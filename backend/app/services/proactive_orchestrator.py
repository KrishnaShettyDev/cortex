"""
Proactive Orchestrator Service - Central coordination for all proactive notifications.

This service:
1. Collects pending notifications from all services
2. Scores and ranks by importance
3. Applies daily budget (default: 8)
4. Consolidates similar notifications
5. Respects quiet hours
6. Logs all decisions for learning
"""

import logging
import uuid
from datetime import datetime, timedelta, time, date
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

from app.models.notification_log import NotificationLog
from app.models.notification_preferences import NotificationPreferences
from app.models.user import User
from app.models.push_token import PushToken
from app.services.push_service import PushService

logger = logging.getLogger(__name__)


class NotificationType(str, Enum):
    """Types of proactive notifications."""
    MEETING_PREP = "meeting_prep"
    URGENT_EMAIL = "urgent_email"
    COMMITMENT = "commitment"
    PATTERN_WARNING = "pattern_warning"
    MORNING_BRIEFING = "morning_briefing"
    EVENING_BRIEFING = "evening_briefing"
    IMPORTANT_DATE = "important_date"
    RECONNECTION = "reconnection"
    MEMORY_INSIGHT = "memory_insight"
    INTENTION_NUDGE = "intention_nudge"
    PROMISE_REMINDER = "promise_reminder"
    SNOOZED_EMAIL = "snoozed_email"
    CONNECTION = "connection"
    DECISION_OUTCOME = "decision_outcome"


class UrgencyLevel(str, Enum):
    """Urgency levels for notifications."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Base priority scores for each notification type (0-100)
BASE_PRIORITY_SCORES = {
    NotificationType.MEETING_PREP: 85,
    NotificationType.URGENT_EMAIL: 80,
    NotificationType.COMMITMENT: 75,
    NotificationType.PATTERN_WARNING: 70,
    NotificationType.MORNING_BRIEFING: 65,
    NotificationType.EVENING_BRIEFING: 65,
    NotificationType.IMPORTANT_DATE: 60,
    NotificationType.PROMISE_REMINDER: 70,
    NotificationType.RECONNECTION: 50,
    NotificationType.MEMORY_INSIGHT: 45,
    NotificationType.INTENTION_NUDGE: 65,
    NotificationType.SNOOZED_EMAIL: 55,
    NotificationType.CONNECTION: 40,
    NotificationType.DECISION_OUTCOME: 50,
}


@dataclass
class QueuedNotification:
    """A notification queued for potential delivery."""

    notification_type: NotificationType
    title: str
    body: str
    user_id: uuid.UUID
    priority_score: float = 0.0
    urgency_level: UrgencyLevel = UrgencyLevel.MEDIUM
    source_service: str = ""
    source_id: str = ""
    data: dict = field(default_factory=dict)

    # Scoring modifiers
    time_sensitivity_minutes: int = 0  # How soon is this relevant (0 = not time-sensitive)
    is_from_inner_circle: bool = False
    days_overdue: int = 0
    confidence_score: float = 0.0
    is_today: bool = False

    def calculate_final_score(self) -> float:
        """Calculate the final priority score with all modifiers."""
        base = BASE_PRIORITY_SCORES.get(self.notification_type, 50)
        score = base

        # Time sensitivity modifier (higher priority if happening soon)
        if self.time_sensitivity_minutes > 0:
            if self.time_sensitivity_minutes <= 15:
                score += 15
            elif self.time_sensitivity_minutes <= 30:
                score += 10
            elif self.time_sensitivity_minutes <= 60:
                score += 5

        # Inner circle modifier
        if self.is_from_inner_circle:
            score += 10

        # Overdue modifier
        if self.days_overdue > 0:
            score += min(self.days_overdue * 5, 20)  # Cap at +20

        # Confidence modifier for pattern warnings
        if self.notification_type == NotificationType.PATTERN_WARNING:
            if self.confidence_score >= 0.8:
                score += 10
            elif self.confidence_score >= 0.6:
                score += 5

        # Today modifier for important dates
        if self.is_today:
            score += 20

        self.priority_score = min(score, 100)  # Cap at 100
        return self.priority_score


class ProactiveOrchestrator:
    """
    Central coordinator for all proactive notifications.

    This service runs periodically (every 15 minutes) and:
    1. Collects pending notifications from various services
    2. Scores and ranks them by importance
    3. Applies the user's daily notification budget
    4. Consolidates similar notifications
    5. Respects quiet hours
    6. Sends approved notifications and logs all decisions
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.push_service = PushService(db)

    async def get_user_preferences(self, user_id: uuid.UUID) -> NotificationPreferences:
        """Get or create notification preferences for a user."""
        result = await self.db.execute(
            select(NotificationPreferences).where(
                NotificationPreferences.user_id == user_id
            )
        )
        prefs = result.scalar_one_or_none()

        if not prefs:
            # Create default preferences
            prefs = NotificationPreferences(
                user_id=user_id,
            )
            self.db.add(prefs)
            await self.db.commit()
            await self.db.refresh(prefs)

        return prefs

    async def get_notifications_sent_today(self, user_id: uuid.UUID) -> int:
        """Get count of notifications sent to user today."""
        # Get user's timezone
        prefs = await self.get_user_preferences(user_id)
        tz = ZoneInfo(prefs.timezone) if prefs.timezone else ZoneInfo("UTC")

        # Calculate today's boundaries in user's timezone
        now_local = datetime.now(tz)
        today_start = datetime.combine(now_local.date(), time.min, tzinfo=tz)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

        result = await self.db.execute(
            select(func.count(NotificationLog.id)).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "sent",
                    NotificationLog.sent_at >= today_start_utc,
                )
            )
        )
        return result.scalar() or 0

    async def get_urgent_sent_today(self, user_id: uuid.UUID) -> int:
        """Get count of urgent notifications sent to user today."""
        prefs = await self.get_user_preferences(user_id)
        tz = ZoneInfo(prefs.timezone) if prefs.timezone else ZoneInfo("UTC")

        now_local = datetime.now(tz)
        today_start = datetime.combine(now_local.date(), time.min, tzinfo=tz)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

        result = await self.db.execute(
            select(func.count(NotificationLog.id)).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "sent",
                    NotificationLog.urgency_level == "high",
                    NotificationLog.sent_at >= today_start_utc,
                )
            )
        )
        return result.scalar() or 0

    def is_quiet_hours(self, prefs: NotificationPreferences) -> bool:
        """Check if current time is within user's quiet hours."""
        if not prefs.quiet_hours_enabled:
            return False

        tz = ZoneInfo(prefs.timezone) if prefs.timezone else ZoneInfo("UTC")
        now_local = datetime.now(tz)
        current_time = now_local.time()

        return prefs.is_quiet_hours(current_time)

    async def queue_notification(
        self,
        notification: QueuedNotification,
    ) -> NotificationLog:
        """
        Queue a notification for processing.
        Creates a log entry with status 'queued'.
        """
        notification.calculate_final_score()

        log = NotificationLog(
            user_id=notification.user_id,
            notification_type=notification.notification_type.value,
            title=notification.title,
            body=notification.body,
            priority_score=notification.priority_score,
            urgency_level=notification.urgency_level.value,
            source_service=notification.source_service,
            source_id=notification.source_id,
            status="queued",
            data=notification.data,
        )

        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)

        logger.debug(
            f"Queued notification: {notification.notification_type.value} "
            f"for user {notification.user_id} (score: {notification.priority_score})"
        )

        return log

    async def process_user_notifications(
        self,
        user_id: uuid.UUID,
    ) -> dict:
        """
        Process all queued notifications for a user.

        Returns stats about what was sent/suppressed/consolidated.
        """
        stats = {
            "sent": 0,
            "suppressed": 0,
            "consolidated": 0,
            "quiet_hours_queued": 0,
        }

        prefs = await self.get_user_preferences(user_id)

        # Check quiet hours
        if self.is_quiet_hours(prefs):
            logger.debug(f"User {user_id} is in quiet hours, skipping processing")
            # Get count of queued notifications
            result = await self.db.execute(
                select(func.count(NotificationLog.id)).where(
                    and_(
                        NotificationLog.user_id == user_id,
                        NotificationLog.status == "queued",
                    )
                )
            )
            stats["quiet_hours_queued"] = result.scalar() or 0
            return stats

        # Get budget remaining
        sent_today = await self.get_notifications_sent_today(user_id)
        urgent_today = await self.get_urgent_sent_today(user_id)

        budget_remaining = max(0, prefs.max_notifications_per_day - sent_today)
        urgent_budget_remaining = max(0, prefs.max_urgent_per_day - urgent_today)

        if budget_remaining == 0:
            logger.debug(f"User {user_id} has exhausted daily notification budget")
            return stats

        # Get queued notifications, ordered by priority
        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "queued",
                )
            ).order_by(NotificationLog.priority_score.desc())
        )
        queued = list(result.scalars().all())

        if not queued:
            return stats

        # Consolidate similar notifications
        consolidated_queued = await self._consolidate_notifications(queued)

        # Process notifications up to budget
        for notification in consolidated_queued:
            if budget_remaining == 0:
                # Mark remaining as suppressed (budget)
                notification.status = "suppressed"
                await self.db.commit()
                stats["suppressed"] += 1
                continue

            # Check if feature is enabled
            feature_name = notification.notification_type.replace("_", "_")
            if not prefs.is_feature_enabled(feature_name):
                notification.status = "suppressed"
                await self.db.commit()
                stats["suppressed"] += 1
                continue

            # Check urgent budget for high priority
            if notification.urgency_level == "high":
                if urgent_budget_remaining == 0:
                    # Downgrade to medium or suppress
                    notification.urgency_level = "medium"
                else:
                    urgent_budget_remaining -= 1

            # Send notification
            try:
                result = await self.push_service.send_notification(
                    user_id=str(user_id),
                    title=notification.title,
                    body=notification.body,
                    data=notification.data or {},
                )

                if result.get("sent", 0) > 0:
                    notification.status = "sent"
                    notification.sent_at = datetime.utcnow()
                    stats["sent"] += 1
                    budget_remaining -= 1
                else:
                    notification.status = "suppressed"
                    stats["suppressed"] += 1

            except Exception as e:
                logger.error(f"Failed to send notification {notification.id}: {e}")
                notification.status = "suppressed"
                stats["suppressed"] += 1

            await self.db.commit()

        return stats

    async def _consolidate_notifications(
        self,
        notifications: list[NotificationLog],
    ) -> list[NotificationLog]:
        """
        Consolidate similar notifications into summary notifications.

        For example, 3 urgent emails become "3 emails need your attention".
        """
        if len(notifications) <= 1:
            return notifications

        # Group by type
        by_type: dict[str, list[NotificationLog]] = {}
        for n in notifications:
            if n.notification_type not in by_type:
                by_type[n.notification_type] = []
            by_type[n.notification_type].append(n)

        consolidated = []

        for ntype, group in by_type.items():
            if len(group) <= 2:
                # Keep individual notifications
                consolidated.extend(group)
            else:
                # Create consolidated notification
                primary = group[0]  # Highest priority
                count = len(group)

                # Update primary to be the consolidated one
                type_label = self._get_type_label(ntype, count)
                primary.title = f"{count} {type_label}"
                primary.body = self._get_consolidated_body(ntype, group)
                primary.data = {
                    **(primary.data or {}),
                    "consolidated": True,
                    "count": count,
                    "source_ids": [str(n.source_id) for n in group if n.source_id],
                }

                # Mark others as consolidated
                for other in group[1:]:
                    other.status = "consolidated"
                    other.consolidated_into_id = primary.id

                consolidated.append(primary)
                await self.db.commit()

        # Re-sort by priority
        consolidated.sort(key=lambda n: n.priority_score, reverse=True)

        return consolidated

    def _get_type_label(self, ntype: str, count: int) -> str:
        """Get human-readable label for notification type."""
        labels = {
            "urgent_email": "emails need attention",
            "meeting_prep": "upcoming meetings",
            "commitment": "commitments due",
            "pattern_warning": "pattern alerts",
            "reconnection": "people to reconnect with",
            "memory_insight": "memory insights",
            "intention_nudge": "things you said you'd do",
            "important_date": "important dates coming up",
            "promise_reminder": "promises to keep",
        }
        return labels.get(ntype, "notifications")

    def _get_consolidated_body(
        self,
        ntype: str,
        notifications: list[NotificationLog],
    ) -> str:
        """Generate body text for consolidated notification."""
        # Get first few items for summary
        items = []
        for n in notifications[:3]:
            if n.data and "person_name" in n.data:
                items.append(n.data["person_name"])
            elif n.data and "subject" in n.data:
                items.append(n.data["subject"][:30])
            else:
                items.append(n.title[:30])

        if len(notifications) > 3:
            return f"{', '.join(items)} and {len(notifications) - 3} more"
        return ", ".join(items)

    async def process_all_users(self) -> dict:
        """
        Process notifications for all users with active push tokens.

        This is the main entry point, called by the scheduler every 15 minutes.
        """
        logger.info("Starting proactive notification processing")

        # Get all users with active push tokens
        result = await self.db.execute(
            select(User)
            .join(PushToken)
            .where(PushToken.is_active == True)
            .distinct()
        )
        users = list(result.scalars().all())

        total_stats = {
            "users_processed": 0,
            "sent": 0,
            "suppressed": 0,
            "consolidated": 0,
            "quiet_hours_queued": 0,
        }

        for user in users:
            try:
                stats = await self.process_user_notifications(user.id)
                total_stats["users_processed"] += 1
                total_stats["sent"] += stats.get("sent", 0)
                total_stats["suppressed"] += stats.get("suppressed", 0)
                total_stats["consolidated"] += stats.get("consolidated", 0)
                total_stats["quiet_hours_queued"] += stats.get("quiet_hours_queued", 0)
            except Exception as e:
                logger.error(f"Error processing notifications for user {user.id}: {e}")

        logger.info(
            f"Proactive processing complete: {total_stats['users_processed']} users, "
            f"{total_stats['sent']} sent, {total_stats['suppressed']} suppressed"
        )

        return total_stats

    async def dismiss_notification(
        self,
        notification_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Mark a notification as dismissed by the user."""
        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.id == notification_id,
                    NotificationLog.user_id == user_id,
                )
            )
        )
        notification = result.scalar_one_or_none()

        if not notification:
            return False

        notification.action_taken = "dismissed"
        await self.db.commit()
        return True

    async def snooze_notification(
        self,
        notification_id: uuid.UUID,
        user_id: uuid.UUID,
        snooze_until: datetime,
    ) -> bool:
        """Snooze a notification until a specific time."""
        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.id == notification_id,
                    NotificationLog.user_id == user_id,
                )
            )
        )
        notification = result.scalar_one_or_none()

        if not notification:
            return False

        notification.status = "snoozed"
        notification.snoozed_until = snooze_until
        notification.action_taken = "snoozed"
        await self.db.commit()
        return True

    async def process_snoozed_notifications(self) -> int:
        """
        Re-queue snoozed notifications that are now due.
        Returns count of notifications re-queued.
        """
        now = datetime.utcnow()

        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.status == "snoozed",
                    NotificationLog.snoozed_until <= now,
                )
            )
        )
        snoozed = list(result.scalars().all())

        for notification in snoozed:
            notification.status = "queued"
            notification.snoozed_until = None

        if snoozed:
            await self.db.commit()
            logger.info(f"Re-queued {len(snoozed)} snoozed notifications")

        return len(snoozed)

    async def record_notification_opened(
        self,
        notification_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        """Record when a user opens/taps a notification."""
        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.id == notification_id,
                    NotificationLog.user_id == user_id,
                )
            )
        )
        notification = result.scalar_one_or_none()

        if not notification:
            return False

        notification.opened_at = datetime.utcnow()
        notification.action_taken = "tapped"
        await self.db.commit()
        return True

    async def get_notification_history(
        self,
        user_id: uuid.UUID,
        days: int = 7,
        limit: int = 50,
        offset: int = 0,
    ) -> list[NotificationLog]:
        """Get notification history for a user with pagination."""
        cutoff = datetime.utcnow() - timedelta(days=days)

        result = await self.db.execute(
            select(NotificationLog).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.created_at >= cutoff,
                )
            ).order_by(NotificationLog.created_at.desc()).offset(offset).limit(limit)
        )

        return list(result.scalars().all())

    async def get_notification_stats(
        self,
        user_id: uuid.UUID,
        days: int = 7,
    ) -> dict:
        """Get notification statistics for a user."""
        cutoff = datetime.utcnow() - timedelta(days=days)

        # Total sent
        sent_result = await self.db.execute(
            select(func.count(NotificationLog.id)).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "sent",
                    NotificationLog.created_at >= cutoff,
                )
            )
        )
        total_sent = sent_result.scalar() or 0

        # Total opened
        opened_result = await self.db.execute(
            select(func.count(NotificationLog.id)).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "sent",
                    NotificationLog.opened_at.isnot(None),
                    NotificationLog.created_at >= cutoff,
                )
            )
        )
        total_opened = opened_result.scalar() or 0

        # Total suppressed
        suppressed_result = await self.db.execute(
            select(func.count(NotificationLog.id)).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "suppressed",
                    NotificationLog.created_at >= cutoff,
                )
            )
        )
        total_suppressed = suppressed_result.scalar() or 0

        # By type
        by_type_result = await self.db.execute(
            select(
                NotificationLog.notification_type,
                func.count(NotificationLog.id),
            ).where(
                and_(
                    NotificationLog.user_id == user_id,
                    NotificationLog.status == "sent",
                    NotificationLog.created_at >= cutoff,
                )
            ).group_by(NotificationLog.notification_type)
        )
        by_type = {row[0]: row[1] for row in by_type_result}

        open_rate = (total_opened / total_sent * 100) if total_sent > 0 else 0

        return {
            "period_days": days,
            "total_sent": total_sent,
            "total_opened": total_opened,
            "total_suppressed": total_suppressed,
            "open_rate_percent": round(open_rate, 1),
            "by_type": by_type,
            "average_per_day": round(total_sent / days, 1) if days > 0 else 0,
        }
