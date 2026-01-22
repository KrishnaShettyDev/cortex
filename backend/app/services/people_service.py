"""Service for aggregating and managing people intelligence."""

import logging
from uuid import UUID
from datetime import datetime, date, timedelta
from sqlalchemy import select, and_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.entity import Entity, MemoryEntity
from app.models.memory import Memory
from app.models.connection import PersonProfile

settings = get_settings()
logger = logging.getLogger(__name__)


class PeopleService:
    """Service for aggregating and managing people intelligence."""

    PROFILE_GENERATION_PROMPT = """Analyze these memories about a person and create a brief profile.

Person: {name}

Memories (from most recent to oldest):
{memories}

Generate a JSON response with:
{{
    "summary": "A 1-2 sentence summary of who this person is to the user and their relationship",
    "relationship_type": "colleague|friend|family|professional|contact",
    "topics": ["topic1", "topic2", "topic3"],
    "sentiment": "positive|neutral|negative|mixed"
}}

Only use information from the memories. Be concise. Return valid JSON only."""

    MEETING_CONTEXT_PROMPT = """Generate meeting preparation context based on these memories.

Meeting with: {name}

Recent memories about this person:
{memories}

In 2-3 short bullet points, summarize:
- Key topics discussed recently
- Any pending items or follow-ups
- Context that might be useful

Keep it brief and actionable. No headers, just bullet points."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def list_people(
        self,
        user_id: UUID,
        sort_by: str = "recent",  # 'recent', 'frequent', 'alphabetical'
        entity_type: str = "person",
        limit: int = 50,
    ) -> list[dict]:
        """List all people (entities) with stats."""
        query = (
            select(Entity)
            .where(Entity.user_id == user_id)
            .where(Entity.entity_type == entity_type)
        )

        if sort_by == "recent":
            query = query.order_by(Entity.last_seen.desc())
        elif sort_by == "frequent":
            query = query.order_by(Entity.mention_count.desc())
        elif sort_by == "alphabetical":
            query = query.order_by(Entity.name.asc())
        else:
            query = query.order_by(Entity.last_seen.desc())

        query = query.limit(limit)
        result = await self.db.execute(query)
        entities = list(result.scalars().all())

        return [
            {
                "id": str(e.id),
                "name": e.name,
                "entity_type": e.entity_type,
                "email": e.email,
                "mention_count": e.mention_count,
                "first_seen": e.first_seen.isoformat() if e.first_seen else None,
                "last_seen": e.last_seen.isoformat() if e.last_seen else None,
            }
            for e in entities
        ]

    async def search_contacts(
        self,
        user_id: UUID,
        query: str,
        limit: int = 10,
    ) -> list[dict]:
        """
        Search for contacts by name or email for autocomplete.
        Returns contacts sorted by relevance (exact matches first, then by frequency).
        """
        if not query or len(query) < 1:
            # Return most frequently contacted people
            return await self.list_people(user_id, sort_by="frequent", limit=limit)

        query_lower = query.lower()

        # Search by name or email (case-insensitive prefix match)
        result = await self.db.execute(
            select(Entity)
            .where(Entity.user_id == user_id)
            .where(Entity.entity_type == "person")
            .where(
                (func.lower(Entity.name).like(f"{query_lower}%")) |
                (func.lower(Entity.email).like(f"{query_lower}%")) |
                (func.lower(Entity.name).like(f"% {query_lower}%"))  # Match first names
            )
            .order_by(
                # Prioritize exact name match
                (func.lower(Entity.name) == query_lower).desc(),
                # Then by mention count (most contacted)
                Entity.mention_count.desc(),
            )
            .limit(limit)
        )
        entities = list(result.scalars().all())

        return [
            {
                "id": str(e.id),
                "name": e.name,
                "email": e.email,
                "mention_count": e.mention_count,
            }
            for e in entities
            if e.email  # Only return contacts with email addresses
        ]

    async def get_person_by_name(
        self, user_id: UUID, name: str
    ) -> Entity | None:
        """Get a person entity by name (case-insensitive)."""
        result = await self.db.execute(
            select(Entity)
            .where(Entity.user_id == user_id)
            .where(Entity.entity_type == "person")
            .where(func.lower(Entity.name) == func.lower(name))
        )
        return result.scalar_one_or_none()

    async def get_person_memories(
        self,
        user_id: UUID,
        person_name: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Memory]:
        """Get all memories mentioning a person."""
        # First find the entity
        entity = await self.get_person_by_name(user_id, person_name)
        if not entity:
            return []

        # Get memories through junction table
        result = await self.db.execute(
            select(Memory)
            .join(MemoryEntity, Memory.id == MemoryEntity.memory_id)
            .where(MemoryEntity.entity_id == entity.id)
            .where(Memory.user_id == user_id)
            .order_by(Memory.memory_date.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_person_profile(
        self,
        user_id: UUID,
        person_name: str,
        regenerate: bool = False,
    ) -> dict | None:
        """Get comprehensive profile for a person."""
        entity = await self.get_person_by_name(user_id, person_name)
        if not entity:
            return None

        # Check for cached profile
        if not regenerate:
            profile = await self._get_cached_profile(user_id, entity.id)
            if profile and profile.updated_at > datetime.utcnow() - timedelta(hours=24):
                return self._profile_to_dict(entity, profile)

        # Generate fresh profile
        memories = await self.get_person_memories(user_id, person_name, limit=15)
        if not memories:
            return {
                "name": entity.name,
                "entity_type": entity.entity_type,
                "email": entity.email,
                "mention_count": entity.mention_count,
                "first_seen": entity.first_seen.isoformat() if entity.first_seen else None,
                "last_seen": entity.last_seen.isoformat() if entity.last_seen else None,
                "summary": None,
                "relationship_type": None,
                "topics": [],
                "sentiment_trend": None,
                "memories": [],
            }

        # Generate profile with LLM
        profile_data = await self._generate_profile(entity.name, memories)

        # Save/update profile cache
        profile = await self._save_profile(
            user_id=user_id,
            entity_id=entity.id,
            profile_data=profile_data,
            last_interaction=memories[0].memory_date.date() if memories and memories[0].memory_date else None,
        )

        return self._profile_to_dict(entity, profile, memories[:5])

    async def _get_cached_profile(
        self, user_id: UUID, entity_id: UUID
    ) -> PersonProfile | None:
        """Get cached profile if it exists."""
        result = await self.db.execute(
            select(PersonProfile)
            .where(PersonProfile.user_id == user_id)
            .where(PersonProfile.entity_id == entity_id)
        )
        return result.scalar_one_or_none()

    async def _generate_profile(
        self, name: str, memories: list[Memory]
    ) -> dict:
        """Generate profile data using LLM."""
        # Format memories for prompt
        memory_texts = []
        for mem in memories:
            date_str = mem.memory_date.strftime("%Y-%m-%d") if mem.memory_date else "unknown"
            memory_texts.append(f"[{date_str}] {mem.content[:300]}")

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.PROFILE_GENERATION_PROMPT.format(
                            name=name,
                            memories="\n\n".join(memory_texts),
                        ),
                    }
                ],
                temperature=0.3,
                max_tokens=300,
                response_format={"type": "json_object"},
            )

            import json
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.error(f"Error generating profile: {e}")
            return {
                "summary": None,
                "relationship_type": "contact",
                "topics": [],
                "sentiment": "neutral",
            }

    async def _save_profile(
        self,
        user_id: UUID,
        entity_id: UUID,
        profile_data: dict,
        last_interaction: date | None,
    ) -> PersonProfile:
        """Save or update profile cache."""
        profile = await self._get_cached_profile(user_id, entity_id)

        if profile:
            profile.summary = profile_data.get("summary")
            profile.relationship_type = profile_data.get("relationship_type")
            profile.topics = profile_data.get("topics", [])
            profile.sentiment_trend = profile_data.get("sentiment")
            profile.last_interaction_date = last_interaction
            profile.updated_at = datetime.utcnow()
        else:
            profile = PersonProfile(
                user_id=user_id,
                entity_id=entity_id,
                summary=profile_data.get("summary"),
                relationship_type=profile_data.get("relationship_type"),
                topics=profile_data.get("topics", []),
                sentiment_trend=profile_data.get("sentiment"),
                last_interaction_date=last_interaction,
            )
            self.db.add(profile)

        await self.db.commit()
        await self.db.refresh(profile)
        return profile

    def _profile_to_dict(
        self,
        entity: Entity,
        profile: PersonProfile | None,
        recent_memories: list[Memory] | None = None,
    ) -> dict:
        """Convert profile to dict response."""
        return {
            "name": entity.name,
            "entity_type": entity.entity_type,
            "email": entity.email,
            "mention_count": entity.mention_count,
            "first_seen": entity.first_seen.isoformat() if entity.first_seen else None,
            "last_seen": entity.last_seen.isoformat() if entity.last_seen else None,
            "summary": profile.summary if profile else None,
            "relationship_type": profile.relationship_type if profile else None,
            "topics": profile.topics if profile else [],
            "sentiment_trend": profile.sentiment_trend if profile else None,
            "last_interaction_date": profile.last_interaction_date.isoformat() if profile and profile.last_interaction_date else None,
            "next_meeting_date": profile.next_meeting_date.isoformat() if profile and profile.next_meeting_date else None,
            "recent_memories": [
                {
                    "id": str(m.id),
                    "content": m.content[:200],
                    "memory_type": m.memory_type,
                    "memory_date": m.memory_date.isoformat() if m.memory_date else None,
                }
                for m in (recent_memories or [])
            ],
        }

    async def generate_meeting_context(
        self, user_id: UUID, person_name: str
    ) -> str | None:
        """Generate context for an upcoming meeting with a person."""
        memories = await self.get_person_memories(user_id, person_name, limit=10)
        if not memories:
            return None

        memory_texts = []
        for mem in memories:
            date_str = mem.memory_date.strftime("%Y-%m-%d") if mem.memory_date else "unknown"
            memory_texts.append(f"[{date_str}] {mem.content[:300]}")

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.MEETING_CONTEXT_PROMPT.format(
                            name=person_name,
                            memories="\n\n".join(memory_texts),
                        ),
                    }
                ],
                temperature=0.3,
                max_tokens=200,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error generating meeting context: {e}")
            return None

    async def update_next_meeting(
        self, user_id: UUID, person_name: str, meeting_date: datetime
    ) -> bool:
        """Update the next meeting date for a person profile."""
        entity = await self.get_person_by_name(user_id, person_name)
        if not entity:
            return False

        profile = await self._get_cached_profile(user_id, entity.id)
        if not profile:
            # Create minimal profile
            profile = PersonProfile(
                user_id=user_id,
                entity_id=entity.id,
                next_meeting_date=meeting_date,
            )
            self.db.add(profile)
        else:
            profile.next_meeting_date = meeting_date

        await self.db.commit()
        return True

    async def get_upcoming_meetings(
        self, user_id: UUID, hours_ahead: int = 2
    ) -> list[tuple[PersonProfile, Entity]]:
        """Get people with meetings in the next N hours."""
        now = datetime.utcnow()
        cutoff = now + timedelta(hours=hours_ahead)

        result = await self.db.execute(
            select(PersonProfile, Entity)
            .join(Entity, PersonProfile.entity_id == Entity.id)
            .where(PersonProfile.user_id == user_id)
            .where(PersonProfile.next_meeting_date >= now)
            .where(PersonProfile.next_meeting_date <= cutoff)
            .order_by(PersonProfile.next_meeting_date)
        )
        return list(result.all())
