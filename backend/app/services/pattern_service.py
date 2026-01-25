"""
Pattern Extraction Service - Phase 3.3

Detects behavioral patterns from user memories to enable Cortex to make predictive calls:
- "You're about to overcommit again."
- "Last time you did X, you ended up Y."
- "I notice you're stressed. When you're stressed, you stop responding to friends."

Based on cognitive science:
- Pattern recognition in autobiographical memory
- Behavioral consistency and prediction
- Self-regulation and metacognition
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select, and_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory
from app.models.pattern import Pattern, PatternOccurrence, PatternType, PatternValence
from app.models.emotion import EmotionalSignature
from app.models.intention import Intention, IntentionStatus

settings = get_settings()
logger = logging.getLogger(__name__)


class PatternService:
    """Service for extracting and managing behavioral patterns."""

    # Minimum memories to analyze before extracting patterns
    MIN_MEMORIES_FOR_ANALYSIS = 20

    # Minimum evidence required for a pattern
    MIN_EVIDENCE_COUNT = 2

    # Confidence thresholds
    HIGH_CONFIDENCE = 0.75
    MEDIUM_CONFIDENCE = 0.5

    PATTERN_EXTRACTION_PROMPT = """Analyze the following memories and identify behavioral patterns.

A pattern has:
- TRIGGER: What situation/event/emotion precedes the behavior
- BEHAVIOR: What the user does in response
- CONSEQUENCE: What typically happens as a result (optional)
- VALENCE: Is this positive (helpful), negative (self-sabotage), or neutral?

Look for:
1. Commitment patterns: Overcommitting, underdelivering, avoiding commitments
2. Emotional patterns: What they do when stressed, happy, sad, anxious
3. Social patterns: How they interact with specific people or groups
4. Avoidance patterns: What they avoid and when
5. Cyclical patterns: Things that repeat weekly, monthly, seasonally
6. Self-sabotage patterns: How they undermine their own goals

MEMORIES (chronologically ordered):
{memories}

Return a JSON array of patterns found. Each pattern:
{{
    "name": "Short descriptive name (max 5 words)",
    "description": "Full description of the pattern",
    "trigger": "What triggers this behavior",
    "behavior": "What the user does",
    "consequence": "What typically results (or null)",
    "pattern_type": "behavioral|temporal|emotional|social|commitment|avoidance|cyclical",
    "valence": "positive|negative|neutral",
    "evidence_summaries": ["Brief description of memory 1 showing this", "Memory 2..."],
    "confidence": 0.0-1.0 (how confident based on evidence),
    "prediction_template": "Warning message when trigger is detected",
    "warning_template": "Message showing the pattern to user"
}}

Return ONLY valid JSON array. If no clear patterns found, return [].
Focus on patterns with at least 2 pieces of evidence."""

    PATTERN_MATCH_PROMPT = """Given the user's current context and their known patterns, identify which patterns might be relevant right now.

USER'S CURRENT CONTEXT:
{current_context}

KNOWN PATTERNS:
{patterns}

For each pattern, assess:
1. Is the trigger currently active? (0-1 probability)
2. Is the behavior likely to occur soon? (0-1 probability)
3. Should we warn the user? (yes/no with reasoning)

Return JSON array:
[
    {{
        "pattern_name": "Name of pattern",
        "trigger_active": 0.0-1.0,
        "behavior_likely": 0.0-1.0,
        "should_warn": true/false,
        "warning_message": "Specific warning to give user (or null)"
    }}
]

Only return patterns where trigger_active > 0.3. Return [] if no patterns are relevant."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_patterns_for_user(self, user_id: UUID) -> list[Pattern]:
        """
        Analyze user's memories and extract behavioral patterns.

        This is the main entry point called by the scheduler.
        """
        # Get user's memories for analysis
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .order_by(Memory.memory_date.asc())
            .limit(200)  # Analyze last 200 memories
        )
        memories = list(result.scalars().all())

        if len(memories) < self.MIN_MEMORIES_FOR_ANALYSIS:
            logger.info(f"User {user_id} has {len(memories)} memories, need {self.MIN_MEMORIES_FOR_ANALYSIS} for pattern extraction")
            return []

        # Get existing patterns to avoid duplicates
        existing_result = await self.db.execute(
            select(Pattern)
            .where(Pattern.user_id == user_id, Pattern.is_active == True)
        )
        existing_patterns = list(existing_result.scalars().all())

        # Also get unfulfilled intentions - they can indicate patterns
        intentions_result = await self.db.execute(
            select(Intention)
            .where(
                Intention.user_id == user_id,
                Intention.status.in_([IntentionStatus.OVERDUE.value, IntentionStatus.ABANDONED.value])
            )
        )
        failed_intentions = list(intentions_result.scalars().all())

        # Extract patterns using AI
        new_patterns = await self._extract_patterns_with_ai(
            user_id=user_id,
            memories=memories,
            existing_patterns=existing_patterns,
            failed_intentions=failed_intentions,
        )

        return new_patterns

    async def _extract_patterns_with_ai(
        self,
        user_id: UUID,
        memories: list[Memory],
        existing_patterns: list[Pattern],
        failed_intentions: list[Intention],
    ) -> list[Pattern]:
        """Use AI to extract patterns from memories."""
        # Format memories for analysis
        memory_texts = []
        for mem in memories:
            date_str = mem.memory_date.strftime("%Y-%m-%d %H:%M")
            text = f"[{date_str}] {mem.content[:500]}"
            memory_texts.append(text)

        # Add context about failed intentions (commitment patterns)
        if failed_intentions:
            memory_texts.append("\n--- UNFULFILLED COMMITMENTS ---")
            for intention in failed_intentions[:10]:
                memory_texts.append(f"[{intention.status}] {intention.description}")

        # Add existing patterns for context
        existing_context = ""
        if existing_patterns:
            existing_context = "\n\nEXISTING PATTERNS (avoid duplicates):\n"
            for p in existing_patterns:
                existing_context += f"- {p.name}: {p.trigger} -> {p.behavior}\n"

        prompt = self.PATTERN_EXTRACTION_PROMPT.format(
            memories="\n".join(memory_texts)
        ) + existing_context

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a behavioral pattern analyst. Your job is to identify recurring patterns in someone's life based on their memories. Be specific and evidence-based.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )

            result = response.choices[0].message.content.strip()

            # Clean up response (remove markdown code blocks if present)
            if result.startswith("```"):
                result = result.split("```")[1]
                if result.startswith("json"):
                    result = result[4:]
                result = result.strip()

            patterns_data = json.loads(result)

            if not isinstance(patterns_data, list):
                return []

            # Create Pattern objects
            new_patterns = []
            for p_data in patterns_data:
                # Check if similar pattern already exists
                if any(self._patterns_similar(p_data, ep) for ep in existing_patterns):
                    continue

                # Require minimum confidence
                confidence = p_data.get("confidence", 0.5)
                if confidence < 0.4:
                    continue

                pattern = Pattern(
                    user_id=user_id,
                    name=p_data.get("name", "Unnamed Pattern")[:255],
                    description=p_data.get("description", "")[:2000],
                    trigger=p_data.get("trigger", "Unknown trigger")[:1000],
                    behavior=p_data.get("behavior", "Unknown behavior")[:1000],
                    consequence=p_data.get("consequence"),
                    pattern_type=self._validate_pattern_type(p_data.get("pattern_type")),
                    valence=self._validate_valence(p_data.get("valence")),
                    evidence_count=len(p_data.get("evidence_summaries", [])),
                    confidence=confidence,
                    prediction_template=p_data.get("prediction_template"),
                    warning_template=p_data.get("warning_template"),
                )

                self.db.add(pattern)
                new_patterns.append(pattern)

            await self.db.commit()

            # Refresh to get IDs
            for pattern in new_patterns:
                await self.db.refresh(pattern)

            logger.info(f"Extracted {len(new_patterns)} new patterns for user {user_id}")
            return new_patterns

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse pattern extraction response: {e}")
            return []
        except Exception as e:
            logger.error(f"Error extracting patterns: {e}")
            return []

    def _patterns_similar(self, new_data: dict, existing: Pattern) -> bool:
        """Check if a new pattern is too similar to an existing one."""
        # Simple similarity check based on trigger and behavior keywords
        new_trigger = new_data.get("trigger", "").lower()
        new_behavior = new_data.get("behavior", "").lower()

        existing_trigger = existing.trigger.lower()
        existing_behavior = existing.behavior.lower()

        # Check for significant word overlap
        def word_overlap(s1: str, s2: str) -> float:
            words1 = set(s1.split())
            words2 = set(s2.split())
            if not words1 or not words2:
                return 0.0
            return len(words1 & words2) / min(len(words1), len(words2))

        trigger_overlap = word_overlap(new_trigger, existing_trigger)
        behavior_overlap = word_overlap(new_behavior, existing_behavior)

        # If both trigger and behavior are >60% similar, consider it a duplicate
        return trigger_overlap > 0.6 and behavior_overlap > 0.6

    def _validate_pattern_type(self, type_str: str | None) -> str:
        """Validate and return a valid pattern type."""
        valid_types = [t.value for t in PatternType]
        if type_str and type_str.lower() in valid_types:
            return type_str.lower()
        return PatternType.BEHAVIORAL.value

    def _validate_valence(self, valence_str: str | None) -> str:
        """Validate and return a valid valence."""
        valid_valences = [v.value for v in PatternValence]
        if valence_str and valence_str.lower() in valid_valences:
            return valence_str.lower()
        return PatternValence.NEUTRAL.value

    async def get_patterns_for_user(
        self,
        user_id: UUID,
        active_only: bool = True,
        pattern_type: str | None = None,
        valence: str | None = None,
    ) -> list[Pattern]:
        """Get user's patterns with optional filtering."""
        query = select(Pattern).where(Pattern.user_id == user_id)

        if active_only:
            query = query.where(Pattern.is_active == True)

        if pattern_type:
            query = query.where(Pattern.pattern_type == pattern_type)

        if valence:
            query = query.where(Pattern.valence == valence)

        query = query.order_by(desc(Pattern.confidence), desc(Pattern.evidence_count))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_strong_patterns(self, user_id: UUID) -> list[Pattern]:
        """Get high-confidence patterns for chat integration."""
        result = await self.db.execute(
            select(Pattern)
            .where(
                Pattern.user_id == user_id,
                Pattern.is_active == True,
                Pattern.confidence >= 0.6,
                Pattern.evidence_count >= 2,
            )
            .order_by(desc(Pattern.confidence))
            .limit(10)
        )
        return list(result.scalars().all())

    async def check_patterns_against_context(
        self,
        user_id: UUID,
        current_context: str,
    ) -> list[dict]:
        """
        Check if any patterns are currently being triggered.

        Returns warnings for patterns that are likely to occur.
        Used by chat service to proactively warn users.
        """
        patterns = await self.get_strong_patterns(user_id)

        if not patterns:
            return []

        # Format patterns for AI
        patterns_text = "\n".join([
            f"- {p.name}: Trigger={p.trigger}, Behavior={p.behavior}, Valence={p.valence}"
            for p in patterns
        ])

        prompt = self.PATTERN_MATCH_PROMPT.format(
            current_context=current_context,
            patterns=patterns_text,
        )

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a pattern matching system. Identify which behavioral patterns might be active based on the current context.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=500,
            )

            result = response.choices[0].message.content.strip()

            if result.startswith("```"):
                result = result.split("```")[1]
                if result.startswith("json"):
                    result = result[4:]
                result = result.strip()

            matches = json.loads(result)
            return matches if isinstance(matches, list) else []

        except Exception as e:
            logger.error(f"Error checking patterns: {e}")
            return []

    async def get_patterns_for_chat_context(self, user_id: UUID) -> str:
        """
        Format user's patterns for inclusion in chat system prompt.

        Returns a string that helps Cortex make calls about user behavior.
        """
        patterns = await self.get_strong_patterns(user_id)

        if not patterns:
            return ""

        lines = ["\n=== USER'S BEHAVIORAL PATTERNS (use sparingly) ==="]
        lines.append("You know these patterns about the user. Use them ONLY when directly relevant:")
        lines.append("")

        for p in patterns:
            valence_prefix = ""
            if p.valence == PatternValence.NEGATIVE.value:
                valence_prefix = "[watch for] "
            elif p.valence == PatternValence.POSITIVE.value:
                valence_prefix = "[strength] "

            lines.append(f"{valence_prefix}When {p.trigger} -> {p.behavior}")
            lines.append("")

        lines.append("IMPORTANT: Only mention patterns when:")
        lines.append("- User is discussing something directly related to a trigger")
        lines.append("- User asks for advice on a relevant topic")
        lines.append("- NOT on greetings, small talk, or unrelated questions")
        lines.append("")

        return "\n".join(lines)

    async def record_occurrence(
        self,
        pattern_id: UUID,
        trigger_memory_id: UUID | None = None,
        behavior_memory_id: UUID | None = None,
        predicted: bool = False,
        observed: bool = False,
    ) -> PatternOccurrence:
        """Record when a pattern is predicted or observed."""
        occurrence = PatternOccurrence(
            pattern_id=pattern_id,
            trigger_memory_id=trigger_memory_id,
            behavior_memory_id=behavior_memory_id,
            predicted=predicted,
            observed=observed,
            predicted_at=datetime.utcnow() if predicted else None,
            observed_at=datetime.utcnow() if observed else None,
        )
        self.db.add(occurrence)

        # Update pattern stats
        pattern_result = await self.db.execute(
            select(Pattern).where(Pattern.id == pattern_id)
        )
        pattern = pattern_result.scalar_one_or_none()
        if pattern:
            if predicted:
                pattern.times_predicted += 1
            if observed:
                pattern.last_observed = datetime.utcnow()
                pattern.evidence_count += 1
                # Increase confidence when observed
                pattern.confidence = min(1.0, pattern.confidence + 0.05)

        await self.db.commit()
        await self.db.refresh(occurrence)
        return occurrence

    async def mark_prediction_accurate(
        self,
        occurrence_id: UUID,
        was_accurate: bool,
        user_prevented: bool = False,
    ) -> None:
        """Mark whether a prediction was accurate."""
        result = await self.db.execute(
            select(PatternOccurrence).where(PatternOccurrence.id == occurrence_id)
        )
        occurrence = result.scalar_one_or_none()

        if occurrence:
            occurrence.prediction_was_accurate = was_accurate
            occurrence.user_prevented = user_prevented
            occurrence.observed_at = datetime.utcnow()

            # Update pattern stats
            pattern_result = await self.db.execute(
                select(Pattern).where(Pattern.id == occurrence.pattern_id)
            )
            pattern = pattern_result.scalar_one_or_none()
            if pattern and was_accurate:
                pattern.times_accurate += 1

            await self.db.commit()

    async def user_confirm_pattern(
        self,
        pattern_id: UUID,
        user_id: UUID,
        confirmed: bool,
    ) -> Pattern | None:
        """User confirms or denies a pattern."""
        result = await self.db.execute(
            select(Pattern).where(
                Pattern.id == pattern_id,
                Pattern.user_id == user_id,
            )
        )
        pattern = result.scalar_one_or_none()

        if pattern:
            pattern.user_confirmed = confirmed
            pattern.is_acknowledged = True

            if confirmed:
                # Boost confidence
                pattern.confidence = min(1.0, pattern.confidence + 0.15)
            else:
                # Reduce confidence significantly
                pattern.confidence = max(0.0, pattern.confidence - 0.3)
                # If user denies and confidence is low, deactivate
                if pattern.confidence < 0.3:
                    pattern.is_active = False

            await self.db.commit()
            await self.db.refresh(pattern)

        return pattern

    async def deactivate_pattern(self, pattern_id: UUID, user_id: UUID) -> bool:
        """Deactivate a pattern (user doesn't want to see it)."""
        result = await self.db.execute(
            select(Pattern).where(
                Pattern.id == pattern_id,
                Pattern.user_id == user_id,
            )
        )
        pattern = result.scalar_one_or_none()

        if pattern:
            pattern.is_active = False
            await self.db.commit()
            return True
        return False

    async def get_negative_patterns(self, user_id: UUID) -> list[Pattern]:
        """Get patterns with negative valence (self-sabotage, avoidance)."""
        result = await self.db.execute(
            select(Pattern)
            .where(
                Pattern.user_id == user_id,
                Pattern.is_active == True,
                Pattern.valence == PatternValence.NEGATIVE.value,
                Pattern.confidence >= 0.5,
            )
            .order_by(desc(Pattern.confidence))
        )
        return list(result.scalars().all())

    async def analyze_current_situation(
        self,
        user_id: UUID,
        recent_memories: list[Memory],
    ) -> list[dict]:
        """
        Analyze recent memories to detect if user is in a trigger situation.

        Returns list of active patterns with warnings.
        """
        if not recent_memories:
            return []

        # Get strong patterns
        patterns = await self.get_strong_patterns(user_id)
        if not patterns:
            return []

        # Format recent memories as context
        context = "\n".join([
            f"[{m.memory_date.strftime('%Y-%m-%d')}] {m.content[:300]}"
            for m in recent_memories[:10]
        ])

        # Check against patterns
        return await self.check_patterns_against_context(user_id, context)
