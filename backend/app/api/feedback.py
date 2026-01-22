"""Feedback API - Endpoints for user feedback and adaptive learning."""

from uuid import UUID
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import CurrentUser, Database
from app.services.adaptive_learning_service import AdaptiveLearningService

router = APIRouter(prefix="/feedback", tags=["feedback"])


# ==================== SCHEMAS ====================

class FeedbackRequest(BaseModel):
    """Request schema for submitting feedback."""
    feedback_type: str  # 'positive', 'negative', 'correction'
    feedback_context: str  # 'response', 'suggestion', 'memory_retrieval', 'action'
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    user_query: Optional[str] = None
    ai_response: Optional[str] = None
    correction_text: Optional[str] = None
    memories_used: Optional[list[str]] = None


class FeedbackResponse(BaseModel):
    """Response schema for feedback submission."""
    id: str
    feedback_type: str
    message: str


class PreferencesResponse(BaseModel):
    """Response schema for user preferences."""
    preferences: dict
    user_model_prompt: str


class LearningStatsResponse(BaseModel):
    """Response schema for learning statistics."""
    memories: dict
    feedback: dict
    preferences_learned: int
    insights_generated: int


# ==================== ENDPOINTS ====================

@router.post("", response_model=FeedbackResponse)
async def submit_feedback(
    request: FeedbackRequest,
    user: CurrentUser,
    db: Database,
):
    """
    Submit feedback on an AI response.

    This feedback is used to:
    - Reinforce or penalize memory importance
    - Learn user preferences
    - Improve future responses

    Feedback types:
    - positive: The response was helpful
    - negative: The response was not helpful
    - correction: The response needed correction (provide correction_text)
    """
    service = AdaptiveLearningService(db)

    feedback = await service.record_feedback(
        user_id=user.id,
        feedback_type=request.feedback_type,
        feedback_context=request.feedback_context,
        conversation_id=request.conversation_id,
        message_id=request.message_id,
        user_query=request.user_query,
        ai_response=request.ai_response,
        correction_text=request.correction_text,
        memories_used=request.memories_used,
    )

    return FeedbackResponse(
        id=str(feedback.id),
        feedback_type=feedback.feedback_type,
        message="Feedback recorded successfully",
    )


@router.get("/preferences", response_model=PreferencesResponse)
async def get_user_preferences(
    user: CurrentUser,
    db: Database,
):
    """
    Get learned user preferences.

    Returns preferences organized by type:
    - communication_style: How the user prefers to communicate
    - interests: Topics the user is interested in
    - behavior_pattern: Behavioral patterns observed
    - correction_learning: Things learned from corrections
    """
    service = AdaptiveLearningService(db)

    preferences = await service.get_user_preferences(user.id)
    user_model_prompt = await service.get_user_model_prompt(user.id)

    return PreferencesResponse(
        preferences=preferences,
        user_model_prompt=user_model_prompt,
    )


@router.get("/stats", response_model=LearningStatsResponse)
async def get_learning_stats(
    user: CurrentUser,
    db: Database,
):
    """
    Get statistics about the adaptive learning system.

    Returns:
    - Memory stats (count, average strength, emotional weight)
    - Feedback stats (positive/negative counts)
    - Number of preferences learned
    - Number of insights generated
    """
    service = AdaptiveLearningService(db)
    stats = await service.get_learning_stats(user.id)

    return LearningStatsResponse(**stats)


@router.post("/memory/{memory_id}/accessed")
async def log_memory_access(
    memory_id: UUID,
    user: CurrentUser,
    db: Database,
    access_type: str = "direct",
    query_text: Optional[str] = None,
):
    """
    Log a memory access (for tracking access patterns).

    Access types:
    - search: Retrieved via search
    - chat_retrieval: Retrieved during chat
    - connection: Retrieved via connection
    - direct: Directly accessed
    - suggestion: Used in suggestion
    """
    service = AdaptiveLearningService(db)

    await service.log_memory_access(
        user_id=user.id,
        memory_id=memory_id,
        access_type=access_type,
        query_text=query_text,
    )

    return {"message": "Memory access logged"}


@router.post("/insights/extract")
async def extract_insights(
    user: CurrentUser,
    db: Database,
    days: int = 30,
):
    """
    Manually trigger insight extraction from recent memories.

    This analyzes memories from the last N days and extracts patterns.
    Normally runs automatically via background job.
    """
    service = AdaptiveLearningService(db)
    insights = await service.extract_patterns(user.id, days=days)

    return {
        "insights_extracted": len(insights),
        "insights": [
            {
                "id": str(i.id),
                "type": i.insight_type,
                "title": i.title,
                "content": i.content,
                "confidence": i.confidence,
            }
            for i in insights
        ],
    }
