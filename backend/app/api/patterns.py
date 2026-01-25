"""
Pattern API endpoints for Phase 3.3 Pattern Extraction.

Provides endpoints for:
- Listing user's behavioral patterns
- Confirming/denying patterns
- Deactivating patterns
- Manual pattern extraction trigger
"""

import logging
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.pattern_service import PatternService
from app.models.pattern import PatternType, PatternValence

logger = logging.getLogger(__name__)
router = APIRouter()


# === Schemas ===

class PatternResponse(BaseModel):
    """Response schema for a pattern."""
    id: UUID
    name: str
    description: str
    trigger: str
    behavior: str
    consequence: Optional[str] = None
    pattern_type: str
    valence: str
    evidence_count: int
    confidence: float
    is_acknowledged: bool
    user_confirmed: Optional[bool] = None
    prediction_template: Optional[str] = None
    warning_template: Optional[str] = None
    times_predicted: int
    times_accurate: int
    created_at: str

    class Config:
        from_attributes = True


class PatternListResponse(BaseModel):
    """Response schema for pattern list."""
    patterns: list[PatternResponse]
    total: int


class PatternConfirmRequest(BaseModel):
    """Request to confirm or deny a pattern."""
    confirmed: bool = Field(..., description="True if user confirms pattern is accurate")


class PatternMatchResponse(BaseModel):
    """Response for pattern match check."""
    pattern_name: str
    trigger_active: float
    behavior_likely: float
    should_warn: bool
    warning_message: Optional[str] = None


class CurrentSituationResponse(BaseModel):
    """Response for current situation analysis."""
    active_patterns: list[PatternMatchResponse]
    has_warnings: bool


# === Endpoints ===

@router.get("", response_model=PatternListResponse)
async def list_patterns(
    active_only: bool = Query(True, description="Only return active patterns"),
    pattern_type: Optional[str] = Query(None, description="Filter by pattern type"),
    valence: Optional[str] = Query(None, description="Filter by valence (positive/negative/neutral)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List user's behavioral patterns.

    Returns patterns detected from memory analysis.
    Patterns are sorted by confidence and evidence count.
    """
    service = PatternService(db)
    patterns = await service.get_patterns_for_user(
        user_id=current_user.id,
        active_only=active_only,
        pattern_type=pattern_type,
        valence=valence,
    )

    return PatternListResponse(
        patterns=[
            PatternResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                trigger=p.trigger,
                behavior=p.behavior,
                consequence=p.consequence,
                pattern_type=p.pattern_type,
                valence=p.valence,
                evidence_count=p.evidence_count,
                confidence=p.confidence,
                is_acknowledged=p.is_acknowledged,
                user_confirmed=p.user_confirmed,
                prediction_template=p.prediction_template,
                warning_template=p.warning_template,
                times_predicted=p.times_predicted,
                times_accurate=p.times_accurate,
                created_at=p.created_at.isoformat() if p.created_at else "",
            )
            for p in patterns
        ],
        total=len(patterns),
    )


@router.get("/negative", response_model=PatternListResponse)
async def get_negative_patterns(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get patterns with negative valence (self-sabotage, avoidance).

    These are the patterns Cortex should warn about.
    """
    service = PatternService(db)
    patterns = await service.get_negative_patterns(current_user.id)

    return PatternListResponse(
        patterns=[
            PatternResponse(
                id=p.id,
                name=p.name,
                description=p.description,
                trigger=p.trigger,
                behavior=p.behavior,
                consequence=p.consequence,
                pattern_type=p.pattern_type,
                valence=p.valence,
                evidence_count=p.evidence_count,
                confidence=p.confidence,
                is_acknowledged=p.is_acknowledged,
                user_confirmed=p.user_confirmed,
                prediction_template=p.prediction_template,
                warning_template=p.warning_template,
                times_predicted=p.times_predicted,
                times_accurate=p.times_accurate,
                created_at=p.created_at.isoformat() if p.created_at else "",
            )
            for p in patterns
        ],
        total=len(patterns),
    )


@router.get("/current-situation", response_model=CurrentSituationResponse)
async def analyze_current_situation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyze user's current situation against known patterns.

    Returns any patterns that might be active right now, with warnings.
    """
    from sqlalchemy import select, desc
    from app.models.memory import Memory
    from datetime import datetime, timedelta

    # Get recent memories (last 3 days)
    result = await db.execute(
        select(Memory)
        .where(
            Memory.user_id == current_user.id,
            Memory.memory_date >= datetime.utcnow() - timedelta(days=3)
        )
        .order_by(desc(Memory.memory_date))
        .limit(20)
    )
    recent_memories = list(result.scalars().all())

    if not recent_memories:
        return CurrentSituationResponse(active_patterns=[], has_warnings=False)

    service = PatternService(db)
    matches = await service.analyze_current_situation(current_user.id, recent_memories)

    active_patterns = [
        PatternMatchResponse(
            pattern_name=m.get("pattern_name", "Unknown"),
            trigger_active=m.get("trigger_active", 0),
            behavior_likely=m.get("behavior_likely", 0),
            should_warn=m.get("should_warn", False),
            warning_message=m.get("warning_message"),
        )
        for m in matches
        if m.get("trigger_active", 0) > 0.3
    ]

    return CurrentSituationResponse(
        active_patterns=active_patterns,
        has_warnings=any(p.should_warn for p in active_patterns),
    )


@router.post("/{pattern_id}/confirm", response_model=PatternResponse)
async def confirm_pattern(
    pattern_id: UUID,
    request: PatternConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Confirm or deny a pattern.

    If confirmed, pattern confidence increases.
    If denied, confidence decreases and pattern may be deactivated.
    """
    service = PatternService(db)
    pattern = await service.user_confirm_pattern(
        pattern_id=pattern_id,
        user_id=current_user.id,
        confirmed=request.confirmed,
    )

    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern not found")

    return PatternResponse(
        id=pattern.id,
        name=pattern.name,
        description=pattern.description,
        trigger=pattern.trigger,
        behavior=pattern.behavior,
        consequence=pattern.consequence,
        pattern_type=pattern.pattern_type,
        valence=pattern.valence,
        evidence_count=pattern.evidence_count,
        confidence=pattern.confidence,
        is_acknowledged=pattern.is_acknowledged,
        user_confirmed=pattern.user_confirmed,
        prediction_template=pattern.prediction_template,
        warning_template=pattern.warning_template,
        times_predicted=pattern.times_predicted,
        times_accurate=pattern.times_accurate,
        created_at=pattern.created_at.isoformat() if pattern.created_at else "",
    )


@router.delete("/{pattern_id}")
async def deactivate_pattern(
    pattern_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Deactivate a pattern.

    User doesn't want to see this pattern anymore.
    Pattern is kept but marked inactive for potential reactivation.
    """
    service = PatternService(db)
    success = await service.deactivate_pattern(pattern_id, current_user.id)

    if not success:
        raise HTTPException(status_code=404, detail="Pattern not found")

    return {"status": "deactivated", "pattern_id": str(pattern_id)}


@router.post("/extract")
async def trigger_pattern_extraction(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger pattern extraction.

    This is normally done automatically by the scheduler,
    but can be triggered manually for testing or on-demand.
    """
    service = PatternService(db)
    patterns = await service.extract_patterns_for_user(current_user.id)

    return {
        "status": "completed",
        "patterns_extracted": len(patterns),
        "pattern_names": [p.name for p in patterns],
    }


@router.get("/types")
async def get_pattern_types():
    """Get available pattern types and valences."""
    return {
        "types": [t.value for t in PatternType],
        "valences": [v.value for v in PatternValence],
    }
