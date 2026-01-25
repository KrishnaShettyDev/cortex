"""
Schemas for Smart Rescheduling API.

Provides request/response models for Iris-like intelligent calendar rescheduling.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, time
from enum import Enum


class RescheduleStrategy(str, Enum):
    """Available rescheduling strategies."""
    SLOW_START = "slow_start"
    BATCH_MEETINGS = "batch_meetings"
    SPREAD_OUT = "spread_out"
    MINIMIZE_CONTEXT_SWITCH = "minimize_context_switch"
    ENERGY_OPTIMIZED = "energy_optimized"
    CUSTOM = "custom"


class MeetingType(str, Enum):
    """Types of meetings for filtering."""
    ONE_ON_ONE = "one_on_one"
    TEAM_MEETING = "team_meeting"
    EXTERNAL_CALL = "external_call"
    FOCUS_BLOCK = "focus_block"
    INTERVIEW = "interview"
    REVIEW = "review"
    STANDUP = "standup"
    ALL_HANDS = "all_hands"
    UNKNOWN = "unknown"


class BatchRescheduleFilterRequest(BaseModel):
    """Filter criteria for batch rescheduling."""

    # Time filters
    after_time: Optional[str] = Field(
        None,
        description="Events starting after this time (HH:MM format)",
        examples=["17:00", "14:30"]
    )
    before_time: Optional[str] = Field(
        None,
        description="Events starting before this time (HH:MM format)",
        examples=["09:00", "12:00"]
    )
    date: Optional[str] = Field(
        None,
        description="Date to reschedule (YYYY-MM-DD, 'today', or 'tomorrow')",
        examples=["2024-01-23", "today", "tomorrow"]
    )
    date_range_start: Optional[datetime] = None
    date_range_end: Optional[datetime] = None

    # Event type filters
    meeting_types: Optional[list[MeetingType]] = Field(
        None,
        description="Only reschedule these meeting types"
    )
    has_attendees: Optional[bool] = Field(
        None,
        description="Only events with attendees (True) or without (False)"
    )
    has_video_call: Optional[bool] = Field(
        None,
        description="Only video calls"
    )

    # Title filters
    title_contains: Optional[str] = Field(
        None,
        description="Only events with title containing this string"
    )
    title_not_contains: Optional[str] = Field(
        None,
        description="Exclude events with title containing this string"
    )

    # Attendee filters
    with_attendee: Optional[str] = Field(
        None,
        description="Only events with this attendee (email or name)"
    )
    external_only: bool = Field(
        False,
        description="Only external meetings"
    )
    internal_only: bool = Field(
        False,
        description="Only internal meetings"
    )


class BatchRescheduleRequest(BaseModel):
    """Request to batch reschedule events with intelligent optimization."""

    filter: BatchRescheduleFilterRequest = Field(
        ...,
        description="Filter criteria to select which events to reschedule"
    )
    strategy: RescheduleStrategy = Field(
        RescheduleStrategy.SPREAD_OUT,
        description="Strategy for optimizing the rescheduling"
    )
    instruction: Optional[str] = Field(
        None,
        description="Optional natural language instruction for custom strategy",
        examples=["Move to afternoon", "Give me a slow start"]
    )
    send_notifications: bool = Field(
        True,
        description="Send personalized notifications to attendees"
    )
    dry_run: bool = Field(
        False,
        description="Preview changes without executing"
    )


class NaturalLanguageRescheduleRequest(BaseModel):
    """Request to reschedule using natural language."""

    instruction: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Natural language rescheduling instruction",
        examples=[
            "Reschedule all calls today after 5pm",
            "Give me a slow start tomorrow",
            "Move my standup to the afternoon",
            "Batch my meetings together in the morning"
        ]
    )
    send_notifications: bool = Field(
        True,
        description="Send personalized notifications to attendees"
    )
    dry_run: bool = Field(
        False,
        description="Preview changes without executing"
    )
    auto_execute: bool = Field(
        False,
        description="Execute immediately without confirmation (requires dry_run=False)"
    )


class TimeSlotScoreResponse(BaseModel):
    """Scoring breakdown for a time slot."""

    slot_start: datetime
    slot_end: datetime
    total_score: float = Field(..., description="Total score 0-100")
    energy_score: float = Field(..., description="Energy match score 0-25")
    preference_score: float = Field(..., description="User preference score 0-25")
    context_score: float = Field(..., description="Context continuity score 0-25")
    buffer_score: float = Field(..., description="Buffer availability score 0-25")
    breakdown: dict = Field(default_factory=dict)


class RescheduleProposalResponse(BaseModel):
    """A proposed reschedule for an event."""

    event_id: str
    event_title: str
    original_start: datetime
    original_end: datetime
    new_start: datetime
    new_end: datetime
    reason: str
    confidence: float = Field(..., ge=0, le=1, description="Confidence score 0-1")
    has_attendees: bool
    attendees: list[str]
    notification_message: Optional[str] = Field(
        None,
        description="Personalized message to send to attendees"
    )
    slot_score: Optional[TimeSlotScoreResponse] = None


class ParsedRescheduleResponse(BaseModel):
    """Response from parsing natural language instruction."""

    success: bool
    filter_dict: Optional[dict] = None
    strategy: Optional[RescheduleStrategy] = None
    target_time: Optional[str] = None
    notification_context: Optional[str] = None
    confidence: float = 0.0
    original_instruction: str
    message: Optional[str] = None


class RescheduleResultResponse(BaseModel):
    """Result of a single event reschedule."""

    event_id: str
    title: str
    status: str
    new_time: str
    reason: str
    confidence: float
    notifications: Optional[dict] = None


class BatchRescheduleResponse(BaseModel):
    """Response from batch rescheduling operation."""

    success: bool
    message: str
    rescheduled: int = Field(..., description="Number of events rescheduled")
    failed: int = Field(..., description="Number of events that failed")
    notifications_sent: int = Field(0, description="Number of notifications sent")
    proposals: list[RescheduleProposalResponse] = Field(
        default_factory=list,
        description="Proposals (when dry_run=True)"
    )
    results: list[RescheduleResultResponse] = Field(
        default_factory=list,
        description="Results (when dry_run=False)"
    )
    errors: list[dict] = Field(default_factory=list)
    dry_run: bool = False


class ExecuteRescheduleRequest(BaseModel):
    """Request to execute a previewed reschedule."""

    proposals: list[RescheduleProposalResponse] = Field(
        ...,
        description="Proposals from a dry_run to execute"
    )
    send_notifications: bool = Field(
        True,
        description="Send personalized notifications to attendees"
    )


class ScheduleAnalysisRequest(BaseModel):
    """Request for schedule analysis."""

    date: Optional[str] = Field(
        None,
        description="Date to analyze (YYYY-MM-DD or 'today')"
    )
    include_recommendations: bool = Field(
        True,
        description="Include AI-generated recommendations"
    )


class ScheduleAnalysisResponse(BaseModel):
    """Response with schedule analysis."""

    date: str
    meeting_count: int
    total_meeting_hours: float
    free_hours: float
    conflict_count: int
    busiest_hour: Optional[str]
    longest_free_block: int = Field(..., description="In minutes")
    energy_alignment_score: float = Field(
        ...,
        ge=0,
        le=100,
        description="How well meetings align with energy levels"
    )
    recommendations: list[str] = Field(default_factory=list)
    optimization_opportunities: list[dict] = Field(default_factory=list)
