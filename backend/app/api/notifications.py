"""API endpoints for push notification management and preferences."""

from datetime import datetime, time as dt_time
from typing import Optional
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import Database, CurrentUser
from app.services.push_service import PushService
from app.services.proactive_orchestrator import ProactiveOrchestrator

router = APIRouter()


class RegisterTokenRequest(BaseModel):
    """Request to register a push notification token."""

    push_token: str
    platform: str  # 'ios' or 'android'
    device_name: str | None = None


class UnregisterTokenRequest(BaseModel):
    """Request to unregister a push notification token."""

    push_token: str


class TokenResponse(BaseModel):
    """Response after token registration."""

    success: bool
    message: str | None = None


@router.post("/register", response_model=TokenResponse)
async def register_push_token(
    request: RegisterTokenRequest,
    current_user: CurrentUser,
    db: Database,
) -> TokenResponse:
    """
    Register a push notification token for the current user.

    This endpoint should be called when:
    - User logs in on a new device
    - Push token is refreshed by the OS
    """
    push_service = PushService(db)

    await push_service.register_token(
        user_id=current_user.id,
        push_token=request.push_token,
        platform=request.platform,
        device_name=request.device_name,
    )

    return TokenResponse(success=True, message="Token registered successfully")


@router.post("/unregister", response_model=TokenResponse)
async def unregister_push_token(
    request: UnregisterTokenRequest,
    current_user: CurrentUser,
    db: Database,
) -> TokenResponse:
    """
    Unregister a push notification token.

    This endpoint should be called when:
    - User logs out
    - User disables notifications
    """
    push_service = PushService(db)

    success = await push_service.unregister_token(request.push_token)

    if success:
        return TokenResponse(success=True, message="Token unregistered successfully")
    else:
        return TokenResponse(success=False, message="Token not found")


@router.get("/status")
async def get_notification_status(
    current_user: CurrentUser,
    db: Database,
) -> dict:
    """
    Get the current user's notification status.

    Returns the number of registered devices.
    """
    push_service = PushService(db)

    tokens = await push_service.get_user_tokens(current_user.id)

    return {
        "enabled": len(tokens) > 0,
        "device_count": len(tokens),
        "devices": [
            {
                "platform": t.platform,
                "device_name": t.device_name,
                "registered_at": t.created_at.isoformat(),
            }
            for t in tokens
        ],
    }


# ==================== NOTIFICATION PREFERENCES ====================


class NotificationPreferencesRequest(BaseModel):
    """Request to update notification preferences."""

    # Feature toggles
    enable_morning_briefing: Optional[bool] = None
    enable_evening_briefing: Optional[bool] = None
    enable_meeting_prep: Optional[bool] = None
    enable_email_alerts: Optional[bool] = None
    enable_commitment_reminders: Optional[bool] = None
    enable_pattern_warnings: Optional[bool] = None
    enable_reconnection_nudges: Optional[bool] = None
    enable_memory_insights: Optional[bool] = None
    enable_important_dates: Optional[bool] = None

    # Budget
    max_notifications_per_day: Optional[int] = Field(None, ge=1, le=30)
    max_urgent_per_day: Optional[int] = Field(None, ge=1, le=10)

    # Quiet hours
    quiet_hours_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None  # HH:MM format
    quiet_hours_end: Optional[str] = None  # HH:MM format

    # Timing
    morning_briefing_time: Optional[str] = None  # HH:MM format
    evening_briefing_time: Optional[str] = None  # HH:MM format
    meeting_prep_minutes_before: Optional[int] = Field(None, ge=5, le=120)
    timezone: Optional[str] = None


class NotificationPreferencesResponse(BaseModel):
    """Response with notification preferences."""

    # Feature toggles
    enable_morning_briefing: bool
    enable_evening_briefing: bool
    enable_meeting_prep: bool
    enable_email_alerts: bool
    enable_commitment_reminders: bool
    enable_pattern_warnings: bool
    enable_reconnection_nudges: bool
    enable_memory_insights: bool
    enable_important_dates: bool

    # Budget
    max_notifications_per_day: int
    max_urgent_per_day: int

    # Quiet hours
    quiet_hours_enabled: bool
    quiet_hours_start: Optional[str]  # HH:MM format
    quiet_hours_end: Optional[str]  # HH:MM format

    # Timing
    morning_briefing_time: str  # HH:MM format
    evening_briefing_time: str  # HH:MM format
    meeting_prep_minutes_before: int
    timezone: str


def time_to_string(t: Optional[dt_time]) -> Optional[str]:
    """Convert time object to HH:MM string."""
    if t is None:
        return None
    return t.strftime("%H:%M")


def string_to_time(s: str) -> dt_time:
    """Convert HH:MM string to time object."""
    parts = s.split(":")
    return dt_time(int(parts[0]), int(parts[1]))


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_notification_preferences(
    current_user: CurrentUser,
    db: Database,
) -> NotificationPreferencesResponse:
    """
    Get the current user's notification preferences.

    Returns all preference settings including feature toggles,
    daily budget, quiet hours, and timing preferences.
    """
    orchestrator = ProactiveOrchestrator(db)
    prefs = await orchestrator.get_user_preferences(current_user.id)

    return NotificationPreferencesResponse(
        enable_morning_briefing=prefs.enable_morning_briefing,
        enable_evening_briefing=prefs.enable_evening_briefing,
        enable_meeting_prep=prefs.enable_meeting_prep,
        enable_email_alerts=prefs.enable_email_alerts,
        enable_commitment_reminders=prefs.enable_commitment_reminders,
        enable_pattern_warnings=prefs.enable_pattern_warnings,
        enable_reconnection_nudges=prefs.enable_reconnection_nudges,
        enable_memory_insights=prefs.enable_memory_insights,
        enable_important_dates=prefs.enable_important_dates,
        max_notifications_per_day=prefs.max_notifications_per_day,
        max_urgent_per_day=prefs.max_urgent_per_day,
        quiet_hours_enabled=prefs.quiet_hours_enabled,
        quiet_hours_start=time_to_string(prefs.quiet_hours_start),
        quiet_hours_end=time_to_string(prefs.quiet_hours_end),
        morning_briefing_time=time_to_string(prefs.morning_briefing_time) or "08:00",
        evening_briefing_time=time_to_string(prefs.evening_briefing_time) or "18:00",
        meeting_prep_minutes_before=prefs.meeting_prep_minutes_before,
        timezone=prefs.timezone,
    )


@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_notification_preferences(
    request: NotificationPreferencesRequest,
    current_user: CurrentUser,
    db: Database,
) -> NotificationPreferencesResponse:
    """
    Update the current user's notification preferences.

    Only fields that are provided will be updated.
    """
    orchestrator = ProactiveOrchestrator(db)
    prefs = await orchestrator.get_user_preferences(current_user.id)

    # Update fields that are provided
    if request.enable_morning_briefing is not None:
        prefs.enable_morning_briefing = request.enable_morning_briefing
    if request.enable_evening_briefing is not None:
        prefs.enable_evening_briefing = request.enable_evening_briefing
    if request.enable_meeting_prep is not None:
        prefs.enable_meeting_prep = request.enable_meeting_prep
    if request.enable_email_alerts is not None:
        prefs.enable_email_alerts = request.enable_email_alerts
    if request.enable_commitment_reminders is not None:
        prefs.enable_commitment_reminders = request.enable_commitment_reminders
    if request.enable_pattern_warnings is not None:
        prefs.enable_pattern_warnings = request.enable_pattern_warnings
    if request.enable_reconnection_nudges is not None:
        prefs.enable_reconnection_nudges = request.enable_reconnection_nudges
    if request.enable_memory_insights is not None:
        prefs.enable_memory_insights = request.enable_memory_insights
    if request.enable_important_dates is not None:
        prefs.enable_important_dates = request.enable_important_dates

    if request.max_notifications_per_day is not None:
        prefs.max_notifications_per_day = request.max_notifications_per_day
    if request.max_urgent_per_day is not None:
        prefs.max_urgent_per_day = request.max_urgent_per_day

    if request.quiet_hours_enabled is not None:
        prefs.quiet_hours_enabled = request.quiet_hours_enabled
    if request.quiet_hours_start is not None:
        prefs.quiet_hours_start = string_to_time(request.quiet_hours_start)
    if request.quiet_hours_end is not None:
        prefs.quiet_hours_end = string_to_time(request.quiet_hours_end)

    if request.morning_briefing_time is not None:
        prefs.morning_briefing_time = string_to_time(request.morning_briefing_time)
    if request.evening_briefing_time is not None:
        prefs.evening_briefing_time = string_to_time(request.evening_briefing_time)
    if request.meeting_prep_minutes_before is not None:
        prefs.meeting_prep_minutes_before = request.meeting_prep_minutes_before
    if request.timezone is not None:
        prefs.timezone = request.timezone

    prefs.updated_at = datetime.utcnow()
    await db.commit()

    return NotificationPreferencesResponse(
        enable_morning_briefing=prefs.enable_morning_briefing,
        enable_evening_briefing=prefs.enable_evening_briefing,
        enable_meeting_prep=prefs.enable_meeting_prep,
        enable_email_alerts=prefs.enable_email_alerts,
        enable_commitment_reminders=prefs.enable_commitment_reminders,
        enable_pattern_warnings=prefs.enable_pattern_warnings,
        enable_reconnection_nudges=prefs.enable_reconnection_nudges,
        enable_memory_insights=prefs.enable_memory_insights,
        enable_important_dates=prefs.enable_important_dates,
        max_notifications_per_day=prefs.max_notifications_per_day,
        max_urgent_per_day=prefs.max_urgent_per_day,
        quiet_hours_enabled=prefs.quiet_hours_enabled,
        quiet_hours_start=time_to_string(prefs.quiet_hours_start),
        quiet_hours_end=time_to_string(prefs.quiet_hours_end),
        morning_briefing_time=time_to_string(prefs.morning_briefing_time) or "08:00",
        evening_briefing_time=time_to_string(prefs.evening_briefing_time) or "18:00",
        meeting_prep_minutes_before=prefs.meeting_prep_minutes_before,
        timezone=prefs.timezone,
    )


# ==================== NOTIFICATION HISTORY ====================


class NotificationLogEntry(BaseModel):
    """A notification log entry."""

    id: str
    notification_type: str
    title: str
    body: Optional[str]
    priority_score: float
    urgency_level: str
    status: str
    sent_at: Optional[str]
    opened_at: Optional[str]
    created_at: str
    data: Optional[dict]


class NotificationHistoryResponse(BaseModel):
    """Response with notification history."""

    notifications: list[NotificationLogEntry]
    total: int


@router.get("/history", response_model=NotificationHistoryResponse)
async def get_notification_history(
    current_user: CurrentUser,
    db: Database,
    days: int = 7,
    limit: int = 50,
    offset: int = 0,
) -> NotificationHistoryResponse:
    """
    Get the notification history for the current user.

    Returns notifications from the last N days (default: 7).
    """
    orchestrator = ProactiveOrchestrator(db)
    notifications = await orchestrator.get_notification_history(
        user_id=current_user.id,
        days=days,
        limit=limit,
        offset=offset,
    )

    entries = [
        NotificationLogEntry(
            id=str(n.id),
            notification_type=n.notification_type,
            title=n.title,
            body=n.body,
            priority_score=n.priority_score,
            urgency_level=n.urgency_level,
            status=n.status,
            sent_at=n.sent_at.isoformat() if n.sent_at else None,
            opened_at=n.opened_at.isoformat() if n.opened_at else None,
            created_at=n.created_at.isoformat(),
            data=n.data,
        )
        for n in notifications
    ]

    return NotificationHistoryResponse(
        notifications=entries,
        total=len(entries),
    )


class NotificationStatsResponse(BaseModel):
    """Response with notification statistics."""

    period_days: int
    total_sent: int
    total_opened: int
    total_suppressed: int
    open_rate_percent: float
    by_type: dict
    average_per_day: float


@router.get("/stats", response_model=NotificationStatsResponse)
async def get_notification_stats(
    current_user: CurrentUser,
    db: Database,
    days: int = 7,
) -> NotificationStatsResponse:
    """
    Get notification statistics for the current user.

    Returns stats like open rate, total sent, etc.
    """
    orchestrator = ProactiveOrchestrator(db)
    stats = await orchestrator.get_notification_stats(
        user_id=current_user.id,
        days=days,
    )

    return NotificationStatsResponse(**stats)


# ==================== NOTIFICATION ACTIONS ====================


class DismissNotificationRequest(BaseModel):
    """Request to dismiss a notification."""

    pass


class SnoozeNotificationRequest(BaseModel):
    """Request to snooze a notification."""

    snooze_until: str  # ISO format datetime


class NotificationActionResponse(BaseModel):
    """Response after notification action."""

    success: bool
    message: Optional[str] = None


@router.post("/{notification_id}/dismiss", response_model=NotificationActionResponse)
async def dismiss_notification(
    notification_id: str,
    current_user: CurrentUser,
    db: Database,
) -> NotificationActionResponse:
    """
    Dismiss a notification.

    This marks the notification as dismissed for analytics.
    """
    try:
        notif_uuid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    orchestrator = ProactiveOrchestrator(db)
    success = await orchestrator.dismiss_notification(
        notification_id=notif_uuid,
        user_id=current_user.id,
    )

    if success:
        return NotificationActionResponse(success=True)
    else:
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/{notification_id}/snooze", response_model=NotificationActionResponse)
async def snooze_notification(
    notification_id: str,
    request: SnoozeNotificationRequest,
    current_user: CurrentUser,
    db: Database,
) -> NotificationActionResponse:
    """
    Snooze a notification until a specific time.

    The notification will be re-queued when the snooze time expires.
    """
    try:
        notif_uuid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    try:
        snooze_until = datetime.fromisoformat(request.snooze_until.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid snooze_until format")

    orchestrator = ProactiveOrchestrator(db)
    success = await orchestrator.snooze_notification(
        notification_id=notif_uuid,
        user_id=current_user.id,
        snooze_until=snooze_until,
    )

    if success:
        return NotificationActionResponse(
            success=True,
            message=f"Snoozed until {snooze_until.isoformat()}",
        )
    else:
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/{notification_id}/opened", response_model=NotificationActionResponse)
async def record_notification_opened(
    notification_id: str,
    current_user: CurrentUser,
    db: Database,
) -> NotificationActionResponse:
    """
    Record that a notification was opened/tapped.

    Used for engagement tracking.
    """
    try:
        notif_uuid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    orchestrator = ProactiveOrchestrator(db)
    success = await orchestrator.record_notification_opened(
        notification_id=notif_uuid,
        user_id=current_user.id,
    )

    if success:
        return NotificationActionResponse(success=True)
    else:
        raise HTTPException(status_code=404, detail="Notification not found")
