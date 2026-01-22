from uuid import UUID
from datetime import datetime, date
from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

from app.api.deps import Database, CurrentUser
from app.services.memory_service import MemoryService
from app.services.search_service import SearchService
from app.schemas.memory import (
    MemoryCreate,
    MemoryResponse,
    MemoryCreateResponse,
    MemoryListResponse,
    MemorySearchResponse,
)


class ContextualSearchResponse(BaseModel):
    """Response for contextual search."""
    memories: list[MemoryResponse]
    parsed_query: dict
    query_understood: str


class DecisionBrief(BaseModel):
    """Brief memory reference for decisions."""
    id: str
    content: str
    memory_type: str
    memory_date: str | None


class DecisionResult(BaseModel):
    """Decision search result."""
    id: str
    topic: str
    decision_text: str
    context: str | None
    decision_date: str | None
    memory: DecisionBrief


class DecisionSearchResponse(BaseModel):
    """Response for decision search."""
    decisions: list[DecisionResult]
    total: int

router = APIRouter()


@router.post("", response_model=MemoryCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_memory(
    request: MemoryCreate,
    current_user: CurrentUser,
    db: Database,
):
    """
    Create a new memory.

    The memory content will be embedded for semantic search,
    and entities will be automatically extracted.
    """
    memory_service = MemoryService(db)

    # Default memory_date to now if not provided
    memory_date = request.memory_date or datetime.utcnow()

    memory, entities = await memory_service.create_memory(
        user_id=current_user.id,
        content=request.content,
        memory_type=request.memory_type,
        memory_date=memory_date,
        audio_url=request.audio_url,
        photo_url=request.photo_url,
    )

    return MemoryCreateResponse(
        memory_id=memory.id,
        entities_extracted=entities,
    )


@router.get("", response_model=MemoryListResponse)
async def list_memories(
    current_user: CurrentUser,
    db: Database,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    type: str | None = Query(None, alias="type"),
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
):
    """
    List memories with pagination and filtering.

    Supports filtering by type (voice, text, photo, email, calendar)
    and date range.
    """
    memory_service = MemoryService(db)

    memories, total = await memory_service.list_memories(
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        memory_type=type,
        from_date=from_date,
        to_date=to_date,
    )

    return MemoryListResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                content=m.content,
                summary=m.summary,
                memory_type=m.memory_type,
                source_id=m.source_id,
                source_url=m.source_url,
                audio_url=m.audio_url,
                photo_url=m.photo_url,
                memory_date=m.memory_date,
                created_at=m.created_at,
                entities=[e.name for e in m.entities],
            )
            for m in memories
        ],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/search", response_model=MemorySearchResponse)
async def search_memories(
    current_user: CurrentUser,
    db: Database,
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(10, ge=1, le=50),
    type: str | None = Query(None),
):
    """
    Search memories using hybrid search (vector + text).

    Returns memories ranked by relevance combining semantic
    similarity and keyword matching.
    """
    search_service = SearchService(db)

    memories = await search_service.search(
        user_id=current_user.id,
        query=q,
        limit=limit,
        memory_type=type,
    )

    return MemorySearchResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                content=m.content,
                summary=m.summary,
                memory_type=m.memory_type,
                source_id=m.source_id,
                source_url=m.source_url,
                audio_url=m.audio_url,
                photo_url=m.photo_url,
                memory_date=m.memory_date,
                created_at=m.created_at,
                entities=[e.name for e in m.entities],
            )
            for m in memories
        ],
        query_understood=q,
    )


@router.get("/search/contextual", response_model=ContextualSearchResponse)
async def contextual_search(
    current_user: CurrentUser,
    db: Database,
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(10, ge=1, le=50),
):
    """
    Smart contextual search with natural language understanding.

    Understands queries like:
    - "what did I decide about the budget last month"
    - "meetings with Sarah last week"
    - "what was I worried about in December"

    Automatically parses time references and search intent.
    """
    search_service = SearchService(db)

    # Parse the query for time references and intent
    parsed = await search_service.parse_query_intent(q)

    # Convert time strings to date objects
    time_start = None
    time_end = None
    if parsed.get("time_start"):
        try:
            time_start = date.fromisoformat(parsed["time_start"])
        except ValueError:
            pass
    if parsed.get("time_end"):
        try:
            time_end = date.fromisoformat(parsed["time_end"])
        except ValueError:
            pass

    # Perform contextual search
    memories = await search_service.contextual_search(
        user_id=current_user.id,
        query=parsed.get("cleaned_query", q),
        time_start=time_start,
        time_end=time_end,
        intent=parsed.get("intent"),
        limit=limit,
    )

    return ContextualSearchResponse(
        memories=[
            MemoryResponse(
                id=m.id,
                content=m.content,
                summary=m.summary,
                memory_type=m.memory_type,
                source_id=m.source_id,
                source_url=m.source_url,
                audio_url=m.audio_url,
                photo_url=m.photo_url,
                memory_date=m.memory_date,
                created_at=m.created_at,
                entities=[e.name for e in m.entities],
            )
            for m in memories
        ],
        parsed_query=parsed,
        query_understood=q,
    )


@router.get("/search/decisions", response_model=DecisionSearchResponse)
async def search_decisions(
    current_user: CurrentUser,
    db: Database,
    q: str = Query(..., min_length=1, max_length=500),
    topic: str | None = Query(None),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    limit: int = Query(10, ge=1, le=50),
):
    """
    Search for decisions extracted from memories.

    Supports filtering by topic and date range.
    Returns decisions with their source memory context.
    """
    search_service = SearchService(db)

    decisions = await search_service.search_decisions(
        user_id=current_user.id,
        query=q,
        topic=topic,
        time_start=from_date,
        time_end=to_date,
        limit=limit,
    )

    return DecisionSearchResponse(
        decisions=[
            DecisionResult(
                id=d["id"],
                topic=d["topic"],
                decision_text=d["decision_text"],
                context=d["context"],
                decision_date=d["decision_date"],
                memory=DecisionBrief(
                    id=d["memory"]["id"],
                    content=d["memory"]["content"],
                    memory_type=d["memory"]["memory_type"],
                    memory_date=d["memory"]["memory_date"],
                ),
            )
            for d in decisions
        ],
        total=len(decisions),
    )


@router.get("/{memory_id}", response_model=MemoryResponse)
async def get_memory(
    memory_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """
    Get a single memory by ID.
    """
    memory_service = MemoryService(db)

    memory = await memory_service.get_memory(memory_id, current_user.id)
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Memory not found",
        )

    return MemoryResponse(
        id=memory.id,
        content=memory.content,
        summary=memory.summary,
        memory_type=memory.memory_type,
        source_id=memory.source_id,
        source_url=memory.source_url,
        audio_url=memory.audio_url,
        photo_url=memory.photo_url,
        memory_date=memory.memory_date,
        created_at=memory.created_at,
        entities=[e.name for e in memory.entities],
    )


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """
    Delete a memory.
    """
    memory_service = MemoryService(db)

    deleted = await memory_service.delete_memory(memory_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Memory not found",
        )

    return {"success": True}
