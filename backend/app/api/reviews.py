"""API endpoints for FSRS-6 spaced repetition reviews.

Provides endpoints for:
- Submitting memory reviews (1-4 rating)
- Getting due memories for review
- Getting scheduling preview for different ratings
- Review statistics
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
from app.models import User, Memory
from app.services.fsrs_service import FSRSService, Rating

logger = logging.getLogger(__name__)
router = APIRouter()


class ReviewRequest(BaseModel):
    """Request to submit a memory review."""
    rating: int = Field(..., ge=1, le=4, description="1=Again, 2=Hard, 3=Good, 4=Easy")
    review_duration_ms: Optional[int] = Field(None, ge=0, description="Time spent reviewing in ms")


class ReviewResponse(BaseModel):
    """Response after submitting a review."""
    memory_id: UUID
    rating: int
    state_before: str
    state_after: str
    stability_before: float
    stability_after: float
    difficulty_before: float
    difficulty_after: float
    scheduled_days: float
    next_review_date: date
    retrievability: float

    class Config:
        from_attributes = True


class SchedulingOption(BaseModel):
    """Scheduling information for a single rating option."""
    rating: int
    rating_name: str
    stability: float
    difficulty: float
    interval_days: float
    interval_display: str
    state: str


class SchedulingPreviewResponse(BaseModel):
    """Preview of scheduling options for all ratings."""
    memory_id: UUID
    current_state: str
    current_retrievability: float
    options: list[SchedulingOption]


class MemoryForReviewResponse(BaseModel):
    """Memory ready for review."""
    id: UUID
    content: str
    summary: Optional[str]
    memory_date: str
    strength: float
    emotional_weight: float
    fsrs_state: str
    fsrs_stability: float
    fsrs_difficulty: float
    fsrs_reps: int
    fsrs_lapses: int
    retrievability: float
    interval_days: int

    class Config:
        from_attributes = True


class ReviewStatsResponse(BaseModel):
    """Review statistics."""
    total_reviews: int
    avg_rating: Optional[float]
    again_count: int
    easy_count: int
    due_count: int
    new_count: int
    retention_rate: Optional[float]


class ReviewQueueResponse(BaseModel):
    """Complete review queue with categorized memories."""
    due: list[MemoryForReviewResponse]
    learning: list[MemoryForReviewResponse]
    new: list[MemoryForReviewResponse]
    total_due: int
    total_learning: int
    total_new: int


def _format_interval(days: float) -> str:
    """Format interval for display."""
    if days < 0.0035:  # Less than 5 minutes
        return "1m"
    if days < 0.042:  # Less than 1 hour
        minutes = round(days * 1440)
        return f"{minutes}m"
    if days < 1:
        hours = round(days * 24)
        return f"{hours}h"
    if days < 30:
        return f"{round(days)}d"
    if days < 365:
        months = round(days / 30)
        return f"{months}mo"
    years = round(days / 365, 1)
    return f"{years}y"


def _memory_to_response(memory: Memory) -> MemoryForReviewResponse:
    """Convert Memory model to response."""
    return MemoryForReviewResponse(
        id=memory.id,
        content=memory.content[:500] if len(memory.content) > 500 else memory.content,
        summary=memory.summary,
        memory_date=memory.memory_date.isoformat(),
        strength=memory.strength,
        emotional_weight=memory.emotional_weight,
        fsrs_state=memory.fsrs_state,
        fsrs_stability=memory.fsrs_stability,
        fsrs_difficulty=memory.fsrs_difficulty,
        fsrs_reps=memory.fsrs_reps,
        fsrs_lapses=memory.fsrs_lapses,
        retrievability=memory.fsrs_retrievability,
        interval_days=memory.interval_days,
    )


@router.post("/memories/{memory_id}/review", response_model=ReviewResponse)
async def submit_review(
    memory_id: UUID,
    request: ReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a spaced repetition review for a memory.

    Rating scale (FSRS):
    - 1 (Again): Complete blackout, couldn't recall
    - 2 (Hard): Recalled with significant difficulty
    - 3 (Good): Recalled correctly with some effort
    - 4 (Easy): Perfect recall, felt effortless
    """
    service = FSRSService(db)
    try:
        result = await service.review_memory(
            memory_id=memory_id,
            user_id=current_user.id,
            rating=request.rating,
            review_duration_ms=request.review_duration_ms,
        )
        return ReviewResponse(
            memory_id=result.memory_id,
            rating=result.rating,
            state_before=result.state_before,
            state_after=result.state_after,
            stability_before=result.stability_before,
            stability_after=result.stability_after,
            difficulty_before=result.difficulty_before,
            difficulty_after=result.difficulty_after,
            scheduled_days=result.scheduled_days,
            next_review_date=result.next_review_date,
            retrievability=result.retrievability,
        )
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/memories/{memory_id}/scheduling-preview", response_model=SchedulingPreviewResponse)
async def get_scheduling_preview(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get preview of scheduling options for all four ratings.

    Shows what the interval and next state would be for each rating choice.
    Useful for showing the user what will happen before they commit.
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

    service = FSRSService(db)
    scheduling = await service.get_scheduling_cards(memory, current_user.id)

    rating_names = ["Again", "Hard", "Good", "Easy"]
    options = []
    for i, (name, schedule) in enumerate(zip(
        rating_names,
        [scheduling.again, scheduling.hard, scheduling.good, scheduling.easy]
    )):
        options.append(SchedulingOption(
            rating=i + 1,
            rating_name=name,
            stability=schedule["stability"],
            difficulty=schedule["difficulty"],
            interval_days=schedule["interval_days"],
            interval_display=_format_interval(schedule["interval_days"]),
            state=schedule["state"],
        ))

    return SchedulingPreviewResponse(
        memory_id=memory.id,
        current_state=memory.fsrs_state,
        current_retrievability=memory.fsrs_retrievability,
        options=options,
    )


@router.get("/reviews/queue", response_model=ReviewQueueResponse)
async def get_review_queue(
    due_limit: int = Query(20, ge=1, le=100),
    new_limit: int = Query(10, ge=0, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the complete review queue with due, learning, and new memories.

    Returns memories categorized by their FSRS state:
    - Due: Memories past their scheduled review date
    - Learning: Memories in learning/relearning state (need same-day review)
    - New: Memories that haven't been reviewed yet
    """
    service = FSRSService(db)

    due_memories = await service.get_due_memories(current_user.id, limit=due_limit)
    learning_memories = await service.get_learning_memories(current_user.id)
    new_memories = await service.get_new_memories(current_user.id, limit=new_limit)

    return ReviewQueueResponse(
        due=[_memory_to_response(m) for m in due_memories],
        learning=[_memory_to_response(m) for m in learning_memories],
        new=[_memory_to_response(m) for m in new_memories],
        total_due=len(due_memories),
        total_learning=len(learning_memories),
        total_new=len(new_memories),
    )


@router.get("/reviews/due", response_model=list[MemoryForReviewResponse])
async def get_due_memories(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get memories that are due for review today.

    Returns memories sorted by due date (oldest first).
    """
    service = FSRSService(db)
    memories = await service.get_due_memories(current_user.id, limit=limit)
    return [_memory_to_response(m) for m in memories]


@router.get("/reviews/stats", response_model=ReviewStatsResponse)
async def get_review_statistics(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get review statistics for the specified time period.

    Returns:
    - Total reviews completed
    - Average rating
    - Retention rate (% not marked as Again)
    - Counts by rating
    - Current queue counts
    """
    service = FSRSService(db)
    stats = await service.get_review_statistics(current_user.id, days=days)
    return ReviewStatsResponse(**stats)


@router.post("/reviews/initialize")
async def initialize_memories_for_review(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initialize memories for spaced repetition review.

    Selects memories based on strength and emotional weight,
    and sets up initial FSRS parameters.
    """
    service = FSRSService(db)
    count = await service.batch_initialize_for_review(current_user.id, limit=limit)
    return {"initialized": count}


@router.post("/memories/{memory_id}/initialize-review")
async def initialize_single_memory(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initialize a single memory for spaced repetition review.
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

    service = FSRSService(db)
    updated = await service.initialize_memory_for_review(memory, current_user.id)

    return {
        "memory_id": str(updated.id),
        "fsrs_state": updated.fsrs_state,
        "next_review_date": updated.next_review_date.isoformat() if updated.next_review_date else None,
    }


@router.get("/reviews/history")
async def get_review_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get review history for the user.

    Returns recent reviews with before/after states for analysis.
    """
    from sqlalchemy import select
    from app.models.fsrs import ReviewLog

    result = await db.execute(
        select(ReviewLog)
        .where(ReviewLog.user_id == current_user.id)
        .order_by(ReviewLog.review_time.desc())
        .offset(offset)
        .limit(limit)
    )
    logs = result.scalars().all()

    return {
        "reviews": [
            {
                "id": str(log.id),
                "memory_id": str(log.memory_id),
                "rating": log.rating,
                "state": log.state,
                "stability_before": log.stability_before,
                "stability_after": log.stability_after,
                "difficulty_before": log.difficulty_before,
                "difficulty_after": log.difficulty_after,
                "retrievability": log.retrievability,
                "elapsed_days": log.elapsed_days,
                "review_time": log.review_time.isoformat(),
                "review_duration_ms": log.review_duration_ms,
            }
            for log in logs
        ],
        "count": len(logs),
    }
