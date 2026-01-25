from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Literal, Optional


MemoryType = Literal["voice", "text", "photo", "email", "calendar"]


class ContextData(BaseModel):
    """Context data captured at memory creation time."""
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    location_name: Optional[str] = Field(None, max_length=255)
    location_type: Optional[str] = Field(None, max_length=50)
    local_time: Optional[str] = Field(None, description="HH:MM format")
    time_of_day: Optional[str] = Field(None, pattern="^(morning|afternoon|evening|night)$")
    day_of_week: Optional[str] = Field(None, max_length=10)
    is_weekend: Optional[bool] = None
    weather: Optional[str] = Field(None, max_length=50)
    temperature: Optional[float] = Field(None, ge=-100, le=60)
    activity: Optional[str] = Field(None, max_length=100)
    activity_category: Optional[str] = Field(None, max_length=50)
    people_present: Optional[list[str]] = Field(default_factory=list)
    social_setting: Optional[str] = Field(None, pattern="^(alone|one_on_one|small_group|large_group|colleagues|family|friends)$")
    device_type: Optional[str] = Field(None, max_length=50)
    app_source: Optional[str] = Field(None, max_length=50)


class MemoryCreate(BaseModel):
    """Request to create a new memory."""

    content: str = Field(..., min_length=1, max_length=50000)
    memory_type: MemoryType = "text"
    memory_date: datetime | None = None  # Defaults to now if not provided
    audio_url: str | None = None
    photo_url: str | None = None
    context: ContextData | None = None  # Optional context captured at creation time


class MemoryResponse(BaseModel):
    """Single memory response."""

    id: UUID
    content: str
    summary: str | None
    memory_type: MemoryType
    source_id: str | None
    source_url: str | None
    audio_url: str | None
    photo_url: str | None
    memory_date: datetime
    created_at: datetime
    entities: list[str] = []  # List of entity names

    class Config:
        from_attributes = True


class MemoryCreateResponse(BaseModel):
    """Response after creating a memory."""

    memory_id: UUID
    entities_extracted: list[str]


class MemoryListResponse(BaseModel):
    """Paginated list of memories."""

    memories: list[MemoryResponse]
    total: int
    offset: int
    limit: int


class MemorySearchResponse(BaseModel):
    """Search results with relevance scores."""

    memories: list[MemoryResponse]
    query_understood: str


class EntityResponse(BaseModel):
    """Entity information."""

    id: UUID
    name: str
    entity_type: str
    mention_count: int
    first_seen: datetime
    last_seen: datetime

    class Config:
        from_attributes = True
