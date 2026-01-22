from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class IntegrationStatus(BaseModel):
    """Status of a single integration."""

    connected: bool
    email: str | None = None
    last_sync: datetime | None = None
    status: str = "not_connected"  # 'active', 'expired', 'not_connected'
    gmail_connected: bool = False
    calendar_connected: bool = False


class IntegrationsStatusResponse(BaseModel):
    """Status of all integrations."""

    google: IntegrationStatus
    microsoft: IntegrationStatus


class OAuthRedirectResponse(BaseModel):
    """OAuth redirect URL response."""

    redirect_url: str


class SyncRequest(BaseModel):
    """Request to sync a specific provider."""

    provider: str  # 'google' or 'microsoft'


class SyncResponse(BaseModel):
    """Response after syncing."""

    memories_added: int
    errors: list[str] = []


# Calendar Action Schemas
class CalendarEventAttendee(BaseModel):
    """Attendee for a calendar event."""

    email: str
    name: Optional[str] = None
    optional: bool = False


class CreateCalendarEventRequest(BaseModel):
    """Request to create a calendar event."""

    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    location: Optional[str] = None
    attendees: list[CalendarEventAttendee] = []
    send_notifications: bool = True


class UpdateCalendarEventRequest(BaseModel):
    """Request to update/reschedule a calendar event."""

    title: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    attendees: Optional[list[CalendarEventAttendee]] = None
    send_notifications: bool = True


class CalendarEventResponse(BaseModel):
    """Response after calendar event action."""

    success: bool
    event_id: str
    event_url: Optional[str] = None
    message: str


# Email Action Schemas
class EmailRecipient(BaseModel):
    """Email recipient."""

    email: str
    name: Optional[str] = None


class SendEmailRequest(BaseModel):
    """Request to send an email."""

    to: list[EmailRecipient]
    cc: list[EmailRecipient] = []
    bcc: list[EmailRecipient] = []
    subject: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    is_html: bool = False
    reply_to_message_id: Optional[str] = None  # For replies


class DraftEmailRequest(BaseModel):
    """Request to generate an email draft."""

    context: str  # What the email should be about
    tone: str = "professional"  # professional, casual, friendly, formal
    recipient_name: Optional[str] = None
    recipient_context: Optional[str] = None  # e.g., "my manager", "a client"


class EmailResponse(BaseModel):
    """Response after email action."""

    success: bool
    message_id: Optional[str] = None
    thread_id: Optional[str] = None
    message: str


class DraftEmailResponse(BaseModel):
    """Response with generated email draft."""

    subject: str
    body: str
    suggestions: list[str] = []  # Alternative phrasings or tips


# Calendar Events List Schemas
class CalendarEventItem(BaseModel):
    """A single calendar event for display."""

    id: str
    title: str
    start_time: datetime
    end_time: datetime
    is_all_day: bool = False
    location: Optional[str] = None
    description: Optional[str] = None
    attendees: list[str] = []
    color: Optional[str] = None
    html_link: Optional[str] = None


class CalendarEventsResponse(BaseModel):
    """Response containing list of calendar events."""

    success: bool
    events: list[CalendarEventItem] = []
    message: Optional[str] = None
