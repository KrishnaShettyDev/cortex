from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class UserLocation(BaseModel):
    """User's current location."""
    latitude: float
    longitude: float


class CurrentContext(BaseModel):
    """
    Current context for context reinstatement (encoding specificity principle).

    Memories are more accessible when retrieval context matches encoding context.
    This context is captured from the frontend and used to boost relevant memories.
    """
    # Location context
    latitude: float | None = None
    longitude: float | None = None
    location_name: str | None = None        # "Home", "Office", "Starbucks"
    location_type: str | None = None        # "home", "work", "cafe", "gym", etc.

    # Time context
    time_of_day: str | None = None          # "morning", "afternoon", "evening", "night"
    day_of_week: str | None = None          # "monday", "tuesday", etc.
    is_weekend: bool | None = None

    # Environment context
    weather: str | None = None              # "sunny", "rainy", "cloudy"
    temperature: float | None = None        # In celsius

    # Activity context
    activity: str | None = None             # "working", "relaxing", "commuting"
    activity_category: str | None = None    # "work", "leisure", "travel"

    # Social context
    social_setting: str | None = None       # "alone", "with_friends", "at_meeting"

    # Device context
    device_type: str | None = None          # "mobile", "tablet", "desktop"


class ChatRequest(BaseModel):
    """Request to chat with memories."""

    message: str = Field(..., min_length=1, max_length=10000)
    conversation_id: str | None = None
    location: UserLocation | None = None  # User's current location for place searches
    context: CurrentContext | None = None  # Current context for context reinstatement


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


# ==================== PROACTIVE INSIGHTS ====================

class RelationshipInsight(BaseModel):
    """A relationship that needs attention."""
    entity_id: str
    name: str
    days_since_contact: int
    health_score: float
    tier: str
    reason: str  # "neglected", "tension", "overdue_promise"
    suggested_action: str | None = None


class IntentionInsight(BaseModel):
    """An intention/commitment the user made."""
    id: str
    description: str
    target_person: str | None = None
    due_date: str | None = None
    days_overdue: int | None = None
    is_overdue: bool = False
    priority_score: float = 0.5


class PatternInsight(BaseModel):
    """A behavioral pattern warning."""
    id: str
    name: str
    description: str
    trigger: str
    consequence: str | None = None
    valence: str  # "positive", "negative", "neutral"
    confidence: float
    warning_message: str | None = None
    is_active: bool = False  # Currently being triggered


class PromiseInsight(BaseModel):
    """A promise made to someone."""
    id: str
    person_name: str
    entity_id: str
    description: str
    made_on: str
    due_date: str | None = None
    days_until_due: int | None = None
    is_overdue: bool = False
    importance: float = 0.5


class ImportantDateInsight(BaseModel):
    """An upcoming important date (birthday, anniversary)."""
    id: str
    person_name: str
    entity_id: str
    date_type: str  # "birthday", "anniversary", "work_anniversary"
    date_label: str
    date: str
    days_until: int
    years: int | None = None  # Age or years married
    notes: str | None = None


class EmotionalInsight(BaseModel):
    """Emotional trend insight."""
    avg_valence: float | None = None  # -1 to 1
    avg_arousal: float | None = None
    top_emotion: str | None = None
    trend: str | None = None  # "improving", "stable", "declining"
    flashbulb_count: int = 0


class ProactiveInsightsResponse(BaseModel):
    """All proactive insights for the chat UI."""

    # Relationships needing attention
    neglected_relationships: list[RelationshipInsight] = []

    # Upcoming important dates
    upcoming_dates: list[ImportantDateInsight] = []

    # Pending commitments
    pending_intentions: list[IntentionInsight] = []

    # Promises to keep
    pending_promises: list[PromiseInsight] = []

    # Active pattern warnings
    pattern_warnings: list[PatternInsight] = []

    # Emotional state (optional)
    emotional_state: EmotionalInsight | None = None

    # Summary counts for badges
    total_attention_needed: int = 0
    has_urgent: bool = False
