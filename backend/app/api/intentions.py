"""API endpoints for prospective memory (intentions).

Enables users to:
- View their active intentions/commitments
- Mark intentions as done or abandoned
- Snooze reminders
- See what they've committed to
"""
import logging
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_current_user
from app.models import User
from app.models.intention import Intention, IntentionStatus, IntentionType
from app.services.intention_service import IntentionService

logger = logging.getLogger(__name__)
router = APIRouter()


class IntentionResponse(BaseModel):
    """Intention response."""
    id: UUID
    description: str
    original_text: str | None
    intention_type: str
    status: str
    due_date: str | None
    days_until_due: int | None
    is_overdue: bool
    target_person: str | None
    target_action: str | None
    importance: float
    urgency: float
    priority_score: float
    reminder_count: int
    detected_at: str
    created_at: str

    class Config:
        from_attributes = True


class IntentionListResponse(BaseModel):
    """List of intentions."""
    intentions: list[IntentionResponse]
    total: int
    overdue_count: int
    due_today_count: int


class MarkFulfilledRequest(BaseModel):
    """Request to mark intention fulfilled."""
    notes: str | None = None


class MarkAbandonedRequest(BaseModel):
    """Request to mark intention abandoned."""
    notes: str | None = None


class SnoozeRequest(BaseModel):
    """Request to snooze intention."""
    hours: int = Field(24, ge=1, le=168)  # 1 hour to 1 week


def _intention_to_response(intention: Intention) -> IntentionResponse:
    """Convert Intention model to response."""
    return IntentionResponse(
        id=intention.id,
        description=intention.description,
        original_text=intention.original_text,
        intention_type=intention.intention_type.value if intention.intention_type else "task",
        status=intention.status.value if intention.status else "active",
        due_date=intention.due_date.isoformat() if intention.due_date else None,
        days_until_due=intention.days_until_due,
        is_overdue=intention.is_overdue,
        target_person=intention.target_person,
        target_action=intention.target_action,
        importance=intention.importance or 0.5,
        urgency=intention.urgency or 0.5,
        priority_score=intention.priority_score,
        reminder_count=intention.reminder_count or 0,
        detected_at=intention.detected_at.isoformat() if intention.detected_at else None,
        created_at=intention.created_at.isoformat() if intention.created_at else None,
    )


@router.get("", response_model=IntentionListResponse)
async def list_intentions(
    status: str | None = Query(None, pattern="^(active|due|overdue|fulfilled|abandoned)$"),
    include_fulfilled: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List user's intentions.

    By default shows active, due, and overdue intentions.
    """
    service = IntentionService(db)

    # Update statuses first
    await service.update_intention_statuses(current_user.id)

    if status:
        # Filter by specific status
        from sqlalchemy import select
        status_enum = IntentionStatus(status)
        result = await db.execute(
            select(Intention)
            .where(Intention.user_id == current_user.id)
            .where(Intention.status == status_enum)
            .order_by(Intention.due_date.asc().nullslast())
        )
        intentions = list(result.scalars().all())
    else:
        # Get active intentions
        intentions = await service.get_active_intentions(
            current_user.id,
            include_due=True,
            include_overdue=True,
        )

    overdue_count = sum(1 for i in intentions if i.is_overdue)
    due_today_count = sum(1 for i in intentions if i.days_until_due == 0)

    return IntentionListResponse(
        intentions=[_intention_to_response(i) for i in intentions],
        total=len(intentions),
        overdue_count=overdue_count,
        due_today_count=due_today_count,
    )


@router.get("/due", response_model=IntentionListResponse)
async def get_due_intentions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get intentions that are due today or overdue."""
    service = IntentionService(db)
    await service.update_intention_statuses(current_user.id)

    intentions = await service.get_due_intentions(current_user.id)

    overdue_count = sum(1 for i in intentions if i.is_overdue)
    due_today_count = sum(1 for i in intentions if i.days_until_due == 0)

    return IntentionListResponse(
        intentions=[_intention_to_response(i) for i in intentions],
        total=len(intentions),
        overdue_count=overdue_count,
        due_today_count=due_today_count,
    )


@router.get("/nudges")
async def get_nudges(
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get proactive nudges for unfulfilled intentions.

    These are the "You said you'd do X" messages.
    """
    service = IntentionService(db)
    await service.update_intention_statuses(current_user.id)

    unfulfilled = await service.get_unfulfilled_intentions(current_user.id)

    nudges = []
    for intention in unfulfilled[:limit]:
        nudges.append({
            "intention_id": str(intention.id),
            "message": await service.get_nudge_message(intention),
            "description": intention.description,
            "days_ago": (datetime.now().date() - intention.detected_at.date()).days if intention.detected_at else 0,
            "is_overdue": intention.is_overdue,
            "priority_score": intention.priority_score,
        })

    return {"nudges": nudges, "total": len(unfulfilled)}


@router.get("/{intention_id}", response_model=IntentionResponse)
async def get_intention(
    intention_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific intention."""
    from sqlalchemy import select

    result = await db.execute(
        select(Intention)
        .where(Intention.id == intention_id)
        .where(Intention.user_id == current_user.id)
    )
    intention = result.scalar_one_or_none()
    if not intention:
        raise HTTPException(404, "Intention not found")

    return _intention_to_response(intention)


@router.post("/{intention_id}/fulfill", response_model=IntentionResponse)
async def mark_fulfilled(
    intention_id: UUID,
    request: MarkFulfilledRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark an intention as fulfilled."""
    service = IntentionService(db)
    try:
        intention = await service.mark_fulfilled(
            intention_id,
            current_user.id,
            request.notes,
        )
        return _intention_to_response(intention)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{intention_id}/abandon", response_model=IntentionResponse)
async def mark_abandoned(
    intention_id: UUID,
    request: MarkAbandonedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark an intention as abandoned."""
    service = IntentionService(db)
    try:
        intention = await service.mark_abandoned(
            intention_id,
            current_user.id,
            request.notes,
        )
        return _intention_to_response(intention)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{intention_id}/snooze", response_model=IntentionResponse)
async def snooze_intention(
    intention_id: UUID,
    request: SnoozeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Snooze an intention's reminders."""
    service = IntentionService(db)
    try:
        intention = await service.snooze_intention(
            intention_id,
            current_user.id,
            request.hours,
        )
        return _intention_to_response(intention)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/scan")
async def scan_fulfillment(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Manually trigger fulfillment scan.

    Checks recent memories to see if any intentions were completed.
    """
    service = IntentionService(db)
    await service.scan_for_fulfillment(current_user.id)
    return {"status": "scan_complete"}
