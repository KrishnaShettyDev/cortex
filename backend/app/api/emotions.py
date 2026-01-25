"""API endpoints for emotional signature analysis.

Provides endpoints for:
- Analyzing memory emotions
- Getting emotional signatures
- Finding memories by emotion
- Emotional summaries
"""
import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user
from app.models import User, Memory
from app.models.emotion import EmotionalSignature
from app.services.emotion_service import EmotionService

logger = logging.getLogger(__name__)
router = APIRouter()


class EmotionalSignatureResponse(BaseModel):
    """Emotional signature response."""
    id: UUID
    memory_id: UUID
    valence: float
    arousal: float
    dominance: float
    personal_significance: float
    identity_relevance: float
    surprise: float
    consequentiality: float
    primary_emotion: Optional[str]
    secondary_emotions: list[str]
    related_goals: list[str]
    importance_score: float
    emotional_intensity: float
    is_flashbulb_candidate: bool
    confidence: Optional[float]
    analyzed_at: str

    class Config:
        from_attributes = True


class MemoryWithEmotionResponse(BaseModel):
    """Memory with its emotional signature."""
    id: UUID
    content: str
    summary: Optional[str]
    memory_date: str
    strength: float
    emotional_weight: float
    emotion: EmotionalSignatureResponse


class EmotionalSummaryResponse(BaseModel):
    """Emotional summary for a time period."""
    avg_valence: Optional[float]
    avg_arousal: Optional[float]
    avg_dominance: Optional[float]
    avg_importance: Optional[float]
    total_analyzed: int
    emotion_distribution: dict[str, int]
    top_emotion: Optional[str]
    flashbulb_memory_count: int


def _signature_to_response(sig: EmotionalSignature) -> EmotionalSignatureResponse:
    """Convert EmotionalSignature model to response."""
    return EmotionalSignatureResponse(
        id=sig.id,
        memory_id=sig.memory_id,
        valence=sig.valence,
        arousal=sig.arousal,
        dominance=sig.dominance,
        personal_significance=sig.personal_significance,
        identity_relevance=sig.identity_relevance,
        surprise=sig.surprise,
        consequentiality=sig.consequentiality,
        primary_emotion=sig.primary_emotion,
        secondary_emotions=sig.secondary_emotions or [],
        related_goals=sig.related_goals or [],
        importance_score=sig.importance_score,
        emotional_intensity=sig.emotional_intensity,
        is_flashbulb_candidate=sig.is_flashbulb_candidate(),
        confidence=sig.confidence,
        analyzed_at=sig.analyzed_at.isoformat(),
    )


@router.post("/memories/{memory_id}/analyze-emotion", response_model=EmotionalSignatureResponse)
async def analyze_memory_emotion(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Analyze emotional content of a memory.

    Uses AI to extract:
    - PAD coordinates (Pleasure-Arousal-Dominance)
    - Personal significance and identity relevance
    - Flashbulb indicators (surprise, consequentiality)
    - Primary and secondary emotions
    - Related life goals
    """
    from sqlalchemy import select

    result = await db.execute(
        select(Memory)
        .where(Memory.id == memory_id)
        .where(Memory.user_id == current_user.id)
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(404, "Memory not found")

    service = EmotionService(db)
    signature = await service.create_emotional_signature(memory_id)

    return _signature_to_response(signature)


@router.get("/memories/{memory_id}/emotion", response_model=EmotionalSignatureResponse)
async def get_memory_emotion(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get emotional signature for a memory."""
    from sqlalchemy import select

    result = await db.execute(
        select(Memory)
        .where(Memory.id == memory_id)
        .where(Memory.user_id == current_user.id)
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(404, "Memory not found")

    service = EmotionService(db)
    signature = await service.get_emotional_signature(memory_id)
    if not signature:
        raise HTTPException(404, "No emotional signature found. Analyze first.")

    return _signature_to_response(signature)


@router.get("/emotions/search", response_model=list[MemoryWithEmotionResponse])
async def search_by_emotion(
    emotion: Optional[str] = Query(None, description="Filter by primary emotion"),
    min_valence: Optional[float] = Query(None, ge=-1, le=1),
    max_valence: Optional[float] = Query(None, ge=-1, le=1),
    min_arousal: Optional[float] = Query(None, ge=-1, le=1),
    max_arousal: Optional[float] = Query(None, ge=-1, le=1),
    min_importance: Optional[float] = Query(None, ge=0, le=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Search memories by emotional criteria.

    Filter by:
    - Primary emotion (joy, sadness, anger, etc.)
    - Valence range (pleasure/displeasure)
    - Arousal range (activation level)
    - Minimum importance score
    """
    service = EmotionService(db)
    results = await service.find_memories_by_emotion(
        user_id=current_user.id,
        emotion=emotion,
        min_valence=min_valence,
        max_valence=max_valence,
        min_arousal=min_arousal,
        max_arousal=max_arousal,
        min_importance=min_importance,
        limit=limit,
    )

    return [
        MemoryWithEmotionResponse(
            id=memory.id,
            content=memory.content[:500] if len(memory.content) > 500 else memory.content,
            summary=memory.summary,
            memory_date=memory.memory_date.isoformat(),
            strength=memory.strength,
            emotional_weight=memory.emotional_weight,
            emotion=_signature_to_response(sig),
        )
        for memory, sig in results
    ]


@router.get("/emotions/flashbulb", response_model=list[MemoryWithEmotionResponse])
async def get_flashbulb_memories(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get potential flashbulb memories.

    Flashbulb memories are vivid, detailed memories of surprising,
    consequential events. They're typically retained very well.
    """
    service = EmotionService(db)
    results = await service.find_flashbulb_memories(
        user_id=current_user.id,
        limit=limit,
    )

    return [
        MemoryWithEmotionResponse(
            id=memory.id,
            content=memory.content[:500] if len(memory.content) > 500 else memory.content,
            summary=memory.summary,
            memory_date=memory.memory_date.isoformat(),
            strength=memory.strength,
            emotional_weight=memory.emotional_weight,
            emotion=_signature_to_response(sig),
        )
        for memory, sig in results
    ]


@router.get("/emotions/summary", response_model=EmotionalSummaryResponse)
async def get_emotional_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get emotional summary for a time period.

    Returns:
    - Average PAD coordinates
    - Emotion distribution
    - Top emotion
    - Flashbulb memory count
    """
    service = EmotionService(db)
    summary = await service.get_emotional_summary(current_user.id, days=days)
    return EmotionalSummaryResponse(**summary)


@router.post("/emotions/batch-analyze")
async def batch_analyze_emotions(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Batch analyze emotions for memories without signatures.

    Runs AI emotion analysis on unanalyzed memories.
    """
    service = EmotionService(db)
    analyzed = await service.batch_analyze_memories(current_user.id, limit=limit)
    return {"analyzed": analyzed}


@router.get("/emotions/quadrant")
async def get_emotions_by_quadrant(
    quadrant: str = Query(..., pattern="^(happy|excited|calm|sad|angry|afraid)$"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get memories by emotional quadrant.

    Quadrants based on valence × arousal:
    - happy: positive valence, moderate-low arousal
    - excited: positive valence, high arousal
    - calm: neutral-positive valence, low arousal
    - sad: negative valence, low arousal
    - angry: negative valence, high arousal, high dominance
    - afraid: negative valence, high arousal, low dominance
    """
    quadrant_params = {
        "happy": {"min_valence": 0.3, "max_valence": 1.0, "min_arousal": -0.5, "max_arousal": 0.5},
        "excited": {"min_valence": 0.3, "min_arousal": 0.3},
        "calm": {"min_valence": -0.2, "max_valence": 0.5, "min_arousal": -1.0, "max_arousal": 0.0},
        "sad": {"max_valence": -0.2, "min_arousal": -1.0, "max_arousal": 0.2},
        "angry": {"max_valence": -0.2, "min_arousal": 0.3},
        "afraid": {"max_valence": -0.2, "min_arousal": 0.3},
    }

    params = quadrant_params[quadrant]
    service = EmotionService(db)
    results = await service.find_memories_by_emotion(
        user_id=current_user.id,
        limit=limit,
        **params,
    )

    return {
        "quadrant": quadrant,
        "count": len(results),
        "memories": [
            {
                "id": str(memory.id),
                "content": memory.content[:300],
                "summary": memory.summary,
                "memory_date": memory.memory_date.isoformat(),
                "valence": sig.valence,
                "arousal": sig.arousal,
                "primary_emotion": sig.primary_emotion,
            }
            for memory, sig in results
        ],
    }
