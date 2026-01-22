from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class UserLocation(BaseModel):
    """User's current location."""
    latitude: float
    longitude: float


class ChatRequest(BaseModel):
    """Request to chat with memories."""

    message: str = Field(..., min_length=1, max_length=10000)
    conversation_id: str | None = None
    location: UserLocation | None = None  # User's current location for place searches


class MemoryReference(BaseModel):
    """A memory referenced in chat response."""

    id: UUID
    content: str
    memory_type: str
    memory_date: datetime
    photo_url: str | None = None
    audio_url: str | None = None

    class Config:
        from_attributes = True


class ActionTaken(BaseModel):
    """An action taken during the chat (calendar event, email, etc.)."""

    tool: str
    arguments: dict
    result: dict


class PendingAction(BaseModel):
    """An action that needs user confirmation before execution."""

    action_id: str  # Unique ID for this pending action
    tool: str  # 'send_email', 'create_calendar_event', etc.
    arguments: dict  # The action parameters


class ChatResponse(BaseModel):
    """Chat response with referenced memories."""

    response: str
    memories_used: list[MemoryReference]
    conversation_id: str
    actions_taken: list[ActionTaken] = []
    pending_actions: list[PendingAction] = []  # Actions requiring user confirmation


class ExecuteActionRequest(BaseModel):
    """Request to execute a pending action."""

    action_id: str
    tool: str
    arguments: dict
    # Optional: Allow user to modify arguments before execution
    modified_arguments: dict | None = None


class ExecuteActionResponse(BaseModel):
    """Response after executing an action."""

    success: bool
    message: str
    result: dict | None = None


class StreamChunk(BaseModel):
    """A chunk of streamed chat response."""

    type: str  # 'content', 'memories', 'done', 'error'
    content: str | None = None
    memories: list[MemoryReference] | None = None
    conversation_id: str | None = None
    error: str | None = None


class SmartSuggestion(BaseModel):
    """A smart suggestion based on user's connected apps via Composio."""

    text: str  # The suggestion text to display
    # Service types for connected apps:
    # Google: gmail, calendar, drive, docs, sheets, slides
    # Microsoft: outlook, teams
    # Collaboration: slack, notion, linear, jira, asana, trello, github
    # Communication: discord, telegram, whatsapp
    # Other: spotify, note, none
    # Combined services use hyphen: 'gmail-calendar', 'slack-notion'
    services: str
    context: str | None = None  # Additional context (e.g., sender name, event title)
    source_id: str | None = None  # ID of the email/event this relates to


class SmartSuggestionsResponse(BaseModel):
    """Response containing smart suggestions."""

    suggestions: list[SmartSuggestion]
    gmail_connected: bool = False
    calendar_connected: bool = False
    # Additional connected apps can be added here as the backend supports more Composio integrations
    connected_apps: list[str] = []  # List of connected app names (e.g., ['gmail', 'calendar', 'slack'])


class GreetingResponse(BaseModel):
    """Dynamic contextual greeting response."""

    greeting: str  # The personalized greeting text
    has_context: bool = False  # Whether the greeting includes contextual info
