"""Service for sending push notifications via Expo Push API."""

import httpx
import uuid
import logging
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_token import PushToken
from app.models.notification_log import NotificationLog

logger = logging.getLogger(__name__)


class PushService:
    """Service for managing push tokens and sending notifications."""

    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

    def __init__(self, db: AsyncSession):
        self.db = db

    async def register_token(
        self,
        user_id: str | uuid.UUID,
        push_token: str,
        platform: str,
        device_name: str | None = None,
    ) -> PushToken:
        """Register or update a push token for a user."""
        if isinstance(user_id, str):
            user_id = uuid.UUID(user_id)

        # Check if token already exists
        result = await self.db.execute(
            select(PushToken).where(PushToken.push_token == push_token)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing token
            existing.user_id = user_id
            existing.is_active = True
            existing.last_used_at = datetime.utcnow()
            existing.device_name = device_name or existing.device_name
            existing.platform = platform
        else:
            # Create new token
            existing = PushToken(
                user_id=user_id,
                push_token=push_token,
                platform=platform,
                device_name=device_name,
            )
            self.db.add(existing)

        await self.db.commit()
        await self.db.refresh(existing)
        return existing

    async def unregister_token(self, push_token: str) -> bool:
        """Deactivate a push token."""
        result = await self.db.execute(
            select(PushToken).where(PushToken.push_token == push_token)
        )
        token = result.scalar_one_or_none()

        if token:
            token.is_active = False
            await self.db.commit()
            return True
        return False

    async def get_user_tokens(self, user_id: str | uuid.UUID) -> list[PushToken]:
        """Get all active push tokens for a user."""
        if isinstance(user_id, str):
            user_id = uuid.UUID(user_id)

        result = await self.db.execute(
            select(PushToken).where(
                PushToken.user_id == user_id,
                PushToken.is_active == True,
            )
        )
        return list(result.scalars().all())

    async def get_all_active_tokens(self) -> list[PushToken]:
        """Get all active push tokens (for broadcast notifications)."""
        result = await self.db.execute(
            select(PushToken).where(PushToken.is_active == True)
        )
        return list(result.scalars().all())

    async def send_notification(
        self,
        user_id: str | uuid.UUID,
        title: str,
        body: str,
        data: dict | None = None,
        badge: int | None = None,
        log_notification: bool = False,
        notification_type: str = "general",
        priority_score: float = 50.0,
        urgency_level: str = "medium",
        source_service: str | None = None,
    ) -> dict:
        """
        Send push notification to all user's devices.

        Args:
            user_id: The user to send to
            title: Notification title
            body: Notification body
            data: Additional data payload
            badge: Badge count
            log_notification: Whether to log this notification
            notification_type: Type for logging (e.g., 'meeting_prep', 'briefing')
            priority_score: Priority score for logging (0-100)
            urgency_level: Urgency level for logging ('high', 'medium', 'low')
            source_service: Service that generated the notification

        Returns:
            Dict with 'sent' and 'failed' counts
        """
        if isinstance(user_id, str):
            user_id = uuid.UUID(user_id)

        tokens = await self.get_user_tokens(user_id)

        if not tokens:
            return {"sent": 0, "failed": 0, "error": "No active tokens"}

        result = await self._send_to_tokens(tokens, title, body, data, badge)

        # Optionally log the notification
        if log_notification:
            try:
                log_entry = NotificationLog(
                    user_id=user_id,
                    notification_type=notification_type,
                    title=title,
                    body=body,
                    priority_score=priority_score,
                    urgency_level=urgency_level,
                    source_service=source_service,
                    status="sent" if result.get("sent", 0) > 0 else "suppressed",
                    sent_at=datetime.utcnow() if result.get("sent", 0) > 0 else None,
                    data=data,
                )
                self.db.add(log_entry)
                await self.db.commit()
            except Exception as e:
                logger.error(f"Failed to log notification: {e}")

        return result

    async def send_to_token(
        self,
        push_token: str,
        title: str,
        body: str,
        data: dict | None = None,
        badge: int | None = None,
    ) -> bool:
        """Send push notification to a specific token."""
        message = self._build_message(push_token, title, body, data, badge)

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.EXPO_PUSH_URL,
                json=[message],
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=10.0,
            )

        if response.status_code != 200:
            return False

        result = response.json()
        tickets = result.get("data", [])
        return len(tickets) > 0 and tickets[0].get("status") == "ok"

    async def _send_to_tokens(
        self,
        tokens: list[PushToken],
        title: str,
        body: str,
        data: dict | None = None,
        badge: int | None = None,
    ) -> dict:
        """Send notifications to multiple tokens."""
        messages = [
            self._build_message(token.push_token, title, body, data, badge)
            for token in tokens
        ]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=30.0,
            )

        if response.status_code != 200:
            return {"sent": 0, "failed": len(messages), "error": "API error"}

        result = response.json()
        tickets = result.get("data", [])

        sent = sum(1 for t in tickets if t.get("status") == "ok")
        failed = len(messages) - sent

        # Deactivate invalid tokens
        for i, ticket in enumerate(tickets):
            if ticket.get("status") == "error":
                error_type = ticket.get("details", {}).get("error")
                if error_type in ["DeviceNotRegistered", "InvalidCredentials"]:
                    await self.unregister_token(tokens[i].push_token)

        return {"sent": sent, "failed": failed}

    def _build_message(
        self,
        push_token: str,
        title: str,
        body: str,
        data: dict | None = None,
        badge: int | None = None,
    ) -> dict:
        """Build an Expo push message."""
        message = {
            "to": push_token,
            "title": title,
            "body": body,
            "sound": "default",
            "priority": "high",
        }

        if data:
            message["data"] = data

        if badge is not None:
            message["badge"] = badge

        return message
