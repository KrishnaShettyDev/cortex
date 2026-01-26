"""
Pydantic schemas for Autonomous Actions API.

Iris-style proactive action suggestions with one-tap approve/dismiss.
"""

from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional


# ==================== PAYLOAD TYPES ====================

class EmailPayload(BaseModel):
    """Pre-filled email action payload."""
    thread_id: str
    to: str
    subject: str
    body: str


class CalendarPayload(BaseModel):
    """Pre-filled calendar action payload."""
    event_id: Optional[str] = None  # For reschedule/cancel
    title: str
    start_time: str  # ISO format
    end_time: str  # ISO format
    description: Optional[str] = None
    location: Optional[str] = None
    attendees: list[str] = []


class MeetingPrepPayload(BaseModel):
    """Meeting prep action payload."""
    event_id: str
    event_title: str
    start_time: str
    attendees: list[str] = []


# ==================== ACTION RESPONSES ====================

class AutonomousActionResponse(BaseModel):
    """Response schema for an autonomous action."""

    id: UUID
    action_type: str  # email_reply, calendar_create, calendar_reschedule, meeting_prep, followup
    title: str
    description: Optional[str] = None
    action_payload: dict  # EmailPayload, CalendarPayload, etc.
    reason: Optional[str] = None
    confidence_score: float
    priority_score: float
    source_type: Optional[str] = None  # email, calendar, pattern
    source_id: Optional[str] = None
    status: str = "pending"
    created_at: datetime
    expires_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AutonomousActionsListResponse(BaseModel):
    """Response for list of autonomous actions."""

    actions: list[AutonomousActionResponse]
    count: int


# ==================== ACTION REQUESTS ====================

class ApproveActionRequest(BaseModel):
    """Request to approve and execute an action."""

    modifications: Optional[dict] = None  # Optional modifications to the payload


class DismissActionRequest(BaseModel):
    """Request to dismiss an action."""

    reason: Optional[str] = None  # wrong_timing, not_relevant, incorrect, too_aggressive


class ActionFeedbackRequest(BaseModel):
    """Request to submit feedback on an action."""

    rating: Optional[int] = Field(None, ge=1, le=5)  # 1-5 rating
    feedback_type: Optional[str] = None  # helpful, not_helpful, wrong_timing, incorrect
    comment: Optional[str] = None


# ==================== EXECUTION RESULTS ====================

class ActionExecutionResult(BaseModel):
    """Result of executing an action."""

    success: bool
    message: str
    event_id: Optional[str] = None  # For calendar actions
    event_url: Optional[str] = None
    message_id: Optional[str] = None  # For email actions
    thread_id: Optional[str] = None


class ActionDismissResult(BaseModel):
    """Result of dismissing an action."""

    success: bool
    message: str


class ActionFeedbackResult(BaseModel):
    """Result of submitting feedback."""

    success: bool
    message: str


# ==================== STATISTICS ====================

class ActionStatsResponse(BaseModel):
    """Statistics on autonomous actions."""

    pending: int = 0
    executed: int = 0
    dismissed: int = 0
    expired: int = 0
    total: int = 0
    approval_rate: float = 0.0


# ==================== GENERATION ====================

class GenerateActionsResponse(BaseModel):
    """Response from manually triggering action generation."""

    success: bool
    actions_generated: int
    actions: list[AutonomousActionResponse]
    message: str
