from uuid import UUID
from datetime import datetime, date
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func, and_
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory
from app.models.connection import Decision
from app.services.embedding_service import embedding_service

settings = get_settings()
logger = logging.getLogger(__name__)


class SearchService:
    """Service for hybrid search combining vector similarity and full-text search with adaptive scoring."""

    # Adaptive scoring weights
    VECTOR_WEIGHT = 0.5  # Base similarity score
    STRENGTH_WEIGHT = 0.2  # Memory strength (learned importance)
    RECENCY_WEIGHT = 0.15  # How recently accessed
    EMOTIONAL_WEIGHT = 0.15  # Emotional importance

    QUERY_PARSING_PROMPT = """Parse this search query and extract:
1. time_reference: Convert any time references to date ranges
2. intent: Classify what the user is looking for

Query: "{query}"

Return JSON:
{{
    "time_start": "YYYY-MM-DD or null",
    "time_end": "YYYY-MM-DD or null",
    "intent": "decision|worry|plan|meeting|person|general",
    "cleaned_query": "the query with time references removed"
}}

Examples:
- "what did I decide about budget last month" → {{"time_start": "2025-12-01", "time_end": "2025-12-31", "intent": "decision", "cleaned_query": "budget"}}
- "meetings with sarah last week" → {{"time_start": "2026-01-13", "time_end": "2026-01-19", "intent": "meeting", "cleaned_query": "meetings with sarah"}}
- "what was I worried about in december" → {{"time_start": "2025-12-01", "time_end": "2025-12-31", "intent": "worry", "cleaned_query": "worried"}}

Today is {today}. Return valid JSON only."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    def _embedding_to_pg_vector(self, embedding: list[float]) -> str:
        """Convert embedding list to PostgreSQL vector string format."""
        return "[" + ",".join(str(x) for x in embedding) + "]"

    async def search_fast(
        self,
        user_id: UUID,
        query: str,
        limit: int = 5,
    ) -> list[Memory]:
        """
        Fast search optimized for chat - skips entity loading and uses simpler logic.
        For simple greetings, returns recent memories. Otherwise uses text search first.
        """
        # Simple greetings - just return recent memories, no embedding needed
        simple_queries = {'hi', 'hey', 'hello', 'good morning', 'good afternoon', 'good evening', 'whats up', "what's up"}
        if query.lower().strip().rstrip('!?.') in simple_queries:
            result = await self.db.execute(
                select(Memory)
                .where(Memory.user_id == user_id)
                .order_by(Memory.memory_date.desc())
                .limit(limit)
            )
            return list(result.scalars().all())

        # Try text search first (no embedding needed, very fast)
        ts_query = func.plainto_tsquery("english", query)
        text_result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.search_vector.op("@@")(ts_query))
            .order_by(func.ts_rank(Memory.search_vector, ts_query).desc())
            .limit(limit)
        )
        text_memories = list(text_result.scalars().all())

        # If text search found enough results, use those
        if len(text_memories) >= 3:
            return text_memories

        # Fall back to vector search only if text search didn't find much
        query_embedding = await embedding_service.embed(query)
        embedding_str = self._embedding_to_pg_vector(query_embedding)

        raw_conn = await self.db.connection()
        result = await raw_conn.exec_driver_sql(
            """
            SELECT id FROM cortex_memories
            WHERE user_id = $1::uuid AND embedding IS NOT NULL
            ORDER BY embedding <=> $2::vector
            LIMIT $3
            """,
            (str(user_id), embedding_str, limit)
        )
        memory_ids = [row[0] for row in result.fetchall()]

        if not memory_ids:
            return text_memories  # Return whatever text search found

        # Fetch memories WITHOUT entities (much faster)
        memories_result = await self.db.execute(
            select(Memory).where(Memory.id.in_(memory_ids))
        )
        vector_memories = list(memories_result.scalars().all())

        # Combine and deduplicate
        seen = set()
        combined = []
        for m in text_memories + vector_memories:
            if m.id not in seen:
                seen.add(m.id)
                combined.append(m)
        return combined[:limit]

    async def search(
        self,
        user_id: UUID,
        query: str,
        limit: int = 10,
        memory_type: str | None = None,
    ) -> list[Memory]:
        """
        Perform hybrid search combining vector similarity and full-text search.

        Uses Reciprocal Rank Fusion (RRF) to combine results:
        combined_score = 0.7 * vector_score + 0.3 * text_score

        Args:
            user_id: The user's ID
            query: Search query
            limit: Maximum number of results
            memory_type: Optional filter by memory type

        Returns:
            List of Memory objects ranked by relevance
        """
        # Generate query embedding
        query_embedding = await embedding_service.embed(query)

        # Convert embedding to PostgreSQL vector string format
        embedding_str = self._embedding_to_pg_vector(query_embedding)
        search_limit = limit

        # Build the hybrid search query using positional parameters for asyncpg
        if memory_type:
            vector_search = """
            WITH vector_results AS (
                SELECT
                    id,
                    1 - (embedding <=> $1::vector) as vector_score,
                    ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) as vector_rank
                FROM cortex_memories
                WHERE user_id = $2::uuid
                AND embedding IS NOT NULL
                AND memory_type = $5
                ORDER BY embedding <=> $1::vector
                LIMIT $4
            ),
            text_results AS (
                SELECT
                    id,
                    ts_rank(search_vector, plainto_tsquery('english', $3)) as text_score,
                    ROW_NUMBER() OVER (
                        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $3)) DESC
                    ) as text_rank
                FROM cortex_memories
                WHERE user_id = $2::uuid
                AND search_vector @@ plainto_tsquery('english', $3)
                AND memory_type = $5
                LIMIT $4
            ),
            combined AS (
                SELECT
                    COALESCE(v.id, t.id) as id,
                    COALESCE(v.vector_score, 0) as vector_score,
                    COALESCE(t.text_score, 0) as text_score,
                    COALESCE(1.0 / (60 + v.vector_rank), 0) +
                    COALESCE(1.0 / (60 + t.text_rank), 0) as rrf_score
                FROM vector_results v
                FULL OUTER JOIN text_results t ON v.id = t.id
            )
            SELECT id
            FROM combined
            ORDER BY rrf_score DESC
            LIMIT $4
            """
        else:
            vector_search = """
            WITH vector_results AS (
                SELECT
                    id,
                    1 - (embedding <=> $1::vector) as vector_score,
                    ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) as vector_rank
                FROM cortex_memories
                WHERE user_id = $2::uuid
                AND embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector
                LIMIT $4
            ),
            text_results AS (
                SELECT
                    id,
                    ts_rank(search_vector, plainto_tsquery('english', $3)) as text_score,
                    ROW_NUMBER() OVER (
                        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $3)) DESC
                    ) as text_rank
                FROM cortex_memories
                WHERE user_id = $2::uuid
                AND search_vector @@ plainto_tsquery('english', $3)
                LIMIT $4
            ),
            combined AS (
                SELECT
                    COALESCE(v.id, t.id) as id,
                    COALESCE(v.vector_score, 0) as vector_score,
                    COALESCE(t.text_score, 0) as text_score,
                    COALESCE(1.0 / (60 + v.vector_rank), 0) +
                    COALESCE(1.0 / (60 + t.text_rank), 0) as rrf_score
                FROM vector_results v
                FULL OUTER JOIN text_results t ON v.id = t.id
            )
            SELECT id
            FROM combined
            ORDER BY rrf_score DESC
            LIMIT $4
            """

        # Get raw connection for asyncpg positional parameters
        raw_conn = await self.db.connection()

        if memory_type:
            result = await raw_conn.exec_driver_sql(
                vector_search,
                (embedding_str, str(user_id), query, search_limit, memory_type)
            )
        else:
            result = await raw_conn.exec_driver_sql(
                vector_search,
                (embedding_str, str(user_id), query, search_limit)
            )

        memory_ids = [row[0] for row in result.fetchall()]

        if not memory_ids:
            return []

        # Fetch full memory objects with entities
        memories_result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.id.in_(memory_ids))
        )
        memories = memories_result.scalars().all()

        # Preserve the ranking order
        memory_map = {m.id: m for m in memories}
        return [memory_map[mid] for mid in memory_ids if mid in memory_map]

    async def adaptive_search(
        self,
        user_id: UUID,
        query: str,
        limit: int = 10,
        memory_type: str | None = None,
    ) -> list[tuple[Memory, float]]:
        """
        Perform adaptive search that combines similarity with learned memory importance.

        Scoring formula:
        final_score = VECTOR_WEIGHT * similarity +
                      STRENGTH_WEIGHT * memory.strength +
                      RECENCY_WEIGHT * recency_score +
                      EMOTIONAL_WEIGHT * memory.emotional_weight

        Args:
            user_id: The user's ID
            query: Search query
            limit: Maximum number of results
            memory_type: Optional filter by memory type

        Returns:
            List of (Memory, score) tuples ranked by adaptive score
        """
        # Generate query embedding
        query_embedding = await embedding_service.embed(query)

        # Build base query - get more results than needed for re-ranking
        base_query = (
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.embedding.isnot(None))
        )

        if memory_type:
            base_query = base_query.where(Memory.memory_type == memory_type)

        # Get top candidates by vector similarity (fetch more for re-ranking)
        base_query = base_query.order_by(
            Memory.embedding.cosine_distance(query_embedding)
        ).limit(limit * 3)

        result = await self.db.execute(base_query)
        candidates = list(result.scalars().all())

        if not candidates:
            return []

        # Calculate adaptive scores
        now = datetime.utcnow()
        scored_memories = []

        for memory in candidates:
            # Vector similarity (convert distance to similarity)
            # Note: cosine_distance returns distance, we need similarity
            # We'll estimate similarity based on position
            vector_similarity = 1.0 - (candidates.index(memory) / len(candidates)) * 0.5

            # Recency score (0-1, higher for recently accessed)
            if memory.last_accessed:
                days_since_access = (now - memory.last_accessed).days
                recency_score = max(0, 1 - (days_since_access / 30))  # Full score within 30 days
            else:
                recency_score = 0.3  # Default for never-accessed

            # Calculate final adaptive score
            adaptive_score = (
                self.VECTOR_WEIGHT * vector_similarity +
                self.STRENGTH_WEIGHT * memory.strength +
                self.RECENCY_WEIGHT * recency_score +
                self.EMOTIONAL_WEIGHT * memory.emotional_weight
            )

            scored_memories.append((memory, adaptive_score))

        # Sort by adaptive score and return top results
        scored_memories.sort(key=lambda x: x[1], reverse=True)
        return scored_memories[:limit]

    def _calculate_recency_score(self, last_accessed: datetime | None, created_at: datetime) -> float:
        """Calculate recency score (0-1) based on last access or creation time."""
        now = datetime.utcnow()
        reference_time = last_accessed or created_at
        days_ago = (now - reference_time).days

        if days_ago <= 1:
            return 1.0
        elif days_ago <= 7:
            return 0.8
        elif days_ago <= 30:
            return 0.6
        elif days_ago <= 90:
            return 0.4
        else:
            return 0.2

    async def vector_search(
        self,
        user_id: UUID,
        query_embedding: list[float],
        limit: int = 10,
    ) -> list[Memory]:
        """
        Perform pure vector similarity search.

        Args:
            user_id: The user's ID
            query_embedding: Pre-computed query embedding
            limit: Maximum number of results

        Returns:
            List of Memory objects ranked by vector similarity
        """
        # Use pgvector's cosine distance operator
        result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.embedding.isnot(None))
            .order_by(Memory.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def text_search(
        self,
        user_id: UUID,
        query: str,
        limit: int = 10,
    ) -> list[Memory]:
        """
        Perform pure full-text search.

        Args:
            user_id: The user's ID
            query: Search query
            limit: Maximum number of results

        Returns:
            List of Memory objects ranked by text relevance
        """
        ts_query = func.plainto_tsquery("english", query)

        result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.search_vector.op("@@")(ts_query))
            .order_by(func.ts_rank(Memory.search_vector, ts_query).desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def parse_query_intent(self, query: str) -> dict:
        """
        Parse a natural language query to extract time references and intent.
        Uses LLM to understand queries like "what did I decide last month".
        """
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.QUERY_PARSING_PROMPT.format(
                            query=query,
                            today=date.today().isoformat(),
                        ),
                    }
                ],
                temperature=0.1,
                max_tokens=200,
                response_format={"type": "json_object"},
            )

            import json
            result = json.loads(response.choices[0].message.content)
            return {
                "time_start": result.get("time_start"),
                "time_end": result.get("time_end"),
                "intent": result.get("intent", "general"),
                "cleaned_query": result.get("cleaned_query", query),
            }
        except Exception as e:
            logger.error(f"Error parsing query intent: {e}")
            return {
                "time_start": None,
                "time_end": None,
                "intent": "general",
                "cleaned_query": query,
            }

    async def contextual_search(
        self,
        user_id: UUID,
        query: str,
        time_start: date | None = None,
        time_end: date | None = None,
        intent: str | None = None,
        limit: int = 10,
    ) -> list[Memory]:
        """
        Perform contextual search with time filtering and intent awareness.

        Args:
            user_id: The user's ID
            query: Search query
            time_start: Optional start date filter
            time_end: Optional end date filter
            intent: Optional intent filter (decision, worry, plan, etc.)
            limit: Maximum number of results

        Returns:
            List of Memory objects ranked by relevance
        """
        # Generate query embedding
        query_embedding = await embedding_service.embed(query)

        # Build base query
        base_query = (
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.embedding.isnot(None))
        )

        # Apply time filters
        if time_start:
            base_query = base_query.where(Memory.memory_date >= datetime.combine(time_start, datetime.min.time()))
        if time_end:
            base_query = base_query.where(Memory.memory_date <= datetime.combine(time_end, datetime.max.time()))

        # Apply intent-based type filter
        if intent:
            intent_type_map = {
                "meeting": "meeting",
                "decision": None,  # Handled separately via Decision table
                "worry": "reflection",
                "plan": "note",
            }
            if intent in intent_type_map and intent_type_map[intent]:
                base_query = base_query.where(Memory.memory_type == intent_type_map[intent])

        # Order by vector similarity
        base_query = base_query.order_by(
            Memory.embedding.cosine_distance(query_embedding)
        ).limit(limit)

        result = await self.db.execute(base_query)
        return list(result.scalars().all())

    async def search_decisions(
        self,
        user_id: UUID,
        query: str,
        topic: str | None = None,
        time_start: date | None = None,
        time_end: date | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """
        Search for decisions with optional filters.

        Returns decisions with their source memory context.
        """
        # Generate query embedding
        query_embedding = await embedding_service.embed(query)

        # Build query
        base_query = (
            select(Decision, Memory)
            .join(Memory, Decision.memory_id == Memory.id)
            .where(Decision.user_id == user_id)
            .where(Decision.embedding.isnot(None))
        )

        if topic:
            base_query = base_query.where(
                func.lower(Decision.topic).contains(func.lower(topic))
            )

        if time_start:
            base_query = base_query.where(Decision.decision_date >= time_start)
        if time_end:
            base_query = base_query.where(Decision.decision_date <= time_end)

        # Order by vector similarity
        base_query = base_query.order_by(
            Decision.embedding.cosine_distance(query_embedding)
        ).limit(limit)

        result = await self.db.execute(base_query)
        rows = result.all()

        return [
            {
                "id": str(decision.id),
                "topic": decision.topic,
                "decision_text": decision.decision_text,
                "context": decision.context,
                "decision_date": decision.decision_date.isoformat() if decision.decision_date else None,
                "memory": {
                    "id": str(memory.id),
                    "content": memory.content[:200],
                    "memory_type": memory.memory_type,
                    "memory_date": memory.memory_date.isoformat() if memory.memory_date else None,
                },
            }
            for decision, memory in rows
        ]
