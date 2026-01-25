"""
Benchmark API endpoints for MemoryBench integration.

Provides endpoints for:
- Creating benchmark test users
- Searching facts with hybrid retrieval
- Clearing user data
"""

from uuid import UUID, uuid4
from datetime import datetime
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.memory import Memory
from app.models.memory_fact import MemoryFact, EntityRelation
from app.services.search_service import SearchService
from app.services.hybrid_retrieval_service import HybridRetrievalService
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/benchmark", tags=["benchmark"])


# ============================================================================
# Schemas
# ============================================================================

class BenchmarkUserRequest(BaseModel):
    name: str = Field(default="MemoryBench Test User")


class BenchmarkUserResponse(BaseModel):
    user_id: str
    name: str
    created: bool


class FactSearchRequest(BaseModel):
    query: str
    limit: int = Field(default=20, ge=1, le=100)
    include_memories: bool = Field(default=True)


class FactSearchResult(BaseModel):
    id: str
    fact_text: str
    fact_type: str
    subject_entity: Optional[str] = None
    object_entity: Optional[str] = None
    relation: Optional[str] = None
    document_date: Optional[str] = None
    event_date: Optional[str] = None
    temporal_expression: Optional[str] = None
    confidence: float
    memory_id: Optional[str] = None


class MemorySearchResult(BaseModel):
    id: str
    content: str
    summary: Optional[str] = None
    memory_date: Optional[str] = None


class FactSearchResponse(BaseModel):
    facts: list[FactSearchResult]
    memories: list[MemorySearchResult]
    confidence: float
    query: str


class ClearDataResponse(BaseModel):
    success: bool
    memories_deleted: int
    facts_deleted: int
    relations_deleted: int


class MemoryCreateRequest(BaseModel):
    content: str
    memory_type: str = Field(default="conversation")
    memory_date: Optional[str] = None
    metadata: Optional[dict] = None


class MemoryCreateResponse(BaseModel):
    id: str
    content: str
    summary: Optional[str] = None
    memory_date: Optional[str] = None


# ============================================================================
# Helper to get user ID from header
# ============================================================================

async def get_benchmark_user_id(
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
) -> UUID:
    """Extract user ID from header for benchmark requests."""
    if not x_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-User-Id header required"
        )
    try:
        return UUID(x_user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID format"
        )


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/user", response_model=BenchmarkUserResponse)
async def create_benchmark_user(
    request: BenchmarkUserRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Create or get a benchmark test user.

    Returns an existing user if one exists with the benchmark name,
    otherwise creates a new one.
    """
    from sqlalchemy import select

    # Check for existing benchmark user
    result = await db.execute(
        select(User).where(User.name == request.name)
    )
    existing = result.scalar_one_or_none()

    if existing:
        return BenchmarkUserResponse(
            user_id=str(existing.id),
            name=existing.name,
            created=False,
        )

    # Create new benchmark user
    user_uuid = uuid4()
    user = User(
        id=user_uuid,
        oauth_id=f"benchmark-{user_uuid.hex[:16]}",  # Required field
        name=request.name,
        email=f"benchmark-{user_uuid.hex[:8]}@test.local",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    logger.info(f"Created benchmark user: {user.id}")

    return BenchmarkUserResponse(
        user_id=str(user.id),
        name=user.name,
        created=True,
    )


@router.post("/memories", response_model=MemoryCreateResponse)
async def create_benchmark_memory(
    request: MemoryCreateRequest,
    user_id: UUID = Depends(get_benchmark_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a memory for benchmark testing.

    Uses X-User-Id header for authentication instead of JWT.
    """
    from app.services.memory_service import MemoryService

    try:
        memory_service = MemoryService(db)

        # Parse memory date
        memory_date = None
        if request.memory_date:
            try:
                memory_date = datetime.fromisoformat(request.memory_date.replace("Z", "+00:00"))
            except ValueError:
                memory_date = datetime.utcnow()
        else:
            memory_date = datetime.utcnow()

        # Create the memory (simplified for benchmarking)
        memory = Memory(
            id=uuid4(),
            user_id=user_id,
            content=request.content,
            memory_type=request.memory_type,
            memory_date=memory_date,
        )
        db.add(memory)
        await db.commit()
        await db.refresh(memory)

        # Trigger background fact extraction
        try:
            from app.services.fact_extraction_service import FactExtractionService
            fact_service = FactExtractionService(db)
            await fact_service.extract_and_save(
                user_id=user_id,
                memory_id=memory.id,
                content=request.content,
                document_date=memory_date,
            )
        except Exception as e:
            logger.warning(f"Fact extraction failed (continuing): {e}")

        return MemoryCreateResponse(
            id=str(memory.id),
            content=memory.content[:200] if memory.content else "",
            summary=memory.summary,
            memory_date=memory.memory_date.isoformat() if memory.memory_date else None,
        )

    except Exception as e:
        logger.error(f"Memory creation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/search/facts", response_model=FactSearchResponse)
async def search_facts(
    request: FactSearchRequest,
    user_id: UUID = Depends(get_benchmark_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Search for facts using hybrid retrieval.

    Uses the MemoryBench-optimized retrieval system that combines:
    - Vector similarity search
    - Entity-based search
    - Temporal filtering
    """
    try:
        # Use hybrid retrieval service
        retrieval_service = HybridRetrievalService(db)

        facts, confidence = await retrieval_service.search(
            user_id=user_id,
            query=request.query,
            limit=request.limit,
        )

        fact_results = [
            FactSearchResult(
                id=str(fact.id),
                fact_text=fact.fact_text,
                fact_type=fact.fact_type,
                subject_entity=fact.subject_entity,
                object_entity=fact.object_entity,
                relation=fact.relation,
                document_date=fact.document_date.isoformat() if fact.document_date else None,
                event_date=fact.event_date.isoformat() if fact.event_date else None,
                temporal_expression=fact.temporal_expression,
                confidence=fact.confidence or 1.0,
                memory_id=str(fact.memory_id) if fact.memory_id else None,
            )
            for fact in facts
        ]

        memory_results = []
        if request.include_memories:
            # Get unique memory IDs from facts
            memory_ids = list(set(
                str(f.memory_id) for f in facts if f.memory_id
            ))

            if memory_ids:
                from sqlalchemy import select
                result = await db.execute(
                    select(Memory).where(
                        Memory.id.in_([UUID(mid) for mid in memory_ids])
                    )
                )
                memories = result.scalars().all()

                memory_results = [
                    MemorySearchResult(
                        id=str(m.id),
                        content=m.content[:500] if m.content else "",
                        summary=m.summary,
                        memory_date=m.memory_date.isoformat() if m.memory_date else None,
                    )
                    for m in memories
                ]

        return FactSearchResponse(
            facts=fact_results,
            memories=memory_results,
            confidence=confidence,
            query=request.query,
        )

    except Exception as e:
        logger.error(f"Fact search error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.delete("/clear", response_model=ClearDataResponse)
async def clear_user_data(
    user_id: UUID = Depends(get_benchmark_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Clear all memories, facts, and relations for a user.

    Used to reset state between benchmark runs.
    """
    try:
        # Delete entity relations first (foreign key to facts)
        relations_result = await db.execute(
            delete(EntityRelation).where(EntityRelation.user_id == user_id)
        )
        relations_deleted = relations_result.rowcount

        # Delete facts
        facts_result = await db.execute(
            delete(MemoryFact).where(MemoryFact.user_id == user_id)
        )
        facts_deleted = facts_result.rowcount

        # Delete memories
        memories_result = await db.execute(
            delete(Memory).where(Memory.user_id == user_id)
        )
        memories_deleted = memories_result.rowcount

        await db.commit()

        logger.info(
            f"Cleared data for user {user_id}: "
            f"{memories_deleted} memories, {facts_deleted} facts, {relations_deleted} relations"
        )

        return ClearDataResponse(
            success=True,
            memories_deleted=memories_deleted,
            facts_deleted=facts_deleted,
            relations_deleted=relations_deleted,
        )

    except Exception as e:
        logger.error(f"Clear data error: {e}")
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
