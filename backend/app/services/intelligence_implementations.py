"""
Intelligence Implementations - Real Composio Integration

This file provides real implementations for intelligence features that
previously returned stub/fake data. Connects to:
- Composio for email/calendar operations
- Database for memories, commitments, relationships
- OpenAI for style analysis and promise extraction

Services:
- ComposioEmailService: Direct email operations via Composio
- ComposioCalendarService: Direct calendar operations via Composio
- StyleLearningService: Learn writing style from sent emails
- TheirPromisesService: Track what others promised to the user
"""

import json
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional, Any
from uuid import UUID

import aiohttp
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.relationship import ThirdPartyCommitment

logger = logging.getLogger(__name__)
settings = get_settings()


# =============================================================================
# GLOBAL COMPOSIO TOOLSET - Set from main.py
# =============================================================================

_composio_toolset = None
_composio_api_key = None


def set_composio_toolset(toolset, api_key: str = None):
    """
    Set the global Composio toolset for use by intelligence services.

    Called from main.py during app initialization:
        from app.services.intelligence_implementations import set_composio_toolset
        set_composio_toolset(toolset, settings.composio_api_key)
    """
    global _composio_toolset, _composio_api_key
    _composio_toolset = toolset
    _composio_api_key = api_key or settings.composio_api_key
    logger.info("Composio toolset initialized for intelligence services")


def get_composio_toolset():
    """Get the global Composio toolset."""
    return _composio_toolset


# =============================================================================
# ASYNC COMPOSIO ACTION EXECUTION
# =============================================================================

async def execute_composio_action_async(
    action: str,
    params: dict,
    connected_account_id: str,
    timeout: int = 30
) -> dict:
    """
    Execute a Composio action asynchronously via REST API.

    Similar to SyncService._execute_composio_action but async.
    """
    if not _composio_api_key:
        logger.warning("Composio API key not configured")
        return {}

    url = f"https://backend.composio.dev/api/v2/actions/{action}/execute"
    headers = {
        "X-API-Key": _composio_api_key,
        "Content-Type": "application/json"
    }
    data = {
        "connectedAccountId": connected_account_id,
        "input": params
    }

    logger.debug(f"Async Composio action: {action}")
    logger.debug(f"Params: {json.dumps(params, indent=2, default=str)}")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json=data,
                timeout=aiohttp.ClientTimeout(total=timeout)
            ) as response:
                result = await response.json()

                logger.debug(f"Response status: {response.status}")

                if response.status >= 400:
                    error_msg = result.get("error") or result.get("message") or str(result)
                    logger.error(f"Composio action {action} failed: {error_msg}")
                    return {}

                # Normalize response
                if result.get("successful") or result.get("successfull"):
                    return result.get("data", result)
                else:
                    error = result.get("error") or result.get("message") or "Unknown error"
                    logger.warning(f"Composio action {action} not successful: {error}")
                    return {}

    except asyncio.TimeoutError:
        logger.error(f"Composio action {action} timed out")
        return {}
    except Exception as e:
        logger.error(f"Composio action {action} failed: {e}")
        return {}


# =============================================================================
# COMPOSIO EMAIL SERVICE
# =============================================================================

class ComposioEmailService:
    """
    Real email operations via Composio.

    Provides async methods to:
    - Fetch recent emails
    - Get email by ID
    - Fetch full thread
    - Search emails
    - Find emails with a specific person
    """

    def __init__(self, connected_account_id: str):
        """
        Initialize with the user's Composio connected account ID.

        Get this from the database:
            account = await db.execute(
                select(ConnectedAccount)
                .where(ConnectedAccount.user_id == user_id)
                .where(ConnectedAccount.service == "googlesuper")
            )
            connected_account_id = account.scalar_one().composio_connection_id
        """
        self.connected_account_id = connected_account_id

    async def fetch_recent_emails(
        self,
        since_hours: int = 24,
        max_results: int = 20,
        unread_only: bool = False
    ) -> List[dict]:
        """Fetch recent emails."""
        try:
            # Build Gmail search query
            since_date = datetime.now(timezone.utc) - timedelta(hours=since_hours)
            query = f"after:{since_date.strftime('%Y/%m/%d')}"
            if unread_only:
                query += " is:unread"

            result = await execute_composio_action_async(
                action="GMAIL_FETCH_EMAILS",
                params={
                    "max_results": max_results,
                    "query": query
                },
                connected_account_id=self.connected_account_id
            )

            emails = result.get("emails", []) if result else []
            return [self._normalize_email(e) for e in emails]

        except Exception as e:
            logger.error(f"Failed to fetch recent emails: {e}")
            return []

    async def fetch_email_by_id(self, email_id: str) -> Optional[dict]:
        """Fetch specific email by ID."""
        try:
            result = await execute_composio_action_async(
                action="GMAIL_GET_MESSAGE",
                params={"message_id": email_id},
                connected_account_id=self.connected_account_id
            )

            if result:
                return self._normalize_email(result)
            return None

        except Exception as e:
            logger.error(f"Failed to fetch email {email_id}: {e}")
            return None

    async def fetch_thread(self, thread_id: str) -> List[dict]:
        """Fetch full email thread."""
        try:
            result = await execute_composio_action_async(
                action="GMAIL_GET_THREAD",
                params={"thread_id": thread_id},
                connected_account_id=self.connected_account_id
            )

            messages = result.get("messages", []) if result else []
            return [self._normalize_email(m) for m in messages]

        except Exception as e:
            logger.error(f"Failed to fetch thread {thread_id}: {e}")
            return []

    async def search_emails(
        self,
        query: str,
        max_results: int = 10
    ) -> List[dict]:
        """Search emails with Gmail query syntax."""
        try:
            result = await execute_composio_action_async(
                action="GMAIL_FETCH_EMAILS",
                params={
                    "query": query,
                    "max_results": max_results
                },
                connected_account_id=self.connected_account_id
            )

            emails = result.get("emails", []) if result else []
            return [self._normalize_email(e) for e in emails]

        except Exception as e:
            logger.error(f"Email search failed: {e}")
            return []

    async def find_emails_with_person(
        self,
        email_or_name: str,
        max_results: int = 10
    ) -> List[dict]:
        """Find emails involving a specific person."""
        query = f"from:{email_or_name} OR to:{email_or_name}"
        return await self.search_emails(query, max_results)

    async def find_sent_emails_to(
        self,
        recipient: str,
        max_results: int = 10
    ) -> List[dict]:
        """Find emails the user SENT to a specific person."""
        query = f"to:{recipient} in:sent"
        return await self.search_emails(query, max_results)

    async def find_received_emails_from(
        self,
        sender: str,
        max_results: int = 10
    ) -> List[dict]:
        """Find emails RECEIVED from a specific person."""
        query = f"from:{sender}"
        return await self.search_emails(query, max_results)

    def _normalize_email(self, email: dict) -> dict:
        """Normalize email to consistent format."""
        return {
            "id": email.get("id") or email.get("message_id", ""),
            "thread_id": email.get("thread_id", ""),
            "from": email.get("from") or email.get("sender", ""),
            "to": email.get("to") or email.get("recipients", []),
            "subject": email.get("subject", "No subject"),
            "snippet": email.get("snippet") or (email.get("body", "")[:500] if email.get("body") else ""),
            "body": email.get("body") or email.get("text", ""),
            "date": email.get("date") or email.get("received_at", ""),
            "is_unread": email.get("is_unread", False),
            "labels": email.get("labels", [])
        }


# =============================================================================
# COMPOSIO CALENDAR SERVICE
# =============================================================================

class ComposioCalendarService:
    """
    Real calendar operations via Composio.

    Provides async methods to:
    - Get upcoming events
    - Get event by ID
    - Get next event
    """

    def __init__(self, connected_account_id: str):
        self.connected_account_id = connected_account_id

    async def get_upcoming_events(
        self,
        hours: int = 24,
        max_results: int = 20
    ) -> List[dict]:
        """Get events in the next N hours."""
        try:
            now = datetime.now(timezone.utc)
            end_time = now + timedelta(hours=hours)

            result = await execute_composio_action_async(
                action="GOOGLECALENDAR_LIST_EVENTS",
                params={
                    "time_min": now.isoformat(),
                    "time_max": end_time.isoformat(),
                    "max_results": max_results
                },
                connected_account_id=self.connected_account_id
            )

            events = result.get("items", []) or result.get("events", [])
            if not events:
                events = []
            return [self._normalize_event(e) for e in events]

        except Exception as e:
            logger.error(f"Failed to fetch calendar events: {e}")
            return []

    async def get_event_by_id(self, event_id: str) -> Optional[dict]:
        """Get specific calendar event."""
        try:
            result = await execute_composio_action_async(
                action="GOOGLECALENDAR_GET_EVENT",
                params={"event_id": event_id},
                connected_account_id=self.connected_account_id
            )

            if result:
                return self._normalize_event(result)
            return None

        except Exception as e:
            logger.error(f"Failed to fetch event {event_id}: {e}")
            return None

    async def get_next_event(self) -> Optional[dict]:
        """Get the next upcoming event."""
        events = await self.get_upcoming_events(hours=24, max_results=1)
        return events[0] if events else None

    def _normalize_event(self, event: dict) -> dict:
        """Normalize event to consistent format."""
        start = event.get("start", {})
        end = event.get("end", {})

        return {
            "id": event.get("id", ""),
            "title": event.get("summary") or event.get("title", "Untitled"),
            "description": event.get("description", ""),
            "start": start.get("dateTime") or start.get("date", ""),
            "end": end.get("dateTime") or end.get("date", ""),
            "attendees": [
                {"email": a.get("email", ""), "name": a.get("displayName", "")}
                for a in event.get("attendees", [])
            ],
            "location": event.get("location", ""),
            "meeting_link": (
                event.get("hangoutLink") or
                event.get("conferenceData", {}).get("entryPoints", [{}])[0].get("uri", "")
            )
        }


# =============================================================================
# STYLE LEARNING SERVICE
# =============================================================================

class StyleLearningService:
    """
    Learn user's writing style from past communications.

    Analyzes actual sent emails to extract:
    - Tone (formal, professional, casual, friendly)
    - Greeting style ("Hi Josh,", "Hey,", etc.)
    - Closing style ("Best,", "Thanks,", etc.)
    - Average length
    - Key patterns
    """

    def __init__(self, session: AsyncSession, openai_client: AsyncOpenAI = None):
        self.session = session
        self.client = openai_client or AsyncOpenAI(api_key=settings.openai_api_key)

    async def learn_style_with_person(
        self,
        user_id: UUID,
        person_email: str,
        email_service: ComposioEmailService
    ) -> dict:
        """
        Analyze user's writing style when emailing a specific person.

        Returns:
        {
            "description": "Professional but warm, uses data points",
            "tone": "formal" | "professional" | "casual" | "friendly",
            "avg_length": "brief" | "medium" | "detailed",
            "greeting_style": "Hi Josh,",
            "closing_style": "Best, Krishna",
            "key_patterns": ["Uses bullet points", "Signs with first name"],
            "samples": ["Sample line 1...", "Sample line 2..."]
        }
        """
        # Fetch emails the user SENT to this person
        emails = await email_service.find_sent_emails_to(person_email, max_results=10)

        if not emails:
            return self._default_style()

        # Extract message bodies
        user_messages = [e.get("body", "") for e in emails if e.get("body")]

        if not user_messages:
            return self._default_style()

        # Analyze with GPT
        analysis = await self._analyze_style(user_messages)

        return analysis

    async def _analyze_style(self, messages: List[str]) -> dict:
        """Use GPT to analyze writing style from samples."""
        # Limit samples to avoid token limits
        sample_text = "\n---\n".join([m[:1000] for m in messages[:5]])

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """Analyze these email samples from one sender and extract their writing style.

Return JSON:
{
    "description": "Brief description of overall style (1 sentence)",
    "tone": "formal" | "professional" | "casual" | "friendly",
    "avg_length": "brief" | "medium" | "detailed",
    "greeting_style": "How they typically start emails (exact phrase)",
    "closing_style": "How they typically end emails (exact phrase)",
    "key_patterns": ["Pattern 1", "Pattern 2"],
    "samples": ["One representative sentence", "Another one"]
}

Be specific about greeting/closing styles - use exact phrases from the emails."""
                    },
                    {"role": "user", "content": f"Emails:\n\n{sample_text}"}
                ],
                response_format={"type": "json_object"},
                temperature=0
            )

            return json.loads(response.choices[0].message.content)

        except Exception as e:
            logger.error(f"Style analysis failed: {e}")
            return self._default_style()

    def _default_style(self) -> dict:
        """Return default style when no data available."""
        return {
            "description": "Professional and clear",
            "tone": "professional",
            "avg_length": "medium",
            "greeting_style": "Hi,",
            "closing_style": "Best,",
            "key_patterns": [],
            "samples": []
        }


# =============================================================================
# THEIR PROMISES SERVICE
# =============================================================================

class TheirPromisesService:
    """
    Track what others have promised to the user.

    Extracts commitments from received emails like:
    - "I'll send you the pricing by Friday"
    - "Let me check and get back to you"
    - "I'll introduce you to our CEO"
    """

    def __init__(self, session: AsyncSession, openai_client: AsyncOpenAI = None):
        self.session = session
        self.client = openai_client or AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_and_store_promises(
        self,
        user_id: UUID,
        person_name: str,
        person_email: str,
        messages: List[dict]
    ) -> List[dict]:
        """
        Extract promises from messages and store them in the database.

        Args:
            user_id: The user's ID
            person_name: Name of the person who made promises
            person_email: Email of the person
            messages: List of email/message dicts with 'body', 'id', 'date' keys

        Returns:
            List of extracted promises
        """
        if not messages:
            return []

        # Extract promises using GPT
        promises = await self._extract_promises(person_name, messages)

        # Store in database
        stored = []
        for promise in promises:
            try:
                # Check if already exists (avoid duplicates)
                existing = await self.session.execute(
                    select(ThirdPartyCommitment)
                    .where(ThirdPartyCommitment.user_id == user_id)
                    .where(ThirdPartyCommitment.person_email == person_email)
                    .where(ThirdPartyCommitment.action == promise.get("action", ""))
                    .where(ThirdPartyCommitment.status == "pending")
                )

                if existing.scalar_one_or_none():
                    continue  # Skip duplicate

                commitment = ThirdPartyCommitment(
                    user_id=user_id,
                    person_name=person_name,
                    person_email=person_email,
                    action=promise.get("action", ""),
                    context=promise.get("context", ""),
                    original_text=promise.get("original_text", ""),
                    mentioned_date=promise.get("date", ""),
                    source_type="email",
                    source_id=promise.get("source_id", ""),
                    confidence=promise.get("confidence", 0.8)
                )

                self.session.add(commitment)
                stored.append(promise)

            except Exception as e:
                logger.warning(f"Failed to store promise: {e}")

        if stored:
            await self.session.commit()
            logger.info(f"Stored {len(stored)} promises from {person_name}")

        return stored

    async def _extract_promises(
        self,
        person_name: str,
        messages: List[dict]
    ) -> List[dict]:
        """Use GPT to extract promises from messages."""
        # Build content for analysis
        content_parts = []
        for m in messages[:10]:  # Limit to 10 messages
            body = m.get("body", "") or m.get("content", "")
            if body:
                content_parts.append(f"[Message ID: {m.get('id', 'unknown')}]\n{body[:1000]}")

        content = f"\n---\n".join(content_parts)

        if not content:
            return []

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"""Extract promises/commitments that {person_name} made to the recipient.

Look for:
- "I'll..." or "I will..."
- "Let me..." (followed by action)
- "I can..." (offering to do something)
- "I'll get back to you"
- "I'll send you..."
- Offers to introduce, send, share, review, schedule, etc.

Return JSON:
{{
    "promises": [
        {{
            "action": "what they promised to do",
            "context": "brief context (1 sentence)",
            "date": "mentioned deadline if any (e.g., 'by Friday', 'next week')",
            "original_text": "exact quote from message",
            "source_id": "message ID if available",
            "confidence": 0.0-1.0
        }}
    ]
}}

Rules:
- Only include clear, actionable commitments
- Skip vague statements like "let's talk sometime"
- Include confidence score based on clarity of commitment
- Return empty array if no clear promises found"""
                    },
                    {"role": "user", "content": content}
                ],
                response_format={"type": "json_object"},
                temperature=0
            )

            result = json.loads(response.choices[0].message.content)
            return result.get("promises", [])

        except Exception as e:
            logger.error(f"Promise extraction failed: {e}")
            return []

    async def get_promises_from_person(
        self,
        user_id: UUID,
        person_name: str = None,
        person_email: str = None,
        status: str = "pending"
    ) -> List[dict]:
        """Get stored promises from a specific person."""
        query = select(ThirdPartyCommitment).where(
            ThirdPartyCommitment.user_id == user_id,
            ThirdPartyCommitment.status == status
        )

        if person_email:
            query = query.where(ThirdPartyCommitment.person_email == person_email)
        elif person_name:
            query = query.where(ThirdPartyCommitment.person_name.ilike(f"%{person_name}%"))

        query = query.order_by(ThirdPartyCommitment.created_at.desc())

        result = await self.session.execute(query)
        commitments = result.scalars().all()

        return [
            {
                "id": str(c.id),
                "action": c.action,
                "context": c.context,
                "date": c.mentioned_date,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in commitments
        ]

    async def get_all_pending_promises(
        self,
        user_id: UUID,
        limit: int = 20
    ) -> List[dict]:
        """Get all pending promises to the user."""
        result = await self.session.execute(
            select(ThirdPartyCommitment)
            .where(ThirdPartyCommitment.user_id == user_id)
            .where(ThirdPartyCommitment.status == "pending")
            .order_by(ThirdPartyCommitment.created_at.desc())
            .limit(limit)
        )

        commitments = result.scalars().all()

        return [
            {
                "id": str(c.id),
                "person_name": c.person_name,
                "person_email": c.person_email,
                "action": c.action,
                "context": c.context,
                "date": c.mentioned_date,
                "created_at": c.created_at.isoformat() if c.created_at else None
            }
            for c in commitments
        ]

    async def mark_promise_fulfilled(
        self,
        user_id: UUID,
        commitment_id: UUID
    ) -> bool:
        """Mark a promise as fulfilled."""
        try:
            result = await self.session.execute(
                select(ThirdPartyCommitment)
                .where(ThirdPartyCommitment.id == commitment_id)
                .where(ThirdPartyCommitment.user_id == user_id)
            )

            commitment = result.scalar_one_or_none()
            if commitment:
                commitment.status = "fulfilled"
                commitment.fulfilled_at = datetime.utcnow()
                await self.session.commit()
                return True
            return False

        except Exception as e:
            logger.error(f"Failed to mark promise fulfilled: {e}")
            return False


# =============================================================================
# ENHANCED MORNING BRIEFING
# =============================================================================

async def get_real_morning_briefing(
    session: AsyncSession,
    user_id: str,
    connected_account_id: str,
    openai_client: AsyncOpenAI = None
) -> str:
    """
    Generate comprehensive morning briefing with real data from Composio.

    Combines:
    - Today's calendar events
    - Urgent/important emails
    - Pending user commitments (intentions)
    - Pending promises from others
    - Relationship alerts (people to reconnect with)
    """
    from app.services.proactive_intelligence_service import ProactiveIntelligenceService

    sections = []
    email_service = ComposioEmailService(connected_account_id)
    calendar_service = ComposioCalendarService(connected_account_id)

    # 1. Today's calendar
    try:
        events = await calendar_service.get_upcoming_events(hours=12)
        if events:
            sections.append("**📅 Today's Schedule:**")
            for event in events[:5]:
                start = event.get("start", "")
                if "T" in str(start):
                    try:
                        time_str = datetime.fromisoformat(
                            start.replace("Z", "+00:00")
                        ).strftime("%I:%M %p")
                    except Exception:
                        time_str = start
                else:
                    time_str = "All day"
                sections.append(f"- {time_str}: {event.get('title')}")
            sections.append("")
    except Exception as e:
        logger.warning(f"Calendar fetch failed: {e}")

    # 2. Email summary
    try:
        emails = await email_service.fetch_recent_emails(since_hours=24, unread_only=True)

        if emails:
            sections.append(f"**📧 {len(emails)} unread emails:**")
            for email in emails[:3]:
                sender = email.get("from", "Unknown")
                # Extract just the name/email from "Name <email>" format
                if "<" in sender:
                    sender = sender.split("<")[0].strip()
                subject = email.get("subject", "No subject")[:50]
                sections.append(f"- {sender}: {subject}")
            if len(emails) > 3:
                sections.append(f"  ...and {len(emails) - 3} more")
            sections.append("")
    except Exception as e:
        logger.warning(f"Email fetch failed: {e}")

    # 3. Pending user commitments (what YOU need to do)
    try:
        client = openai_client or AsyncOpenAI(api_key=settings.openai_api_key)
        proactive = ProactiveIntelligenceService(session, client)
        intentions = await proactive.get_pending_intentions(UUID(user_id), limit=5)

        if intentions:
            sections.append("**⏰ Your open loops:**")
            for intent in intentions[:3]:
                created_at = intent.get('created_at')
                if created_at:
                    days_ago = (datetime.now(timezone.utc) - created_at.replace(tzinfo=timezone.utc)).days
                    if days_ago > 3:
                        sections.append(f"- ⚠️ {intent['action']} ({days_ago} days ago)")
                    else:
                        sections.append(f"- {intent['action']}")
                else:
                    sections.append(f"- {intent['action']}")
            sections.append("")
    except Exception as e:
        logger.warning(f"Intentions fetch failed: {e}")

    # 4. Pending promises from others (what THEY owe you)
    try:
        promises_service = TheirPromisesService(session, openai_client)
        their_promises = await promises_service.get_all_pending_promises(UUID(user_id), limit=3)

        if their_promises:
            sections.append("**📋 Awaiting from others:**")
            for p in their_promises[:3]:
                sections.append(f"- {p['person_name']}: {p['action']}")
            sections.append("")
    except Exception as e:
        logger.warning(f"Promises fetch failed: {e}")

    # 5. Relationship alerts
    try:
        result = await session.execute(
            text("""
                SELECT e.name,
                       EXTRACT(EPOCH FROM (NOW() - rh.last_interaction_date)) / 86400 as days_ago
                FROM cortex_relationship_health rh
                JOIN cortex_entities e ON e.id = rh.entity_id
                WHERE rh.user_id = :user_id
                AND rh.needs_reconnect = true
                AND rh.last_interaction_date < NOW() - INTERVAL '14 days'
                ORDER BY days_ago DESC
                LIMIT 3
            """),
            {"user_id": user_id}
        )

        neglected = result.fetchall()
        if neglected:
            sections.append("**👥 Consider reaching out to:**")
            for row in neglected:
                days = int(row.days_ago) if row.days_ago else 0
                sections.append(f"- {row.name} ({days} days)")
            sections.append("")
    except Exception as e:
        logger.warning(f"Relationship check failed: {e}")

    # Build final briefing
    if sections:
        return "\n".join(sections)
    else:
        return "Good morning! Your calendar and inbox are clear. What would you like to focus on today?"


# =============================================================================
# HELPER FUNCTIONS - For use in other services
# =============================================================================

async def get_connected_account_id(session: AsyncSession, user_id: UUID) -> Optional[str]:
    """Get the Composio connected account ID for a user."""
    from app.models.integration import ConnectedAccount

    result = await session.execute(
        select(ConnectedAccount)
        .where(ConnectedAccount.user_id == user_id)
        .where(ConnectedAccount.service == "googlesuper")
    )

    account = result.scalar_one_or_none()
    if account:
        return account.composio_connection_id

    # Fallback to gmail connection
    result = await session.execute(
        select(ConnectedAccount)
        .where(ConnectedAccount.user_id == user_id)
        .where(ConnectedAccount.service == "gmail")
    )

    account = result.scalar_one_or_none()
    return account.composio_connection_id if account else None


async def fetch_emails_for_intelligence(
    session: AsyncSession,
    user_id: UUID,
    since_hours: int = 24
) -> List[dict]:
    """Convenience function to fetch emails for intelligence features."""
    connected_account_id = await get_connected_account_id(session, user_id)
    if not connected_account_id:
        logger.warning(f"No connected account for user {user_id}")
        return []

    service = ComposioEmailService(connected_account_id)
    return await service.fetch_recent_emails(since_hours)


async def fetch_calendar_for_intelligence(
    session: AsyncSession,
    user_id: UUID,
    hours: int = 24
) -> List[dict]:
    """Convenience function to fetch calendar for intelligence features."""
    connected_account_id = await get_connected_account_id(session, user_id)
    if not connected_account_id:
        logger.warning(f"No connected account for user {user_id}")
        return []

    service = ComposioCalendarService(connected_account_id)
    return await service.get_upcoming_events(hours)
