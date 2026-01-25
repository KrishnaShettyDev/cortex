"""
Smart Rescheduling API

Provides Iris-like intelligent calendar rescheduling endpoints:
- Natural language rescheduling ("Reschedule all calls today after 5pm")
- Batch operations with filters
- Automatic personalized attendee notifications
- Intelligent time optimization
"""

from datetime import datetime, time, timedelta
from fastapi import APIRouter, HTTPException, Request
from typing import Optional

from app.api.deps import CurrentUser, Database
from app.rate_limiter import limiter
from app.schemas.smart_rescheduling import (
    BatchRescheduleRequest,
    BatchRescheduleResponse,
    NaturalLanguageRescheduleRequest,
    ParsedRescheduleResponse,
    ExecuteRescheduleRequest,
    RescheduleProposalResponse,
    RescheduleResultResponse,
    ScheduleAnalysisRequest,
    ScheduleAnalysisResponse,
    RescheduleStrategy,
    TimeSlotScoreResponse,
)
from app.services.smart_rescheduling_service import (
    SmartReschedulingService,
    BatchRescheduleFilter,
    RescheduleStrategy as ServiceStrategy,
    MeetingType,
)

router = APIRouter(prefix="/smart-reschedule", tags=["Smart Rescheduling"])


@router.post("/natural-language", response_model=BatchRescheduleResponse)
@limiter.limit("10/minute")
async def reschedule_natural_language(
    request: Request,
    reschedule_request: NaturalLanguageRescheduleRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Reschedule events using natural language instruction.

    Examples:
    - "Reschedule all calls today after 5pm"
    - "Give me a slow start tomorrow"
    - "Move my standup to the afternoon"
    - "Batch my meetings together in the morning"

    This endpoint parses the instruction, identifies events to reschedule,
    generates optimized proposals, and optionally executes them.
    """
    service = SmartReschedulingService(db)

    # Parse the natural language instruction
    parsed = await service.parse_natural_language_reschedule(
        user_id=user.id,
        instruction=reschedule_request.instruction,
    )

    if not parsed.get("success"):
        raise HTTPException(
            status_code=400,
            detail=parsed.get("message", "Failed to parse instruction")
        )

    filter_obj = parsed.get("filter")
    strategy = parsed.get("strategy", ServiceStrategy.CUSTOM)

    if not filter_obj:
        raise HTTPException(
            status_code=400,
            detail="Could not determine which events to reschedule"
        )

    # Execute or preview the rescheduling
    result = await service.batch_reschedule_with_filter(
        user_id=user.id,
        filter=filter_obj,
        strategy=strategy,
        instruction=reschedule_request.instruction,
        send_notifications=reschedule_request.send_notifications,
        dry_run=reschedule_request.dry_run or not reschedule_request.auto_execute,
    )

    return BatchRescheduleResponse(
        success=result.get("success", False),
        message=result.get("message", ""),
        rescheduled=result.get("rescheduled", 0),
        failed=result.get("failed", 0),
        notifications_sent=result.get("notifications_sent", 0),
        proposals=[
            RescheduleProposalResponse(**p) for p in result.get("proposals", [])
        ],
        results=[
            RescheduleResultResponse(**r) for r in result.get("results", [])
        ],
        errors=result.get("errors", []),
        dry_run=result.get("dry_run", True),
    )


@router.post("/parse", response_model=ParsedRescheduleResponse)
@limiter.limit("15/minute")
async def parse_reschedule_instruction(
    request: Request,
    parse_request: NaturalLanguageRescheduleRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Parse a natural language instruction without executing.

    Useful for previewing how an instruction will be interpreted
    before committing to rescheduling.
    """
    service = SmartReschedulingService(db)

    result = await service.parse_natural_language_reschedule(
        user_id=user.id,
        instruction=parse_request.instruction,
    )

    return ParsedRescheduleResponse(
        success=result.get("success", False),
        filter_dict=result.get("filter_dict"),
        strategy=result.get("strategy"),
        target_time=result.get("target_time"),
        notification_context=result.get("notification_context"),
        confidence=result.get("confidence", 0.0),
        original_instruction=parse_request.instruction,
        message=result.get("message"),
    )


@router.post("/batch", response_model=BatchRescheduleResponse)
@limiter.limit("10/minute")
async def batch_reschedule(
    request: Request,
    batch_request: BatchRescheduleRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Batch reschedule events with explicit filter and strategy.

    Use this when you want precise control over:
    - Which events to reschedule (filter)
    - How to optimize the schedule (strategy)

    Available strategies:
    - slow_start: Move morning meetings later, protect early hours
    - batch_meetings: Group meetings together for focus blocks
    - spread_out: Add breaks between meetings
    - minimize_context_switch: Group similar meeting types
    - energy_optimized: Match meeting types to energy levels
    - custom: Use instruction for LLM-based optimization
    """
    service = SmartReschedulingService(db)

    # Convert request filter to service filter
    filter_obj = _request_to_filter(batch_request.filter)

    # Map strategy
    strategy = ServiceStrategy(batch_request.strategy.value)

    result = await service.batch_reschedule_with_filter(
        user_id=user.id,
        filter=filter_obj,
        strategy=strategy,
        instruction=batch_request.instruction,
        send_notifications=batch_request.send_notifications,
        dry_run=batch_request.dry_run,
    )

    return BatchRescheduleResponse(
        success=result.get("success", False),
        message=result.get("message", ""),
        rescheduled=result.get("rescheduled", 0),
        failed=result.get("failed", 0),
        notifications_sent=result.get("notifications_sent", 0),
        proposals=[
            RescheduleProposalResponse(**p) for p in result.get("proposals", [])
        ],
        results=[
            RescheduleResultResponse(**r) for r in result.get("results", [])
        ],
        errors=result.get("errors", []),
        dry_run=batch_request.dry_run,
    )


@router.post("/execute", response_model=BatchRescheduleResponse)
@limiter.limit("10/minute")
async def execute_proposals(
    request: Request,
    execute_request: ExecuteRescheduleRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Execute previously previewed reschedule proposals.

    Use this after calling /batch or /natural-language with dry_run=True
    to review proposals before executing.
    """
    service = SmartReschedulingService(db)

    # Convert proposals back to service format
    from app.services.smart_rescheduling_service import RescheduleProposal, TimeSlotScore

    proposals = []
    for p in execute_request.proposals:
        slot_score = None
        if p.slot_score:
            slot_score = TimeSlotScore(
                slot_start=p.slot_score.slot_start,
                slot_end=p.slot_score.slot_end,
                total_score=p.slot_score.total_score,
                energy_score=p.slot_score.energy_score,
                preference_score=p.slot_score.preference_score,
                context_score=p.slot_score.context_score,
                buffer_score=p.slot_score.buffer_score,
                breakdown=p.slot_score.breakdown,
            )

        proposals.append(RescheduleProposal(
            event_id=p.event_id,
            event_title=p.event_title,
            original_start=p.original_start,
            original_end=p.original_end,
            new_start=p.new_start,
            new_end=p.new_end,
            reason=p.reason,
            confidence=p.confidence,
            has_attendees=p.has_attendees,
            attendees=p.attendees,
            notification_message=p.notification_message,
            slot_score=slot_score,
        ))

    result = await service._execute_batch_reschedule(
        user_id=user.id,
        proposals=proposals,
        send_notifications=execute_request.send_notifications,
    )

    # Learn from this decision
    await service._learn_from_reschedule(
        user_id=user.id,
        results=result,
        strategy=ServiceStrategy.CUSTOM,
        instruction=None,
    )

    return BatchRescheduleResponse(
        success=result.get("success", False),
        message=result.get("message", ""),
        rescheduled=result.get("rescheduled", 0),
        failed=result.get("failed", 0),
        notifications_sent=result.get("notifications_sent", 0),
        proposals=[],
        results=[
            RescheduleResultResponse(**r) for r in result.get("results", [])
        ],
        errors=result.get("errors", []),
        dry_run=False,
    )


@router.post("/analyze", response_model=ScheduleAnalysisResponse)
@limiter.limit("15/minute")
async def analyze_schedule(
    request: Request,
    analysis_request: ScheduleAnalysisRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Analyze schedule for optimization opportunities.

    Returns:
    - Meeting load metrics
    - Energy alignment score
    - Conflict count
    - AI-generated recommendations
    - Optimization opportunities (specific suggestions)
    """
    from app.services.calendar_intelligence_service import CalendarIntelligenceService

    cal_service = CalendarIntelligenceService(db)
    smart_service = SmartReschedulingService(db)

    # Parse date
    if analysis_request.date:
        if analysis_request.date == "today":
            date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        elif analysis_request.date == "tomorrow":
            date = (datetime.now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            try:
                date = datetime.fromisoformat(analysis_request.date)
            except Exception:
                date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Get day summary
    summary = await cal_service.get_day_summary(user.id, date)

    # Calculate energy alignment score
    energy_score = await _calculate_energy_alignment(db, user.id, date)

    # Generate optimization opportunities
    opportunities = []
    if summary.get("conflict_count", 0) > 0:
        opportunities.append({
            "type": "conflicts",
            "description": f"{summary['conflict_count']} scheduling conflicts",
            "suggested_action": "Use /smart-reschedule/batch with spread_out strategy"
        })

    if summary.get("total_meeting_hours", 0) > 6:
        opportunities.append({
            "type": "meeting_overload",
            "description": f"{summary['total_meeting_hours']} hours of meetings",
            "suggested_action": "Consider declining optional meetings or rescheduling to tomorrow"
        })

    if summary.get("longest_free_block", 0) < 60:
        opportunities.append({
            "type": "no_focus_time",
            "description": "No significant focus blocks available",
            "suggested_action": "Use slow_start or batch_meetings strategy"
        })

    return ScheduleAnalysisResponse(
        date=summary.get("date", date.strftime("%A, %B %d")),
        meeting_count=summary.get("meeting_count", 0),
        total_meeting_hours=summary.get("total_meeting_hours", 0.0),
        free_hours=summary.get("free_hours", 0.0),
        conflict_count=summary.get("conflict_count", 0),
        busiest_hour=summary.get("busiest_hour"),
        longest_free_block=summary.get("longest_free_block", 0),
        energy_alignment_score=energy_score,
        recommendations=summary.get("recommendations", []),
        optimization_opportunities=opportunities,
    )


@router.get("/strategies")
async def list_strategies():
    """
    List available rescheduling strategies with descriptions.
    """
    return {
        "strategies": [
            {
                "id": "slow_start",
                "name": "Slow Start",
                "description": "Move morning meetings later to protect early hours for focus work. Best for mornings when you need deep work time.",
                "best_for": ["Focus work", "Deep thinking", "Morning people who need quiet time"]
            },
            {
                "id": "batch_meetings",
                "name": "Batch Meetings",
                "description": "Group meetings together to create longer focus blocks. Minimizes context switching throughout the day.",
                "best_for": ["Productivity", "Context continuity", "Busy meeting days"]
            },
            {
                "id": "spread_out",
                "name": "Spread Out",
                "description": "Add breaks between meetings to prevent burnout. Ensures recovery time between calls.",
                "best_for": ["Preventing burnout", "Back-to-back meeting days", "Energy management"]
            },
            {
                "id": "minimize_context_switch",
                "name": "Minimize Context Switch",
                "description": "Group similar meeting types together (all 1:1s, then all team meetings). Reduces mental switching cost.",
                "best_for": ["Focus", "Related discussions", "Project-based work"]
            },
            {
                "id": "energy_optimized",
                "name": "Energy Optimized",
                "description": "Schedule demanding meetings at high-energy times (usually 9-11am, 2-4pm) and routine meetings at lower energy times.",
                "best_for": ["Important meetings", "Interviews", "Client calls"]
            },
            {
                "id": "custom",
                "name": "Custom",
                "description": "Use natural language instruction for AI-powered optimization. Understands context like 'give me a slow start' or 'protect lunch time'.",
                "best_for": ["Flexible needs", "Specific requirements", "Natural language preferences"]
            }
        ]
    }


# Helper functions

def _request_to_filter(request_filter) -> BatchRescheduleFilter:
    """Convert request filter to service filter."""
    filter_obj = BatchRescheduleFilter()

    # Parse time filters
    if request_filter.after_time:
        try:
            parts = request_filter.after_time.split(":")
            filter_obj.after_time = time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
        except Exception:
            pass

    if request_filter.before_time:
        try:
            parts = request_filter.before_time.split(":")
            filter_obj.before_time = time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
        except Exception:
            pass

    # Parse date
    if request_filter.date:
        now = datetime.now()
        if request_filter.date == "today":
            filter_obj.date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif request_filter.date == "tomorrow":
            filter_obj.date = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            try:
                filter_obj.date = datetime.fromisoformat(request_filter.date)
            except Exception:
                pass

    filter_obj.date_range_start = request_filter.date_range_start
    filter_obj.date_range_end = request_filter.date_range_end

    # Meeting type filters
    if request_filter.meeting_types:
        filter_obj.meeting_types = [
            MeetingType(mt.value) for mt in request_filter.meeting_types
        ]

    filter_obj.has_attendees = request_filter.has_attendees
    filter_obj.has_video_call = request_filter.has_video_call
    filter_obj.title_contains = request_filter.title_contains
    filter_obj.title_not_contains = request_filter.title_not_contains
    filter_obj.with_attendee = request_filter.with_attendee
    filter_obj.external_only = request_filter.external_only
    filter_obj.internal_only = request_filter.internal_only

    return filter_obj


async def _calculate_energy_alignment(db, user_id, date: datetime) -> float:
    """Calculate how well the schedule aligns with energy levels."""
    from app.services.sync_service import SyncService
    from app.services.smart_rescheduling_service import SmartReschedulingService

    sync_service = SyncService(db)
    smart_service = SmartReschedulingService(db)

    # Get events
    result = await sync_service.get_calendar_events(
        user_id=user_id,
        start_date=date,
        end_date=date + timedelta(days=1),
    )

    events = result.get("events", [])
    if not events:
        return 100.0  # No events = perfect alignment

    # Get user's energy curve
    energy_curve = await smart_service._get_user_energy_curve(user_id)

    # Calculate alignment for each event
    total_score = 0
    total_weight = 0

    for event in events:
        start_str = event.get("start_time", "")
        try:
            start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            hour = start.hour

            # Get user's energy at this hour
            user_energy = energy_curve.get(hour, 0.5)

            # Get meeting's energy requirement
            meeting_type = smart_service._classify_meeting_type(event)
            required_energy = smart_service.MEETING_ENERGY_REQUIREMENTS.get(meeting_type, 0.7)

            # Calculate alignment (1 - absolute difference)
            alignment = 1 - abs(user_energy - required_energy)

            # Weight by meeting duration
            end_str = event.get("end_time", "")
            end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            duration_minutes = (end - start).total_seconds() / 60

            total_score += alignment * duration_minutes
            total_weight += duration_minutes

        except Exception:
            continue

    if total_weight == 0:
        return 100.0

    return round((total_score / total_weight) * 100, 1)
