from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Literal


MemoryType = Literal["voice", "text", "photo", "email", "calendar"]


class MemoryCreate(BaseModel):
    """Request to create a new memory."""

    content: str = Field(..., min_length=1, max_length=50000)
    memory_type: MemoryType = "text"
    memory_date: datetime | None = None  # Defaults to now if not provided
    audio_url: str | None = None
    photo_url: str | None = None


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
