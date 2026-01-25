import json
import logging
import asyncio
from uuid import UUID
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory
from app.models.entity import Entity, MemoryEntity
from app.services.embedding_service import embedding_service

settings = get_settings()
logger = logging.getLogger(__name__)


class MemoryService:
    """Service for creating and managing memories."""

    ENTITY_EXTRACTION_PROMPT = """Extract entities from the following text. Return a JSON array of objects with these fields:
- name: The entity name
- type: One of "person", "place", "topic", "company"
- email: Email address if mentioned (for people only, otherwise null)

Only extract clearly mentioned entities. Don't infer or guess.

Text:
{text}

Return ONLY valid JSON array, no other text. Example:
[{"name": "John Smith", "type": "person", "email": "john@example.com"}, {"name": "Acme Corp", "type": "company", "email": null}]"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def create_memory(
        self,
        user_id: UUID,
        content: str,
        memory_type: str,
        memory_date: datetime,
        audio_url: str | None = None,
        photo_url: str | None = None,
        source_id: str | None = None,
        source_url: str | None = None,
    ) -> tuple[Memory, list[str]]:
        """
        Create a new memory with FAST save - embedding and entity extraction happen in background.

        Args:
            user_id: The user's ID
            content: Memory content text
            memory_type: Type of memory (voice, text, photo, email, calendar)
            memory_date: When the memory occurred
            audio_url: Optional URL to audio file
            photo_url: Optional URL to photo
            source_id: Optional external source ID (for integrations)
            source_url: Optional URL to original source

        Returns:
            Tuple of (Memory object, list of extracted entity names - empty initially)
        """
        # FAST PATH: Save memory immediately without embedding/entities
        # This returns to user in <100ms
        memory = Memory(
            user_id=user_id,
            content=content,
            summary=None,  # Will be generated in background
            memory_type=memory_type,
            memory_date=memory_date,
            audio_url=audio_url,
            photo_url=photo_url,
            source_id=source_id,
            source_url=source_url,
            embedding=None,  # Will be generated in background
        )
        self.db.add(memory)
        await self.db.commit()
        await self.db.refresh(memory)

        # BACKGROUND: Process all the slow stuff asynchronously
        asyncio.create_task(self._process_memory_async(
            memory_id=memory.id,
            user_id=user_id,
            content=content,
        ))

        # Return immediately - entities will be populated later
        return memory, []

    async def _process_memory_async(
        self,
        memory_id: UUID,
        user_id: UUID,
        content: str,
    ) -> None:
        """Process embedding, summary, entities, and intelligence in background."""
        from app.database import async_session_maker

        try:
            async with async_session_maker() as db:
                # Reload memory in new session
                result = await db.execute(
                    select(Memory).where(Memory.id == memory_id)
                )
                memory = result.scalar_one_or_none()
                if not memory:
                    return

                # Generate embedding and summary in parallel
                embedding_task = embedding_service.embed(content)
                summary_task = self._generate_summary(content) if len(content) > 500 else None

                embedding = await embedding_task
                summary = await summary_task if summary_task else None

                # Update memory with embedding and summary
                memory.embedding = embedding
                if summary:
                    memory.summary = summary

                # Extract entities
                entities = await self._extract_entities(content)

                for entity_data in entities:
                    entity = await self._get_or_create_entity_in_session(
                        db=db,
                        user_id=user_id,
                        name=entity_data["name"],
                        entity_type=entity_data["type"],
                        email=entity_data.get("email"),
                    )

                    # Link entity to memory
                    memory_entity = MemoryEntity(
                        memory_id=memory.id,
                        entity_id=entity.id,
                    )
                    db.add(memory_entity)

                await db.commit()
                logger.info(f"Background processing complete for memory {memory_id}: {len(entities)} entities")

                # Extract intentions (prospective memory)
                try:
                    from app.services.intention_service import IntentionService
                    intention_service = IntentionService(db)
                    intentions = await intention_service.extract_intentions(memory)
                    if intentions:
                        logger.info(f"Extracted {len(intentions)} intentions from memory {memory_id}")
                except Exception as e:
                    logger.error(f"Error extracting intentions: {e}")

                # Now process intelligence (connections, decisions)
                await self._process_intelligence_in_session(db, memory)

                # Extract atomic facts for MemoryBench SOTA
                await self._extract_facts_in_session(db, memory, user_id)

        except Exception as e:
            logger.error(f"Error in background memory processing: {e}")

    async def _get_or_create_entity_in_session(
        self,
        db: AsyncSession,
        user_id: UUID,
        name: str,
        entity_type: str,
        email: str | None = None,
    ) -> Entity:
        """Get existing entity or create new one (for background processing)."""
        result = await db.execute(
            select(Entity).where(
                Entity.user_id == user_id,
                Entity.name == name,
                Entity.entity_type == entity_type,
            )
        )
        entity = result.scalar_one_or_none()

        if entity:
            entity.mention_count += 1
            entity.last_seen = datetime.utcnow()
            if email and not entity.email:
                entity.email = email
            return entity

        # Create new entity with embedding
        entity_embedding = await embedding_service.embed(f"{name} ({entity_type})")
        entity = Entity(
            user_id=user_id,
            name=name,
            entity_type=entity_type,
            email=email,
            embedding=entity_embedding,
        )
        db.add(entity)
        await db.flush()
        return entity

    async def _process_intelligence_in_session(self, db: AsyncSession, memory: Memory) -> None:
        """Process intelligence features in the given session."""
        try:
            from app.services.connection_service import ConnectionService
            from app.services.decision_service import DecisionService

            # Reload with entities
            result = await db.execute(
                select(Memory)
                .options(selectinload(Memory.entities))
                .where(Memory.id == memory.id)
            )
            mem = result.scalar_one_or_none()
            if not mem:
                return

            connection_service = ConnectionService(db)
            connections = await connection_service.find_connections_for_memory(
                user_id=mem.user_id,
                memory=mem,
                limit=3,
            )
            if connections:
                logger.info(f"Discovered {len(connections)} connections for memory {mem.id}")

            decision_service = DecisionService(db)
            decisions = await decision_service.extract_decisions(mem)
            if decisions:
                logger.info(f"Extracted {len(decisions)} decisions from memory {mem.id}")

        except Exception as e:
            logger.error(f"Error processing intelligence: {e}")

    async def _generate_summary(self, content: str) -> str:
        """Generate a brief summary of long content."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Summarize the following text in 1-2 sentences. Be concise and capture the key points.",
                },
                {"role": "user", "content": content[:5000]},  # Limit input
            ],
            temperature=0.3,
            max_tokens=100,
        )
        return response.choices[0].message.content.strip()

    async def _extract_entities(self, content: str) -> list[dict]:
        """Extract entities from content using GPT-4o-mini."""
        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.ENTITY_EXTRACTION_PROMPT.format(text=content[:3000]),
                    },
                ],
                temperature=0,
                max_tokens=500,
            )
            result = response.choices[0].message.content.strip()

            # Parse JSON response
            entities = json.loads(result)
            return entities if isinstance(entities, list) else []
        except (json.JSONDecodeError, Exception):
            return []

    async def get_memory(self, memory_id: UUID, user_id: UUID) -> Memory | None:
        """Get a single memory by ID."""
        result = await self.db.execute(
            select(Memory)
            .options(selectinload(Memory.entities))
            .where(Memory.id == memory_id, Memory.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def list_memories(
        self,
        user_id: UUID,
        limit: int = 20,
        offset: int = 0,
        memory_type: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
    ) -> tuple[list[Memory], int]:
        """
        List memories with pagination and filtering.

        Returns:
            Tuple of (list of memories, total count)
        """
        # Build base query
        query = select(Memory).where(Memory.user_id == user_id)
        count_query = select(func.count(Memory.id)).where(Memory.user_id == user_id)

        # Apply filters
        if memory_type:
            query = query.where(Memory.memory_type == memory_type)
            count_query = count_query.where(Memory.memory_type == memory_type)
        if from_date:
            query = query.where(Memory.memory_date >= from_date)
            count_query = count_query.where(Memory.memory_date >= from_date)
        if to_date:
            query = query.where(Memory.memory_date <= to_date)
            count_query = count_query.where(Memory.memory_date <= to_date)

        # Add ordering and pagination
        query = (
            query.options(selectinload(Memory.entities))
            .order_by(Memory.memory_date.desc())
            .offset(offset)
            .limit(limit)
        )

        # Execute queries
        result = await self.db.execute(query)
        memories = list(result.scalars().all())

        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        return memories, total

    async def delete_memory(self, memory_id: UUID, user_id: UUID) -> bool:
        """Delete a memory."""
        memory = await self.get_memory(memory_id, user_id)
        if not memory:
            return False

        await self.db.delete(memory)
        await self.db.commit()
        return True

    async def _extract_facts_in_session(
        self,
        db: AsyncSession,
        memory: Memory,
        user_id: UUID,
    ) -> None:
        """
        Extract atomic facts from a memory.

        This enables:
        - Multi-hop reasoning (entity relations)
        - Temporal reasoning (event_date vs document_date)
        - Abstention (confidence-based)
        """
        try:
            from app.services.fact_extraction_service import FactExtractionService

            fact_service = FactExtractionService(db)

            # Extract and save atomic facts from the memory
            facts = await fact_service.extract_and_save(
                user_id=user_id,
                memory_id=memory.id,
                content=memory.content,
                document_date=memory.memory_date or datetime.utcnow(),
            )

            if not facts:
                logger.debug(f"No facts extracted from memory {memory.id}")
                return

            # Extract entity relations from saved facts
            if facts:
                relations = await fact_service.extract_entity_relations(user_id, facts)
                logger.info(
                    f"Extracted {len(facts)} facts and {len(relations)} relations "
                    f"from memory {memory.id}"
                )

        except Exception as e:
            logger.error(f"Error extracting facts from memory {memory.id}: {e}")
