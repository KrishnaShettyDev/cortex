"""
Proactive Intelligence Service for Cortex

Enables Cortex to be genuinely proactive by:
1. Extracting and tracking user intentions ("I should call mom")
2. Detecting topic patterns ("You've mentioned Ruchitha 3x this week")
3. Surfacing relevant upcoming events
4. Finding connections between current and past topics
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Configuration
INTENTION_MIN_AGE_DAYS = 2  # Days before surfacing an intention
TOPIC_MIN_MENTIONS = 3      # Minimum mentions for pattern detection
TOPIC_LOOKBACK_DAYS = 7     # How far back to look for patterns
REMINDER_COOLDOWN_HOURS = 24  # Don't remind same intention more than once per day


class ProactiveIntelligenceService:
    """Generates proactive context to make Cortex anticipate user needs."""

    def __init__(self, session: AsyncSession, openai_client: AsyncOpenAI = None):
        self.session = session
        self.client = openai_client or AsyncOpenAI(api_key=settings.openai_api_key)

    # =========================================================================
    # MAIN ENTRY POINT - Called from chat_service
    # =========================================================================

    async def build_proactive_context(
        self,
        user_id: UUID,
        current_message: str,
    ) -> str:
        """
        Build a proactive context string to inject into the system prompt.

        Returns a string like:
        PROACTIVE CONTEXT (weave naturally into response, don't list):
        - User said they'd "call mom" 5 days ago - no follow-up yet
        - "Ruchitha" mentioned 3x this week
        - Tomorrow: Investor meeting at 2pm
        """
        proactive_notes = []

        try:
            # 1. Open loops / unfollowed intentions
            intentions = await self.get_pending_intentions(user_id, limit=2)
            for intent in intentions:
                days_ago = (datetime.now(timezone.utc) - intent['created_at'].replace(tzinfo=timezone.utc)).days
                if days_ago >= INTENTION_MIN_AGE_DAYS:
                    proactive_notes.append(
                        f"User said they'd \"{intent['action']}\" {days_ago} days ago - no follow-up"
                    )

            # 2. Repeated topics (pattern detection)
            patterns = await self.get_topic_patterns(user_id, days=TOPIC_LOOKBACK_DAYS, min_mentions=TOPIC_MIN_MENTIONS)
            for pattern in patterns[:2]:
                proactive_notes.append(
                    f"\"{pattern['topic']}\" mentioned {pattern['count']}x this week"
                )

            # 3. Upcoming calendar events (next 24 hours)
            upcoming = await self.get_upcoming_events(user_id, hours=24)
            for event in upcoming[:2]:
                proactive_notes.append(
                    f"Upcoming: {event['title']} at {event['time']}"
                )

            # 4. Related past memories (connection finding)
            if current_message and len(current_message) > 10:
                connections = await self.find_related_context(
                    user_id,
                    current_message,
                    exclude_recent_days=3
                )
                for conn in connections[:1]:
                    proactive_notes.append(
                        f"Related ({conn['date']}): {conn['summary']}"
                    )

        except Exception as e:
            logger.warning(f"Error building proactive context: {e}")
            return ""

        if not proactive_notes:
            return ""

        return (
            "PROACTIVE CONTEXT (weave naturally, don't list these verbatim):\n- " +
            "\n- ".join(proactive_notes)
        )

    # =========================================================================
    # INTENTION EXTRACTION - "I should call mom" -> stored
    # =========================================================================

    async def extract_and_store_intentions(
        self,
        user_id: UUID,
        message: str,
        memory_id: UUID = None
    ) -> list[dict]:
        """
        Extract intentions from a user message and store them.

        Intentions are things like:
        - "I should call mom"
        - "Need to review the proposal"
        - "Remind me to buy groceries"
        """
        if len(message) < 10:
            return []

        try:
            # Use GPT to extract intentions
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """Extract any intentions/commitments/todos from the user's message.

Look for phrases like:
- "I should...", "I need to...", "I have to..."
- "Remind me to...", "Don't let me forget..."
- "I'll do X tomorrow/later/soon"
- "I want to...", "I'm going to..."

Return JSON: {"intentions": [{"action": "call mom", "subject": "mom", "due_hint": "soon"}, ...]}

If no intentions found, return: {"intentions": []}

Only extract clear, actionable intentions. Skip vague statements."""
                    },
                    {"role": "user", "content": message}
                ],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=200
            )

            result = json.loads(response.choices[0].message.content)
            intentions = result.get("intentions", [])

            if not isinstance(intentions, list):
                intentions = []

            stored = []
            for intent in intentions:
                if not intent.get("action"):
                    continue

                # Create hash for deduplication
                action_normalized = intent["action"].lower().strip()
                intent_hash = hashlib.sha256(
                    f"{user_id}:{action_normalized}".encode()
                ).hexdigest()[:16]

                # Check if similar intention exists (not completed)
                existing = await self.session.execute(
                    text("""
                        SELECT id FROM cortex_user_intentions
                        WHERE user_id = :user_id
                        AND intention_hash = :hash
                        AND status = 'pending'
                        LIMIT 1
                    """),
                    {"user_id": str(user_id), "hash": intent_hash}
                )

                if existing.fetchone():
                    continue  # Skip duplicate

                # Parse due hint into date
                due_date = self._parse_due_hint(intent.get("due_hint"))

                # Insert new intention
                await self.session.execute(
                    text("""
                        INSERT INTO cortex_user_intentions
                        (user_id, action, subject, source_memory_id, extracted_from,
                         due_date, intention_hash)
                        VALUES (:user_id, :action, :subject, :memory_id, :extracted_from,
                                :due_date, :hash)
                    """),
                    {
                        "user_id": str(user_id),
                        "action": intent["action"],
                        "subject": intent.get("subject"),
                        "memory_id": str(memory_id) if memory_id else None,
                        "extracted_from": message[:500],
                        "due_date": due_date,
                        "hash": intent_hash
                    }
                )

                stored.append(intent)

            if stored:
                await self.session.commit()
                logger.info(f"Stored {len(stored)} intentions for user {user_id}")

            return stored

        except Exception as e:
            logger.warning(f"Failed to extract intentions: {e}")
            return []

    async def get_pending_intentions(
        self,
        user_id: UUID,
        limit: int = 5
    ) -> list[dict]:
        """Get pending intentions, prioritizing overdue and older ones."""
        try:
            result = await self.session.execute(
                text("""
                    SELECT action, subject, due_date, created_at
                    FROM cortex_user_intentions
                    WHERE user_id = :user_id
                    AND status = 'pending'
                    AND (last_reminded_at IS NULL OR last_reminded_at < NOW() - INTERVAL '1 day')
                    ORDER BY
                        CASE WHEN due_date IS NOT NULL AND due_date < NOW() THEN 0 ELSE 1 END,
                        created_at ASC
                    LIMIT :limit
                """),
                {"user_id": str(user_id), "limit": limit}
            )

            return [
                {
                    "action": row.action,
                    "subject": row.subject,
                    "due_date": row.due_date,
                    "created_at": row.created_at,
                }
                for row in result.fetchall()
            ]
        except Exception as e:
            logger.warning(f"Failed to get pending intentions: {e}")
            return []

    async def mark_intention_complete(
        self,
        user_id: UUID,
        action_keywords: str
    ) -> bool:
        """Mark an intention as complete based on keyword match."""
        try:
            result = await self.session.execute(
                text("""
                    UPDATE cortex_user_intentions
                    SET status = 'completed', completed_at = NOW()
                    WHERE user_id = :user_id
                    AND status = 'pending'
                    AND (
                        action ILIKE :pattern
                        OR subject ILIKE :pattern
                    )
                    RETURNING id
                """),
                {"user_id": str(user_id), "pattern": f"%{action_keywords}%"}
            )

            updated = result.fetchone()
            if updated:
                await self.session.commit()
                return True
            return False
        except Exception as e:
            logger.warning(f"Failed to mark intention complete: {e}")
            return False

    # =========================================================================
    # TOPIC PATTERNS - "Ruchitha mentioned 3x this week"
    # =========================================================================

    async def get_topic_patterns(
        self,
        user_id: UUID,
        days: int = 7,
        min_mentions: int = 3
    ) -> list[dict]:
        """Find topics/entities mentioned frequently in recent memories."""
        try:
            # Note: INTERVAL cannot be parameterized in asyncpg, so we use f-string
            # days is an int so this is safe from SQL injection
            result = await self.session.execute(
                text(f"""
                    SELECT
                        e.name as topic,
                        e.entity_type,
                        COUNT(DISTINCT m.id) as mention_count,
                        MAX(m.created_at) as last_mentioned
                    FROM cortex_entities e
                    JOIN cortex_memory_entities me ON e.id = me.entity_id
                    JOIN cortex_memories m ON me.memory_id = m.id
                    WHERE e.user_id = :user_id
                    AND m.created_at > NOW() - INTERVAL '{int(days)} days'
                    AND e.entity_type IN ('person', 'topic', 'company', 'project')
                    GROUP BY e.id, e.name, e.entity_type
                    HAVING COUNT(DISTINCT m.id) >= :min_mentions
                    ORDER BY mention_count DESC
                    LIMIT 5
                """),
                {"user_id": str(user_id), "min_mentions": min_mentions}
            )

            return [
                {
                    "topic": row.topic,
                    "type": row.entity_type,
                    "count": row.mention_count,
                    "last_mentioned": row.last_mentioned
                }
                for row in result.fetchall()
            ]
        except Exception as e:
            logger.warning(f"Failed to get topic patterns: {e}")
            return []

    # =========================================================================
    # CALENDAR AWARENESS - "Meeting tomorrow"
    # =========================================================================

    async def get_upcoming_events(
        self,
        user_id: UUID,
        hours: int = 24
    ) -> list[dict]:
        """Get upcoming calendar events from synced memories."""
        try:
            # Note: INTERVAL cannot be parameterized in asyncpg
            result = await self.session.execute(
                text(f"""
                    SELECT
                        content,
                        summary,
                        memory_date
                    FROM cortex_memories
                    WHERE user_id = :user_id
                    AND memory_type = 'calendar'
                    AND memory_date > NOW()
                    AND memory_date < NOW() + INTERVAL '{int(hours)} hours'
                    ORDER BY memory_date ASC
                    LIMIT 3
                """),
                {"user_id": str(user_id)}
            )

            events = []
            for row in result.fetchall():
                events.append({
                    "title": row.summary or (row.content[:50] if row.content else "Event"),
                    "time": row.memory_date.strftime("%I:%M %p") if row.memory_date else "unknown",
                    "date": row.memory_date
                })

            return events
        except Exception as e:
            logger.warning(f"Failed to get upcoming events: {e}")
            return []

    # =========================================================================
    # CONNECTION FINDING - "Related to what you said before"
    # =========================================================================

    async def find_related_context(
        self,
        user_id: UUID,
        current_message: str,
        exclude_recent_days: int = 3,
        limit: int = 2
    ) -> list[dict]:
        """Find older memories related to current topic using text search."""
        keywords = self._extract_keywords(current_message)
        if not keywords:
            return []

        search_terms = " | ".join(keywords[:5])  # OR search

        try:
            # Note: INTERVAL cannot be parameterized in asyncpg
            result = await self.session.execute(
                text(f"""
                    SELECT
                        id,
                        content,
                        summary,
                        memory_date,
                        ts_rank(search_vector, websearch_to_tsquery('english', :query)) as rank
                    FROM cortex_memories
                    WHERE user_id = :user_id
                    AND created_at < NOW() - INTERVAL '{int(exclude_recent_days)} days'
                    AND search_vector @@ websearch_to_tsquery('english', :query)
                    ORDER BY rank DESC
                    LIMIT :limit
                """),
                {
                    "user_id": str(user_id),
                    "query": search_terms,
                    "limit": limit
                }
            )

            connections = []
            for row in result.fetchall():
                connections.append({
                    "id": row.id,
                    "summary": row.summary or (row.content[:100] if row.content else ""),
                    "date": row.memory_date.strftime("%b %d") if row.memory_date else "unknown",
                    "rank": row.rank
                })

            return connections
        except Exception as e:
            logger.warning(f"Failed to find related context: {e}")
            return []

    # =========================================================================
    # COMPLETION DETECTION - Did they follow through?
    # =========================================================================

    async def check_for_completion_signals(
        self,
        user_id: UUID,
        message: str
    ) -> list[str]:
        """
        Check if the message indicates completion of a pending intention.

        E.g., "Just called mom" should mark "call mom" as complete.
        """
        completion_phrases = [
            "just did", "just finished", "done with", "completed",
            "finally did", "got around to", "took care of", "handled",
            "just called", "just sent", "just emailed", "finished"
        ]

        message_lower = message.lower()
        if not any(phrase in message_lower for phrase in completion_phrases):
            return []

        # Get pending intentions to check against
        pending = await self.get_pending_intentions(user_id, limit=10)
        if not pending:
            return []

        completed = []
        for intent in pending:
            # Simple keyword matching
            action_words = intent['action'].lower().split()
            if any(word in message_lower for word in action_words if len(word) > 3):
                success = await self.mark_intention_complete(user_id, intent['action'])
                if success:
                    completed.append(intent['action'])

        return completed

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _parse_due_hint(self, hint: str) -> Optional[datetime]:
        """Parse natural language time hints into dates."""
        if not hint:
            return None

        hint = hint.lower()
        now = datetime.now(timezone.utc)

        if "today" in hint:
            return now.replace(hour=23, minute=59)
        elif "tomorrow" in hint:
            return now + timedelta(days=1)
        elif "next week" in hint or "this week" in hint:
            return now + timedelta(days=7)
        elif "soon" in hint:
            return now + timedelta(days=3)
        elif "later" in hint:
            return now + timedelta(days=2)

        return None

    def _extract_keywords(self, text: str) -> list[str]:
        """Extract meaningful keywords from text for search."""
        stop_words = {
            'i', 'me', 'my', 'we', 'our', 'you', 'your', 'the', 'a', 'an',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
            'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
            'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
            'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
            'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too',
            'very', 'just', 'about', 'also', 'back', 'been', 'before', 'but',
            'by', 'for', 'from', 'get', 'go', 'going', 'here', 'if', 'in',
            'into', 'it', 'its', 'like', 'make', 'many', 'much', 'new', 'now',
            'of', 'on', 'one', 'or', 'out', 'over', 'see', 'she', 'he', 'him',
            'her', 'they', 'them', 'there', 'then', 'think', 'time', 'to', 'up',
            'use', 'want', 'way', 'well', 'with', 'yeah', 'yes', 'know', 'right',
            'really', 'feeling', 'feel', 'need', 'something', 'anything', 'nothing'
        }

        words = text.lower().split()
        keywords = [
            word.strip('.,!?;:\'\"()[]{}')
            for word in words
            if len(word) > 3 and word.lower() not in stop_words
        ]

        return list(dict.fromkeys(keywords))[:10]  # Dedupe, limit to 10
