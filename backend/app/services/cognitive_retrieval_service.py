"""Cognitive Retrieval Service.

Integrates cognitive science features into memory retrieval:
- FSRS-6 retrievability scores
- Context reinstatement (encoding specificity)
- Emotional salience (3D circumplex)
- Mood congruence (mood-congruent recall)
- Autobiographical anchoring

This is where the cognitive science actually affects chat behavior.
"""
import logging
import math
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Memory
from app.models.context import MemoryContext
from app.models.emotion import EmotionalSignature
from app.models.autobiography import LifePeriod, GeneralEvent
from app.services.embedding_service import embedding_service
from app.services.fsrs_service import FSRSService

logger = logging.getLogger(__name__)


# Simple inline mood state (replaces mood_service)
class MoodState:
    """Simple mood representation."""
    def __init__(self, mood_label: str, valence: float, arousal: float, confidence: float):
        self.mood_label = mood_label
        self.valence = valence  # -1 (negative) to 1 (positive)
        self.arousal = arousal  # -1 (calm) to 1 (excited)
        self.confidence = confidence


def _detect_mood_simple(query: str) -> MoodState:
    """Simple keyword-based mood detection."""
    query_lower = query.lower()

    # Positive high-arousal
    if any(w in query_lower for w in ["excited", "amazing", "fantastic", "thrilled"]):
        return MoodState("excited", 0.8, 0.8, 0.7)
    # Positive low-arousal
    if any(w in query_lower for w in ["happy", "good", "great", "love", "nice"]):
        return MoodState("happy", 0.6, 0.2, 0.6)
    # Negative high-arousal
    if any(w in query_lower for w in ["angry", "frustrated", "annoyed", "furious"]):
        return MoodState("angry", -0.7, 0.8, 0.7)
    # Negative low-arousal
    if any(w in query_lower for w in ["sad", "depressed", "down", "upset", "worried"]):
        return MoodState("sad", -0.6, -0.3, 0.6)
    # Anxious
    if any(w in query_lower for w in ["anxious", "nervous", "stressed", "overwhelmed"]):
        return MoodState("anxious", -0.4, 0.6, 0.7)

    # Neutral
    return MoodState("neutral", 0.0, 0.0, 0.3)


def _get_mood_congruent_boost(current_mood: MoodState, memory_valence: float, memory_arousal: float) -> float:
    """Calculate mood congruence score (0-1)."""
    if not current_mood or current_mood.confidence < 0.3:
        return 0.5

    # Euclidean distance in valence-arousal space
    valence_diff = abs(current_mood.valence - memory_valence)
    arousal_diff = abs(current_mood.arousal - memory_arousal)
    distance = math.sqrt(valence_diff**2 + arousal_diff**2)

    # Convert distance to similarity (max distance is ~2.83 for diagonal)
    max_distance = 2.83
    similarity = 1 - (distance / max_distance)

    return max(0.0, min(1.0, similarity))


class CognitiveRetrievalService:
    """
    Memory retrieval using cognitive science principles.

    Scoring formula:
    final_score = (
        SEMANTIC_WEIGHT * semantic_similarity +
        RETRIEVABILITY_WEIGHT * fsrs_retrievability +
        CONTEXT_WEIGHT * context_match +
        EMOTIONAL_WEIGHT * emotional_salience +
        MOOD_WEIGHT * mood_congruence
    )

    This replaces the basic search to make chat actually behave differently.
    """

    # Cognitive scoring weights (tuned based on cognitive science research)
    SEMANTIC_WEIGHT = 0.35      # Base semantic similarity
    RETRIEVABILITY_WEIGHT = 0.15  # FSRS-6 retrievability (how likely to recall)
    CONTEXT_WEIGHT = 0.20       # Context reinstatement bonus
    EMOTIONAL_WEIGHT = 0.15     # Emotional salience (memory's intrinsic importance)
    MOOD_WEIGHT = 0.15          # Mood congruence (match with current mood)

    def __init__(self, db: AsyncSession):
        self.db = db
        self.fsrs_service = FSRSService(db)
        self.current_mood: Optional[MoodState] = None

    async def retrieve(
        self,
        user_id: UUID,
        query: str,
        current_context: Optional[dict] = None,
        limit: int = 10,
    ) -> list[tuple[Memory, dict]]:
        """
        Retrieve memories using cognitive principles.

        Args:
            user_id: The user's ID
            query: Search query
            current_context: Optional dict with current context (location, time_of_day, etc.)
            limit: Maximum number of results

        Returns:
            List of (Memory, score_breakdown) tuples, ranked by cognitive score
        """
        # Step 1: Detect current mood from query (mood-congruent recall)
        self.current_mood = _detect_mood_simple(query)

        # Step 2: Get candidate memories by semantic similarity
        query_embedding = await embedding_service.embed(query)
        candidates = await self._get_semantic_candidates(user_id, query_embedding, limit * 3)

        if not candidates:
            return []

        # Step 3: Load cognitive data for candidates IN PARALLEL
        # These queries are independent - run them concurrently
        memory_ids = [m.id for m in candidates]

        import asyncio
        contexts, emotions, current_period = await asyncio.gather(
            self._load_contexts(memory_ids),
            self._load_emotions(memory_ids),
            self._get_current_period(user_id),
        )

        # Step 4: Score each candidate using cognitive principles
        scored_memories = []
        now = datetime.now(timezone.utc)

        for i, memory in enumerate(candidates):
            # Semantic similarity (position-based approximation since we ordered by distance)
            semantic_score = 1.0 - (i / len(candidates)) * 0.5

            # FSRS retrievability
            retrievability = self._calculate_retrievability(memory, now)

            # Context match (encoding specificity principle)
            context_match = self._calculate_context_match(
                memory,
                contexts.get(memory.id),
                current_context
            )

            # Emotional salience (intrinsic importance of the memory)
            emotional_salience = self._calculate_emotional_salience(
                emotions.get(memory.id)
            )

            # Mood congruence (match between current mood and memory's emotion)
            mood_congruence = self._calculate_mood_congruence(
                emotions.get(memory.id)
            )

            # Combined cognitive score
            final_score = (
                self.SEMANTIC_WEIGHT * semantic_score +
                self.RETRIEVABILITY_WEIGHT * retrievability +
                self.CONTEXT_WEIGHT * context_match +
                self.EMOTIONAL_WEIGHT * emotional_salience +
                self.MOOD_WEIGHT * mood_congruence
            )

            score_breakdown = {
                "final_score": final_score,
                "semantic": semantic_score,
                "retrievability": retrievability,
                "context_match": context_match,
                "emotional_salience": emotional_salience,
                "mood_congruence": mood_congruence,
                "current_mood": self.current_mood.mood_label if self.current_mood else None,
                "life_period": current_period.name if current_period and memory.life_period_id == current_period.id else None,
                "emotion_label": self._get_emotion_label(emotions.get(memory.id)),
            }

            scored_memories.append((memory, score_breakdown))

        # Sort by final cognitive score
        scored_memories.sort(key=lambda x: x[1]["final_score"], reverse=True)

        return scored_memories[:limit]

    async def _get_semantic_candidates(
        self,
        user_id: UUID,
        query_embedding: list[float],
        limit: int,
    ) -> list[Memory]:
        """Get candidate memories by semantic similarity."""
        result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.embedding.isnot(None))
            .order_by(Memory.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def _load_contexts(self, memory_ids: list[UUID]) -> dict[UUID, MemoryContext]:
        """Load context data for memories."""
        if not memory_ids:
            return {}
        result = await self.db.execute(
            select(MemoryContext)
            .where(MemoryContext.memory_id.in_(memory_ids))
        )
        return {ctx.memory_id: ctx for ctx in result.scalars().all()}

    async def _load_emotions(self, memory_ids: list[UUID]) -> dict[UUID, EmotionalSignature]:
        """Load emotional signatures for memories."""
        if not memory_ids:
            return {}
        result = await self.db.execute(
            select(EmotionalSignature)
            .where(EmotionalSignature.memory_id.in_(memory_ids))
        )
        return {emo.memory_id: emo for emo in result.scalars().all()}

    async def _get_current_period(self, user_id: UUID) -> Optional[LifePeriod]:
        """Get user's current life period."""
        result = await self.db.execute(
            select(LifePeriod)
            .where(LifePeriod.user_id == user_id)
            .where(LifePeriod.is_current == True)
        )
        return result.scalar_one_or_none()

    def _calculate_retrievability(self, memory: Memory, now: datetime) -> float:
        """
        Calculate FSRS-6 retrievability score.

        Formula: R(t,S) = (1 + factor × t/S)^(-decay)

        Higher retrievability = user is more likely to recall this memory
        """
        # Use FSRS fields if available
        if memory.fsrs_stability and memory.fsrs_last_review:
            stability = memory.fsrs_stability
            elapsed = (now - memory.fsrs_last_review).days

            # FSRS-6 retrievability formula
            factor = 0.9  # w₁₉ in FSRS-6
            decay = 0.5   # w₂₀ in FSRS-6

            retrievability = math.pow(1 + factor * elapsed / stability, -decay)
            return max(0.0, min(1.0, retrievability))

        # Fallback: use memory age with decay
        if memory.memory_date:
            days_old = (now - memory.memory_date.replace(tzinfo=timezone.utc)).days
            # Exponential decay with 30-day half-life
            return math.exp(-0.693 * days_old / 30)

        return 0.5  # Default middle value

    def _calculate_context_match(
        self,
        memory: Memory,
        memory_context: Optional[MemoryContext],
        current_context: Optional[dict],
    ) -> float:
        """
        Calculate context reinstatement score.

        Based on Tulving's Encoding Specificity Principle:
        Memories are more accessible when retrieval context matches encoding context.

        Context matching includes:
        - Time of day (morning memories easier to recall in morning)
        - Day type (weekend vs weekday)
        - Location type (home, work, cafe, etc.)
        - Location proximity (GPS distance)
        - Activity category
        - Social setting
        - Weather similarity
        """
        if not memory_context or not current_context:
            return 0.5  # Neutral score when no context available

        match_score = 0.0
        match_factors = 0
        weights = {
            "time_of_day": 1.0,
            "is_weekend": 0.8,
            "location_type": 1.2,  # Location is highly important
            "location_proximity": 1.5,  # GPS proximity is most important
            "activity_category": 1.0,
            "social_setting": 0.7,
            "weather": 0.5,  # Minor factor
            "day_of_week": 0.6,
        }

        # Time of day match (morning memories easier to recall in morning)
        if memory_context.time_of_day and current_context.get("time_of_day"):
            weight = weights["time_of_day"]
            if memory_context.time_of_day == current_context["time_of_day"]:
                match_score += weight
            elif self._adjacent_time_of_day(memory_context.time_of_day, current_context["time_of_day"]):
                match_score += weight * 0.5  # Partial match for adjacent times
            match_factors += weight

        # Day type match (weekend memories easier on weekends)
        if memory_context.is_weekend is not None and current_context.get("is_weekend") is not None:
            weight = weights["is_weekend"]
            if memory_context.is_weekend == current_context["is_weekend"]:
                match_score += weight
            match_factors += weight

        # Day of week match (Tuesday memories on Tuesday)
        if memory_context.day_of_week and current_context.get("day_of_week"):
            weight = weights["day_of_week"]
            if memory_context.day_of_week.lower() == current_context["day_of_week"].lower():
                match_score += weight
            match_factors += weight

        # Location type match (home, work, cafe, gym, etc.)
        if memory_context.location_type and current_context.get("location_type"):
            weight = weights["location_type"]
            if memory_context.location_type == current_context["location_type"]:
                match_score += weight
            match_factors += weight

        # Location proximity (GPS-based, most important for context reinstatement)
        if (memory_context.latitude and memory_context.longitude and
            current_context.get("latitude") and current_context.get("longitude")):
            weight = weights["location_proximity"]
            distance_km = self._haversine_distance(
                memory_context.latitude, memory_context.longitude,
                current_context["latitude"], current_context["longitude"]
            )
            # Within 100m = full match, 1km = 0.5 match, 5km+ = 0 match
            if distance_km < 0.1:
                match_score += weight
            elif distance_km < 0.5:
                match_score += weight * 0.8
            elif distance_km < 1.0:
                match_score += weight * 0.5
            elif distance_km < 5.0:
                match_score += weight * 0.2
            match_factors += weight

        # Activity category match
        if memory_context.activity_category and current_context.get("activity_category"):
            weight = weights["activity_category"]
            if memory_context.activity_category == current_context["activity_category"]:
                match_score += weight
            match_factors += weight

        # Social setting match
        if memory_context.social_setting and current_context.get("social_setting"):
            weight = weights["social_setting"]
            if memory_context.social_setting == current_context["social_setting"]:
                match_score += weight
            match_factors += weight

        # Weather match (minor factor - rainy day memories on rainy days)
        if memory_context.weather and current_context.get("weather"):
            weight = weights["weather"]
            if memory_context.weather == current_context["weather"]:
                match_score += weight
            match_factors += weight

        if match_factors == 0:
            return 0.5

        # Normalize to 0-1 range
        normalized_score = match_score / match_factors
        return min(1.0, max(0.0, normalized_score))

    def _adjacent_time_of_day(self, time1: str, time2: str) -> bool:
        """Check if two time-of-day values are adjacent."""
        order = ["morning", "afternoon", "evening", "night"]
        try:
            idx1 = order.index(time1)
            idx2 = order.index(time2)
            return abs(idx1 - idx2) == 1 or (idx1 == 0 and idx2 == 3) or (idx1 == 3 and idx2 == 0)
        except ValueError:
            return False

    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two GPS points in kilometers."""
        import math
        R = 6371  # Earth's radius in km

        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)

        a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

        return R * c

    def _calculate_emotional_salience(
        self,
        emotion: Optional[EmotionalSignature],
    ) -> float:
        """
        Calculate emotional salience score.

        Based on the emotional memory enhancement effect:
        - High arousal memories are better remembered
        - Personally significant memories are prioritized
        - Flashbulb memory indicators (surprise + consequentiality) boost recall
        """
        if not emotion:
            return 0.5  # Neutral when no emotional data

        # Use the computed importance_score if available
        if emotion.importance_score is not None:
            return emotion.importance_score

        # Otherwise calculate from components
        arousal_component = emotion.arousal * 0.25
        significance_component = emotion.personal_significance * 0.30
        surprise_component = emotion.surprise * 0.20
        consequentiality_component = emotion.consequentiality * 0.25

        return (
            arousal_component +
            significance_component +
            surprise_component +
            consequentiality_component
        )

    def _calculate_mood_congruence(
        self,
        emotion: Optional[EmotionalSignature],
    ) -> float:
        """
        Calculate mood congruence score.

        Based on mood-congruent memory effect:
        - People recall memories that match their current emotional state
        - Happy mood → happy memories more accessible
        - Anxious mood → memories of handling anxiety surface

        Uses the mood_service to compare current mood with memory's emotion.
        """
        if not self.current_mood or self.current_mood.confidence < 0.3:
            return 0.5  # Neutral when no confident mood detected

        if not emotion:
            return 0.5  # Neutral when memory has no emotional data

        # Calculate mood congruence
        return _get_mood_congruent_boost(
            current_mood=self.current_mood,
            memory_valence=emotion.valence,
            memory_arousal=emotion.arousal,
        )

    def _get_emotion_label(self, emotion: Optional[EmotionalSignature]) -> Optional[str]:
        """Get human-readable emotion label from 3D circumplex."""
        if not emotion:
            return None

        # Map circumplex values to emotion labels
        valence = emotion.valence
        arousal = emotion.arousal

        if valence > 0.5 and arousal > 0.5:
            return "excited"
        elif valence > 0.5 and arousal < 0.5:
            return "content"
        elif valence < 0.5 and arousal > 0.5:
            return "anxious"
        elif valence < 0.5 and arousal < 0.5:
            return "sad"
        else:
            return "neutral"

    def format_memories_with_cognitive_context(
        self,
        scored_memories: list[tuple[Memory, dict]],
    ) -> str:
        """
        Format memories for LLM context, including cognitive insights.

        This is what makes the chat behave differently - the LLM sees
        cognitive context that helps it understand memory importance.
        """
        if not scored_memories:
            return "No relevant memories found."

        formatted = []

        # Add mood context at the top if detected
        if self.current_mood and self.current_mood.confidence >= 0.4:
            formatted.append(f"[User's current mood detected: {self.current_mood.mood_label}]")
            formatted.append("")

        for i, (memory, scores) in enumerate(scored_memories, 1):
            date_str = memory.memory_date.strftime("%Y-%m-%d %H:%M") if memory.memory_date else "unknown date"

            # Build cognitive context hints
            cognitive_hints = []

            # Retrievability hint
            if scores["retrievability"] > 0.8:
                cognitive_hints.append("(vivid memory)")
            elif scores["retrievability"] < 0.3:
                cognitive_hints.append("(fading memory)")

            # Emotional context
            if scores.get("emotion_label"):
                cognitive_hints.append(f"({scores['emotion_label']})")

            # Mood congruence hint
            if scores.get("mood_congruence", 0.5) > 0.7:
                cognitive_hints.append("(mood-matched)")

            # Life period context
            if scores.get("life_period"):
                cognitive_hints.append(f"(from: {scores['life_period']})")

            hint_str = " ".join(cognitive_hints)

            memory_text = f"""Memory {i} ({memory.memory_type}, {date_str}) {hint_str}:
{memory.content}
"""
            if memory.source_id:
                memory_text += f"Source ID: {memory.source_id}\n"
            if memory.summary:
                memory_text += f"Summary: {memory.summary}\n"

            formatted.append(memory_text)

        return "\n---\n".join(formatted)
