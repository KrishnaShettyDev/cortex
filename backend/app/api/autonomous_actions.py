"""
Autonomous Actions API - Iris-style Proactive Suggestions

Endpoints for:
- GET /autonomous-actions - Get pending actions
- POST /autonomous-actions/generate - Force action generation
- POST /autonomous-actions/{id}/approve - Approve and execute
- POST /autonomous-actions/{id}/dismiss - Dismiss an action
- POST /autonomous-actions/{id}/feedback - Submit feedback
- GET /autonomous-actions/stats - Get action statistics
"""

import logging
from uuid import UUID
from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, Database
from app.services.autonomous_action_service import AutonomousActionService
from app.schemas.autonomous_action import (
    AutonomousActionResponse,
    AutonomousActionsListResponse,
    ApproveActionRequest,
    DismissActionRequest,
    ActionFeedbackRequest,
    ActionExecutionResult,
    ActionDismissResult,
    ActionFeedbackResult,
    ActionStatsResponse,
    GenerateActionsResponse,
)

router = APIRouter(prefix="/autonomous-actions", tags=["autonomous-actions"])
logger = logging.getLogger(__name__)


@router.get("", response_model=AutonomousActionsListResponse)
async def get_pending_actions(
    current_user: CurrentUser,
    db: Database,
    limit: int = 5,
) -> AutonomousActionsListResponse:
    """
    Get pending autonomous actions for the current user.

    Returns actions ordered by priority, filtered to pending status.
    """
    service = AutonomousActionService(db)
    actions = await service.get_pending_actions(current_user.id, limit=limit)

    return AutonomousActionsListResponse(
        actions=[AutonomousActionResponse.model_validate(a) for a in actions],
        count=len(actions),
    )


@router.post("/generate", response_model=GenerateActionsResponse)
async def generate_actions(
    current_user: CurrentUser,
    db: Database,
) -> GenerateActionsResponse:
    """
    Force generation of new autonomous actions.

    Analyzes current context (emails, calendar, patterns) and generates
    actionable suggestions. Actions are stored and returned.
    """
    service = AutonomousActionService(db)

    try:
        actions = await service.generate_actions(current_user.id)

        return GenerateActionsResponse(
            success=True,
            actions_generated=len(actions),
            actions=[AutonomousActionResponse.model_validate(a) for a in actions],
            message=f"Generated {len(actions)} action suggestions",
        )
    except Exception as e:
        logger.error(f"Error generating actions: {e}")
        return GenerateActionsResponse(
            success=False,
            actions_generated=0,
            actions=[],
            message=f"Error generating actions: {str(e)}",
        )


@router.get("/{action_id}", response_model=AutonomousActionResponse)
async def get_action(
    action_id: UUID,
    current_user: CurrentUser,
    db: Database,
) -> AutonomousActionResponse:
    """
    Get a specific autonomous action by ID.
    """
    service = AutonomousActionService(db)
    action = await service.get_action_by_id(action_id, current_user.id)

    if not action:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Action not found",
        )

    return AutonomousActionResponse.model_validate(action)


@router.post("/{action_id}/approve", response_model=ActionExecutionResult)
async def approve_action(
    action_id: UUID,
    current_user: CurrentUser,
    db: Database,
    request: ApproveActionRequest = None,
) -> ActionExecutionResult:
    """
    Approve and execute an autonomous action.

    Optionally accepts modifications to the action payload before execution.
    On success, the action is executed (email sent, event created, etc.).
    """
    service = AutonomousActionService(db)

    modifications = request.modifications if request else None
    result = await service.approve_action(action_id, current_user.id, modifications)

    return ActionExecutionResult(
        success=result.get("success", False),
        message=result.get("message", ""),
        event_id=result.get("event_id"),
        event_url=result.get("event_url"),
        message_id=result.get("message_id"),
        thread_id=result.get("thread_id"),
    )


@router.post("/{action_id}/dismiss", response_model=ActionDismissResult)
async def dismiss_action(
    action_id: UUID,
    current_user: CurrentUser,
    db: Database,
    request: DismissActionRequest = None,
) -> ActionDismissResult:
    """
    Dismiss an autonomous action.

    Optionally accepts a reason for the dismissal (for learning).
    """
    service = AutonomousActionService(db)

    reason = request.reason if request else None
    result = await service.dismiss_action(action_id, current_user.id, reason)

    return ActionDismissResult(
        success=result.get("success", False),
        message=result.get("message", ""),
    )


@router.post("/{action_id}/feedback", response_model=ActionFeedbackResult)
async def submit_feedback(
    action_id: UUID,
    request: ActionFeedbackRequest,
    current_user: CurrentUser,
    db: Database,
) -> ActionFeedbackResult:
    """
    Submit feedback on an action.

    Can include rating (1-5), feedback type, and comments.
    Used for learning and improving action suggestions.
    """
    service = AutonomousActionService(db)

    result = await service.submit_feedback(
        action_id=action_id,
        user_id=current_user.id,
        rating=request.rating,
        feedback_type=request.feedback_type,
        comment=request.comment,
    )

    return ActionFeedbackResult(
        success=result.get("success", False),
        message=result.get("message", ""),
    )


@router.get("/stats/summary", response_model=ActionStatsResponse)
async def get_action_stats(
    current_user: CurrentUser,
    db: Database,
) -> ActionStatsResponse:
    """
    Get statistics on autonomous actions for the current user.

    Includes counts by status and approval rate.
    """
    service = AutonomousActionService(db)
    stats = await service.get_action_stats(current_user.id)

    return ActionStatsResponse(**stats)
