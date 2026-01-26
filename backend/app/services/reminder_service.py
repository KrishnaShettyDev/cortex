"""Service for managing reminders and tasks with smart notifications."""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from dateutil import parser as date_parser

from app.models.reminder import Reminder, Task, ReminderStatus, ReminderType
from app.services.push_service import PushService

logger = logging.getLogger(__name__)


class ReminderService:
    """Service for managing reminders with time, location, and event triggers."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.push_service = PushService(db)

    # ==================== REMINDER CRUD ====================

    async def create_reminder(
        self,
        user_id: uuid.UUID,
        title: str,
        remind_at: Optional[datetime] = None,
        body: Optional[str] = None,
        reminder_type: str = ReminderType.TIME.value,
        location_name: Optional[str] = None,
        location_latitude: Optional[float] = None,
        location_longitude: Optional[float] = None,
        location_radius_meters: int = 200,
        event_id: Optional[str] = None,
        minutes_before_event: int = 15,
        is_recurring: bool = False,
        recurrence_pattern: Optional[str] = None,
        source_message: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> Reminder:
        """Create a new reminder."""
        reminder = Reminder(
            user_id=user_id,
            title=title,
            body=body,
            reminder_type=reminder_type,
            remind_at=remind_at,
            location_name=location_name,
            location_latitude=location_latitude,
            location_longitude=location_longitude,
            location_radius_meters=location_radius_meters,
            event_id=event_id,
            minutes_before_event=minutes_before_event,
            is_recurring=is_recurring,
            recurrence_pattern=recurrence_pattern,
            source_message=source_message,
            conversation_id=conversation_id,
            status=ReminderStatus.PENDING.value,
        )

        self.db.add(reminder)
        await self.db.commit()
        await self.db.refresh(reminder)

        logger.info(f"Created reminder '{title}' for user {user_id}")
        return reminder

    async def get_reminder(
        self, reminder_id: uuid.UUID, user_id: uuid.UUID
    ) -> Optional[Reminder]:
        """Get a specific reminder by ID."""
        result = await self.db.execute(
            select(Reminder).where(
                and_(
                    Reminder.id == reminder_id,
                    Reminder.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_reminders(
        self,
        user_id: uuid.UUID,
        status: Optional[str] = None,
        include_completed: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Reminder], int]:
        """List reminders for a user with pagination."""
        base_filter = Reminder.user_id == user_id

        if status:
            status_filter = Reminder.status == status
        elif not include_completed:
            status_filter = Reminder.status.in_([
                ReminderStatus.PENDING.value,
                ReminderStatus.SNOOZED.value,
            ])
        else:
            status_filter = True

        # Get total count
        count_query = select(func.count(Reminder.id)).where(and_(base_filter, status_filter))
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Get paginated results
        query = (
            select(Reminder)
            .where(and_(base_filter, status_filter))
            .order_by(Reminder.remind_at.asc().nullsfirst())
            .offset(offset)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def update_reminder(
        self,
        reminder_id: uuid.UUID,
        user_id: uuid.UUID,
        **kwargs,
    ) -> Optional[Reminder]:
        """Update a reminder."""
        reminder = await self.get_reminder(reminder_id, user_id)
        if not reminder:
            return None

        for key, value in kwargs.items():
            if hasattr(reminder, key) and value is not None:
                setattr(reminder, key, value)

        reminder.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(reminder)

        return reminder

    async def complete_reminder(
        self, reminder_id: uuid.UUID, user_id: uuid.UUID
    ) -> Optional[Reminder]:
        """Mark a reminder as completed."""
        return await self.update_reminder(
            reminder_id,
            user_id,
            status=ReminderStatus.COMPLETED.value,
            completed_at=datetime.utcnow(),
        )

    async def snooze_reminder(
        self,
        reminder_id: uuid.UUID,
        user_id: uuid.UUID,
        snooze_until: datetime,
    ) -> Optional[Reminder]:
        """Snooze a reminder until a specific time."""
        return await self.update_reminder(
            reminder_id,
            user_id,
            status=ReminderStatus.SNOOZED.value,
            remind_at=snooze_until,
        )

    async def cancel_reminder(
        self, reminder_id: uuid.UUID, user_id: uuid.UUID
    ) -> Optional[Reminder]:
        """Cancel a reminder."""
        return await self.update_reminder(
            reminder_id,
            user_id,
            status=ReminderStatus.CANCELLED.value,
        )

    async def delete_reminder(
        self, reminder_id: uuid.UUID, user_id: uuid.UUID
    ) -> bool:
        """Delete a reminder permanently."""
        reminder = await self.get_reminder(reminder_id, user_id)
        if not reminder:
            return False

        await self.db.delete(reminder)
        await self.db.commit()
        return True

    # ==================== TASK CRUD ====================

    async def create_task(
        self,
        user_id: uuid.UUID,
        title: str,
        description: Optional[str] = None,
        due_date: Optional[datetime] = None,
        priority: int = 3,
        source_type: Optional[str] = None,
        source_id: Optional[str] = None,
        extracted_from: Optional[str] = None,
        related_person: Optional[str] = None,
    ) -> Task:
        """Create a new task."""
        task = Task(
            user_id=user_id,
            title=title,
            description=description,
            due_date=due_date,
            priority=priority,
            source_type=source_type,
            source_id=source_id,
            extracted_from=extracted_from,
            related_person=related_person,
        )

        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)

        logger.info(f"Created task '{title}' for user {user_id}")
        return task

    async def list_tasks(
        self,
        user_id: uuid.UUID,
        include_completed: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Task], int]:
        """List tasks for a user with pagination."""
        base_filter = Task.user_id == user_id
        completed_filter = True if include_completed else Task.is_completed == False

        # Get total count
        count_query = select(func.count(Task.id)).where(and_(base_filter, completed_filter))
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Get paginated results
        query = (
            select(Task)
            .where(and_(base_filter, completed_filter))
            .order_by(Task.priority.asc(), Task.due_date.asc().nullsfirst())
            .offset(offset)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all()), total

    async def complete_task(
        self, task_id: uuid.UUID, user_id: uuid.UUID
    ) -> Optional[Task]:
        """Mark a task as completed."""
        result = await self.db.execute(
            select(Task).where(
                and_(Task.id == task_id, Task.user_id == user_id)
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            return None

        task.is_completed = True
        task.completed_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(task)
        return task

    # ==================== NOTIFICATION TRIGGERS ====================

    async def get_pending_time_reminders(
        self,
        within_minutes: int = 1,
    ) -> list[Reminder]:
        """Get all pending time-based reminders that should be sent."""
        now = datetime.utcnow()
        window_end = now + timedelta(minutes=within_minutes)

        result = await self.db.execute(
            select(Reminder).where(
                and_(
                    Reminder.reminder_type == ReminderType.TIME.value,
                    Reminder.status.in_([
                        ReminderStatus.PENDING.value,
                        ReminderStatus.SNOOZED.value,
                    ]),
                    Reminder.remind_at <= window_end,
                    Reminder.remind_at >= now - timedelta(minutes=5),
                )
            )
        )
        return list(result.scalars().all())

    async def send_reminder_notification(self, reminder: Reminder) -> bool:
        """Send push notification for a reminder and update status."""
        try:
            result = await self.push_service.send_notification(
                user_id=reminder.user_id,
                title=reminder.title,
                body=reminder.body or "Tap to view",
                data={
                    "type": "reminder",
                    "reminder_id": str(reminder.id),
                },
            )

            if result.get("sent", 0) > 0:
                reminder.status = ReminderStatus.SENT.value
                reminder.sent_at = datetime.utcnow()
                await self.db.commit()
                logger.info(f"Sent reminder notification: {reminder.title}")
                return True
            return False

        except Exception as e:
            # Handle SQLite test environment gracefully (no push_tokens table)
            if "sqlite" in str(e).lower() or "no such table" in str(e).lower():
                logger.debug(f"Push notifications not available (SQLite/test environment): {e}")
            else:
                logger.error(f"Error sending reminder notification: {e}")
            return False

    async def check_location_reminders(
        self,
        user_id: uuid.UUID,
        latitude: float,
        longitude: float,
    ) -> list[Reminder]:
        """Check if any location-based reminders should be triggered."""
        from math import radians, sin, cos, sqrt, atan2

        def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
            R = 6371000
            phi1, phi2 = radians(lat1), radians(lat2)
            delta_phi = radians(lat2 - lat1)
            delta_lambda = radians(lon2 - lon1)
            a = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
            c = 2 * atan2(sqrt(a), sqrt(1 - a))
            return R * c

        result = await self.db.execute(
            select(Reminder).where(
                and_(
                    Reminder.user_id == user_id,
                    Reminder.reminder_type == ReminderType.LOCATION.value,
                    Reminder.status == ReminderStatus.PENDING.value,
                    Reminder.location_latitude.isnot(None),
                    Reminder.location_longitude.isnot(None),
                )
            )
        )
        reminders = list(result.scalars().all())

        triggered = []
        for reminder in reminders:
            distance = haversine_distance(
                latitude, longitude,
                reminder.location_latitude, reminder.location_longitude
            )
            radius = reminder.location_radius_meters or 200
            if distance <= radius:
                triggered.append(reminder)

        return triggered

    def parse_reminder_from_text(self, text: str) -> dict:
        """Parse reminder details from natural language."""
        import re

        text_lower = text.lower()
        result = {
            "title": "",
            "remind_at": None,
            "reminder_type": ReminderType.TIME.value,
            "location_name": None,
        }

        # Extract title
        to_pattern = r"remind(?:\s+me)?\s+to\s+(.+?)(?:\s+(?:at|in|on|tomorrow|when|by)\s|$)"
        about_pattern = r"remind(?:\s+me)?\s+about\s+(.+?)(?:\s+(?:at|in|on|tomorrow|when|by)\s|$)"

        to_match = re.search(to_pattern, text_lower)
        about_match = re.search(about_pattern, text_lower)

        if to_match:
            result["title"] = to_match.group(1).strip()
        elif about_match:
            result["title"] = about_match.group(1).strip()
        else:
            result["title"] = re.sub(r"^remind(?:\s+me)?\s+", "", text_lower).strip()

        # Check for location-based
        location_patterns = [
            r"when\s+(?:i(?:'m|am))?\s*(?:at|near|by)\s+(?:the\s+)?(.+?)(?:\s|$)",
        ]
        for pattern in location_patterns:
            loc_match = re.search(pattern, text_lower)
            if loc_match:
                result["reminder_type"] = ReminderType.LOCATION.value
                result["location_name"] = loc_match.group(1).strip()
                return result

        # Parse time
        now = datetime.utcnow()

        in_pattern = r"in\s+(\d+)\s+(minute|hour|min|hr)s?"
        in_match = re.search(in_pattern, text_lower)
        if in_match:
            amount = int(in_match.group(1))
            unit = in_match.group(2)
            if unit in ["minute", "min"]:
                result["remind_at"] = now + timedelta(minutes=amount)
            elif unit in ["hour", "hr"]:
                result["remind_at"] = now + timedelta(hours=amount)
            return result

        if "tomorrow" in text_lower:
            tomorrow = now + timedelta(days=1)
            time_pattern = r"at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?"
            time_match = re.search(time_pattern, text_lower)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                ampm = time_match.group(3)
                if ampm == "pm" and hour < 12:
                    hour += 12
                result["remind_at"] = tomorrow.replace(hour=hour, minute=minute, second=0, microsecond=0)
            else:
                result["remind_at"] = tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
            return result

        # Default to 1 hour
        result["remind_at"] = now + timedelta(hours=1)
        return result
