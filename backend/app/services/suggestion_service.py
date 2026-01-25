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

    # ==================== SMART PRE-FILLED ACTIONS ====================

    async def get_prefilled_actions(
        self,
        user_id: UUID,
        gmail_connected: bool,
        calendar_connected: bool,
    ) -> list[dict]:
        """
        Get smart pre-filled actions like Iris.

        Returns actions with all data pre-filled so user just needs to approve.
        Each action includes:
        - type: the action type (reply_email, follow_up, resolve_conflict, etc.)
        - title: display text
        - data: pre-filled data for the action
        - requires_confirmation: whether user needs to approve

        Example:
        {
            "type": "reply_email",
            "title": "Reply to Sarah about budget",
            "priority": 1,
            "data": {
                "thread_id": "...",
                "draft_body": "Hi Sarah, Thanks for sending...",
                "to": "sarah@example.com"
            },
            "requires_confirmation": True
        }
        """
        actions = []

        try:
            # 1. Check for emails needing replies
            if gmail_connected:
                reply_actions = await self._get_email_reply_actions(user_id)
                actions.extend(reply_actions)

                # 2. Check for follow-ups needed
                followup_actions = await self._get_followup_actions(user_id)
                actions.extend(followup_actions)

            # 3. Check for calendar conflicts
            if calendar_connected:
                conflict_actions = await self._get_conflict_actions(user_id)
                actions.extend(conflict_actions)

                # 4. Check for focus time opportunities
                focus_actions = await self._get_focus_time_actions(user_id)
                actions.extend(focus_actions)

            # Sort by priority and limit
            actions.sort(key=lambda x: x.get("priority", 5))
            return actions[:5]

        except Exception as e:
            logger.error(f"Error generating prefilled actions: {e}")
            return []

    async def _get_email_reply_actions(self, user_id: UUID) -> list[dict]:
        """Get pre-filled email reply actions."""
        actions = []

        try:
            from app.services.email_intelligence_service import EmailIntelligenceService
            email_intel = EmailIntelligenceService(self.db)

            # Get recent unread emails
            emails = await self._get_recent_emails(user_id, hours=24)

            for i, email in enumerate(emails[:3]):
                # Check if this looks like it needs a reply
                subject = email.get("subject", "").lower()
                needs_reply = any([
                    "?" in subject,
                    "request" in subject,
                    "please" in subject,
                    "question" in subject,
                    "when" in subject,
                    "can you" in subject,
                ])

                if needs_reply and email.get("source_id"):
                    # Generate a draft reply
                    # Note: In production, this would be async/background
                    actions.append({
                        "type": "reply_email",
                        "title": f"Reply to {email.get('sender', 'Unknown').split()[0]} about {email.get('subject', 'email')[:30]}",
                        "priority": 1 + i,
                        "data": {
                            "thread_id": email.get("source_id"),
                            "subject": email.get("subject"),
                            "to": email.get("sender"),
                        },
                        "context": f"From {email.get('sender', 'Unknown')}, {email.get('age_hours', 0):.0f}h ago",
                        "requires_confirmation": True,
                    })

        except Exception as e:
            logger.error(f"Error getting email reply actions: {e}")

        return actions

    async def _get_followup_actions(self, user_id: UUID) -> list[dict]:
        """Get pre-filled follow-up actions."""
        actions = []

        try:
            from app.services.email_intelligence_service import EmailIntelligenceService
            email_intel = EmailIntelligenceService(self.db)

            # Get awaiting replies
            awaiting = await email_intel.get_awaiting_replies(user_id, days_threshold=3)

            for email in awaiting.get("awaiting_replies", [])[:2]:
                actions.append({
                    "type": "follow_up",
                    "title": f"Follow up with {email.get('to', 'contact').split('@')[0]} - {email.get('days_without_reply', 0)}d",
                    "priority": 3,
                    "data": {
                        "thread_id": email.get("thread_id"),
                        "subject": email.get("subject"),
                        "days_waiting": email.get("days_without_reply"),
                    },
                    "context": f"No response in {email.get('days_without_reply', 0)} days",
                    "requires_confirmation": True,
                })

        except Exception as e:
            logger.error(f"Error getting followup actions: {e}")

        return actions

    async def _get_conflict_actions(self, user_id: UUID) -> list[dict]:
        """Get pre-filled conflict resolution actions."""
        actions = []

        try:
            from app.services.calendar_intelligence_service import CalendarIntelligenceService
            cal_intel = CalendarIntelligenceService(self.db)

            # Check for conflicts in next 24 hours
            conflicts = await cal_intel.detect_conflicts(
                user_id=user_id,
                start_date=utcnow().replace(tzinfo=None),
                end_date=(utcnow() + timedelta(hours=24)).replace(tzinfo=None),
            )

            for conflict in conflicts.get("conflicts", [])[:2]:
                e1 = conflict.get("event1", {})
                e2 = conflict.get("event2", {})

                actions.append({
                    "type": "resolve_conflict",
                    "title": f"Conflict: {e1.get('title', 'Event 1')[:15]} & {e2.get('title', 'Event 2')[:15]}",
                    "priority": 2,
                    "data": {
                        "conflict": conflict,
                        "suggestions": conflict.get("suggestions", []),
                    },
                    "context": f"{conflict.get('overlap_minutes', 0)} min overlap",
                    "requires_confirmation": True,
                })

        except Exception as e:
            logger.error(f"Error getting conflict actions: {e}")

        return actions

    async def _get_focus_time_actions(self, user_id: UUID) -> list[dict]:
        """Get pre-filled focus time blocking actions."""
        actions = []

        try:
            from app.services.calendar_intelligence_service import CalendarIntelligenceService
            cal_intel = CalendarIntelligenceService(self.db)

            # Get today's summary
            summary = await cal_intel.get_day_summary(
                user_id=user_id,
                date=utcnow().replace(tzinfo=None),
            )

            # If it's a busy day but has some free time, suggest focus block
            total_meeting_hours = summary.get("total_meeting_hours", 0)
            free_hours = summary.get("free_hours", 0)
            longest_free = summary.get("longest_free_block", 0)

            if total_meeting_hours > 4 and free_hours >= 1 and longest_free >= 60:
                # Find a free slot
                slots_result = await cal_intel.find_focus_time_slots(
                    user_id=user_id,
                    date=utcnow().replace(tzinfo=None),
                    duration_minutes=60,
                )

                if slots_result.get("best_slot"):
                    slot = slots_result["best_slot"]
                    start = slot.get("start")
                    if isinstance(start, str):
                        from datetime import datetime
                        start = datetime.fromisoformat(start.replace("Z", "+00:00"))

                    actions.append({
                        "type": "block_focus_time",
                        "title": f"Block focus time at {start.strftime('%I:%M %p') if hasattr(start, 'strftime') else 'available slot'}",
                        "priority": 4,
                        "data": {
                            "start_time": slot.get("start"),
                            "duration_minutes": 60,
                            "title": "Focus Time",
                        },
                        "context": f"Busy day - {total_meeting_hours}h of meetings",
                        "requires_confirmation": True,
                    })

        except Exception as e:
            logger.error(f"Error getting focus time actions: {e}")

        return actions

    # ==================== CONTEXT-AWARE PROACTIVE SUGGESTIONS ====================

    async def get_proactive_suggestions(
        self,
        user_id: UUID,
        context: dict,
    ) -> list[dict]:
        """
        Get proactive suggestions based on current context.

        Context can include:
        - current_time: datetime
        - location: lat/lng
        - just_finished: event that just ended
        - next_event: upcoming event
        - last_action: what user just did

        Returns suggestions that are contextually relevant.
        """
        suggestions = []
        now = context.get("current_time", utcnow())

        try:
            # After meeting - suggest capture notes
            if context.get("just_finished"):
                event = context["just_finished"]
                suggestions.append({
                    "type": "capture_notes",
                    "title": f"Capture notes from {event.get('title', 'meeting')}",
                    "priority": 1,
                    "data": {
                        "event_id": event.get("id"),
                        "event_title": event.get("title"),
                        "attendees": event.get("attendees", []),
                    },
                    "context": "Meeting just ended",
                })

            # Before meeting - prepare context
            if context.get("next_event"):
                event = context["next_event"]
                hours_until = event.get("hours_until", 24)

                if 0.25 <= hours_until <= 1:  # 15-60 mins before
                    from app.services.people_service import PeopleService
                    people_service = PeopleService(self.db)

                    # Get attendee context
                    attendees = event.get("attendees", [])
                    if attendees:
                        attendee_name = attendees[0].split("@")[0] if "@" in attendees[0] else attendees[0]
                        meeting_context = await people_service.generate_meeting_context(
                            user_id=user_id,
                            person_name=attendee_name,
                        )

                        suggestions.append({
                            "type": "meeting_prep",
                            "title": f"Prep for {event.get('title', 'meeting')}",
                            "priority": 1,
                            "data": {
                                "event_id": event.get("id"),
                                "event_title": event.get("title"),
                                "attendees": attendees,
                                "context": meeting_context,
                            },
                            "context": f"Meeting in {int(hours_until * 60)} minutes",
                        })

            # Morning - suggest day planning
            if now.hour == 8 and not context.get("morning_briefing_sent"):
                suggestions.append({
                    "type": "day_planning",
                    "title": "Plan your day",
                    "priority": 2,
                    "data": {},
                    "context": "Start of day",
                })

            # End of day - suggest reflection
            if now.hour == 17 and not context.get("evening_briefing_sent"):
                suggestions.append({
                    "type": "day_reflection",
                    "title": "Reflect on today",
                    "priority": 3,
                    "data": {},
                    "context": "End of work day",
                })

        except Exception as e:
            logger.error(f"Error getting proactive suggestions: {e}")

        return suggestions[:3]
