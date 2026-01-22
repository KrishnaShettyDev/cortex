"""API endpoints for people intelligence."""

from uuid import UUID
from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

from app.api.deps import Database, CurrentUser
from app.services.people_service import PeopleService


router = APIRouter()


class PersonSummary(BaseModel):
    """Summary of a person in the list."""
    id: str
    name: str
    entity_type: str
    email: str | None
    mention_count: int
    first_seen: str | None
    last_seen: str | None


class ContactSuggestion(BaseModel):
    """Contact for autocomplete."""
    id: str
    name: str
    email: str | None
    mention_count: int


class ContactSearchResponse(BaseModel):
    """Response for contact search/autocomplete."""
    contacts: list[ContactSuggestion]


class PeopleListResponse(BaseModel):
    """Response for listing people."""
    people: list[PersonSummary]
    total: int


class MemoryBrief(BaseModel):
    """Brief memory reference."""
    id: str
    content: str
    memory_type: str
    memory_date: str | None


class PersonProfileResponse(BaseModel):
    """Full person profile response."""
    name: str
    entity_type: str
    email: str | None
    mention_count: int
    first_seen: str | None
    last_seen: str | None
    summary: str | None
    relationship_type: str | None
    topics: list[str]
    sentiment_trend: str | None
    last_interaction_date: str | None
    next_meeting_date: str | None
    recent_memories: list[MemoryBrief]


class PersonMemoriesResponse(BaseModel):
    """Response for person's memories."""
    memories: list[MemoryBrief]
    total: int


class MeetingContextResponse(BaseModel):
    """Meeting context response."""
    person_name: str
    context: str | None


@router.get("/search", response_model=ContactSearchResponse)
async def search_contacts(
    current_user: CurrentUser,
    db: Database,
    q: str = Query("", description="Search query for name or email"),
    limit: int = Query(10, ge=1, le=20),
):
    """
    Search for contacts by name or email for autocomplete.

    Returns contacts with email addresses, sorted by relevance.
    Use this for email composition to suggest recipients.
    """
    people_service = PeopleService(db)
    contacts = await people_service.search_contacts(
        user_id=current_user.id,
        query=q,
        limit=limit,
    )

    return ContactSearchResponse(
        contacts=[ContactSuggestion(**c) for c in contacts]
    )


@router.get("", response_model=PeopleListResponse)
async def list_people(
    current_user: CurrentUser,
    db: Database,
    sort_by: str = Query("recent", enum=["recent", "frequent", "alphabetical"]),
    limit: int = Query(50, ge=1, le=100),
):
    """
    List all people the user knows about.

    Sort options:
    - recent: Most recently mentioned first
    - frequent: Most frequently mentioned first
    - alphabetical: Alphabetically by name
    """
    people_service = PeopleService(db)
    people = await people_service.list_people(
        user_id=current_user.id,
        sort_by=sort_by,
        limit=limit,
    )

    return PeopleListResponse(
        people=[PersonSummary(**p) for p in people],
        total=len(people),
    )


@router.get("/{person_name}", response_model=PersonProfileResponse)
async def get_person_profile(
    person_name: str,
    current_user: CurrentUser,
    db: Database,
    regenerate: bool = Query(False, description="Force regenerate the profile"),
):
    """
    Get comprehensive profile for a person.

    The profile includes:
    - Basic stats (mention count, first/last seen)
    - AI-generated summary of the relationship
    - Common topics discussed
    - Sentiment trend
    - Recent memories
    """
    people_service = PeopleService(db)
    profile = await people_service.get_person_profile(
        user_id=current_user.id,
        person_name=person_name,
        regenerate=regenerate,
    )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Person '{person_name}' not found",
        )

    return PersonProfileResponse(**profile)


@router.get("/{person_name}/memories", response_model=PersonMemoriesResponse)
async def get_person_memories(
    person_name: str,
    current_user: CurrentUser,
    db: Database,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    Get all memories mentioning a person.
    """
    people_service = PeopleService(db)
    memories = await people_service.get_person_memories(
        user_id=current_user.id,
        person_name=person_name,
        limit=limit,
        offset=offset,
    )

    return PersonMemoriesResponse(
        memories=[
            MemoryBrief(
                id=str(m.id),
                content=m.content[:200],
                memory_type=m.memory_type,
                memory_date=m.memory_date.isoformat() if m.memory_date else None,
            )
            for m in memories
        ],
        total=len(memories),
    )


@router.get("/{person_name}/context", response_model=MeetingContextResponse)
async def get_meeting_context(
    person_name: str,
    current_user: CurrentUser,
    db: Database,
):
    """
    Get meeting preparation context for a person.

    Returns bullet points summarizing:
    - Key topics discussed recently
    - Pending items or follow-ups
    - Useful context for the meeting
    """
    people_service = PeopleService(db)

    # First verify person exists
    entity = await people_service.get_person_by_name(current_user.id, person_name)
    if not entity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Person '{person_name}' not found",
        )

    context = await people_service.generate_meeting_context(
        user_id=current_user.id,
        person_name=person_name,
    )

    return MeetingContextResponse(
        person_name=person_name,
        context=context,
    )
