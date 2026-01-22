import json
from datetime import datetime, timedelta
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.deps import Database, CurrentUser
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
)

router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat_with_memories(
    request: ChatRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Chat with your memories (non-streaming).

    Searches relevant memories and uses them as context
    to answer your question. Actions (emails, calendar events)
    are returned as pending_actions for user confirmation.
    """
    search_service = SearchService(db)
    chat_service = ChatService(search_service, db=db)

    response_text, memories_used, conversation_id, actions_taken, pending_actions = await chat_service.chat(
        user_id=str(current_user.id),
        message=request.message,
        conversation_id=request.conversation_id,
        auto_execute=False,  # Return pending actions instead of auto-executing
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
async def execute_action(
    request: ExecuteActionRequest,
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
    arguments = request.modified_arguments or request.arguments

    try:
        result = await chat_service._execute_tool(
            user_id=str(current_user.id),
            tool_name=request.tool,
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
async def chat_stream(
    request: ChatRequest,
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
    """
    search_service = SearchService(db)
    chat_service = ChatService(search_service, db=db)

    async def generate():
        async for chunk in chat_service.chat_stream(
            user_id=str(current_user.id),
            message=request.message,
            conversation_id=request.conversation_id,
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
