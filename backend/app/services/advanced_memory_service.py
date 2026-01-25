"""Advanced Memory Service - State-of-the-art memory infrastructure.

Implements:
1. Decision Outcome Tracking - Track if decisions worked out
2. SM2 Spaced Repetition - Surface important memories before they're forgotten
3. Memory Consolidation - Merge similar memories into stronger, synthesized ones
4. Temporal Pattern Detection - Detect recurring behaviors ("tired on Mondays")
"""

import logging
import json
from datetime import datetime, timedelta, date
from uuid import UUID
from typing import Optional
from collections import defaultdict

from sqlalchemy import select, update, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.models import Memory, Decision, Insight
from app.models.advanced import TemporalPattern, DecisionMetrics
from app.services.embedding_service import embedding_service
from app.config import settings

logger = logging.getLogger(__name__)


class AdvancedMemoryService:
    """Service for advanced memory features: outcomes, SM2, consolidation, patterns."""

    # SM2 Algorithm Constants
    SM2_MIN_EASINESS = 1.3  # Minimum easiness factor
    SM2_DEFAULT_EASINESS = 2.5  # Starting easiness factor
    SM2_QUALITY_THRESHOLD = 3  # Quality >= 3 is a successful recall

    # Consolidation Constants
    CONSOLIDATION_SIMILARITY_THRESHOLD = 0.85  # Very similar memories
    CONSOLIDATION_MIN_MEMORIES = 3  # Min memories to consolidate
    CONSOLIDATION_MAX_AGE_DAYS = 30  # Only consolidate memories older than this

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    # ==================== DECISION OUTCOME TRACKING ====================

    async def record_decision_outcome(
        self,
        decision_id: UUID,
        user_id: UUID,
        outcome_status: str,  # 'successful', 'failed', 'abandoned', 'mixed'
        outcome_notes: Optional[str] = None,
        outcome_memory_id: Optional[UUID] = None,
        confidence_in_hindsight: Optional[float] = None,
    ) -> Decision:
        """
        Record the outcome of a decision.
        This is a key differentiator - learning from past decisions.
        """
        result = await self.db.execute(
            select(Decision)
            .where(Decision.id == decision_id)
            .where(Decision.user_id == user_id)
        )
        decision = result.scalar_one_or_none()
        if not decision:
            raise ValueError(f"Decision {decision_id} not found")

        # Update outcome fields
        decision.outcome_status = outcome_status
        decision.outcome_date = datetime.utcnow()
        decision.outcome_notes = outcome_notes
        decision.outcome_memory_id = outcome_memory_id
        decision.confidence_in_hindsight = confidence_in_hindsight

        # Extract lessons learned using AI
        lessons = await self._extract_lessons_learned(decision)
        decision.lessons_learned = lessons

        await self.db.commit()

        # Update decision metrics
        await self._update_decision_metrics(user_id, decision)

        logger.info(f"Recorded outcome '{outcome_status}' for decision {decision_id}")
        return decision

    async def _extract_lessons_learned(self, decision: Decision) -> str:
        """Use AI to extract lessons from a decision outcome."""
        try:
            prompt = f"""Analyze this decision and its outcome to extract a brief, actionable lesson.

Decision: {decision.decision_text}
Topic: {decision.topic}
Context: {decision.context or 'N/A'}
Outcome: {decision.outcome_status}
Notes: {decision.outcome_notes or 'N/A'}
Initial Confidence: {decision.confidence_at_decision or 0.5}
Hindsight Confidence: {decision.confidence_in_hindsight or 'N/A'}

Extract a brief (1-2 sentence) lesson that could help with future similar decisions.
Focus on actionable insights, not generic advice.
If the outcome was successful, what made it work?
If it failed, what should be done differently?

Return only the lesson, no preamble."""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=150,
                temperature=0.3,
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            logger.error(f"Error extracting lessons: {e}")
            return ""

    async def _update_decision_metrics(self, user_id: UUID, decision: Decision) -> None:
        """Update aggregated decision metrics for the topic."""
        # Get or create metrics for this topic
        result = await self.db.execute(
            select(DecisionMetrics)
            .where(DecisionMetrics.user_id == user_id)
            .where(DecisionMetrics.topic == decision.topic)
            .where(DecisionMetrics.period_start <= date.today())
            .where(DecisionMetrics.period_end >= date.today())
        )
        metrics = result.scalar_one_or_none()

        if not metrics:
            # Create new metrics for current quarter
            today = date.today()
            quarter_start = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
            quarter_end = date(
                today.year + (1 if today.month > 9 else 0),
                ((today.month - 1) // 3 + 1) * 3 % 12 + 1,
                1
            ) - timedelta(days=1)

            metrics = DecisionMetrics(
                user_id=user_id,
                topic=decision.topic,
                period_start=quarter_start,
                period_end=quarter_end,
            )
            self.db.add(metrics)

        # Update counts
        metrics.total_decisions += 1
        if decision.outcome_status == 'successful':
            metrics.successful_decisions += 1
        elif decision.outcome_status == 'failed':
            metrics.failed_decisions += 1

        # Update success rate
        metrics.update_success_rate()

        # Update confidence averages
        if decision.confidence_at_decision:
            if decision.outcome_status == 'successful':
                if metrics.avg_confidence_when_successful:
                    metrics.avg_confidence_when_successful = (
                        metrics.avg_confidence_when_successful * (metrics.successful_decisions - 1)
                        + decision.confidence_at_decision
                    ) / metrics.successful_decisions
                else:
                    metrics.avg_confidence_when_successful = decision.confidence_at_decision
            elif decision.outcome_status == 'failed':
                if metrics.avg_confidence_when_failed:
                    metrics.avg_confidence_when_failed = (
                        metrics.avg_confidence_when_failed * (metrics.failed_decisions - 1)
                        + decision.confidence_at_decision
                    ) / metrics.failed_decisions
                else:
                    metrics.avg_confidence_when_failed = decision.confidence_at_decision

        await self.db.commit()

    async def find_pending_decisions(
        self,
        user_id: UUID,
        min_age_days: int = 7,
        limit: int = 10,
    ) -> list[Decision]:
        """Find decisions that need outcome tracking (old enough, no outcome yet)."""
        cutoff = datetime.utcnow() - timedelta(days=min_age_days)

        result = await self.db.execute(
            select(Decision)
            .where(Decision.user_id == user_id)
            .where(or_(
                Decision.outcome_status.is_(None),
                Decision.outcome_status == 'pending'
            ))
            .where(Decision.created_at <= cutoff)
            .order_by(Decision.decision_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_decision_insights(self, user_id: UUID, topic: Optional[str] = None) -> dict:
        """Get insights about decision-making patterns."""
        query = select(DecisionMetrics).where(DecisionMetrics.user_id == user_id)
        if topic:
            query = query.where(DecisionMetrics.topic == topic)

        result = await self.db.execute(query)
        metrics = list(result.scalars().all())

        if not metrics:
            return {"message": "Not enough decision data yet"}

        # Aggregate insights
        total_decisions = sum(m.total_decisions for m in metrics)
        total_successful = sum(m.successful_decisions for m in metrics)
        total_failed = sum(m.failed_decisions for m in metrics)

        # Find best and worst topics
        topics_with_rates = [
            (m.topic, m.success_rate)
            for m in metrics
            if m.success_rate is not None and m.total_decisions >= 3
        ]
        topics_with_rates.sort(key=lambda x: x[1], reverse=True)

        return {
            "total_decisions_tracked": total_decisions,
            "successful": total_successful,
            "failed": total_failed,
            "overall_success_rate": total_successful / (total_successful + total_failed) if (total_successful + total_failed) > 0 else None,
            "best_topics": topics_with_rates[:3],
            "topics_needing_improvement": topics_with_rates[-3:] if len(topics_with_rates) > 3 else [],
            "topics": [
                {
                    "topic": m.topic,
                    "decisions": m.total_decisions,
                    "success_rate": m.success_rate,
                    "avg_confidence_successful": m.avg_confidence_when_successful,
                    "avg_confidence_failed": m.avg_confidence_when_failed,
                }
                for m in metrics
            ]
        }

    # ==================== SM2 SPACED REPETITION ====================

    async def apply_sm2_review(
        self,
        memory_id: UUID,
        user_id: UUID,
        quality: int,  # 0-5: 0=complete blackout, 5=perfect recall
    ) -> Memory:
        """
        Apply SM2 spaced repetition algorithm to a memory.

        Quality scale:
        0 - Complete blackout, no recall
        1 - Incorrect response, but remembered upon seeing
        2 - Incorrect response, but it seemed easy to recall
        3 - Correct response with serious difficulty
        4 - Correct response after hesitation
        5 - Perfect response
        """
        result = await self.db.execute(
            select(Memory)
            .where(Memory.id == memory_id)
            .where(Memory.user_id == user_id)
        )
        memory = result.scalar_one_or_none()
        if not memory:
            raise ValueError(f"Memory {memory_id} not found")

        quality = max(0, min(5, quality))  # Clamp to 0-5
        memory.last_quality_score = quality

        if quality >= self.SM2_QUALITY_THRESHOLD:
            # Successful recall
            if memory.repetitions == 0:
                memory.interval_days = 1
            elif memory.repetitions == 1:
                memory.interval_days = 6
            else:
                memory.interval_days = round(memory.interval_days * memory.easiness_factor)

            memory.repetitions += 1

            # Update easiness factor (EF)
            memory.easiness_factor = max(
                self.SM2_MIN_EASINESS,
                memory.easiness_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
            )

            # Also boost strength for successful recalls
            memory.strength = min(1.0, memory.strength + 0.05)

        else:
            # Failed recall - reset
            memory.repetitions = 0
            memory.interval_days = 1
            # Don't reduce easiness factor too much on failure
            memory.easiness_factor = max(
                self.SM2_MIN_EASINESS,
                memory.easiness_factor - 0.2
            )

        # Set next review date
        memory.next_review_date = date.today() + timedelta(days=memory.interval_days)

        # Update last accessed
        memory.last_accessed = datetime.utcnow()
        memory.access_count += 1

        await self.db.commit()

        logger.info(
            f"SM2 review for memory {memory_id}: quality={quality}, "
            f"interval={memory.interval_days}d, EF={memory.easiness_factor:.2f}"
        )
        return memory

    async def get_memories_due_for_review(
        self,
        user_id: UUID,
        limit: int = 10,
    ) -> list[Memory]:
        """Get memories that are due for spaced repetition review."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.next_review_date.isnot(None))
            .where(Memory.next_review_date <= date.today())
            .where(Memory.consolidated_into_id.is_(None))  # Not consolidated
            .order_by(Memory.next_review_date.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def initialize_spaced_repetition(
        self,
        user_id: UUID,
        memory_ids: Optional[list[UUID]] = None,
    ) -> int:
        """
        Initialize spaced repetition for memories that don't have it set up.
        Prioritizes high-strength, emotional memories.
        """
        query = (
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.next_review_date.is_(None))
            .where(Memory.consolidated_into_id.is_(None))
            .where(Memory.strength >= 0.5)  # Only reasonably strong memories
            .order_by(
                Memory.emotional_weight.desc(),
                Memory.strength.desc(),
            )
        )

        if memory_ids:
            query = query.where(Memory.id.in_(memory_ids))
        else:
            query = query.limit(100)  # Process in batches

        result = await self.db.execute(query)
        memories = list(result.scalars().all())

        initialized = 0
        for memory in memories:
            # Set initial review date based on memory age and strength
            days_old = (datetime.utcnow() - memory.created_at).days
            initial_interval = max(1, min(7, days_old // 7))  # 1-7 days based on age

            memory.next_review_date = date.today() + timedelta(days=initial_interval)
            memory.interval_days = initial_interval
            initialized += 1

        await self.db.commit()
        logger.info(f"Initialized spaced repetition for {initialized} memories")
        return initialized

    # ==================== MEMORY CONSOLIDATION ====================

    async def find_consolidation_candidates(
        self,
        user_id: UUID,
        limit: int = 50,
    ) -> list[list[Memory]]:
        """
        Find groups of similar memories that could be consolidated.
        Returns list of memory groups that are candidates for merging.
        """
        # Get older memories that haven't been consolidated
        cutoff = datetime.utcnow() - timedelta(days=self.CONSOLIDATION_MAX_AGE_DAYS)

        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.created_at <= cutoff)
            .where(Memory.consolidated_into_id.is_(None))
            .where(Memory.is_consolidated_memory == False)
            .where(Memory.embedding.isnot(None))
            .order_by(Memory.created_at.desc())
            .limit(limit)
        )
        memories = list(result.scalars().all())

        if len(memories) < self.CONSOLIDATION_MIN_MEMORIES:
            return []

        # Group by high similarity
        groups = []
        used = set()

        for i, mem1 in enumerate(memories):
            if mem1.id in used:
                continue

            group = [mem1]
            used.add(mem1.id)

            for j, mem2 in enumerate(memories[i + 1:], i + 1):
                if mem2.id in used:
                    continue

                # Calculate cosine similarity
                if mem1.embedding and mem2.embedding:
                    similarity = self._cosine_similarity(mem1.embedding, mem2.embedding)
                    if similarity >= self.CONSOLIDATION_SIMILARITY_THRESHOLD:
                        group.append(mem2)
                        used.add(mem2.id)

            if len(group) >= self.CONSOLIDATION_MIN_MEMORIES:
                groups.append(group)

        return groups

    def _cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        import math
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        if norm1 == 0 or norm2 == 0:
            return 0
        return dot_product / (norm1 * norm2)

    async def consolidate_memories(
        self,
        user_id: UUID,
        memory_ids: list[UUID],
    ) -> Memory:
        """
        Consolidate multiple similar memories into a single, stronger memory.
        The original memories are marked as consolidated but not deleted.
        """
        # Fetch all memories
        result = await self.db.execute(
            select(Memory)
            .where(Memory.id.in_(memory_ids))
            .where(Memory.user_id == user_id)
        )
        memories = list(result.scalars().all())

        if len(memories) < self.CONSOLIDATION_MIN_MEMORIES:
            raise ValueError(f"Need at least {self.CONSOLIDATION_MIN_MEMORIES} memories to consolidate")

        # Generate consolidated content using AI
        consolidated_content = await self._generate_consolidated_content(memories)

        # Calculate consolidated memory properties
        avg_strength = sum(m.strength for m in memories) / len(memories)
        max_emotional_weight = max(m.emotional_weight for m in memories)
        total_access_count = sum(m.access_count for m in memories)

        # Use the earliest memory date
        earliest_date = min(m.memory_date for m in memories)

        # Create consolidated memory
        consolidated = Memory(
            user_id=user_id,
            content=consolidated_content,
            memory_type='text',  # Consolidated memories are always text
            memory_date=earliest_date,
            strength=min(1.0, avg_strength + 0.1),  # Boost for consolidation
            emotional_weight=max_emotional_weight,
            access_count=total_access_count,
            is_consolidated_memory=True,
            source_memory_ids=[str(m.id) for m in memories],
        )

        # Generate embedding for consolidated content
        consolidated.embedding = await embedding_service.embed(consolidated_content)

        # Generate summary if long
        if len(consolidated_content) > 500:
            consolidated.summary = await self._generate_summary(consolidated_content)

        self.db.add(consolidated)
        await self.db.flush()  # Get the ID

        # Mark original memories as consolidated
        now = datetime.utcnow()
        for memory in memories:
            memory.consolidated_into_id = consolidated.id
            memory.consolidated_at = now

        await self.db.commit()

        logger.info(f"Consolidated {len(memories)} memories into {consolidated.id}")
        return consolidated

    async def _generate_consolidated_content(self, memories: list[Memory]) -> str:
        """Generate synthesized content from multiple memories using AI."""
        memory_texts = [
            f"[{m.memory_date.strftime('%Y-%m-%d')}]: {m.content[:500]}"
            for m in sorted(memories, key=lambda x: x.memory_date)
        ]

        prompt = f"""Synthesize these related memories into a single, coherent summary.
Preserve key facts, insights, and emotional context.
Write in first person, as if recalling a consolidated memory.

Memories:
{chr(10).join(memory_texts)}

Create a consolidated memory (2-4 sentences) that captures the essence of all these memories:"""

        response = await self.openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3,
        )

        return response.choices[0].message.content.strip()

    async def _generate_summary(self, content: str) -> str:
        """Generate a brief summary of content."""
        prompt = f"Summarize this in one sentence:\n\n{content[:1000]}"

        response = await self.openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0.3,
        )

        return response.choices[0].message.content.strip()

    # ==================== TEMPORAL PATTERN DETECTION ====================

    async def detect_temporal_patterns(
        self,
        user_id: UUID,
        days: int = 90,
    ) -> list[TemporalPattern]:
        """
        Analyze memories to detect temporal patterns.
        E.g., "You tend to feel tired on Monday mornings"
        """
        # Get memories from the time period
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.created_at >= cutoff)
            .where(Memory.strength >= 0.3)
            .order_by(Memory.memory_date.asc())
        )
        memories = list(result.scalars().all())

        if len(memories) < 10:
            return []

        # Analyze patterns using AI
        patterns_data = await self._analyze_patterns(memories)

        # Create or update patterns
        patterns = []
        for pattern_data in patterns_data:
            pattern = await self._upsert_temporal_pattern(user_id, pattern_data, memories)
            if pattern:
                patterns.append(pattern)

        await self.db.commit()
        logger.info(f"Detected {len(patterns)} temporal patterns for user {user_id}")
        return patterns

    async def _analyze_patterns(self, memories: list[Memory]) -> list[dict]:
        """Use AI to detect temporal patterns in memories."""
        # Group memories by day of week and time of day
        memory_texts = []
        for m in memories[-100:]:  # Limit for context
            day_name = m.memory_date.strftime("%A")
            time_period = "morning" if m.memory_date.hour < 12 else "afternoon" if m.memory_date.hour < 17 else "evening"
            memory_texts.append(f"[{day_name} {time_period}] {m.content[:200]}")

        prompt = f"""Analyze these memories for temporal patterns - recurring behaviors, moods, or activities that happen at specific times.

Memories (with day and time):
{chr(10).join(memory_texts)}

Identify up to 5 meaningful temporal patterns. For each pattern:
1. When does it occur? (e.g., "Monday mornings", "Friday evenings", "end of month")
2. What behavior/mood occurs? (e.g., "tends to feel stressed", "is more creative")
3. A brief recommendation (optional)

Return as JSON:
{{
    "patterns": [
        {{
            "pattern_type": "weekly|daily|monthly|event_triggered",
            "trigger": "specific time trigger",
            "behavior": "what happens",
            "recommendation": "suggestion or null",
            "confidence": 0.0-1.0
        }}
    ]
}}

Only include patterns with clear evidence. Be conservative."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=800,
                temperature=0.3,
            )

            data = json.loads(response.choices[0].message.content)
            return data.get("patterns", [])

        except Exception as e:
            logger.error(f"Error analyzing patterns: {e}")
            return []

    async def _upsert_temporal_pattern(
        self,
        user_id: UUID,
        pattern_data: dict,
        source_memories: list[Memory],
    ) -> Optional[TemporalPattern]:
        """Create or update a temporal pattern."""
        trigger = pattern_data.get("trigger", "")
        behavior = pattern_data.get("behavior", "")

        if not trigger or not behavior:
            return None

        # Check if pattern already exists
        result = await self.db.execute(
            select(TemporalPattern)
            .where(TemporalPattern.user_id == user_id)
            .where(TemporalPattern.trigger == trigger)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing pattern
            existing.behavior = behavior
            existing.recommendation = pattern_data.get("recommendation")
            existing.confidence = min(1.0, existing.confidence + 0.1)  # Increase confidence
            existing.occurrence_count += 1
            existing.last_occurred = datetime.utcnow()
            return existing
        else:
            # Create new pattern
            pattern = TemporalPattern(
                user_id=user_id,
                pattern_type=pattern_data.get("pattern_type", "weekly"),
                trigger=trigger,
                behavior=behavior,
                recommendation=pattern_data.get("recommendation"),
                confidence=pattern_data.get("confidence", 0.5),
                source_memory_ids=[str(m.id) for m in source_memories[:10]],
            )

            # Generate embedding
            embed_text = f"{trigger} {behavior}"
            pattern.embedding = await embedding_service.embed(embed_text)

            self.db.add(pattern)
            return pattern

    async def get_relevant_patterns(
        self,
        user_id: UUID,
        context: Optional[str] = None,
    ) -> list[TemporalPattern]:
        """Get patterns relevant to current time or context."""
        now = datetime.utcnow()
        day_name = now.strftime("%A").lower()
        time_period = "morning" if now.hour < 12 else "afternoon" if now.hour < 17 else "evening"

        # Get all confirmed patterns
        result = await self.db.execute(
            select(TemporalPattern)
            .where(TemporalPattern.user_id == user_id)
            .where(TemporalPattern.confidence >= 0.5)
            .where(TemporalPattern.dismissed_at.is_(None))
        )
        patterns = list(result.scalars().all())

        # Filter by current time relevance
        relevant = []
        for pattern in patterns:
            trigger_lower = pattern.trigger.lower()
            if day_name in trigger_lower or time_period in trigger_lower:
                relevant.append(pattern)

        # If context provided, also search by semantic similarity
        if context and len(relevant) < 3:
            context_embedding = await embedding_service.embed(context)
            for pattern in patterns:
                if pattern not in relevant and pattern.embedding:
                    similarity = self._cosine_similarity(context_embedding, pattern.embedding)
                    if similarity > 0.7:
                        relevant.append(pattern)

        return relevant[:5]  # Limit to 5 patterns

    # ==================== SCHEDULER JOBS ====================

    async def run_consolidation_job(self) -> dict:
        """Background job to consolidate similar memories."""
        from app.models.user import User

        result = await self.db.execute(
            select(User)
            .join(Memory)
            .group_by(User.id)
            .having(func.count(Memory.id) >= 50)  # Only users with enough memories
        )
        users = list(result.scalars().all())

        total_consolidated = 0

        for user in users:
            try:
                groups = await self.find_consolidation_candidates(user.id, limit=30)
                for group in groups[:5]:  # Max 5 consolidations per user per run
                    await self.consolidate_memories(user.id, [m.id for m in group])
                    total_consolidated += 1
            except Exception as e:
                logger.error(f"Consolidation error for user {user.id}: {e}")

        return {"memories_consolidated": total_consolidated}

    async def run_pattern_detection_job(self) -> dict:
        """Background job to detect temporal patterns."""
        from app.models.user import User

        result = await self.db.execute(
            select(User)
            .join(Memory)
            .group_by(User.id)
            .having(func.count(Memory.id) >= 20)  # Only users with enough memories
        )
        users = list(result.scalars().all())

        total_patterns = 0

        for user in users:
            try:
                patterns = await self.detect_temporal_patterns(user.id, days=60)
                total_patterns += len(patterns)
            except Exception as e:
                logger.error(f"Pattern detection error for user {user.id}: {e}")

        return {"patterns_detected": total_patterns}

    async def run_spaced_repetition_init_job(self) -> dict:
        """Background job to initialize spaced repetition for new memories."""
        from app.models.user import User

        result = await self.db.execute(
            select(User).join(Memory).distinct()
        )
        users = list(result.scalars().all())

        total_initialized = 0

        for user in users:
            try:
                count = await self.initialize_spaced_repetition(user.id)
                total_initialized += count
            except Exception as e:
                logger.error(f"SR init error for user {user.id}: {e}")

        return {"memories_initialized": total_initialized}
