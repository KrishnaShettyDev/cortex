"""Service for generating daily briefings (morning and evening)."""

import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
from sqlalchemy import select, and_, or_, desc, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory

logger = logging.getLogger(__name__)
settings = get_settings()


# Briefing item types
BRIEFING_ICONS = {
    "calendar": "calendar",
    "email": "mail",
    "reminder": "alarm",
    "task": "checkbox",
    "test": "school",
    "meeting": "people",
    "deadline": "time",
    "followup": "arrow-redo",
}


class BriefingService:
    """Service for generating daily briefings with a minimal, zen-like tone."""

    MORNING_PROMPT = """Generate a morning briefing. Be calm. Brief. Zen-like.

Format exactly like this:
Good morning.

[If events today, list 2-3 key ones:]
- [time]: [event]

[If emails need attention, one line:]
[X] emails. [One notable if any.]

[If open loops/intentions, mention naturally:]
Remember: [brief mention of oldest open loop]

[End with one calming line.]

---
Today: {date}
Calendar: {calendar}
Emails: {emails}
Open loops: {intentions}
"""

    EVENING_PROMPT = """Generate an evening reflection. Calm. Reflective. Brief.

Format exactly like this:
Good evening.

[One line about today]

[If tomorrow has events:]
Tomorrow: [brief preview]

[One calming line for rest.]

---
Today: {date}
Events: {calendar}
Tomorrow: {tomorrow}
"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate_morning_briefing(self, user_id: str) -> str:
        """Generate morning briefing content for a user."""
        today = datetime.now().date()
        tomorrow = today + timedelta(days=1)
        yesterday = datetime.now() - timedelta(hours=24)

        # Get today's calendar events
        calendar_result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "calendar",
                    Memory.memory_date >= datetime.combine(today, datetime.min.time()),
                    Memory.memory_date < datetime.combine(tomorrow, datetime.min.time()),
                )
            ).order_by(Memory.memory_date).limit(5)
        )
        calendar_events = calendar_result.scalars().all()

        # Get recent emails (last 24 hours)
        email_result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "email",
                    Memory.memory_date >= yesterday,
                )
            ).order_by(Memory.memory_date.desc()).limit(10)
        )
        emails = email_result.scalars().all()

        # Get pending intentions (from both tables)
        intentions_result = await self.db.execute(
            text("""
                SELECT action, subject,
                       EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as days_old
                FROM cortex_user_intentions
                WHERE user_id = :user_id
                AND status = 'pending'
                ORDER BY created_at ASC
                LIMIT 3
            """),
            {"user_id": user_id}
        )
        intentions = intentions_result.fetchall()

        # Format for prompt
        calendar_text = self._format_calendar(calendar_events) if calendar_events else "No events today."
        email_text = self._format_emails(emails) if emails else "No recent emails."
        intentions_text = self._format_intentions(intentions) if intentions else "None."

        prompt = self.MORNING_PROMPT.format(
            date=today.strftime("%A, %B %d"),
            calendar=calendar_text,
            emails=email_text,
            intentions=intentions_text,
        )

        response = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=300,
        )

        return response.choices[0].message.content.strip()

    async def generate_evening_briefing(self, user_id: str) -> str:
        """Generate evening reflection content for a user."""
        today = datetime.now().date()
        tomorrow = today + timedelta(days=1)
        day_after = tomorrow + timedelta(days=1)

        # Get today's completed events
        today_result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "calendar",
                    Memory.memory_date >= datetime.combine(today, datetime.min.time()),
                    Memory.memory_date < datetime.combine(tomorrow, datetime.min.time()),
                )
            ).limit(5)
        )
        today_events = today_result.scalars().all()

        # Get tomorrow's events
        tomorrow_result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "calendar",
                    Memory.memory_date >= datetime.combine(tomorrow, datetime.min.time()),
                    Memory.memory_date < datetime.combine(day_after, datetime.min.time()),
                )
            ).order_by(Memory.memory_date).limit(3)
        )
        tomorrow_events = tomorrow_result.scalars().all()

        prompt = self.EVENING_PROMPT.format(
            date=today.strftime("%A, %B %d"),
            calendar=self._format_calendar(today_events) if today_events else "A quiet day.",
            tomorrow=self._format_calendar(tomorrow_events) if tomorrow_events else "Tomorrow is clear.",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=300,
        )

        return response.choices[0].message.content.strip()

    def _format_calendar(self, events: list[Memory]) -> str:
        """Format calendar events for the prompt."""
        if not events:
            return "No events."

        lines = []
        for event in events:
            # Extract title from content
            title = self._extract_event_title(event.content)
            time_str = event.memory_date.strftime("%I:%M %p").lstrip("0")
            lines.append(f"- {time_str}: {title}")
        return "\n".join(lines)

    def _format_emails(self, emails: list[Memory]) -> str:
        """Format emails for the prompt."""
        if not emails:
            return "No emails."

        count = len(emails)
        # Extract first notable sender
        senders = []
        for email in emails[:3]:
            sender = self._extract_email_sender(email.content)
            if sender and sender not in senders:
                senders.append(sender)

        if senders:
            return f"{count} emails. From: {', '.join(senders[:2])}"
        return f"{count} emails waiting."

    def _format_intentions(self, intentions: list) -> str:
        """Format pending intentions for the prompt."""
        if not intentions:
            return "None."

        lines = []
        for intent in intentions:
            days = int(intent.days_old)
            action = intent.action
            if days >= 3:
                lines.append(f"- {action} ({days} days ago)")
            else:
                lines.append(f"- {action}")
        return "\n".join(lines)

    def _extract_event_title(self, content: str) -> str:
        """Extract event title from memory content."""
        for line in content.split("\n"):
            if ":" in line and "Calendar" not in line:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    return parts[1].strip()[:50]
            if not line.startswith("-") and len(line) > 5:
                return line.strip()[:50]
        return "Event"

    def _extract_email_sender(self, content: str) -> str:
        """Extract sender name from email content."""
        for line in content.split("\n"):
            lower = line.lower()
            if "from:" in lower or "from " in lower:
                # Extract name part
                parts = line.split(":", 1) if ":" in line else line.split(" from ", 1)
                if len(parts) > 1:
                    sender = parts[1].strip()
                    # Remove email address if present
                    if "<" in sender:
                        sender = sender.split("<")[0].strip()
                    if "@" in sender:
                        sender = sender.split("@")[0]
                    return sender[:20]
        return None

    # ==================== ACTIONABLE BRIEFING ====================

    async def get_actionable_briefing(self, user_id: UUID) -> dict:
        """
        Generate a structured, actionable briefing for the UI.

        Returns items that the user can take immediate action on,
        each with a pre-filled chat prompt.

        Items are prioritized by urgency:
        1. Overdue items (reminders, deadlines)
        2. Due today
        3. Upcoming (tomorrow)
        4. Emails needing response
        5. Patterns/insights
        """
        from app.services.reminder_service import ReminderService
        from app.services.sync_service import SyncService
        from app.services.pattern_service import PatternService

        items = []
        now = datetime.now()
        today = now.date()
        tomorrow = today + timedelta(days=1)

        logger.debug(f"Starting briefing for user {user_id}, today: {today}, tomorrow: {tomorrow}")

        # 1. Get calendar events for today and tomorrow
        try:
            calendar_items = await self._get_calendar_items(user_id, today, tomorrow)
            logger.debug(f"Got {len(calendar_items)} calendar items")
            items.extend(calendar_items)
        except Exception as e:
            logger.error(f"Error in _get_calendar_items: {e}", exc_info=True)

        # 2. Get due/overdue reminders
        try:
            reminder_items = await self._get_reminder_items(user_id)
            logger.debug(f"Got {len(reminder_items)} reminder items")
            items.extend(reminder_items)
        except Exception as e:
            logger.error(f"Error in _get_reminder_items: {e}")

        # 3. Get emails needing attention
        try:
            email_items = await self._get_email_items(user_id)
            logger.debug(f"Got {len(email_items)} email items")
            items.extend(email_items)
        except Exception as e:
            logger.error(f"Error in _get_email_items: {e}")

        # 4. Get pattern-based insights
        pattern_items = await self._get_pattern_items(user_id)
        items.extend(pattern_items)

        # 5. Get memory-based insights (tests, assignments, deadlines from conversations)
        memory_items = await self._get_memory_based_items(user_id)
        items.extend(memory_items)

        logger.debug(f"Total items before sort: {len(items)}")

        # Sort by urgency (higher = more urgent)
        items.sort(key=lambda x: x.get("urgency_score", 0), reverse=True)

        # Limit to top 8 most important (show more variety)
        top_items = items[:8]

        return {
            "items": top_items,
            "total_count": len(items),
            "has_urgent": any(i.get("urgency") == "high" for i in top_items),
            "generated_at": now.isoformat(),
        }

    async def _get_calendar_items(self, user_id: UUID, today, tomorrow) -> list:
        """Get actionable calendar items for today and tomorrow from Google Calendar."""
        items = []
        now = datetime.now()
        logger.debug(f"Getting calendar items for {today} to {tomorrow}")

        try:
            from app.services.sync_service import SyncService
            sync_service = SyncService(self.db)

            # Fetch events directly from Google Calendar
            start_date = datetime.combine(today, datetime.min.time())
            end_date = datetime.combine(tomorrow + timedelta(days=1), datetime.min.time())

            result = await sync_service.get_calendar_events(user_id, start_date, end_date)

            logger.debug(f"Calendar result: success={result.get('success')}, events_count={len(result.get('events', []))}")

            if not result.get("success") or not result.get("events"):
                return items

            for event in result["events"][:10]:
                # Parse event time - get_calendar_events returns datetime objects
                event_time = event.get("start_time")

                # Handle if it's a string (from raw API)
                if isinstance(event_time, str):
                    try:
                        if "T" in event_time:
                            event_time = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
                        else:
                            continue  # All-day event, skip for now
                    except Exception:
                        logger.warning(f"Failed to parse event time string: {event_time}")
                        continue
                elif event_time is None:
                    # Try nested structure from raw API
                    start_obj = event.get("start", {})
                    event_time_str = start_obj.get("dateTime") or start_obj.get("date")
                    if not event_time_str:
                        continue
                    try:
                        if "T" in str(event_time_str):
                            event_time = datetime.fromisoformat(event_time_str.replace("Z", "+00:00"))
                        else:
                            continue  # All-day event
                    except Exception:
                        logger.warning(f"Failed to parse nested event time: {event_time_str}")
                        continue

                # Make sure we have a valid datetime
                if not isinstance(event_time, datetime):
                    logger.warning(f"Invalid event_time type: {type(event_time)}")
                    continue

                # Convert to naive datetime for comparison (strip timezone)
                if event_time.tzinfo is not None:
                    event_time = event_time.replace(tzinfo=None)

                title = event.get("title") or event.get("summary") or "Untitled Event"
                event_date = event_time.date()
                is_today = event_date == today

                # Calculate time difference - now is local, event_time was UTC
                # Events come from Google Calendar as UTC, convert now to UTC for comparison
                now_utc = datetime.utcnow()
                time_diff = (event_time - now_utc).total_seconds()
                is_soon = is_today and 0 < time_diff < 7200  # Within 2 hours and not past

                # Skip past events
                if time_diff < -3600:  # More than 1 hour ago
                    continue

                # Determine urgency
                if is_soon:
                    urgency = "high"
                    urgency_score = 100
                    minutes = int(time_diff / 60)
                    subtitle = f"In {minutes} minutes" if minutes > 0 else "Starting now"
                elif is_today:
                    urgency = "medium"
                    urgency_score = 70
                    subtitle = f"Today at {event_time.strftime('%I:%M %p').lstrip('0')}"
                else:
                    urgency = "low"
                    urgency_score = 40
                    subtitle = f"Tomorrow at {event_time.strftime('%I:%M %p').lstrip('0')}"

                # Determine if it's a meeting
                attendees = event.get("attendees", [])
                has_meet_link = "meet.google" in str(event.get("hangoutLink", "")) or "meet.google" in str(event.get("location", ""))
                is_meeting = len(attendees) > 0 or has_meet_link

                event_id = event.get("id") or f"cal_{hash(title + str(event_time)) % 100000}"
                items.append({
                    "id": event_id,
                    "type": "meeting" if is_meeting else "calendar",
                    "title": title,
                    "subtitle": subtitle,
                    "urgency": urgency,
                    "urgency_score": urgency_score,
                    "icon": "people" if is_meeting else "calendar",
                    "action_label": "Prep for this" if is_meeting else "View details",
                    "action_prompt": f"Help me prepare for my {'meeting' if is_meeting else 'event'}: {title}. What should I know or prepare?",
                    "source_id": event.get("id"),
                })

        except Exception as e:
            logger.error(f"Error fetching calendar items: {e}", exc_info=True)

        return items

    async def _get_reminder_items(self, user_id: UUID) -> list:
        """Get due and overdue reminders."""
        items = []

        try:
            from app.models.reminder import Reminder

            now = datetime.now()

            # Get pending reminders that are due or overdue
            result = await self.db.execute(
                select(Reminder).where(
                    and_(
                        Reminder.user_id == user_id,
                        Reminder.status == "pending",
                        Reminder.remind_at <= now + timedelta(hours=24),
                    )
                ).order_by(Reminder.remind_at).limit(5)
            )
            reminders = result.scalars().all()

            for reminder in reminders:
                remind_at = reminder.remind_at
                # Normalize to naive datetime for comparison
                if remind_at.tzinfo is not None:
                    remind_at = remind_at.replace(tzinfo=None)

                is_overdue = remind_at < now

                if is_overdue:
                    urgency = "high"
                    urgency_score = 95
                    subtitle = f"Overdue by {self._format_time_diff(now - remind_at)}"
                else:
                    time_until = remind_at - now
                    if time_until.total_seconds() < 3600:
                        urgency = "high"
                        urgency_score = 90
                        subtitle = f"Due in {int(time_until.total_seconds() / 60)} minutes"
                    elif time_until.total_seconds() < 14400:  # 4 hours
                        urgency = "medium"
                        urgency_score = 60
                        subtitle = f"Due in {int(time_until.total_seconds() / 3600)} hours"
                    else:
                        urgency = "low"
                        urgency_score = 30
                        subtitle = f"Due {remind_at.strftime('%I:%M %p').lstrip('0')}"

                items.append({
                    "id": str(reminder.id),
                    "type": "reminder",
                    "title": reminder.title,
                    "subtitle": subtitle,
                    "urgency": urgency,
                    "urgency_score": urgency_score,
                    "icon": "alarm",
                    "action_label": "Complete this",
                    "action_prompt": f"Help me complete this: {reminder.title}",
                })
        except Exception:
            pass  # Reminders table might not exist

        return items

    async def _get_email_items(self, user_id: UUID) -> list:
        """Get emails needing response from Gmail."""
        items = []

        try:
            from app.services.sync_service import SyncService
            sync_service = SyncService(self.db)

            # Search for recent unread emails
            result = await sync_service.search_emails(
                user_id,
                query="is:unread newer_than:2d",
                max_results=15
            )

            logger.debug(f"Email result: success={result.get('success')}, emails_count={len(result.get('emails', []))}")

            if not result.get("success") or not result.get("emails"):
                return items

            emails = result["emails"]
            urgent_emails = []
            regular_emails = []

            for email in emails:
                subject = email.get("subject", "No subject")
                sender = email.get("from") or email.get("sender") or "Unknown"
                snippet = email.get("snippet", "")

                # Extract just the name from sender
                if sender and "<" in sender:
                    sender = sender.split("<")[0].strip().strip('"')

                # Check for urgency signals
                content_lower = (subject + " " + snippet).lower()
                is_urgent = any(word in content_lower for word in [
                    "urgent", "asap", "immediately", "deadline", "due today",
                    "action required", "response needed", "waiting for", "important"
                ])

                email_data = {
                    "id": email.get("id") or f"email_{hash(subject + sender) % 100000}",
                    "thread_id": email.get("thread_id", ""),
                    "sender": sender,
                    "subject": subject,
                }

                if is_urgent:
                    urgent_emails.append(email_data)
                else:
                    regular_emails.append(email_data)

            # Add urgent emails individually
            for email in urgent_emails[:2]:
                items.append({
                    "id": email["id"],
                    "type": "email",
                    "title": f"From {email['sender'][:25]}",
                    "subtitle": email["subject"][:40],
                    "urgency": "high",
                    "urgency_score": 85,
                    "icon": "mail",
                    "action_label": "Reply now",
                    "action_prompt": f"Help me reply to the email from {email['sender']} about: {email['subject']}",
                })

            # Add summary for unread emails
            total_unread = len(urgent_emails) + len(regular_emails)
            if total_unread > 0 and len(items) < 2:
                senders = list(set(e["sender"] for e in (urgent_emails + regular_emails)[:5]))
                items.append({
                    "id": "email_summary",
                    "type": "email",
                    "title": f"{total_unread} unread email{'s' if total_unread > 1 else ''}",
                    "subtitle": f"From {', '.join(senders[:2])}{'...' if len(senders) > 2 else ''}",
                    "urgency": "medium" if total_unread > 5 else "low",
                    "urgency_score": 45 if total_unread > 5 else 25,
                    "icon": "mail-unread",
                    "action_label": "Review emails",
                    "action_prompt": "Help me go through my unread emails and identify what needs my attention",
                })

        except Exception as e:
            logger.error(f"Error fetching email items: {e}", exc_info=True)

        return items

    async def _get_pattern_items(self, user_id: UUID) -> list:
        """Get pattern-based insights and warnings."""
        items = []

        try:
            from app.services.pattern_service import PatternService
            pattern_service = PatternService(self.db)

            # Get negative patterns that might need attention
            patterns = await pattern_service.get_negative_patterns(user_id)

            for pattern in patterns[:2]:  # Limit to top 2
                items.append({
                    "id": f"pattern_{pattern.id}",
                    "type": "pattern",
                    "title": pattern.name or "Pattern detected",
                    "subtitle": (pattern.warning_message or pattern.description or "")[:50],
                    "urgency": "medium",
                    "urgency_score": 50,
                    "icon": "bulb",
                    "action_label": "Get advice",
                    "action_prompt": f"I notice I have a pattern of {pattern.name or 'this behavior'}. Can you help me understand it and suggest how to improve?",
                })
        except Exception:
            pass

        return items

    async def _get_memory_based_items(self, user_id: UUID) -> list:
        """
        Scan recent memories for actionable items like:
        - Tests/exams mentioned
        - Assignments/deadlines
        - Meetings scheduled
        - Commitments made
        """
        items = []

        # Get recent memories (last 7 days)
        cutoff = datetime.now() - timedelta(days=7)

        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_date >= cutoff,
                    Memory.memory_type.in_(["text", "voice", "chat"]),
                )
            ).order_by(desc(Memory.memory_date)).limit(50)
        )
        memories = result.scalars().all()

        now = datetime.now()
        today = now.date()
        tomorrow = today + timedelta(days=1)

        for memory in memories:
            content_lower = memory.content.lower()

            # Detect test/exam mentions
            if any(word in content_lower for word in ["test", "exam", "quiz", "midterm", "final"]):
                # Look for date mentions
                if "tomorrow" in content_lower:
                    items.append({
                        "id": f"test_{memory.id}",
                        "type": "test",
                        "title": "Test tomorrow",
                        "subtitle": self._extract_subject_from_memory(memory.content),
                        "urgency": "high",
                        "urgency_score": 92,
                        "icon": "school",
                        "action_label": "Create study plan",
                        "action_prompt": f"I have a test tomorrow. Help me create a quick study plan based on what I've been learning.",
                    })
                    break  # Only add one test item

            # Detect assignment/deadline mentions
            if any(word in content_lower for word in ["assignment", "homework", "due", "deadline", "submit"]):
                if any(word in content_lower for word in ["today", "tonight", "tomorrow"]):
                    items.append({
                        "id": f"deadline_{memory.id}",
                        "type": "deadline",
                        "title": "Deadline approaching",
                        "subtitle": self._extract_task_from_memory(memory.content),
                        "urgency": "high" if "today" in content_lower else "medium",
                        "urgency_score": 88 if "today" in content_lower else 65,
                        "icon": "time",
                        "action_label": "Help me finish",
                        "action_prompt": "I have a deadline coming up. Help me focus and complete the work.",
                    })
                    break  # Only add one deadline item

        return items

    def _extract_email_subject(self, content: str) -> str:
        """Extract email subject from memory content."""
        for line in content.split("\n"):
            lower = line.lower()
            if "subject:" in lower:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    return parts[1].strip()[:60]
        return None

    def _extract_subject_from_memory(self, content: str) -> str:
        """Extract subject/topic from memory content."""
        # Look for common subject names
        subjects = ["math", "chemistry", "physics", "biology", "history",
                   "english", "computer", "science", "economics", "psychology"]
        content_lower = content.lower()
        for subject in subjects:
            if subject in content_lower:
                return subject.capitalize()
        return "Study session needed"

    def _extract_task_from_memory(self, content: str) -> str:
        """Extract task description from memory content."""
        # Return first meaningful line
        for line in content.split("\n"):
            line = line.strip()
            if len(line) > 10 and len(line) < 60:
                return line
        return "Task due soon"

    def _format_time_diff(self, delta: timedelta) -> str:
        """Format time difference as human readable string."""
        total_seconds = int(delta.total_seconds())
        if total_seconds < 3600:
            return f"{total_seconds // 60} minutes"
        elif total_seconds < 86400:
            return f"{total_seconds // 3600} hours"
        else:
            return f"{total_seconds // 86400} days"
