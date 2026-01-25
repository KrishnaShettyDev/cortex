"""Prospective Memory - Intention Service.

Extracts and tracks user intentions from memories.
Enables proactive nudges: "You said you'd do X. You haven't."
"""
import logging
import json
from datetime import datetime, date, timedelta, timezone
from uuid import UUID
from typing import Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.models import Memory
from app.models.intention import Intention, IntentionStatus, IntentionType
from app.config import settings

logger = logging.getLogger(__name__)


class IntentionService:
    """
    Service for extracting and tracking user intentions.

    Prospective memory = remembering to do something in the future.
    """

    EXTRACTION_PROMPT = """Analyze this text for intentions, commitments, or tasks the person is planning to do.

Text: "{text}"
Today's date: {today}

Look for patterns like:
- "I'll do X" / "I will do X"
- "I need to X" / "I have to X"
- "I should X" / "I must X"
- "Remind me to X"
- "Don't let me forget to X"
- "I'm going to X"
- "I want to stop doing X" (avoidance)
- "My goal is to X"

For each intention found, extract:
1. description: Clear, actionable description
2. original_text: The exact phrase from the text
3. intention_type: "task", "commitment", "goal", "habit", or "avoidance"
4. due_date: ISO date (YYYY-MM-DD) if mentioned, null otherwise
5. deadline_flexibility: "strict" (hard deadline), "flexible" (soft), or "anytime"
6. target_person: Name if it involves someone
7. target_action: The verb (email, call, finish, submit, etc.)
8. importance: 0.0-1.0 based on language urgency
9. urgency: 0.0-1.0 based on time pressure

Return JSON:
{{
    "intentions": [
        {{
            "description": "string",
            "original_text": "string",
            "intention_type": "task|commitment|goal|habit|avoidance",
            "due_date": "YYYY-MM-DD or null",
            "deadline_flexibility": "strict|flexible|anytime",
            "target_person": "string or null",
            "target_action": "string",
            "importance": 0.5,
            "urgency": 0.5
        }}
    ]
}}

If no intentions found, return {{"intentions": []}}
Be conservative - only extract clear intentions, not vague wishes."""

    FULFILLMENT_CHECK_PROMPT = """Check if this new activity indicates the intention was fulfilled.

Intention: "{intention}"
Due date: {due_date}

New activity: "{activity}"
Activity date: {activity_date}

Does this activity fulfill or partially fulfill the intention?

Return JSON:
{{
    "fulfilled": true/false,
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation"
}}"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_intentions(self, memory: Memory) -> list[Intention]:
        """
        Extract intentions from a memory.

        Called when a new memory is created to detect any commitments.
        """
        if not memory.content or len(memory.content) < 10:
            return []

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": self.EXTRACTION_PROMPT.format(
                        text=memory.content[:2000],
                        today=date.today().isoformat(),
                    )
                }],
                response_format={"type": "json_object"},
                max_tokens=800,
                temperature=0.2,
            )

            data = json.loads(response.choices[0].message.content)
            intentions = []

            for item in data.get("intentions", []):
                # Parse due date
                due_date = None
                if item.get("due_date"):
                    try:
                        due_date = date.fromisoformat(item["due_date"])
                    except ValueError:
                        pass

                # Map intention type
                intention_type = IntentionType.TASK
                type_str = item.get("intention_type", "task").lower()
                if type_str == "commitment":
                    intention_type = IntentionType.COMMITMENT
                elif type_str == "goal":
                    intention_type = IntentionType.GOAL
                elif type_str == "habit":
                    intention_type = IntentionType.HABIT
                elif type_str == "avoidance":
                    intention_type = IntentionType.AVOIDANCE

                intention = Intention(
                    user_id=memory.user_id,
                    source_memory_id=memory.id,
                    description=item["description"],
                    original_text=item.get("original_text"),
                    intention_type=intention_type,
                    status="active",
                    due_date=due_date,
                    deadline_flexibility=item.get("deadline_flexibility", "flexible"),
                    target_person=item.get("target_person"),
                    target_action=item.get("target_action"),
                    importance=item.get("importance", 0.5),
                    urgency=item.get("urgency", 0.5),
                )

                self.db.add(intention)
                intentions.append(intention)

            if intentions:
                await self.db.commit()
                logger.info(f"Extracted {len(intentions)} intentions from memory {memory.id}")

            return intentions

        except Exception as e:
            logger.error(f"Error extracting intentions: {e}")
            return []

    async def check_fulfillment(
        self,
        intention: Intention,
        recent_memory: Memory,
    ) -> tuple[bool, float]:
        """
        Check if a recent memory indicates intention fulfillment.

        Returns (fulfilled, confidence).
        """
        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": self.FULFILLMENT_CHECK_PROMPT.format(
                        intention=intention.description,
                        due_date=intention.due_date.isoformat() if intention.due_date else "no deadline",
                        activity=recent_memory.content[:500],
                        activity_date=recent_memory.memory_date.date().isoformat() if recent_memory.memory_date else "unknown",
                    )
                }],
                response_format={"type": "json_object"},
                max_tokens=200,
                temperature=0.1,
            )

            data = json.loads(response.choices[0].message.content)
            return data.get("fulfilled", False), data.get("confidence", 0.0)

        except Exception as e:
            logger.error(f"Error checking fulfillment: {e}")
            return False, 0.0

    async def get_active_intentions(
        self,
        user_id: UUID,
        include_due: bool = True,
        include_overdue: bool = True,
    ) -> list[Intention]:
        """Get active intentions for a user."""
        statuses = ["active"]
        if include_due:
            statuses.append("due")
        if include_overdue:
            statuses.append("overdue")

        result = await self.db.execute(
            select(Intention)
            .where(Intention.user_id == user_id)
            .where(Intention.status.in_(statuses))
            .order_by(Intention.due_date.asc().nullslast())
        )
        return list(result.scalars().all())

    async def get_due_intentions(self, user_id: UUID) -> list[Intention]:
        """Get intentions that are due today or overdue."""
        today = date.today()

        result = await self.db.execute(
            select(Intention)
            .where(Intention.user_id == user_id)
            .where(Intention.status.in_(["active", "due"]))
            .where(Intention.due_date <= today)
            .order_by(Intention.due_date.asc())
        )
        return list(result.scalars().all())

    async def get_unfulfilled_intentions(
        self,
        user_id: UUID,
        min_days_old: int = 3,
    ) -> list[Intention]:
        """
        Get intentions that seem unfulfilled.

        These are candidates for proactive nudges.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=min_days_old)

        result = await self.db.execute(
            select(Intention)
            .where(Intention.user_id == user_id)
            .where(Intention.status.in_(["active", "due", "overdue"]))
            .where(Intention.detected_at <= cutoff)
            .where(
                or_(
                    Intention.last_reminded_at.is_(None),
                    Intention.last_reminded_at <= cutoff
                )
            )
            .where(
                or_(
                    Intention.snoozed_until.is_(None),
                    Intention.snoozed_until <= datetime.now(timezone.utc)
                )
            )
            .order_by(Intention.importance.desc(), Intention.due_date.asc().nullslast())
        )
        return list(result.scalars().all())

    async def update_intention_statuses(self, user_id: UUID):
        """
        Update intention statuses based on due dates.

        Called periodically to mark intentions as DUE or OVERDUE.
        """
        today = date.today()

        # Mark as DUE
        result = await self.db.execute(
            select(Intention)
            .where(Intention.user_id == user_id)
            .where(Intention.status == "active")
            .where(Intention.due_date == today)
        )
        for intention in result.scalars().all():
            intention.status = "due"

        # Mark as OVERDUE
        result = await self.db.execute(
            select(Intention)
            .where(Intention.user_id == user_id)
            .where(Intention.status.in_(["active", "due"]))
            .where(Intention.due_date < today)
        )
        for intention in result.scalars().all():
            intention.status = "overdue"

        await self.db.commit()

    async def scan_for_fulfillment(self, user_id: UUID):
        """
        Scan recent memories to check for intention fulfillment.

        Called periodically to auto-detect completed intentions.
        """
        # Get active intentions
        active_intentions = await self.get_active_intentions(user_id)
        if not active_intentions:
            return

        # Get recent memories (last 3 days)
        cutoff = datetime.now(timezone.utc) - timedelta(days=3)
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.created_at >= cutoff)
            .order_by(Memory.created_at.desc())
            .limit(20)
        )
        recent_memories = list(result.scalars().all())

        if not recent_memories:
            return

        for intention in active_intentions:
            for memory in recent_memories:
                # Skip if memory is before intention
                if memory.created_at < intention.detected_at:
                    continue

                fulfilled, confidence = await self.check_fulfillment(intention, memory)

                if fulfilled and confidence >= 0.7:
                    intention.mark_fulfilled(memory.id, confidence)
                    logger.info(f"Intention {intention.id} marked fulfilled with confidence {confidence}")
                    break

        await self.db.commit()

    async def mark_fulfilled(
        self,
        intention_id: UUID,
        user_id: UUID,
        notes: str = None,
    ) -> Intention:
        """Manually mark an intention as fulfilled."""
        result = await self.db.execute(
            select(Intention)
            .where(Intention.id == intention_id)
            .where(Intention.user_id == user_id)
        )
        intention = result.scalar_one_or_none()
        if not intention:
            raise ValueError("Intention not found")

        intention.mark_fulfilled()
        intention.user_confirmed = True
        intention.user_notes = notes
        await self.db.commit()
        return intention

    async def mark_abandoned(
        self,
        intention_id: UUID,
        user_id: UUID,
        notes: str = None,
    ) -> Intention:
        """Mark an intention as abandoned."""
        result = await self.db.execute(
            select(Intention)
            .where(Intention.id == intention_id)
            .where(Intention.user_id == user_id)
        )
        intention = result.scalar_one_or_none()
        if not intention:
            raise ValueError("Intention not found")

        intention.mark_abandoned(notes)
        await self.db.commit()
        return intention

    async def snooze_intention(
        self,
        intention_id: UUID,
        user_id: UUID,
        hours: int = 24,
    ) -> Intention:
        """Snooze an intention for a number of hours."""
        result = await self.db.execute(
            select(Intention)
            .where(Intention.id == intention_id)
            .where(Intention.user_id == user_id)
        )
        intention = result.scalar_one_or_none()
        if not intention:
            raise ValueError("Intention not found")

        intention.snooze(datetime.now(timezone.utc) + timedelta(hours=hours))
        await self.db.commit()
        return intention

    async def get_nudge_message(self, intention: Intention) -> str:
        """
        Generate a nudge message for an unfulfilled intention.

        This is what Cortex says to the user.
        """
        days_ago = (date.today() - intention.detected_at.date()).days if intention.detected_at else 0

        if intention.is_overdue:
            days_overdue = abs(intention.days_until_due)
            if days_overdue == 1:
                return f"You said you'd {intention.description.lower()}. That was due yesterday."
            else:
                return f"You said you'd {intention.description.lower()}. That was due {days_overdue} days ago."

        elif intention.days_until_due == 0:
            return f"Today's the day. You said you'd {intention.description.lower()}."

        elif intention.days_until_due and intention.days_until_due <= 3:
            return f"You said you'd {intention.description.lower()}. {intention.days_until_due} days left."

        elif days_ago >= 5:
            return f"You said you'd {intention.description.lower()}. That was {days_ago} days ago. Did you do it?"

        else:
            return f"Reminder: {intention.description}"

    async def get_intentions_for_chat_context(self, user_id: UUID, limit: int = 5) -> str:
        """
        Get intentions formatted for chat context.

        Gives the LLM awareness of what the user committed to.
        """
        intentions = await self.get_active_intentions(user_id)

        if not intentions:
            return ""

        lines = ["USER'S ACTIVE COMMITMENTS:"]
        for i, intention in enumerate(intentions[:limit], 1):
            status_hint = ""
            if intention.is_overdue:
                status_hint = " [OVERDUE]"
            elif intention.days_until_due == 0:
                status_hint = " [DUE TODAY]"
            elif intention.days_until_due and intention.days_until_due <= 3:
                status_hint = f" [DUE IN {intention.days_until_due} DAYS]"

            lines.append(f"{i}. {intention.description}{status_hint}")

        return "\n".join(lines)
