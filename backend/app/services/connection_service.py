"""Service for discovering and managing memory connections."""

import logging
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory
from app.models.connection import MemoryConnection
from app.services.embedding_service import embedding_service

settings = get_settings()
logger = logging.getLogger(__name__)


class ConnectionService:
    """Service for discovering and managing memory connections."""

    SIMILARITY_THRESHOLD = 0.75  # Minimum similarity for a connection
    MIN_TIME_DIFFERENCE_HOURS = 1  # Don't connect memories too close in time

    CONNECTION_ANALYSIS_PROMPT = """Analyze why these two memories might be connected.

Memory 1 ({date1}):
{content1}

Memory 2 ({date2}):
{content2}

If there's a meaningful connection (same topic, follow-up, related events, shared context),
explain it in ONE short sentence (under 100 chars) from the user's perspective.

If there's no meaningful connection, respond with just: "none"

Examples of good explanations:
- "You worried about this deadline, and it got extended"
- "Same project - budget discussed both times"
- "Sarah mentioned this earlier"
- "Follow-up to last week's meeting"

Response:"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def find_connections_for_memory(
        self,
        user_id: UUID,
        memory: Memory,
        limit: int = 5,
    ) -> list[MemoryConnection]:
        """
        Find connections between a new memory and existing memories.
        Called when a new memory is created or during background job.
        """
        if not memory.embedding:
            logger.debug(f"Memory {memory.id} has no embedding, skipping connection discovery")
            return []

        # Find similar memories (excluding the memory itself and very recent ones)
        cutoff_time = memory.created_at - timedelta(hours=self.MIN_TIME_DIFFERENCE_HOURS)

        similar_memories = await self._find_similar_memories(
            user_id=user_id,
            embedding=memory.embedding,
            exclude_id=memory.id,
            before_time=cutoff_time,
            limit=limit,
        )

        connections = []
        for similar_memory, similarity in similar_memories:
            if similarity < self.SIMILARITY_THRESHOLD:
                continue

            # Check if connection already exists
            existing = await self._get_existing_connection(user_id, memory.id, similar_memory.id)
            if existing:
                continue

            # Check for shared entities (boosts connection strength)
            shared_entities = self._get_shared_entities(memory, similar_memory)
            entity_boost = min(len(shared_entities) * 0.05, 0.15)  # Max 15% boost

            # Analyze the connection
            explanation = await self._analyze_connection(memory, similar_memory)
            if explanation == "none":
                continue

            # Determine connection type
            connection_type = "semantic"
            if shared_entities:
                connection_type = "entity"

            # Create connection (ensure memory_id_1 < memory_id_2)
            id_1, id_2 = sorted([memory.id, similar_memory.id])

            connection = MemoryConnection(
                user_id=user_id,
                memory_id_1=id_1,
                memory_id_2=id_2,
                connection_type=connection_type,
                strength=min(similarity + entity_boost, 1.0),
                explanation=explanation,
            )
            self.db.add(connection)
            connections.append(connection)

        if connections:
            await self.db.commit()
            logger.info(f"Created {len(connections)} connections for memory {memory.id}")

        return connections

    async def _find_similar_memories(
        self,
        user_id: UUID,
        embedding: list[float],
        exclude_id: UUID,
        before_time: datetime | None = None,
        limit: int = 5,
    ) -> list[tuple[Memory, float]]:
        """Find memories similar to the given embedding with their similarity scores."""
        # Build query
        query = (
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.user_id == user_id)
            .where(Memory.id != exclude_id)
            .where(Memory.embedding.isnot(None))
        )

        if before_time:
            query = query.where(Memory.created_at < before_time)

        # Order by cosine similarity (1 - distance)
        query = query.order_by(Memory.embedding.cosine_distance(embedding)).limit(limit)

        result = await self.db.execute(query)
        memories = list(result.scalars().all())

        # Calculate similarity scores
        memories_with_scores = []
        for mem in memories:
            if mem.embedding:
                # Cosine similarity = 1 - cosine_distance
                similarity = self._cosine_similarity(embedding, mem.embedding)
                memories_with_scores.append((mem, similarity))

        return memories_with_scores

    def _cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        import math
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot_product / (norm1 * norm2)

    def _get_shared_entities(self, memory1: Memory, memory2: Memory) -> list:
        """Get entities shared between two memories."""
        if not memory1.entities or not memory2.entities:
            return []

        entity_ids_1 = {e.id for e in memory1.entities}
        entity_ids_2 = {e.id for e in memory2.entities}
        shared_ids = entity_ids_1 & entity_ids_2

        return [e for e in memory1.entities if e.id in shared_ids]

    async def _get_existing_connection(
        self, user_id: UUID, memory_id_1: UUID, memory_id_2: UUID
    ) -> MemoryConnection | None:
        """Check if a connection already exists between two memories for a user."""
        id_1, id_2 = sorted([memory_id_1, memory_id_2])
        result = await self.db.execute(
            select(MemoryConnection).where(
                and_(
                    MemoryConnection.user_id == user_id,
                    MemoryConnection.memory_id_1 == id_1,
                    MemoryConnection.memory_id_2 == id_2,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _analyze_connection(
        self, memory1: Memory, memory2: Memory
    ) -> str:
        """Use LLM to analyze and explain the connection between memories."""
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.CONNECTION_ANALYSIS_PROMPT.format(
                            date1=memory1.memory_date.strftime("%Y-%m-%d") if memory1.memory_date else "unknown",
                            content1=memory1.content[:500],
                            date2=memory2.memory_date.strftime("%Y-%m-%d") if memory2.memory_date else "unknown",
                            content2=memory2.content[:500],
                        ),
                    }
                ],
                temperature=0.3,
                max_tokens=100,
            )
            explanation = response.choices[0].message.content.strip()
            return explanation if explanation.lower() != "none" else "none"
        except Exception as e:
            logger.error(f"Error analyzing connection: {e}")
            return "none"

    async def get_connections(
        self,
        user_id: UUID,
        limit: int = 20,
        unnotified_only: bool = False,
        undismissed_only: bool = True,
    ) -> list[MemoryConnection]:
        """Get connections for a user."""
        query = (
            select(MemoryConnection)
            .where(MemoryConnection.user_id == user_id)
            .order_by(MemoryConnection.created_at.desc())
        )

        if unnotified_only:
            query = query.where(MemoryConnection.notified_at.is_(None))

        if undismissed_only:
            query = query.where(MemoryConnection.dismissed_at.is_(None))

        query = query.limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_connection_with_memories(
        self, connection_id: UUID, user_id: UUID
    ) -> tuple[MemoryConnection, Memory, Memory] | None:
        """Get a connection with its associated memories."""
        result = await self.db.execute(
            select(MemoryConnection)
            .where(MemoryConnection.id == connection_id)
            .where(MemoryConnection.user_id == user_id)
        )
        connection = result.scalar_one_or_none()
        if not connection:
            return None

        # Fetch both memories
        memories_result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.id.in_([connection.memory_id_1, connection.memory_id_2]))
        )
        memories = list(memories_result.scalars().all())
        memory_map = {m.id: m for m in memories}

        memory1 = memory_map.get(connection.memory_id_1)
        memory2 = memory_map.get(connection.memory_id_2)

        if not memory1 or not memory2:
            return None

        return connection, memory1, memory2

    async def dismiss_connection(self, connection_id: UUID, user_id: UUID) -> bool:
        """Dismiss/acknowledge a connection."""
        result = await self.db.execute(
            select(MemoryConnection)
            .where(MemoryConnection.id == connection_id)
            .where(MemoryConnection.user_id == user_id)
        )
        connection = result.scalar_one_or_none()
        if not connection:
            return False

        connection.dismissed_at = datetime.utcnow()
        await self.db.commit()
        return True

    async def mark_notified(self, user_id: UUID, connection_ids: list[UUID]) -> None:
        """Mark connections as notified for a specific user."""
        if not connection_ids:
            return

        result = await self.db.execute(
            select(MemoryConnection).where(
                and_(
                    MemoryConnection.user_id == user_id,
                    MemoryConnection.id.in_(connection_ids),
                )
            )
        )
        connections = result.scalars().all()

        for conn in connections:
            conn.notified_at = datetime.utcnow()

        await self.db.commit()

    async def get_unnotified_connections(self, user_id: UUID, limit: int = 5) -> list[MemoryConnection]:
        """Get connections that haven't been notified yet."""
        return await self.get_connections(
            user_id=user_id,
            limit=limit,
            unnotified_only=True,
            undismissed_only=True,
        )
