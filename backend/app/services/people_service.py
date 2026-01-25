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
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List all people (entities) with stats and pagination."""
        # Base query for filtering
        base_query = (
            select(Entity)
            .where(Entity.user_id == user_id)
            .where(Entity.entity_type == entity_type)
        )

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply sorting
        if sort_by == "recent":
            base_query = base_query.order_by(Entity.last_seen.desc())
        elif sort_by == "frequent":
            base_query = base_query.order_by(Entity.mention_count.desc())
        elif sort_by == "alphabetical":
            base_query = base_query.order_by(Entity.name.asc())
        else:
            base_query = base_query.order_by(Entity.last_seen.desc())

        # Apply pagination
        query = base_query.offset(offset).limit(limit)
        result = await self.db.execute(query)
        entities = list(result.scalars().all())

        people = [
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
        return people, total

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

    # ==================== RELATIONSHIP INTELLIGENCE ====================

    async def get_relationship_context(
        self,
        user_id: UUID,
        person_name: str,
    ) -> dict:
        """
        Get comprehensive relationship context for a person.

        Includes:
        - Communication patterns
        - Relationship strength
        - Key topics and decisions
        - Interaction history
        """
        entity = await self.get_person_by_name(user_id, person_name)
        if not entity:
            return {"success": False, "message": "Person not found"}

        # Get profile
        profile = await self._get_cached_profile(user_id, entity.id)

        # Get recent interactions
        memories = await self.get_person_memories(user_id, person_name, limit=30)

        # Analyze communication patterns
        patterns = self._analyze_communication_patterns(memories)

        # Calculate relationship strength
        strength = self._calculate_relationship_strength(entity, memories, patterns)

        # Get key topics
        topics = await self._extract_key_topics(person_name, memories)

        return {
            "success": True,
            "person": {
                "name": entity.name,
                "email": entity.email,
                "relationship_type": profile.relationship_type if profile else "contact",
            },
            "relationship_strength": strength,
            "communication_patterns": patterns,
            "key_topics": topics,
            "summary": profile.summary if profile else None,
            "sentiment": profile.sentiment_trend if profile else "neutral",
            "stats": {
                "total_interactions": entity.mention_count,
                "first_contact": entity.first_seen.isoformat() if entity.first_seen else None,
                "last_contact": entity.last_seen.isoformat() if entity.last_seen else None,
                "days_known": (datetime.utcnow() - entity.first_seen).days if entity.first_seen else 0,
            },
        }

    def _analyze_communication_patterns(self, memories: list[Memory]) -> dict:
        """Analyze communication patterns from memories."""
        patterns = {
            "interaction_frequency": "rare",  # rare, occasional, regular, frequent
            "primary_channel": "unknown",  # email, calendar, chat
            "avg_interactions_per_week": 0,
            "last_7_days": 0,
            "last_30_days": 0,
            "time_of_day_preference": None,  # morning, afternoon, evening
        }

        if not memories:
            return patterns

        now = datetime.utcnow()
        last_7_days = sum(1 for m in memories if m.memory_date and (now - m.memory_date).days <= 7)
        last_30_days = sum(1 for m in memories if m.memory_date and (now - m.memory_date).days <= 30)

        patterns["last_7_days"] = last_7_days
        patterns["last_30_days"] = last_30_days
        patterns["avg_interactions_per_week"] = round(last_30_days / 4, 1)

        # Determine frequency
        if last_7_days >= 5:
            patterns["interaction_frequency"] = "frequent"
        elif last_7_days >= 2:
            patterns["interaction_frequency"] = "regular"
        elif last_30_days >= 4:
            patterns["interaction_frequency"] = "occasional"

        # Primary channel
        email_count = sum(1 for m in memories if m.memory_type == "email")
        calendar_count = sum(1 for m in memories if m.memory_type == "calendar")
        other_count = len(memories) - email_count - calendar_count

        if email_count >= calendar_count and email_count >= other_count:
            patterns["primary_channel"] = "email"
        elif calendar_count > email_count:
            patterns["primary_channel"] = "meetings"
        else:
            patterns["primary_channel"] = "other"

        # Time of day preference
        hours = [m.memory_date.hour for m in memories if m.memory_date]
        if hours:
            avg_hour = sum(hours) / len(hours)
            if avg_hour < 12:
                patterns["time_of_day_preference"] = "morning"
            elif avg_hour < 17:
                patterns["time_of_day_preference"] = "afternoon"
            else:
                patterns["time_of_day_preference"] = "evening"

        return patterns

    def _calculate_relationship_strength(
        self,
        entity: Entity,
        memories: list[Memory],
        patterns: dict,
    ) -> dict:
        """Calculate relationship strength score."""
        score = 0
        max_score = 100

        # Factor 1: Total interactions (up to 25 points)
        interaction_score = min(entity.mention_count * 2, 25)
        score += interaction_score

        # Factor 2: Recency (up to 25 points)
        if entity.last_seen:
            days_since = (datetime.utcnow() - entity.last_seen).days
            if days_since <= 7:
                recency_score = 25
            elif days_since <= 30:
                recency_score = 15
            elif days_since <= 90:
                recency_score = 5
            else:
                recency_score = 0
            score += recency_score

        # Factor 3: Frequency (up to 25 points)
        freq = patterns.get("interaction_frequency", "rare")
        freq_scores = {"frequent": 25, "regular": 20, "occasional": 10, "rare": 0}
        score += freq_scores.get(freq, 0)

        # Factor 4: Relationship duration (up to 25 points)
        if entity.first_seen:
            months_known = (datetime.utcnow() - entity.first_seen).days / 30
            duration_score = min(months_known * 2, 25)
            score += duration_score

        # Determine label
        if score >= 75:
            label = "strong"
        elif score >= 50:
            label = "moderate"
        elif score >= 25:
            label = "weak"
        else:
            label = "minimal"

        return {
            "score": round(score, 1),
            "max_score": max_score,
            "label": label,
            "factors": {
                "interactions": interaction_score,
                "recency": recency_score if entity.last_seen else 0,
                "frequency": freq_scores.get(freq, 0),
                "duration": duration_score if entity.first_seen else 0,
            },
        }

    async def _extract_key_topics(
        self,
        person_name: str,
        memories: list[Memory],
    ) -> list[str]:
        """Extract key topics discussed with this person."""
        if not memories or len(memories) < 3:
            return []

        # Use LLM to extract topics
        memory_texts = "\n".join([
            m.content[:200] for m in memories[:15]
        ])

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": f"What are the top 5 topics discussed with {person_name} based on these interactions?\n\n{memory_texts}\n\nReturn only a JSON array of strings: [\"topic1\", \"topic2\", ...]",
                    }
                ],
                response_format={"type": "json_object"},
                max_tokens=100,
            )

            import json
            result = json.loads(response.choices[0].message.content)
            return result.get("topics", result) if isinstance(result, dict) else result[:5]

        except Exception as e:
            logger.error(f"Error extracting topics: {e}")
            return []

    async def search_people(
        self,
        user_id: UUID,
        query: str,
        limit: int = 10,
    ) -> list[dict]:
        """
        Search for people by name, email, or topic.
        Enhanced search that also looks at profile content.
        """
        if not query or len(query) < 1:
            return await self.list_people(user_id, sort_by="frequent", limit=limit)

        query_lower = query.lower()

        # Search entities
        result = await self.db.execute(
            select(Entity)
            .where(Entity.user_id == user_id)
            .where(Entity.entity_type == "person")
            .where(
                (func.lower(Entity.name).like(f"%{query_lower}%")) |
                (func.lower(Entity.email).like(f"%{query_lower}%"))
            )
            .order_by(Entity.mention_count.desc())
            .limit(limit)
        )
        entities = list(result.scalars().all())

        # Also search in profiles for topic matches
        profile_result = await self.db.execute(
            select(PersonProfile, Entity)
            .join(Entity, PersonProfile.entity_id == Entity.id)
            .where(PersonProfile.user_id == user_id)
            .where(
                PersonProfile.topics.cast(str).like(f"%{query_lower}%") |
                PersonProfile.summary.like(f"%{query_lower}%")
            )
            .limit(limit)
        )
        profile_matches = list(profile_result.all())

        # Combine results
        seen_ids = {e.id for e in entities}
        for profile, entity in profile_matches:
            if entity.id not in seen_ids:
                entities.append(entity)
                seen_ids.add(entity.id)

        return [
            {
                "id": str(e.id),
                "name": e.name,
                "email": e.email,
                "mention_count": e.mention_count,
                "entity_type": e.entity_type,
            }
            for e in entities[:limit]
        ]
