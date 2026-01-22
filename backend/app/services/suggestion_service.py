"""Service for generating smart, LLM-powered suggestions from emails and calendar."""

import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory

settings = get_settings()
logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    """Return timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class SuggestionService:
    """Service for generating intelligent suggestions using LLM analysis."""

    SUGGESTION_PROMPT = """You are an intelligent assistant analyzing a user's recent emails and upcoming calendar events.

Generate 3-4 actionable suggestions based on the data below. Each suggestion should be:
- Specific and actionable (not generic like "check emails")
- Reference specific people, subjects, or events by name
- Prioritized by urgency/importance
- Concise but informative (under 70 characters)

Prioritization rules:
1. Urgent emails needing reply (questions, deadlines, direct requests)
2. Meetings in next 2 hours (need preparation)
3. Follow-ups needed (waiting for response, no reply in days)
4. Important but not urgent items

EMAILS (last 48 hours):
{emails}

CALENDAR (next 24 hours):
{calendar}

Current time: {current_time}

Return a JSON array of suggestions, each with:
- "text": The suggestion text - be SPECIFIC with names/subjects (e.g., "Reply to Sarah about Q4 budget")
- "priority": 1-5 (1=most urgent)
- "type": "email" or "calendar" or "combined"
- "context": Brief context about the item (sender name, meeting title, etc.)
- "source_index": The index (0-based) of the email or event this relates to, or null if combined

Example output:
[
  {{"text": "Reply to John about budget approval request", "priority": 1, "type": "email", "context": "From John Smith, 2h ago", "source_index": 0}},
  {{"text": "Prepare for 2pm meeting with Sarah", "priority": 2, "type": "calendar", "context": "Product sync in 1.5h", "source_index": 0}},
  {{"text": "Follow up with Acme Corp on proposal", "priority": 3, "type": "email", "context": "No response in 3 days", "source_index": 2}}
]

Return ONLY valid JSON array, no other text."""

    FALLBACK_SUGGESTIONS = [
        {"text": "Check your inbox for important emails", "type": "email"},
        {"text": "Review your calendar for upcoming meetings", "type": "calendar"},
        {"text": "Summarize my day and priorities", "type": "combined"},
    ]

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._cache: dict[str, tuple[list, datetime]] = {}  # user_id -> (suggestions, timestamp)
        self._cache_ttl = timedelta(minutes=2)  # Cache for 2 minutes

    async def get_suggestions(
        self,
        user_id: UUID,
        gmail_connected: bool,
        calendar_connected: bool,
        force_refresh: bool = False,
    ) -> list[dict]:
        """
        Get smart suggestions for a user.

        Uses LLM to analyze recent emails and calendar events and generate
        prioritized, actionable suggestions.

        Args:
            user_id: User's UUID
            gmail_connected: Whether Gmail is connected
            calendar_connected: Whether Calendar is connected
            force_refresh: Skip cache and regenerate

        Returns:
            List of suggestion dicts with text, type, priority
        """
        cache_key = str(user_id)

        # Check cache first
        if not force_refresh and cache_key in self._cache:
            cached, timestamp = self._cache[cache_key]
            if utcnow() - timestamp < self._cache_ttl:
                logger.debug(f"Returning cached suggestions for {user_id}")
                return cached

        # If nothing is connected, return default
        if not gmail_connected and not calendar_connected:
            return [
                {
                    "text": "Connect Google to get personalized suggestions",
                    "type": "none",
                    "priority": 1,
                }
            ]

        try:
            # Fetch recent data
            emails = await self._get_recent_emails(user_id) if gmail_connected else []
            events = await self._get_upcoming_events(user_id) if calendar_connected else []

            # If no data, return defaults
            if not emails and not events:
                suggestions = self._get_default_suggestions(gmail_connected, calendar_connected)
                self._cache[cache_key] = (suggestions, utcnow())
                return suggestions

            # Generate LLM-powered suggestions
            suggestions = await self._generate_llm_suggestions(emails, events)

            # Cache and return
            self._cache[cache_key] = (suggestions, utcnow())
            return suggestions

        except Exception as e:
            logger.error(f"Error generating suggestions: {e}")
            return self._get_default_suggestions(gmail_connected, calendar_connected)

    async def _get_recent_emails(self, user_id: UUID, hours: int = 48) -> list[dict]:
        """Fetch recent email memories with source IDs for linking."""
        recent_date = utcnow() - timedelta(hours=hours)

        result = await self.db.execute(
            select(Memory)
            .where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "email",
                    Memory.memory_date >= recent_date,
                )
            )
            .order_by(desc(Memory.memory_date))
            .limit(10)
        )
        memories = result.scalars().all()

        emails = []
        for m in memories:
            email_data = self._parse_email_content(m.content, m.memory_date)
            if email_data:
                # Include source ID for linking back to the email
                email_data["source_id"] = str(m.id)
                email_data["memory_id"] = str(m.id)
                emails.append(email_data)

        return emails

    async def _get_upcoming_events(self, user_id: UUID, hours: int = 24) -> list[dict]:
        """Fetch upcoming calendar events with source IDs for linking."""
        now = utcnow()
        upcoming_date = now + timedelta(hours=hours)

        result = await self.db.execute(
            select(Memory)
            .where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "calendar",
                    Memory.memory_date >= now,
                    Memory.memory_date <= upcoming_date,
                )
            )
            .order_by(Memory.memory_date)
            .limit(5)
        )
        memories = result.scalars().all()

        events = []
        for m in memories:
            event_data = self._parse_calendar_content(m.content, m.memory_date)
            if event_data:
                # Include source ID for linking back to the event
                event_data["source_id"] = str(m.id)
                event_data["memory_id"] = str(m.id)
                events.append(event_data)

        return events

    def _parse_email_content(self, content: str, date: datetime) -> Optional[dict]:
        """Parse email memory content into structured data."""
        lines = content.split("\n")
        sender = "Unknown"
        subject = "No subject"
        body_preview = ""

        for i, line in enumerate(lines):
            if line.startswith("Email from "):
                sender = line.replace("Email from ", "").strip()
                if "<" in sender:
                    sender = sender.split("<")[0].strip()
            elif line.startswith("Subject: "):
                subject = line.replace("Subject: ", "").strip()
            elif i > 2 and line.strip() and not body_preview:
                body_preview = line.strip()[:100]

        return {
            "sender": sender,
            "subject": subject,
            "preview": body_preview,
            "date": date.isoformat() if date else None,
            "age_hours": (utcnow() - date).total_seconds() / 3600 if date else 0,
        }

    def _parse_calendar_content(self, content: str, date: datetime) -> Optional[dict]:
        """Parse calendar memory content into structured data."""
        lines = content.split("\n")
        title = "Event"
        location = None
        attendees = []

        for line in lines:
            if line.startswith("Calendar Event: "):
                title = line.replace("Calendar Event: ", "").strip()
            elif line.startswith("Location: "):
                location = line.replace("Location: ", "").strip()
            elif line.startswith("Attendees: "):
                attendees = line.replace("Attendees: ", "").strip().split(", ")

        # Calculate time until event
        hours_until = (date - utcnow()).total_seconds() / 3600 if date else 24

        return {
            "title": title,
            "location": location,
            "attendees": attendees[:3],  # Limit attendees
            "date": date.isoformat() if date else None,
            "hours_until": round(hours_until, 1),
        }

    async def _generate_llm_suggestions(
        self,
        emails: list[dict],
        events: list[dict],
    ) -> list[dict]:
        """Use GPT-4o-mini to generate intelligent suggestions with source linking."""
        try:
            # Format data for prompt with indices for reference
            email_text = "\n".join([
                f"[{i}] From: {e['sender']}, Subject: {e['subject']}, Age: {e['age_hours']:.0f}h ago"
                + (f", Preview: {e['preview'][:50]}..." if e.get('preview') else "")
                for i, e in enumerate(emails[:7])
            ]) if emails else "No recent emails"

            calendar_text = "\n".join([
                f"[{i}] {e['title']} in {e['hours_until']:.1f} hours" +
                (f" at {e['location']}" if e.get('location') else "") +
                (f" with {', '.join(e['attendees'][:2])}" if e.get('attendees') else "")
                for i, e in enumerate(events[:5])
            ]) if events else "No upcoming events"

            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.SUGGESTION_PROMPT.format(
                            emails=email_text,
                            calendar=calendar_text,
                            current_time=utcnow().strftime("%Y-%m-%d %H:%M UTC"),
                        ),
                    }
                ],
                temperature=0.3,
                max_tokens=600,
                response_format={"type": "json_object"},
            )

            result = response.choices[0].message.content.strip()

            # Parse JSON response
            try:
                data = json.loads(result)
                # Handle both array and object with array
                suggestions = data if isinstance(data, list) else data.get("suggestions", [])
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse LLM suggestions: {result[:200]}")
                return self._get_default_suggestions(bool(emails), bool(events))

            # Validate and clean suggestions, map source_index to source_id
            cleaned = []
            for s in suggestions[:4]:
                if isinstance(s, dict) and "text" in s:
                    suggestion = {
                        "text": s["text"][:70],  # Truncate
                        "type": s.get("type", "combined"),
                        "priority": s.get("priority", 3),
                        "context": s.get("context"),
                        "source_id": None,
                    }

                    # Map source_index to actual source_id
                    source_idx = s.get("source_index")
                    if source_idx is not None:
                        stype = s.get("type", "combined")
                        if stype == "email" and source_idx < len(emails):
                            suggestion["source_id"] = emails[source_idx].get("source_id")
                        elif stype == "calendar" and source_idx < len(events):
                            suggestion["source_id"] = events[source_idx].get("source_id")

                    cleaned.append(suggestion)

            # Sort by priority
            cleaned.sort(key=lambda x: x.get("priority", 3))

            return cleaned if cleaned else self._get_default_suggestions(bool(emails), bool(events))

        except Exception as e:
            logger.error(f"LLM suggestion generation failed: {e}")
            return self._get_default_suggestions(bool(emails), bool(events))

    def _get_default_suggestions(
        self,
        gmail_connected: bool,
        calendar_connected: bool,
    ) -> list[dict]:
        """Return default suggestions when LLM fails or no data."""
        suggestions = []

        if gmail_connected:
            suggestions.append({
                "text": "Check your inbox for new emails",
                "type": "email",
                "priority": 2,
            })

        if calendar_connected:
            suggestions.append({
                "text": "Review your upcoming meetings",
                "type": "calendar",
                "priority": 2,
            })

        if gmail_connected or calendar_connected:
            suggestions.append({
                "text": "Summarize my day and priorities",
                "type": "combined",
                "priority": 3,
            })

        return suggestions

    def clear_cache(self, user_id: Optional[UUID] = None) -> None:
        """Clear suggestion cache for a user or all users."""
        if user_id:
            self._cache.pop(str(user_id), None)
        else:
            self._cache.clear()

    async def get_greeting(
        self,
        user_id: UUID,
        user_name: str,
        gmail_connected: bool,
        calendar_connected: bool,
    ) -> dict:
        """
        Generate a TARS-style contextual greeting based on emails and calendar.

        Returns a dict with 'greeting' and 'has_context' fields.
        """
        now = utcnow()
        hour = now.hour

        # Get time-based prefix
        if hour < 12:
            time_greeting = "Morning"
        elif hour < 17:
            time_greeting = "Afternoon"
        else:
            time_greeting = "Evening"

        first_name = user_name.split()[0] if user_name else ""

        # If nothing connected, return simple greeting
        if not gmail_connected and not calendar_connected:
            return {
                "greeting": f"{time_greeting}, {first_name}." if first_name else f"{time_greeting}.",
                "has_context": False,
            }

        try:
            # Fetch context data
            emails = await self._get_recent_emails(user_id, hours=24) if gmail_connected else []
            events = await self._get_upcoming_events(user_id, hours=12) if calendar_connected else []

            # Build context pieces
            context_parts = []

            # Check for urgent/important emails
            unread_count = len(emails)
            important_sender = None
            if emails:
                # Find most recent email sender
                important_sender = emails[0].get("sender", "").split()[0] if emails[0].get("sender") else None

            # Check upcoming events
            next_event = events[0] if events else None
            events_today = len(events)

            # Build TARS-style greeting with context
            # TARS is dry, factual, slightly witty
            if next_event and next_event.get("hours_until", 24) < 2:
                # Imminent meeting
                event_name = next_event.get("title", "meeting")
                hours_until = next_event.get("hours_until", 1)
                if hours_until < 1:
                    mins = int(hours_until * 60)
                    context_parts.append(f"{event_name} in {mins} minutes")
                else:
                    context_parts.append(f"{event_name} in {hours_until:.0f}h")

            elif events_today > 0:
                if events_today == 1:
                    event_name = next_event.get("title", "one thing")
                    context_parts.append(f"One thing on the calendar: {event_name}")
                else:
                    context_parts.append(f"{events_today} things on your calendar today")

            if unread_count > 0 and important_sender and not context_parts:
                context_parts.append(f"{important_sender} sent you something")
            elif unread_count > 3 and not context_parts:
                context_parts.append(f"{unread_count} emails waiting")

            # Construct final greeting
            if context_parts:
                context_text = ". ".join(context_parts)
                greeting = f"{time_greeting}, {first_name}. {context_text}." if first_name else f"{time_greeting}. {context_text}."
            else:
                # Fallback with slight TARS personality
                fallback_lines = [
                    f"{time_greeting}, {first_name}. All quiet.",
                    f"{time_greeting}, {first_name}. Nothing urgent.",
                    f"{time_greeting}, {first_name}. Clear skies ahead.",
                ]
                import random
                greeting = random.choice(fallback_lines) if first_name else f"{time_greeting}. Nothing urgent."

            return {
                "greeting": greeting,
                "has_context": bool(context_parts),
            }

        except Exception as e:
            logger.error(f"Error generating greeting: {e}")
            return {
                "greeting": f"{time_greeting}, {first_name}." if first_name else f"{time_greeting}.",
                "has_context": False,
            }
