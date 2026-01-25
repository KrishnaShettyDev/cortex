import json
import asyncio
from datetime import datetime, timedelta, date
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.api.deps import Database, CurrentUser
from app.rate_limiter import limiter
from app.services.search_service import SearchService
from app.services.chat_service import ChatService
from app.services.sync_service import SyncService
from app.services.suggestion_service import SuggestionService
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    MemoryReference,
    ActionTaken,
    PendingAction,
    ExecuteActionRequest,
    ExecuteActionResponse,
    SmartSuggestion,
    SmartSuggestionsResponse,
    GreetingResponse,
    ProactiveInsightsResponse,
    RelationshipInsight,
    IntentionInsight,
    PatternInsight,
    PromiseInsight,
    ImportantDateInsight,
    EmotionalInsight,
)

router = APIRouter()


@router.post("", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat_with_memories(
    request: Request,
    chat_request: ChatRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Chat with your memories (non-streaming).

    Searches relevant memories and uses them as context
    to answer your question. Actions (emails, calendar events)
    are returned as pending_actions for user confirmation.

    Context reinstatement: If context is provided, memories matching
    the current context (time of day, location type, activity) will
    be prioritized (encoding specificity principle).
    """
    search_service = SearchService(db)
    chat_service = ChatService(search_service, db=db)

    # Convert context schema to dict for cognitive retrieval
    current_context = None
    if chat_request.context:
        current_context = chat_request.context.model_dump(exclude_none=True)

    response_text, memories_used, conversation_id, actions_taken, pending_actions = await chat_service.chat(
        user_id=str(current_user.id),
        message=chat_request.message,
        conversation_id=chat_request.conversation_id,
        auto_execute=False,  # Return pending actions instead of auto-executing
        current_context=current_context,  # Pass context for reinstatement
    )

    return ChatResponse(
        response=response_text,
        memories_used=[
            MemoryReference(
                id=m.id,
                content=m.content[:500],  # Truncate for response
                memory_type=m.memory_type,
                memory_date=m.memory_date,
                photo_url=m.photo_url,
                audio_url=m.audio_url,
            )
            for m in memories_used
        ],
        conversation_id=conversation_id,
        actions_taken=[
            ActionTaken(
                tool=a["tool"],
                arguments=a["arguments"],
                result=a["result"],
            )
            for a in actions_taken
        ],
        pending_actions=[
            PendingAction(
                action_id=p["action_id"],
                tool=p["tool"],
                arguments=p["arguments"],
            )
            for p in pending_actions
        ],
    )


@router.post("/execute-action", response_model=ExecuteActionResponse)
@limiter.limit("20/minute")
async def execute_action(
    request: Request,
    action_request: ExecuteActionRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Execute a pending action after user confirmation.

    The user can optionally modify the action arguments before execution.
    """
    search_service = SearchService(db)
    chat_service = ChatService(search_service, db=db)

    # Use modified arguments if provided, otherwise use original
    arguments = action_request.modified_arguments or action_request.arguments

    try:
        result = await chat_service._execute_tool(
            user_id=str(current_user.id),
            tool_name=action_request.tool,
            arguments=arguments,
        )

        if result.get("success", False):
            return ExecuteActionResponse(
                success=True,
                message=result.get("message", "Action executed successfully"),
                result=result,
            )
        else:
            return ExecuteActionResponse(
                success=False,
                message=result.get("message", "Action failed"),
                result=result,
            )
    except Exception as e:
        return ExecuteActionResponse(
            success=False,
            message=f"Error executing action: {str(e)}",
            result=None,
        )


@router.post("/stream")
@limiter.limit("20/minute")
async def chat_stream(
    request: Request,
    chat_request: ChatRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Chat with your memories (streaming via Server-Sent Events).

    Returns a stream of events:
    - type: "memories" - relevant memories found
    - type: "content" - chunks of the response
    - type: "done" - completion with conversation_id
    - type: "error" - error message

    Context reinstatement: If context is provided, memories matching
    the current context will be prioritized.
    """
    search_service = SearchService(db)
    chat_service = ChatService(search_service, db=db)

    # Convert context schema to dict for cognitive retrieval
    current_context = None
    if chat_request.context:
        current_context = chat_request.context.model_dump(exclude_none=True)

    async def generate():
        async for chunk in chat_service.chat_stream(
            user_id=str(current_user.id),
            message=chat_request.message,
            conversation_id=chat_request.conversation_id,
            current_context=current_context,  # Pass context for reinstatement
        ):
            # Format as SSE
            data = json.dumps(chunk)
            yield f"data: {data}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/greeting", response_model=GreetingResponse)
async def get_greeting(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get a dynamic, contextual greeting based on calendar and emails.

    Returns a TARS-style greeting that includes relevant context like:
    - Upcoming meetings
    - Important emails
    - Daily overview
    """
    sync_service = SyncService(db)
    suggestion_service = SuggestionService(db)

    # Get connection status
    status = await sync_service.get_connection_status(current_user.id)
    gmail_connected = status["google"].get("gmail_connected", False)
    calendar_connected = status["google"].get("calendar_connected", False)

    # Get contextual greeting
    result = await suggestion_service.get_greeting(
        user_id=current_user.id,
        user_name=current_user.name or "",
        gmail_connected=gmail_connected,
        calendar_connected=calendar_connected,
    )

    return GreetingResponse(
        greeting=result["greeting"],
        has_context=result["has_context"],
    )


@router.get("/suggestions", response_model=SmartSuggestionsResponse)
async def get_smart_suggestions(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get smart contextual suggestions using LLM-powered analysis.

    Analyzes recent emails and upcoming calendar events to generate
    intelligent, prioritized suggestions like:
    - "Reply to Sarah - she's waiting on budget approval"
    - "Prepare for 2pm meeting - review attached deck"
    - "Follow up with John - no response in 3 days"

    Suggestions are cached for 2 minutes and auto-refresh with new sync data.
    """
    sync_service = SyncService(db)
    suggestion_service = SuggestionService(db)

    # Get connection status
    status = await sync_service.get_connection_status(current_user.id)
    gmail_connected = status["google"].get("gmail_connected", False)
    calendar_connected = status["google"].get("calendar_connected", False)

    # Get LLM-powered suggestions
    raw_suggestions = await suggestion_service.get_suggestions(
        user_id=current_user.id,
        gmail_connected=gmail_connected,
        calendar_connected=calendar_connected,
    )

    # Convert to SmartSuggestion format
    suggestions: list[SmartSuggestion] = []
    for s in raw_suggestions[:4]:
        # Map type to services
        service_map = {
            "email": "gmail",
            "calendar": "calendar",
            "combined": "gmail-calendar",
            "none": "none",
        }
        services = service_map.get(s.get("type", "combined"), "gmail-calendar")

        suggestions.append(
            SmartSuggestion(
                text=s.get("text", ""),
                services=services,
                context=s.get("context"),  # Include context from LLM
                source_id=s.get("source_id"),  # Include source_id for linking
            )
        )

    # Fallback if no suggestions
    if not suggestions:
        if not gmail_connected and not calendar_connected:
            suggestions = [
                SmartSuggestion(
                    text="Connect Google to get personalized suggestions",
                    services="none",
                    context=None,
                    source_id=None,
                ),
            ]
        else:
            suggestions = [
                SmartSuggestion(
                    text="Summarize my day and priorities",
                    services="gmail-calendar" if gmail_connected and calendar_connected else ("gmail" if gmail_connected else "calendar"),
                    context=None,
                    source_id=None,
                ),
            ]

    # Build list of connected apps
    connected_apps: list[str] = []
    if gmail_connected:
        connected_apps.append('gmail')
    if calendar_connected:
        connected_apps.append('calendar')

    return SmartSuggestionsResponse(
        suggestions=suggestions,
        gmail_connected=gmail_connected,
        calendar_connected=calendar_connected,
        connected_apps=connected_apps,
    )


@router.get("/actions")
async def get_prefilled_actions(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get smart pre-filled actions like Iris.

    Returns actions with all data pre-filled so user just needs to approve.
    Each action includes the type, title, and pre-filled data ready to execute.

    Examples:
    - Reply to email (with draft body generated)
    - Follow up on unanswered thread
    - Resolve calendar conflict
    - Block focus time

    Actions are context-aware and prioritized by urgency.
    """
    sync_service = SyncService(db)
    suggestion_service = SuggestionService(db)

    # Get connection status
    status = await sync_service.get_connection_status(current_user.id)
    gmail_connected = status["google"].get("gmail_connected", False)
    calendar_connected = status["google"].get("calendar_connected", False)

    # Get pre-filled actions
    actions = await suggestion_service.get_prefilled_actions(
        user_id=current_user.id,
        gmail_connected=gmail_connected,
        calendar_connected=calendar_connected,
    )

    return {
        "actions": actions,
        "count": len(actions),
        "gmail_connected": gmail_connected,
        "calendar_connected": calendar_connected,
    }


@router.get("/insights", response_model=ProactiveInsightsResponse)
async def get_proactive_insights(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get proactive insights for the chat UI.

    Returns structured data for:
    - Relationships needing attention
    - Upcoming important dates (birthdays, anniversaries)
    - Pending intentions/commitments
    - Promises to keep
    - Active pattern warnings
    - Emotional state trends

    This data is shown as special UI cards in the chat interface.

    OPTIMIZED: All 6 data sources loaded in PARALLEL (5-6x faster).
    """
    from app.services.relationship_intelligence_service import RelationshipIntelligenceService
    from app.services.intention_service import IntentionService
    from app.services.pattern_service import PatternService
    from app.services.emotion_service import EmotionService
    from app.models.memory import Memory
    from sqlalchemy import select, desc

    # Create all services upfront
    rel_service = RelationshipIntelligenceService(db)
    intention_service = IntentionService(db)
    pattern_service = PatternService(db)
    emotion_service = EmotionService(db)

    # Helper coroutines for parallel fetching
    async def fetch_neglected():
        try:
            return await rel_service.get_neglected_relationships(current_user.id, limit=3)
        except Exception:
            return []

    async def fetch_upcoming_dates():
        try:
            return await rel_service.get_upcoming_important_dates(current_user.id, days_ahead=7)
        except Exception:
            return []

    async def fetch_promises():
        try:
            return await rel_service.get_pending_promises(current_user.id)
        except Exception:
            return []

    async def fetch_intentions():
        try:
            await intention_service.update_intention_statuses(current_user.id)
            return await intention_service.get_active_intentions(
                current_user.id, include_due=True, include_overdue=True
            )
        except Exception:
            return []

    async def fetch_patterns():
        try:
            result = await db.execute(
                select(Memory)
                .where(
                    Memory.user_id == current_user.id,
                    Memory.memory_date >= datetime.utcnow() - timedelta(days=3)
                )
                .order_by(desc(Memory.memory_date))
                .limit(15)
            )
            recent_memories = list(result.scalars().all())
            if recent_memories:
                return await pattern_service.analyze_current_situation(
                    current_user.id, recent_memories
                )
            return []
        except Exception:
            return []

    async def fetch_emotions():
        try:
            return await emotion_service.get_emotional_summary(current_user.id, days=7)
        except Exception:
            return {}

    # OPTIMIZATION: Fetch ALL data in PARALLEL (5-6x faster than sequential)
    neglected, upcoming, promises, intentions, pattern_matches, emotion_summary = await asyncio.gather(
        fetch_neglected(),
        fetch_upcoming_dates(),
        fetch_promises(),
        fetch_intentions(),
        fetch_patterns(),
        fetch_emotions(),
    )

    # Now process results (this is fast, just building response objects)
    response = ProactiveInsightsResponse()
    total_attention = 0
    has_urgent = False

    # 1. Process neglected relationships
    for r in neglected:
        response.neglected_relationships.append(
            RelationshipInsight(
                entity_id=r["entity_id"],
                name=r["name"],
                days_since_contact=r["days_since_contact"],
                health_score=r["health_score"],
                tier=r["tier"],
                reason="neglected",
                suggested_action=f"Reach out to {r['name']}",
            )
        )
        total_attention += 1
        if r["days_since_contact"] > r.get("ideal_contact_days", 14) * 2:
            has_urgent = True

    # 2. Process upcoming important dates
    for d in upcoming[:3]:
        response.upcoming_dates.append(
            ImportantDateInsight(
                id=d["id"],
                person_name=d["person_name"],
                entity_id=d["entity_id"],
                date_type=d["date_type"],
                date_label=d["date_label"],
                date=d["date"],
                days_until=d["days_until"],
                years=d.get("years"),
                notes=d.get("notes"),
            )
        )
        if d["days_until"] <= 1:
            has_urgent = True
            total_attention += 1

    # 3. Process pending promises
    today = date.today()
    for p in promises[:3]:
        due_date = p.get("due_date")
        days_until = None
        is_overdue = False

        if due_date:
            if isinstance(due_date, str):
                due_date_obj = datetime.fromisoformat(due_date).date()
            else:
                due_date_obj = due_date
            days_until = (due_date_obj - today).days
            is_overdue = days_until < 0

        response.pending_promises.append(
            PromiseInsight(
                id=p["id"],
                person_name=p["person_name"],
                entity_id=p["entity_id"],
                description=p["description"],
                made_on=p["made_on"],
                due_date=p.get("due_date"),
                days_until_due=days_until,
                is_overdue=is_overdue,
                importance=p.get("importance", 0.5),
            )
        )
        if is_overdue:
            has_urgent = True
            total_attention += 1

    # 4. Process pending intentions
    for i in intentions[:3]:
        response.pending_intentions.append(
            IntentionInsight(
                id=str(i.id),
                description=i.description,
                target_person=i.target_person,
                due_date=i.due_date.isoformat() if i.due_date else None,
                days_overdue=abs(i.days_until_due) if i.is_overdue else None,
                is_overdue=i.is_overdue,
                priority_score=i.priority_score,
            )
        )
        if i.is_overdue:
            has_urgent = True
            total_attention += 1

    # 5. Process active pattern warnings
    for m in pattern_matches:
        if m.get("should_warn", False):
            response.pattern_warnings.append(
                PatternInsight(
                    id=m.get("pattern_id", ""),
                    name=m.get("pattern_name", "Unknown Pattern"),
                    description=m.get("description", ""),
                    trigger=m.get("trigger", ""),
                    consequence=m.get("consequence"),
                    valence="negative",
                    confidence=m.get("confidence", 0.5),
                    warning_message=m.get("warning_message"),
                    is_active=True,
                )
            )
            has_urgent = True
            total_attention += 1

    # 6. Process emotional state (optional - only if significant)
    if emotion_summary.get("total_analyzed", 0) >= 3:
        avg_valence = emotion_summary.get("avg_valence")
        trend = None
        if avg_valence is not None:
            if avg_valence > 0.3:
                trend = "positive"
            elif avg_valence < -0.3:
                trend = "declining"
            else:
                trend = "stable"

        response.emotional_state = EmotionalInsight(
            avg_valence=emotion_summary.get("avg_valence"),
            avg_arousal=emotion_summary.get("avg_arousal"),
            top_emotion=emotion_summary.get("top_emotion"),
            trend=trend,
            flashbulb_count=emotion_summary.get("flashbulb_memory_count", 0),
        )

    response.total_attention_needed = total_attention
    response.has_urgent = has_urgent

    return response


@router.get("/briefing")
async def get_daily_briefing(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get an actionable daily briefing for the user.

    Returns structured items that the user can take immediate action on.
    Each item includes a pre-filled chat prompt for one-tap actions.

    Items are prioritized by urgency:
    1. Overdue items (reminders, deadlines)
    2. Due today (meetings, tasks)
    3. Upcoming (tomorrow's events)
    4. Emails needing response
    5. Pattern-based insights

    The briefing is memory-driven - it learns from past interactions
    and surfaces what's most relevant to the user.
    """
    from app.services.briefing_service import BriefingService

    briefing_service = BriefingService(db)
    result = await briefing_service.get_actionable_briefing(current_user.id)

    return result
