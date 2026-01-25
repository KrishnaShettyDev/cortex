"""API endpoints for reminders and tasks."""

from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

from app.api.deps import Database, CurrentUser
from app.services.reminder_service import ReminderService
from app.models.reminder import ReminderStatus, ReminderType

router = APIRouter()


# ==================== REQUEST/RESPONSE MODELS ====================


class CreateReminderRequest(BaseModel):
    """Request to create a new reminder."""
    title: str
    body: str | None = None
    remind_at: datetime | None = None
    reminder_type: str = "time"
    location_name: str | None = None
    location_latitude: float | None = None
    location_longitude: float | None = None
    location_radius_meters: int = 200


class UpdateReminderRequest(BaseModel):
    """Request to update a reminder."""
    title: str | None = None
    body: str | None = None
    remind_at: datetime | None = None
    status: str | None = None


class ReminderResponse(BaseModel):
    """Response for a single reminder."""
    id: str
    title: str
    body: str | None
    remind_at: datetime | None
    reminder_type: str
    location_name: str | None
    status: str
    created_at: datetime


class ReminderListResponse(BaseModel):
    """Response for listing reminders."""
    reminders: list[ReminderResponse]
    total: int


class CreateTaskRequest(BaseModel):
    """Request to create a new task."""
    title: str
    description: str | None = None
    due_date: datetime | None = None
    priority: int = 3
    related_person: str | None = None


class TaskResponse(BaseModel):
    """Response for a single task."""
    id: str
    title: str
    description: str | None
    due_date: datetime | None
    priority: int
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime


class TaskListResponse(BaseModel):
    """Response for listing tasks."""
    tasks: list[TaskResponse]
    total: int


class SuccessResponse(BaseModel):
    """Generic success response."""
    success: bool
    message: str | None = None


# ==================== REMINDER ENDPOINTS ====================


@router.post("", response_model=ReminderResponse, status_code=status.HTTP_201_CREATED)
async def create_reminder(
    request: CreateReminderRequest,
    current_user: CurrentUser,
    db: Database,
):
    """Create a new reminder."""
    service = ReminderService(db)

    reminder = await service.create_reminder(
        user_id=current_user.id,
        title=request.title,
        body=request.body,
        remind_at=request.remind_at,
        reminder_type=request.reminder_type,
        location_name=request.location_name,
        location_latitude=request.location_latitude,
        location_longitude=request.location_longitude,
        location_radius_meters=request.location_radius_meters,
    )

    return ReminderResponse(
        id=str(reminder.id),
        title=reminder.title,
        body=reminder.body,
        remind_at=reminder.remind_at,
        reminder_type=reminder.reminder_type,
        location_name=reminder.location_name,
        status=reminder.status,
        created_at=reminder.created_at,
    )


@router.get("", response_model=ReminderListResponse)
async def list_reminders(
    current_user: CurrentUser,
    db: Database,
    include_completed: bool = Query(False, description="Include completed reminders"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List all reminders for the current user with pagination."""
    service = ReminderService(db)

    reminders, total = await service.list_reminders(
        user_id=current_user.id,
        include_completed=include_completed,
        limit=limit,
        offset=offset,
    )

    return ReminderListResponse(
        reminders=[
            ReminderResponse(
                id=str(r.id),
                title=r.title,
                body=r.body,
                remind_at=r.remind_at,
                reminder_type=r.reminder_type,
                location_name=r.location_name,
                status=r.status,
                created_at=r.created_at,
            )
            for r in reminders
        ],
        total=total,
    )


# ==================== TASK ENDPOINTS (must be before /{reminder_id}) ====================


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    request: CreateTaskRequest,
    current_user: CurrentUser,
    db: Database,
):
    """Create a new task."""
    service = ReminderService(db)

    task = await service.create_task(
        user_id=current_user.id,
        title=request.title,
        description=request.description,
        due_date=request.due_date,
        priority=request.priority,
        related_person=request.related_person,
    )

    return TaskResponse(
        id=str(task.id),
        title=task.title,
        description=task.description,
        due_date=task.due_date,
        priority=task.priority,
        is_completed=task.is_completed,
        completed_at=task.completed_at,
        created_at=task.created_at,
    )


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    current_user: CurrentUser,
    db: Database,
    include_completed: bool = Query(False, description="Include completed tasks"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List all tasks for the current user with pagination."""
    service = ReminderService(db)

    tasks, total = await service.list_tasks(
        user_id=current_user.id,
        include_completed=include_completed,
        limit=limit,
        offset=offset,
    )

    return TaskListResponse(
        tasks=[
            TaskResponse(
                id=str(t.id),
                title=t.title,
                description=t.description,
                due_date=t.due_date,
                priority=t.priority,
                is_completed=t.is_completed,
                completed_at=t.completed_at,
                created_at=t.created_at,
            )
            for t in tasks
        ],
        total=total,
    )


@router.post("/tasks/{task_id}/complete", response_model=SuccessResponse)
async def complete_task(
    task_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """Mark a task as completed."""
    service = ReminderService(db)

    task = await service.complete_task(task_id, current_user.id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    return SuccessResponse(success=True, message="Task completed")


# ==================== LOCATION CHECK ENDPOINT (must be before /{reminder_id}) ====================


@router.post("/check-location", response_model=ReminderListResponse)
async def check_location_reminders(
    current_user: CurrentUser,
    db: Database,
    latitude: float = Query(..., description="Current latitude"),
    longitude: float = Query(..., description="Current longitude"),
):
    """
    Check if any location-based reminders should be triggered.
    Call this when user's location updates significantly.
    """
    service = ReminderService(db)

    triggered = await service.check_location_reminders(
        user_id=current_user.id,
        latitude=latitude,
        longitude=longitude,
    )

    # Send notifications for triggered reminders
    for reminder in triggered:
        await service.send_reminder_notification(reminder)

    return ReminderListResponse(
        reminders=[
            ReminderResponse(
                id=str(r.id),
                title=r.title,
                body=r.body,
                remind_at=r.remind_at,
                reminder_type=r.reminder_type,
                location_name=r.location_name,
                status=r.status,
                created_at=r.created_at,
            )
            for r in triggered
        ],
        total=len(triggered),
    )


# ==================== DYNAMIC REMINDER ROUTES (must be after static routes) ====================


@router.get("/{reminder_id}", response_model=ReminderResponse)
async def get_reminder(
    reminder_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """Get a specific reminder by ID."""
    service = ReminderService(db)

    reminder = await service.get_reminder(reminder_id, current_user.id)
    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )

    return ReminderResponse(
        id=str(reminder.id),
        title=reminder.title,
        body=reminder.body,
        remind_at=reminder.remind_at,
        reminder_type=reminder.reminder_type,
        location_name=reminder.location_name,
        status=reminder.status,
        created_at=reminder.created_at,
    )


@router.patch("/{reminder_id}", response_model=ReminderResponse)
async def update_reminder(
    reminder_id: UUID,
    request: UpdateReminderRequest,
    current_user: CurrentUser,
    db: Database,
):
    """Update a reminder."""
    service = ReminderService(db)

    reminder = await service.update_reminder(
        reminder_id=reminder_id,
        user_id=current_user.id,
        title=request.title,
        body=request.body,
        remind_at=request.remind_at,
        status=request.status,
    )

    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )

    return ReminderResponse(
        id=str(reminder.id),
        title=reminder.title,
        body=reminder.body,
        remind_at=reminder.remind_at,
        reminder_type=reminder.reminder_type,
        location_name=reminder.location_name,
        status=reminder.status,
        created_at=reminder.created_at,
    )


@router.post("/{reminder_id}/complete", response_model=SuccessResponse)
async def complete_reminder(
    reminder_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """Mark a reminder as completed."""
    service = ReminderService(db)

    reminder = await service.complete_reminder(reminder_id, current_user.id)
    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )

    return SuccessResponse(success=True, message="Reminder completed")


@router.post("/{reminder_id}/snooze", response_model=ReminderResponse)
async def snooze_reminder(
    reminder_id: UUID,
    current_user: CurrentUser,
    db: Database,
    minutes: int = Query(15, description="Minutes to snooze"),
):
    """Snooze a reminder."""
    service = ReminderService(db)

    from datetime import timedelta
    snooze_until = datetime.utcnow() + timedelta(minutes=minutes)

    reminder = await service.snooze_reminder(reminder_id, current_user.id, snooze_until)
    if not reminder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )

    return ReminderResponse(
        id=str(reminder.id),
        title=reminder.title,
        body=reminder.body,
        remind_at=reminder.remind_at,
        reminder_type=reminder.reminder_type,
        location_name=reminder.location_name,
        status=reminder.status,
        created_at=reminder.created_at,
    )


@router.delete("/{reminder_id}", response_model=SuccessResponse)
async def delete_reminder(
    reminder_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """Delete a reminder."""
    service = ReminderService(db)

    deleted = await service.delete_reminder(reminder_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reminder not found",
        )

    return SuccessResponse(success=True, message="Reminder deleted")
