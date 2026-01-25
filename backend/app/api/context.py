"""API endpoints for memory context capture and retrieval.

Context-dependent memory based on encoding specificity principle.
"""
import logging
from uuid import UUID
from typing import Optional
from datetime import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user
from app.models import User
from app.models.context import MemoryContext
from app.services.context_service import ContextService, CapturedContext

logger = logging.getLogger(__name__)
router = APIRouter()


class ContextCaptureRequest(BaseModel):
    """Request to capture context for a memory."""
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    location_name: Optional[str] = Field(None, max_length=255)
    location_type: Optional[str] = Field(None, max_length=50)
    local_time: Optional[str] = Field(None, description="HH:MM format")
    time_of_day: Optional[str] = Field(None, pattern="^(morning|afternoon|evening|night)$")
    day_of_week: Optional[str] = Field(None, max_length=10)
    is_weekend: Optional[bool] = None
    weather: Optional[str] = Field(None, max_length=50)
    temperature: Optional[float] = Field(None, ge=-100, le=60)
    activity: Optional[str] = Field(None, max_length=100)
    activity_category: Optional[str] = Field(None, max_length=50)
    people_present: Optional[list[str]] = Field(default_factory=list)
    social_setting: Optional[str] = Field(None, pattern="^(alone|one_on_one|small_group|large_group|colleagues|family|friends)$")
    device_type: Optional[str] = Field(None, max_length=50)
    app_source: Optional[str] = Field(None, max_length=50)


class ContextResponse(BaseModel):
    """Context response."""
    id: UUID
    memory_id: UUID
    latitude: Optional[float]
    longitude: Optional[float]
    location_name: Optional[str]
    location_type: Optional[str]
    local_time: Optional[str]
    time_of_day: Optional[str]
    day_of_week: Optional[str]
    is_weekend: Optional[bool]
    weather: Optional[str]
    temperature: Optional[float]
    activity: Optional[str]
    activity_category: Optional[str]
    people_present: list[str]
    social_setting: Optional[str]
    device_type: Optional[str]
    app_source: Optional[str]

    class Config:
        from_attributes = True


class ContextMatchResponse(BaseModel):
    """Memory with context match score."""
    memory_id: UUID
    content: str
    summary: Optional[str]
    memory_date: str
    match_score: float
    context: Optional[ContextResponse]


class ContextSummaryResponse(BaseModel):
    """Summary of context patterns."""
    time_of_day_distribution: dict[str, int]
    day_of_week_distribution: dict[str, int]
    location_type_distribution: dict[str, int]
    activity_category_distribution: dict[str, int]
    total_contextualized_memories: int


def _context_to_response(ctx: MemoryContext) -> ContextResponse:
    """Convert MemoryContext model to response."""
    return ContextResponse(
        id=ctx.id,
        memory_id=ctx.memory_id,
        latitude=ctx.latitude,
        longitude=ctx.longitude,
        location_name=ctx.location_name,
        location_type=ctx.location_type,
        local_time=ctx.local_time.strftime("%H:%M") if ctx.local_time else None,
        time_of_day=ctx.time_of_day,
        day_of_week=ctx.day_of_week,
        is_weekend=ctx.is_weekend,
        weather=ctx.weather,
        temperature=ctx.temperature,
        activity=ctx.activity,
        activity_category=ctx.activity_category,
        people_present=ctx.people_present or [],
        social_setting=ctx.social_setting,
        device_type=ctx.device_type,
        app_source=ctx.app_source,
    )


@router.post("/memories/{memory_id}/context", response_model=ContextResponse)
async def capture_memory_context(
    memory_id: UUID,
    request: ContextCaptureRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Capture rich context for a memory.

    Context includes location, time, activity, social setting, and device info.
    This enables context-dependent retrieval (encoding specificity principle).
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

    local_time_obj = None
    if request.local_time:
        try:
            parts = request.local_time.split(":")
            local_time_obj = time(int(parts[0]), int(parts[1]))
        except (ValueError, IndexError):
            raise HTTPException(400, "Invalid local_time format. Use HH:MM")

    context_data = CapturedContext(
        latitude=request.latitude,
        longitude=request.longitude,
        location_name=request.location_name,
        location_type=request.location_type,
        local_time=local_time_obj,
        time_of_day=request.time_of_day,
        day_of_week=request.day_of_week,
        is_weekend=request.is_weekend,
        weather=request.weather,
        temperature=request.temperature,
        activity=request.activity,
        activity_category=request.activity_category,
        people_present=request.people_present,
        social_setting=request.social_setting,
        device_type=request.device_type,
        app_source=request.app_source,
    )

    service = ContextService(db)
    context_data = await service.enrich_context_from_location(context_data)
    context = await service.capture_context(memory_id, context_data)

    return _context_to_response(context)


@router.get("/memories/{memory_id}/context", response_model=ContextResponse)
async def get_memory_context(
    memory_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get context for a specific memory."""
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

    service = ContextService(db)
    context = await service.get_context(memory_id)
    if not context:
        raise HTTPException(404, "No context found for this memory")

    return _context_to_response(context)


@router.post("/context/find-matching-memories", response_model=list[ContextMatchResponse])
async def find_memories_by_context(
    request: ContextCaptureRequest,
    limit: int = Query(20, ge=1, le=100),
    min_score: float = Query(0.3, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Find memories that match the given context.

    Uses context reinstatement principle - memories encoded in similar
    contexts are more easily retrieved when the retrieval context matches.
    """
    local_time_obj = None
    if request.local_time:
        try:
            parts = request.local_time.split(":")
            local_time_obj = time(int(parts[0]), int(parts[1]))
        except (ValueError, IndexError):
            pass

    context_data = CapturedContext(
        latitude=request.latitude,
        longitude=request.longitude,
        location_name=request.location_name,
        location_type=request.location_type,
        local_time=local_time_obj,
        time_of_day=request.time_of_day,
        day_of_week=request.day_of_week,
        is_weekend=request.is_weekend,
        weather=request.weather,
        temperature=request.temperature,
        activity=request.activity,
        activity_category=request.activity_category,
        people_present=request.people_present,
        social_setting=request.social_setting,
        device_type=request.device_type,
        app_source=request.app_source,
    )

    service = ContextService(db)
    matches = await service.find_memories_by_context(
        user_id=current_user.id,
        context=context_data,
        limit=limit,
        min_match_score=min_score,
    )

    return [
        ContextMatchResponse(
            memory_id=memory.id,
            content=memory.content[:500] if len(memory.content) > 500 else memory.content,
            summary=memory.summary,
            memory_date=memory.memory_date.isoformat(),
            match_score=score,
            context=_context_to_response(memory.context) if memory.context else None,
        )
        for memory, score in matches
    ]


@router.get("/context/summary", response_model=ContextSummaryResponse)
async def get_context_summary(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get summary of context patterns for the user.

    Shows distribution of memories by time of day, day of week,
    location type, and activity category.
    """
    service = ContextService(db)
    summary = await service.get_context_summary(current_user.id, days=days)
    return ContextSummaryResponse(**summary)


@router.get("/context/weather")
async def get_current_weather(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current weather for a location."""
    service = ContextService(db)
    weather = await service.get_weather(latitude, longitude)
    if not weather:
        raise HTTPException(503, "Weather service unavailable")
    return weather
