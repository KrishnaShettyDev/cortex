"""
Calendar Memory Service

Creates memories from calendar events so users can recall:
- "What happened in that meeting with Sarah?"
- "When did I last meet with the engineering team?"
- "What did we discuss in the Q4 planning meeting?"

Key features:
- Creates memories from completed calendar events
- Extracts attendees, topics, and context
- Links to email threads about the meeting
- Runs as a scheduled job to process past events
"""

import logging
from datetime import datetime, timedelta
from uuid import UUID
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.config import get_settings
from app.models.memory import Memory
from app.models.integration import ConnectedAccount
from app.services.memory_service import MemoryService
from app.services.sync_service import SyncService
from app.services.fact_extraction_service import FactExtractionService

settings = get_settings()
logger = logging.getLogger(__name__)


class CalendarMemoryService:
    """
    Creates memories from calendar events.

    This allows Cortex to answer questions like:
    - "What did I discuss in my last meeting with Sarah?"
    - "When was my last 1:1 with my manager?"
    - "What meetings did I have last week?"
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.memory_service = MemoryService(db)
        self.sync_service = SyncService(db)

    async def create_memory_from_event(
        self,
        user_id: UUID,
        event: dict,
    ) -> Optional[Memory]:
        """
        Create a memory from a calendar event.

        Args:
            user_id: The user's ID
            event: Calendar event data from Google Calendar

        Returns:
            Created Memory or None if skipped
        """
        event_id = event.get("id")
        title = event.get("summary", event.get("title", "Untitled Event"))
        description = event.get("description", "")
        location = event.get("location", "")
        attendees = event.get("attendees", [])

        # Parse start/end times
        start = event.get("start", {})
        end = event.get("end", {})

        start_time = start.get("dateTime") or start.get("date")
        end_time = end.get("dateTime") or end.get("date")

        if isinstance(start_time, str):
            try:
                if "T" in start_time:
                    start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                else:
                    start_dt = datetime.strptime(start_time, "%Y-%m-%d")
            except Exception:
                start_dt = datetime.utcnow()
        else:
            start_dt = datetime.utcnow()

        # Skip all-day events without meaningful content
        if not description and not attendees and "T" not in str(start_time):
            logger.debug(f"Skipping all-day event without content: {title}")
            return None

        # Check if we already have a memory for this event
        existing = await self._check_existing_memory(user_id, event_id)
        if existing:
            logger.debug(f"Memory already exists for event: {title}")
            return None

        # Format attendees
        attendee_names = []
        for att in attendees:
            email = att.get("email", "")
            name = att.get("displayName") or email.split("@")[0]
            # Skip the user's own email
            if "self" not in att and email:
                attendee_names.append(name)

        # Build memory content
        content_parts = [f"Calendar event: {title}"]

        if attendee_names:
            if len(attendee_names) == 1:
                content_parts.append(f"Meeting with {attendee_names[0]}")
            else:
                content_parts.append(f"Meeting with {', '.join(attendee_names[:5])}")
                if len(attendee_names) > 5:
                    content_parts.append(f"and {len(attendee_names) - 5} others")

        content_parts.append(f"Date: {start_dt.strftime('%B %d, %Y at %I:%M %p')}")

        if location:
            content_parts.append(f"Location: {location}")

        if description:
            # Clean up HTML if present
            clean_desc = description.replace("<br>", "\n").replace("</p>", "\n")
            import re
            clean_desc = re.sub(r'<[^>]+>', '', clean_desc)
            if len(clean_desc) > 500:
                clean_desc = clean_desc[:500] + "..."
            content_parts.append(f"Notes: {clean_desc}")

        content = "\n".join(content_parts)

        # Create the memory
        memory, _ = await self.memory_service.create_memory(
            user_id=user_id,
            content=content,
            memory_type="calendar",
            memory_date=start_dt,
            source_id=f"gcal:{event_id}",
        )

        logger.info(f"Created memory from calendar event: {title}")

        # Extract facts in background
        try:
            fact_service = FactExtractionService(self.db)
            await fact_service.extract_and_save(
                user_id=user_id,
                memory_id=memory.id,
                content=content,
                document_date=start_dt,
            )
        except Exception as e:
            logger.warning(f"Fact extraction failed for calendar memory: {e}")

        return memory

    async def process_recent_events(
        self,
        user_id: UUID,
        days_back: int = 7,
    ) -> list[Memory]:
        """
        Process recent calendar events and create memories.

        Args:
            user_id: The user's ID
            days_back: How many days back to look

        Returns:
            List of created memories
        """
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_back)

        # Get events from calendar
        events_result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        if not events_result.get("success"):
            logger.warning(f"Failed to get calendar events for user {user_id}")
            return []

        events = events_result.get("events", [])
        created_memories = []

        for event in events:
            memory = await self.create_memory_from_event(user_id, event)
            if memory:
                created_memories.append(memory)

        logger.info(
            f"Created {len(created_memories)} memories from {len(events)} "
            f"calendar events for user {user_id}"
        )

        return created_memories

    async def _check_existing_memory(
        self,
        user_id: UUID,
        event_id: str,
    ) -> bool:
        """Check if a memory already exists for this calendar event."""
        source_id = f"gcal:{event_id}"

        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.source_id == source_id,
                )
            )
        )

        return result.scalar_one_or_none() is not None


async def process_calendar_memories_for_all_users(db: AsyncSession) -> int:
    """
    Process calendar events for all users with connected calendars.

    This runs as a scheduled job to create memories from recent calendar events.

    Returns:
        Total number of memories created
    """
    # Get all users with connected Google Calendar
    result = await db.execute(
        select(ConnectedAccount).where(
            and_(
                ConnectedAccount.service == "google_calendar",
                ConnectedAccount.status == "active",
            )
        )
    )

    accounts = result.scalars().all()
    total_created = 0

    for account in accounts:
        try:
            service = CalendarMemoryService(db)
            memories = await service.process_recent_events(
                user_id=account.user_id,
                days_back=1,  # Only process yesterday's events in scheduled job
            )
            total_created += len(memories)
        except Exception as e:
            logger.error(f"Failed to process calendar for user {account.user_id}: {e}")

    logger.info(f"Calendar memory job created {total_created} memories for {len(accounts)} users")
    return total_created
