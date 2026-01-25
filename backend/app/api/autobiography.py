"""API endpoints for autobiographical memory hierarchy.

Provides endpoints for:
- Managing life periods
- Managing general events
- Memory categorization
- Timeline views
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
from app.models import User
from app.models.autobiography import LifePeriod, GeneralEvent
from app.services.autobiography_service import AutobiographyService

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateLifePeriodRequest(BaseModel):
    """Request to create a life period."""
    name: str = Field(..., min_length=1, max_length=255)
    start_date: date
    end_date: Optional[date] = None
    description: Optional[str] = Field(None, max_length=2000)
    themes: Optional[list[str]] = Field(default_factory=list)
    identity_goals: Optional[list[str]] = Field(default_factory=list)
    key_people: Optional[list[str]] = Field(default_factory=list)
    key_locations: Optional[list[str]] = Field(default_factory=list)
    is_current: bool = False


class LifePeriodResponse(BaseModel):
    """Life period response."""
    id: UUID
    name: str
    description: Optional[str]
    start_date: date
    end_date: Optional[date]
    is_current: bool
    themes: list[str]
    identity_goals: list[str]
    key_people: list[str]
    key_locations: list[str]
    duration_years: float
    created_at: str

    class Config:
        from_attributes = True


class CreateGeneralEventRequest(BaseModel):
    """Request to create a general event."""
    name: str = Field(..., min_length=1, max_length=255)
    event_type: str = Field(..., pattern="^(repeated|extended|first_time)$")
    life_period_id: Optional[UUID] = None
    description: Optional[str] = Field(None, max_length=2000)
    frequency: Optional[str] = Field(None, pattern="^(daily|weekly|monthly|yearly)$")
    participants: Optional[list[str]] = Field(default_factory=list)
    location_pattern: Optional[str] = Field(None, max_length=255)
    first_occurrence: Optional[date] = None


class GeneralEventResponse(BaseModel):
    """General event response."""
    id: UUID
    name: str
    description: Optional[str]
    event_type: str
    frequency: Optional[str]
    participants: list[str]
    location_pattern: Optional[str]
    first_occurrence: Optional[date]
    last_occurrence: Optional[date]
    occurrence_count: int
    life_period_id: Optional[UUID]
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True


class MemoryInHierarchyResponse(BaseModel):
    """Memory within hierarchy response."""
    id: UUID
    content: str
    summary: Optional[str]
    memory_date: str
    strength: float
    life_period_id: Optional[UUID]
    general_event_id: Optional[UUID]


class AutobiographySummaryResponse(BaseModel):
    """Autobiography summary response."""
    life_period_count: int
    general_event_count: int
    categorized_memory_count: int
    total_memory_count: int
    categorization_rate: float
    current_period: Optional[dict]
    periods_timeline: list[dict]


def _period_to_response(period: LifePeriod) -> LifePeriodResponse:
    """Convert LifePeriod model to response."""
    return LifePeriodResponse(
        id=period.id,
        name=period.name,
        description=period.description,
        start_date=period.start_date,
        end_date=period.end_date,
        is_current=period.is_current,
        themes=period.themes or [],
        identity_goals=period.identity_goals or [],
        key_people=period.key_people or [],
        key_locations=period.key_locations or [],
        duration_years=round(period.duration_years, 1),
        created_at=period.created_at.isoformat(),
    )


def _event_to_response(event: GeneralEvent) -> GeneralEventResponse:
    """Convert GeneralEvent model to response."""
    return GeneralEventResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        event_type=event.event_type,
        frequency=event.frequency,
        participants=event.participants or [],
        location_pattern=event.location_pattern,
        first_occurrence=event.first_occurrence,
        last_occurrence=event.last_occurrence,
        occurrence_count=event.occurrence_count,
        life_period_id=event.life_period_id,
        is_active=event.is_active,
        created_at=event.created_at.isoformat(),
    )


@router.post("/life-periods", response_model=LifePeriodResponse, status_code=201)
async def create_life_period(
    request: CreateLifePeriodRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new life period.

    Life periods represent major chapters in life:
    - "College years"
    - "First job at TechCorp"
    - "Living in San Francisco"
    """
    if request.end_date and request.end_date < request.start_date:
        raise HTTPException(400, "end_date must be after start_date")

    service = AutobiographyService(db)
    period = await service.create_life_period(
        user_id=current_user.id,
        name=request.name,
        start_date=request.start_date,
        end_date=request.end_date,
        description=request.description,
        themes=request.themes,
        identity_goals=request.identity_goals,
        key_people=request.key_people,
        key_locations=request.key_locations,
        is_current=request.is_current,
    )
    return _period_to_response(period)


@router.get("/life-periods", response_model=list[LifePeriodResponse])
async def get_life_periods(
    include_past: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all life periods."""
    service = AutobiographyService(db)
    periods = await service.get_life_periods(
        user_id=current_user.id,
        include_past=include_past,
    )
    return [_period_to_response(p) for p in periods]


@router.get("/life-periods/current", response_model=LifePeriodResponse)
async def get_current_period(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current life period."""
    service = AutobiographyService(db)
    period = await service.get_current_life_period(current_user.id)
    if not period:
        raise HTTPException(404, "No current life period set")
    return _period_to_response(period)


@router.get("/life-periods/{period_id}", response_model=LifePeriodResponse)
async def get_life_period(
    period_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific life period."""
    from sqlalchemy import select

    result = await db.execute(
        select(LifePeriod)
        .where(LifePeriod.id == period_id)
        .where(LifePeriod.user_id == current_user.id)
    )
    period = result.scalar_one_or_none()
    if not period:
        raise HTTPException(404, "Life period not found")
    return _period_to_response(period)


@router.get("/life-periods/{period_id}/memories", response_model=list[MemoryInHierarchyResponse])
async def get_period_memories(
    period_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get memories belonging to a life period."""
    service = AutobiographyService(db)
    memories = await service.get_period_memories(
        user_id=current_user.id,
        period_id=period_id,
        limit=limit,
    )
    return [
        MemoryInHierarchyResponse(
            id=m.id,
            content=m.content[:500] if len(m.content) > 500 else m.content,
            summary=m.summary,
            memory_date=m.memory_date.isoformat(),
            strength=m.strength,
            life_period_id=m.life_period_id,
            general_event_id=m.general_event_id,
        )
        for m in memories
    ]


@router.post("/general-events", response_model=GeneralEventResponse, status_code=201)
async def create_general_event(
    request: CreateGeneralEventRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new general event.

    Event types:
    - repeated: Regular occurrences (weekly dinners, morning runs)
    - extended: Multi-day events (vacations, conferences)
    - first_time: Significant firsts (first day at work)
    """
    if request.event_type == "repeated" and not request.frequency:
        raise HTTPException(400, "frequency required for repeated events")

    service = AutobiographyService(db)
    event = await service.create_general_event(
        user_id=current_user.id,
        name=request.name,
        event_type=request.event_type,
        life_period_id=request.life_period_id,
        description=request.description,
        frequency=request.frequency,
        participants=request.participants,
        location_pattern=request.location_pattern,
        first_occurrence=request.first_occurrence,
    )
    return _event_to_response(event)


@router.get("/general-events", response_model=list[GeneralEventResponse])
async def get_general_events(
    life_period_id: Optional[UUID] = Query(None),
    event_type: Optional[str] = Query(None, pattern="^(repeated|extended|first_time)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get general events."""
    service = AutobiographyService(db)
    events = await service.get_general_events(
        user_id=current_user.id,
        life_period_id=life_period_id,
        event_type=event_type,
    )
    return [_event_to_response(e) for e in events]


@router.get("/general-events/{event_id}", response_model=GeneralEventResponse)
async def get_general_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific general event."""
    from sqlalchemy import select

    result = await db.execute(
        select(GeneralEvent)
        .where(GeneralEvent.id == event_id)
        .where(GeneralEvent.user_id == current_user.id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(404, "General event not found")
    return _event_to_response(event)


@router.get("/general-events/{event_id}/memories", response_model=list[MemoryInHierarchyResponse])
async def get_event_memories(
    event_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get memories belonging to a general event."""
    service = AutobiographyService(db)
    memories = await service.get_event_memories(
        user_id=current_user.id,
        event_id=event_id,
        limit=limit,
    )
    return [
        MemoryInHierarchyResponse(
            id=m.id,
            content=m.content[:500] if len(m.content) > 500 else m.content,
            summary=m.summary,
            memory_date=m.memory_date.isoformat(),
            strength=m.strength,
            life_period_id=m.life_period_id,
            general_event_id=m.general_event_id,
        )
        for m in memories
    ]


@router.post("/general-events/detect")
async def detect_general_events(
    days: int = Query(90, ge=30, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Detect recurring events from memory patterns.

    Analyzes memories from the past N days to identify
    recurring activities or events.
    """
    service = AutobiographyService(db)
    events = await service.detect_general_events(
        user_id=current_user.id,
        days=days,
    )
    return {
        "detected": len(events),
        "events": [_event_to_response(e) for e in events],
    }


@router.get("/summary", response_model=AutobiographySummaryResponse)
async def get_autobiography_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get summary of autobiographical structure."""
    service = AutobiographyService(db)
    summary = await service.get_autobiography_summary(current_user.id)
    return AutobiographySummaryResponse(**summary)


@router.post("/memories/{memory_id}/categorize")
async def categorize_memory(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Automatically categorize a memory into the hierarchy.

    Assigns the memory to the appropriate life period and
    potentially links it to a general event.
    """
    from sqlalchemy import select
    from app.models import Memory

    result = await db.execute(
        select(Memory)
        .where(Memory.id == memory_id)
        .where(Memory.user_id == current_user.id)
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(404, "Memory not found")

    service = AutobiographyService(db)
    period, event = await service.assign_memory_to_hierarchy(memory)

    return {
        "memory_id": str(memory_id),
        "life_period": {
            "id": str(period.id),
            "name": period.name,
        } if period else None,
        "general_event": {
            "id": str(event.id),
            "name": event.name,
        } if event else None,
    }
