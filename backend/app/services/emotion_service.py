"""Emotion Analysis Service.

Analyzes memory content to extract emotional signatures using:
- 3D Circumplex Model (Valence × Arousal × Dominance)
- Personal significance detection
- Flashbulb memory indicators
- Goal relevance extraction
"""
import logging
import json
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.models import Memory
from app.models.emotion import EmotionalSignature
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class EmotionAnalysis:
    """Result of emotion analysis."""
    valence: float
    arousal: float
    dominance: float
    personal_significance: float
    identity_relevance: float
    surprise: float
    consequentiality: float
    primary_emotion: str
    secondary_emotions: list[str]
    related_goals: list[str]
    confidence: float


class EmotionService:
    """Service for analyzing and managing emotional signatures."""

    ANALYSIS_VERSION = 1

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def analyze_memory(
        self,
        memory: Memory,
        context: Optional[str] = None,
    ) -> EmotionAnalysis:
        """Analyze emotional content of a memory using AI.

        Returns PAD coordinates and personal meaning factors.
        """
        content = memory.content[:2000]  # Limit for API

        prompt = f"""Analyze the emotional content of this memory/journal entry.

Memory: "{content}"
{f'Additional context: {context}' if context else ''}

Provide emotional analysis in JSON format:
{{
    "valence": float (-1 to 1, -1=very unpleasant, 1=very pleasant),
    "arousal": float (-1 to 1, -1=very calm/deactivated, 1=very activated/excited),
    "dominance": float (-1 to 1, -1=submissive/helpless, 1=dominant/in control),
    "personal_significance": float (0 to 1, how personally meaningful is this to the person),
    "identity_relevance": float (0 to 1, how much does this relate to their sense of self/identity),
    "surprise": float (0 to 1, how unexpected or surprising is this event),
    "consequentiality": float (0 to 1, how much impact could this have on their life),
    "primary_emotion": string (most prominent emotion: joy, sadness, anger, fear, surprise, etc.),
    "secondary_emotions": list of strings (other emotions present),
    "related_goals": list of strings (any life goals this relates to, e.g., "career advancement", "health"),
    "confidence": float (0 to 1, your confidence in this analysis)
}}

Be nuanced and accurate. Consider context and implicit emotions. Only return valid JSON."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=500,
                temperature=0.3,
            )

            data = json.loads(response.choices[0].message.content)

            return EmotionAnalysis(
                valence=self._clamp(data.get("valence", 0), -1, 1),
                arousal=self._clamp(data.get("arousal", 0), -1, 1),
                dominance=self._clamp(data.get("dominance", 0), -1, 1),
                personal_significance=self._clamp(data.get("personal_significance", 0.5), 0, 1),
                identity_relevance=self._clamp(data.get("identity_relevance", 0), 0, 1),
                surprise=self._clamp(data.get("surprise", 0), 0, 1),
                consequentiality=self._clamp(data.get("consequentiality", 0), 0, 1),
                primary_emotion=data.get("primary_emotion", "neutral"),
                secondary_emotions=data.get("secondary_emotions", []),
                related_goals=data.get("related_goals", []),
                confidence=self._clamp(data.get("confidence", 0.7), 0, 1),
            )

        except Exception as e:
            logger.error(f"Emotion analysis failed: {e}")
            return self._default_analysis()

    def _clamp(self, value: float, min_val: float, max_val: float) -> float:
        """Clamp value to range."""
        return max(min_val, min(max_val, value))

    def _default_analysis(self) -> EmotionAnalysis:
        """Return default neutral analysis."""
        return EmotionAnalysis(
            valence=0.0,
            arousal=0.0,
            dominance=0.0,
            personal_significance=0.5,
            identity_relevance=0.0,
            surprise=0.0,
            consequentiality=0.0,
            primary_emotion="neutral",
            secondary_emotions=[],
            related_goals=[],
            confidence=0.3,
        )

    async def create_emotional_signature(
        self,
        memory_id: UUID,
        analysis: Optional[EmotionAnalysis] = None,
    ) -> EmotionalSignature:
        """Create or update emotional signature for a memory."""
        result = await self.db.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        memory = result.scalar_one_or_none()
        if memory is None:
            raise ValueError(f"Memory {memory_id} not found")

        if analysis is None:
            analysis = await self.analyze_memory(memory)

        result = await self.db.execute(
            select(EmotionalSignature).where(EmotionalSignature.memory_id == memory_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.valence = analysis.valence
            existing.arousal = analysis.arousal
            existing.dominance = analysis.dominance
            existing.personal_significance = analysis.personal_significance
            existing.identity_relevance = analysis.identity_relevance
            existing.surprise = analysis.surprise
            existing.consequentiality = analysis.consequentiality
            existing.primary_emotion = analysis.primary_emotion
            existing.secondary_emotions = analysis.secondary_emotions
            existing.related_goals = analysis.related_goals
            existing.confidence = analysis.confidence
            existing.analyzed_at = datetime.now(timezone.utc)
            existing.analysis_version = self.ANALYSIS_VERSION
            existing.update_importance()
            signature = existing
        else:
            signature = EmotionalSignature(
                memory_id=memory_id,
                valence=analysis.valence,
                arousal=analysis.arousal,
                dominance=analysis.dominance,
                personal_significance=analysis.personal_significance,
                identity_relevance=analysis.identity_relevance,
                surprise=analysis.surprise,
                consequentiality=analysis.consequentiality,
                primary_emotion=analysis.primary_emotion,
                secondary_emotions=analysis.secondary_emotions,
                related_goals=analysis.related_goals,
                confidence=analysis.confidence,
                analysis_version=self.ANALYSIS_VERSION,
            )
            signature.update_importance()
            self.db.add(signature)

        await self.db.commit()

        memory.emotional_weight = signature.importance_score
        await self.db.commit()

        logger.info(
            f"Created emotional signature for memory {memory_id}: "
            f"V={signature.valence:.2f}, A={signature.arousal:.2f}, D={signature.dominance:.2f}, "
            f"importance={signature.importance_score:.2f}"
        )
        return signature

    async def get_emotional_signature(
        self,
        memory_id: UUID,
    ) -> Optional[EmotionalSignature]:
        """Get emotional signature for a memory."""
        result = await self.db.execute(
            select(EmotionalSignature).where(EmotionalSignature.memory_id == memory_id)
        )
        return result.scalar_one_or_none()

    async def find_memories_by_emotion(
        self,
        user_id: UUID,
        emotion: Optional[str] = None,
        min_valence: Optional[float] = None,
        max_valence: Optional[float] = None,
        min_arousal: Optional[float] = None,
        max_arousal: Optional[float] = None,
        min_importance: Optional[float] = None,
        limit: int = 20,
    ) -> list[tuple[Memory, EmotionalSignature]]:
        """Find memories by emotional criteria."""
        from sqlalchemy import and_

        conditions = [Memory.user_id == user_id, Memory.consolidated_into_id.is_(None)]

        query = (
            select(Memory, EmotionalSignature)
            .join(EmotionalSignature, Memory.id == EmotionalSignature.memory_id)
        )

        if emotion:
            conditions.append(EmotionalSignature.primary_emotion == emotion.lower())
        if min_valence is not None:
            conditions.append(EmotionalSignature.valence >= min_valence)
        if max_valence is not None:
            conditions.append(EmotionalSignature.valence <= max_valence)
        if min_arousal is not None:
            conditions.append(EmotionalSignature.arousal >= min_arousal)
        if max_arousal is not None:
            conditions.append(EmotionalSignature.arousal <= max_arousal)
        if min_importance is not None:
            conditions.append(EmotionalSignature.importance_score >= min_importance)

        query = query.where(and_(*conditions))
        query = query.order_by(EmotionalSignature.importance_score.desc())
        query = query.limit(limit)

        result = await self.db.execute(query)
        return list(result.all())

    async def find_flashbulb_memories(
        self,
        user_id: UUID,
        limit: int = 10,
    ) -> list[tuple[Memory, EmotionalSignature]]:
        """Find potential flashbulb memories.

        Flashbulb memories are vivid, detailed memories of surprising,
        consequential events.
        """
        from sqlalchemy import and_

        query = (
            select(Memory, EmotionalSignature)
            .join(EmotionalSignature, Memory.id == EmotionalSignature.memory_id)
            .where(and_(
                Memory.user_id == user_id,
                Memory.consolidated_into_id.is_(None),
                EmotionalSignature.surprise >= 0.6,
                EmotionalSignature.consequentiality >= 0.5,
            ))
            .order_by(EmotionalSignature.importance_score.desc())
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.all())

    async def get_emotional_summary(
        self,
        user_id: UUID,
        days: int = 30,
    ) -> dict:
        """Get emotional summary for a user over a time period."""
        from sqlalchemy import func
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(
                func.avg(EmotionalSignature.valence).label("avg_valence"),
                func.avg(EmotionalSignature.arousal).label("avg_arousal"),
                func.avg(EmotionalSignature.dominance).label("avg_dominance"),
                func.avg(EmotionalSignature.importance_score).label("avg_importance"),
                func.count(EmotionalSignature.id).label("total_analyzed"),
            )
            .join(Memory, EmotionalSignature.memory_id == Memory.id)
            .where(Memory.user_id == user_id)
            .where(EmotionalSignature.analyzed_at >= cutoff)
        )
        row = result.one()

        emotion_counts = await self.db.execute(
            select(
                EmotionalSignature.primary_emotion,
                func.count(EmotionalSignature.id).label("count"),
            )
            .join(Memory, EmotionalSignature.memory_id == Memory.id)
            .where(Memory.user_id == user_id)
            .where(EmotionalSignature.analyzed_at >= cutoff)
            .group_by(EmotionalSignature.primary_emotion)
            .order_by(func.count(EmotionalSignature.id).desc())
        )
        emotions = emotion_counts.all()

        flashbulb_count = await self.db.scalar(
            select(func.count(EmotionalSignature.id))
            .join(Memory, EmotionalSignature.memory_id == Memory.id)
            .where(Memory.user_id == user_id)
            .where(EmotionalSignature.analyzed_at >= cutoff)
            .where(EmotionalSignature.surprise >= 0.6)
            .where(EmotionalSignature.consequentiality >= 0.5)
        )

        return {
            "avg_valence": float(row.avg_valence) if row.avg_valence else None,
            "avg_arousal": float(row.avg_arousal) if row.avg_arousal else None,
            "avg_dominance": float(row.avg_dominance) if row.avg_dominance else None,
            "avg_importance": float(row.avg_importance) if row.avg_importance else None,
            "total_analyzed": row.total_analyzed or 0,
            "emotion_distribution": {
                e.primary_emotion: e.count for e in emotions if e.primary_emotion
            },
            "top_emotion": emotions[0].primary_emotion if emotions else None,
            "flashbulb_memory_count": flashbulb_count or 0,
        }

    async def batch_analyze_memories(
        self,
        user_id: UUID,
        limit: int = 50,
    ) -> int:
        """Batch analyze memories without emotional signatures."""
        result = await self.db.execute(
            select(Memory)
            .outerjoin(EmotionalSignature, Memory.id == EmotionalSignature.memory_id)
            .where(Memory.user_id == user_id)
            .where(EmotionalSignature.id.is_(None))
            .where(Memory.consolidated_into_id.is_(None))
            .order_by(Memory.created_at.desc())
            .limit(limit)
        )
        memories = list(result.scalars().all())

        analyzed = 0
        for memory in memories:
            try:
                await self.create_emotional_signature(memory.id)
                analyzed += 1
            except Exception as e:
                logger.error(f"Failed to analyze memory {memory.id}: {e}")

        logger.info(f"Batch analyzed {analyzed} memories for user {user_id}")
        return analyzed
