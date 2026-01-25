"""API endpoints for advanced memory features.

Includes:
- Decision outcome tracking
- Spaced repetition (SM2)
- Memory consolidation
- Temporal patterns
"""

import logging
from uuid import UUID
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user
from app.models import User, Decision, Memory
from app.models.advanced import TemporalPattern, DecisionMetrics
from app.services.advanced_memory_service import AdvancedMemoryService

logger = logging.getLogger(__name__)
router = APIRouter()


# ==================== SCHEMAS ====================

class DecisionOutcomeRequest(BaseModel):
    """Request to record a decision outcome."""
    outcome_status: str = Field(..., description="Status: successful, failed, abandoned, mixed")
    outcome_notes: Optional[str] = Field(None, max_length=1000)
    outcome_memory_id: Optional[UUID] = Field(None, description="Memory that recorded the outcome")
    confidence_in_hindsight: Optional[float] = Field(None, ge=0, le=1)


class DecisionOutcomeResponse(BaseModel):
    """Response after recording a decision outcome."""
    id: UUID
    topic: str
    decision_text: str
    outcome_status: str
    outcome_notes: Optional[str]
    lessons_learned: Optional[str]
    confidence_at_decision: Optional[float]
    confidence_in_hindsight: Optional[float]

    class Config:
        from_attributes = True


class SM2ReviewRequest(BaseModel):
    """Request for SM2 spaced repetition review."""
    quality: int = Field(..., ge=0, le=5, description="Quality of recall: 0-5")


class SM2ReviewResponse(BaseModel):
    """Response after SM2 review."""
    id: UUID
    content: str
    easiness_factor: float
    interval_days: int
    repetitions: int
    next_review_date: Optional[date]
    strength: float

    class Config:
        from_attributes = True


class MemoryDueForReviewResponse(BaseModel):
    """Memory due for spaced repetition review."""
    id: UUID
    content: str
    summary: Optional[str]
    memory_date: str
    strength: float
    emotional_weight: float
    interval_days: int
    repetitions: int

    class Config:
        from_attributes = True


class TemporalPatternResponse(BaseModel):
    """Temporal pattern response."""
    id: UUID
    pattern_type: str
    trigger: str
    behavior: str
    recommendation: Optional[str]
    confidence: float
    occurrence_count: int
    confirmed_by_user: Optional[bool]

    class Config:
        from_attributes = True


class DecisionInsightsResponse(BaseModel):
    """Aggregated decision insights."""
    total_decisions_tracked: int
    successful: int
    failed: int
    overall_success_rate: Optional[float]
    best_topics: list
    topics_needing_improvement: list
    topics: list


class PendingDecisionResponse(BaseModel):
    """Decision pending outcome tracking."""
    id: UUID
    topic: str
    decision_text: str
    context: Optional[str]
    decision_date: date
    confidence_at_decision: Optional[float]
    days_since_decision: int

    class Config:
        from_attributes = True


# ==================== DECISION OUTCOME ENDPOINTS ====================

@router.post("/decisions/{decision_id}/outcome", response_model=DecisionOutcomeResponse)
async def record_decision_outcome(
    decision_id: UUID,
    request: DecisionOutcomeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Record the outcome of a decision.

    This enables learning from past decisions - a key differentiator.
    """
    valid_statuses = ['successful', 'failed', 'abandoned', 'mixed']
    if request.outcome_status not in valid_statuses:
        raise HTTPException(400, f"Invalid outcome_status. Must be one of: {valid_statuses}")

    service = AdvancedMemoryService(db)
    try:
        decision = await service.record_decision_outcome(
            decision_id=decision_id,
            user_id=current_user.id,
            outcome_status=request.outcome_status,
            outcome_notes=request.outcome_notes,
            outcome_memory_id=request.outcome_memory_id,
            confidence_in_hindsight=request.confidence_in_hindsight,
        )
        return decision
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/decisions/pending", response_model=list[PendingDecisionResponse])
async def get_pending_decisions(
    min_age_days: int = Query(7, ge=1, le=90),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get decisions that need outcome tracking.

    Returns decisions older than min_age_days that don't have outcomes recorded.
    """
    service = AdvancedMemoryService(db)
    decisions = await service.find_pending_decisions(
        user_id=current_user.id,
        min_age_days=min_age_days,
        limit=limit,
    )

    from datetime import datetime
    return [
        PendingDecisionResponse(
            id=d.id,
            topic=d.topic,
            decision_text=d.decision_text,
            context=d.context,
            decision_date=d.decision_date,
            confidence_at_decision=d.confidence_at_decision,
            days_since_decision=(datetime.utcnow().date() - d.decision_date).days,
        )
        for d in decisions
    ]


@router.get("/decisions/insights", response_model=DecisionInsightsResponse)
async def get_decision_insights(
    topic: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get insights about decision-making patterns.

    Shows success rates, best/worst topics, and confidence analysis.
    """
    service = AdvancedMemoryService(db)
    insights = await service.get_decision_insights(current_user.id, topic)
    return insights


# ==================== SPACED REPETITION ENDPOINTS ====================

@router.post("/memories/{memory_id}/review", response_model=SM2ReviewResponse)
async def review_memory(
    memory_id: UUID,
    request: SM2ReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a spaced repetition review for a memory.

    Quality scale (SM2 algorithm):
    - 0: Complete blackout, no recall
    - 1: Incorrect response, but remembered upon seeing
    - 2: Incorrect response, but it seemed easy to recall
    - 3: Correct response with serious difficulty
    - 4: Correct response after hesitation
    - 5: Perfect response
    """
    service = AdvancedMemoryService(db)
    try:
        memory = await service.apply_sm2_review(
            memory_id=memory_id,
            user_id=current_user.id,
            quality=request.quality,
        )
        return memory
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/memories/due-for-review", response_model=list[MemoryDueForReviewResponse])
async def get_memories_due_for_review(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get memories that are due for spaced repetition review.

    Returns memories where next_review_date <= today.
    """
    service = AdvancedMemoryService(db)
    memories = await service.get_memories_due_for_review(
        user_id=current_user.id,
        limit=limit,
    )

    return [
        MemoryDueForReviewResponse(
            id=m.id,
            content=m.content[:500] if len(m.content) > 500 else m.content,
            summary=m.summary,
            memory_date=m.memory_date.isoformat(),
            strength=m.strength,
            emotional_weight=m.emotional_weight,
            interval_days=m.interval_days,
            repetitions=m.repetitions,
        )
        for m in memories
    ]


@router.post("/memories/initialize-spaced-repetition")
async def initialize_spaced_repetition(
    memory_ids: Optional[list[UUID]] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initialize spaced repetition for memories.

    If memory_ids provided, initializes those specific memories.
    Otherwise, initializes top memories by strength/emotion.
    """
    service = AdvancedMemoryService(db)
    count = await service.initialize_spaced_repetition(
        user_id=current_user.id,
        memory_ids=memory_ids,
    )
    return {"initialized": count}


# ==================== MEMORY CONSOLIDATION ENDPOINTS ====================

@router.get("/memories/consolidation-candidates")
async def get_consolidation_candidates(
    limit: int = Query(50, ge=10, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Find groups of similar memories that could be consolidated.

    Returns groups of highly similar (>85% similarity) memories
    that are candidates for merging.
    """
    service = AdvancedMemoryService(db)
    groups = await service.find_consolidation_candidates(
        user_id=current_user.id,
        limit=limit,
    )

    return {
        "groups": [
            {
                "memory_ids": [str(m.id) for m in group],
                "previews": [m.content[:100] for m in group],
                "count": len(group),
            }
            for group in groups
        ],
        "total_groups": len(groups),
    }


@router.post("/memories/consolidate")
async def consolidate_memories(
    memory_ids: list[UUID],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Consolidate multiple similar memories into a single, stronger memory.

    Requires at least 3 memories. The original memories are marked as
    consolidated but not deleted.
    """
    if len(memory_ids) < 3:
        raise HTTPException(400, "At least 3 memories are required for consolidation")

    service = AdvancedMemoryService(db)
    try:
        consolidated = await service.consolidate_memories(
            user_id=current_user.id,
            memory_ids=memory_ids,
        )
        return {
            "consolidated_memory_id": str(consolidated.id),
            "content": consolidated.content,
            "summary": consolidated.summary,
            "source_count": len(memory_ids),
            "strength": consolidated.strength,
        }
    except ValueError as e:
        raise HTTPException(400, str(e))


# ==================== TEMPORAL PATTERN ENDPOINTS ====================

@router.get("/patterns/temporal", response_model=list[TemporalPatternResponse])
async def get_temporal_patterns(
    min_confidence: float = Query(0.5, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get detected temporal patterns.

    Returns patterns like "You tend to feel tired on Monday mornings".
    """
    from sqlalchemy import select

    result = await db.execute(
        select(TemporalPattern)
        .where(TemporalPattern.user_id == current_user.id)
        .where(TemporalPattern.confidence >= min_confidence)
        .where(TemporalPattern.dismissed_at.is_(None))
        .order_by(TemporalPattern.confidence.desc())
    )
    patterns = result.scalars().all()
    return list(patterns)


@router.get("/patterns/relevant")
async def get_relevant_patterns(
    context: Optional[str] = Query(None, max_length=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get patterns relevant to current time or context.

    Returns patterns that match the current day/time or the provided context.
    """
    service = AdvancedMemoryService(db)
    patterns = await service.get_relevant_patterns(
        user_id=current_user.id,
        context=context,
    )

    return {
        "patterns": [
            {
                "id": str(p.id),
                "trigger": p.trigger,
                "behavior": p.behavior,
                "recommendation": p.recommendation,
                "confidence": p.confidence,
            }
            for p in patterns
        ]
    }


@router.post("/patterns/{pattern_id}/confirm")
async def confirm_pattern(
    pattern_id: UUID,
    confirmed: bool,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Confirm or dismiss a detected pattern.

    User feedback improves pattern detection accuracy.
    """
    from sqlalchemy import select
    from datetime import datetime

    result = await db.execute(
        select(TemporalPattern)
        .where(TemporalPattern.id == pattern_id)
        .where(TemporalPattern.user_id == current_user.id)
    )
    pattern = result.scalar_one_or_none()

    if not pattern:
        raise HTTPException(404, "Pattern not found")

    if confirmed:
        pattern.confirmed_by_user = True
        pattern.confidence = min(1.0, pattern.confidence + 0.2)
    else:
        pattern.dismissed_at = datetime.utcnow()
        pattern.confirmed_by_user = False

    await db.commit()

    return {"status": "confirmed" if confirmed else "dismissed"}


@router.post("/patterns/detect")
async def detect_patterns(
    days: int = Query(60, ge=14, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Manually trigger temporal pattern detection.

    Analyzes memories from the past N days to find recurring patterns.
    """
    service = AdvancedMemoryService(db)
    patterns = await service.detect_temporal_patterns(
        user_id=current_user.id,
        days=days,
    )

    return {
        "patterns_detected": len(patterns),
        "patterns": [
            {
                "trigger": p.trigger,
                "behavior": p.behavior,
                "recommendation": p.recommendation,
                "confidence": p.confidence,
            }
            for p in patterns
        ]
    }
