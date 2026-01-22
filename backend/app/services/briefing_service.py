"""Service for generating daily briefings (morning and evening)."""

from datetime import datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory

settings = get_settings()


class BriefingService:
    """Service for generating daily briefings with a minimal, zen-like tone."""

    MORNING_PROMPT = """Generate a morning briefing. Be calm. Brief. Zen-like.

Format exactly like this:
Good morning.

[If events today, list 2-3 key ones:]
- [time]: [event]

[If emails need attention, one line:]
[X] emails. [One notable if any.]

[End with one calming line.]

---
Today: {date}
Calendar: {calendar}
Emails: {emails}
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

        # Format for prompt
        calendar_text = self._format_calendar(calendar_events) if calendar_events else "No events today."
        email_text = self._format_emails(emails) if emails else "No recent emails."

        prompt = self.MORNING_PROMPT.format(
            date=today.strftime("%A, %B %d"),
            calendar=calendar_text,
            emails=email_text,
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
