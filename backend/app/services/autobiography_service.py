"""Autobiographical Memory Hierarchy Service.

Manages the hierarchical organization of memories:
- Life Periods (major chapters)
- General Events (recurring/extended events)
- Specific Memories (individual episodes)

Based on Conway's Self-Memory System (SMS).
"""
import logging
import json
from datetime import datetime, date, timezone, timedelta
from uuid import UUID
from typing import Optional
from collections import defaultdict

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.models import Memory
from app.models.autobiography import LifePeriod, GeneralEvent
from app.services.embedding_service import embedding_service
from app.config import settings

logger = logging.getLogger(__name__)


class AutobiographyService:
    """Service for managing autobiographical memory hierarchy."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def create_life_period(
        self,
        user_id: UUID,
        name: str,
        start_date: date,
        end_date: Optional[date] = None,
        description: Optional[str] = None,
        themes: Optional[list[str]] = None,
        identity_goals: Optional[list[str]] = None,
        key_people: Optional[list[str]] = None,
        key_locations: Optional[list[str]] = None,
        is_current: bool = False,
    ) -> LifePeriod:
        """Create a new life period."""
        if is_current:
            await self.db.execute(
                select(LifePeriod)
                .where(LifePeriod.user_id == user_id)
                .where(LifePeriod.is_current == True)
            )
            await self.db.execute(
                LifePeriod.__table__.update()
                .where(LifePeriod.user_id == user_id)
                .where(LifePeriod.is_current == True)
                .values(is_current=False)
            )

        period = LifePeriod(
            user_id=user_id,
            name=name,
            description=description,
            start_date=start_date,
            end_date=end_date,
            is_current=is_current,
            themes=themes or [],
            identity_goals=identity_goals or [],
            key_people=key_people or [],
            key_locations=key_locations or [],
        )

        embed_text = f"{name}. {description or ''}. Themes: {', '.join(themes or [])}"
        period.embedding = await embedding_service.embed(embed_text)

        self.db.add(period)
        await self.db.commit()

        logger.info(f"Created life period '{name}' for user {user_id}")
        return period

    async def get_life_periods(
        self,
        user_id: UUID,
        include_past: bool = True,
    ) -> list[LifePeriod]:
        """Get all life periods for a user."""
        query = (
            select(LifePeriod)
            .where(LifePeriod.user_id == user_id)
            .order_by(LifePeriod.start_date.desc())
        )
        if not include_past:
            query = query.where(
                (LifePeriod.is_current == True) | (LifePeriod.end_date.is_(None))
            )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_current_life_period(self, user_id: UUID) -> Optional[LifePeriod]:
        """Get the current life period for a user."""
        result = await self.db.execute(
            select(LifePeriod)
            .where(LifePeriod.user_id == user_id)
            .where(LifePeriod.is_current == True)
        )
        return result.scalar_one_or_none()

    async def find_life_period_for_date(
        self,
        user_id: UUID,
        check_date: date,
    ) -> Optional[LifePeriod]:
        """Find the life period containing a specific date."""
        result = await self.db.execute(
            select(LifePeriod)
            .where(LifePeriod.user_id == user_id)
            .where(LifePeriod.start_date <= check_date)
            .where(
                (LifePeriod.end_date.is_(None)) | (LifePeriod.end_date >= check_date)
            )
            .order_by(LifePeriod.start_date.desc())
        )
        return result.scalar_one_or_none()

    async def create_general_event(
        self,
        user_id: UUID,
        name: str,
        event_type: str,
        life_period_id: Optional[UUID] = None,
        description: Optional[str] = None,
        frequency: Optional[str] = None,
        participants: Optional[list[str]] = None,
        location_pattern: Optional[str] = None,
        first_occurrence: Optional[date] = None,
    ) -> GeneralEvent:
        """Create a new general event."""
        event = GeneralEvent(
            user_id=user_id,
            life_period_id=life_period_id,
            name=name,
            description=description,
            event_type=event_type,
            frequency=frequency,
            participants=participants or [],
            location_pattern=location_pattern,
            first_occurrence=first_occurrence,
            last_occurrence=first_occurrence,
        )

        embed_text = f"{name}. {description or ''}. Type: {event_type}"
        event.embedding = await embedding_service.embed(embed_text)

        self.db.add(event)
        await self.db.commit()

        logger.info(f"Created general event '{name}' for user {user_id}")
        return event

    async def get_general_events(
        self,
        user_id: UUID,
        life_period_id: Optional[UUID] = None,
        event_type: Optional[str] = None,
    ) -> list[GeneralEvent]:
        """Get general events for a user."""
        query = (
            select(GeneralEvent)
            .where(GeneralEvent.user_id == user_id)
        )
        if life_period_id:
            query = query.where(GeneralEvent.life_period_id == life_period_id)
        if event_type:
            query = query.where(GeneralEvent.event_type == event_type)

        query = query.order_by(GeneralEvent.last_occurrence.desc().nullsfirst())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def find_similar_events(
        self,
        user_id: UUID,
        query_text: str,
        limit: int = 5,
    ) -> list[GeneralEvent]:
        """Find general events similar to a query."""
        query_embedding = await embedding_service.embed(query_text)

        result = await self.db.execute(
            select(GeneralEvent)
            .where(GeneralEvent.user_id == user_id)
            .where(GeneralEvent.embedding.isnot(None))
            .order_by(GeneralEvent.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def assign_memory_to_hierarchy(
        self,
        memory: Memory,
    ) -> tuple[Optional[LifePeriod], Optional[GeneralEvent]]:
        """Automatically assign a memory to the appropriate hierarchy level."""
        memory_date = memory.memory_date.date() if hasattr(memory.memory_date, 'date') else memory.memory_date

        life_period = await self.find_life_period_for_date(memory.user_id, memory_date)
        if life_period:
            memory.life_period_id = life_period.id

        similar_events = await self.find_similar_events(
            memory.user_id,
            memory.content[:500],
            limit=3,
        )

        if similar_events:
            best_event = similar_events[0]
            if best_event.embedding:
                memory_embedding = memory.embedding or await embedding_service.embed(memory.content[:500])
                from app.services.advanced_memory_service import AdvancedMemoryService
                service = AdvancedMemoryService(self.db)
                similarity = service._cosine_similarity(memory_embedding, best_event.embedding)

                if similarity > 0.75:
                    memory.general_event_id = best_event.id
                    best_event.record_occurrence(memory_date)

        await self.db.commit()
        return life_period, memory.general_event

    async def detect_general_events(
        self,
        user_id: UUID,
        days: int = 90,
    ) -> list[GeneralEvent]:
        """Analyze memories to detect recurring general events."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.memory_date >= cutoff)
            .where(Memory.general_event_id.is_(None))
            .order_by(Memory.memory_date.asc())
            .limit(200)
        )
        memories = list(result.scalars().all())

        if len(memories) < 10:
            return []

        memory_summaries = [
            f"[{m.memory_date.strftime('%Y-%m-%d')}] {m.summary or m.content[:200]}"
            for m in memories
        ]

        prompt = f"""Analyze these memories to identify recurring events or patterns that could be grouped as "General Events" (recurring activities, regular social gatherings, ongoing projects, etc.).

Memories:
{chr(10).join(memory_summaries)}

Identify up to 5 recurring events/activities. For each:
1. Name (brief, descriptive)
2. Type: "repeated" (regular occurrence), "extended" (multi-day), or "first_time" (significant first)
3. Frequency (if repeated): daily, weekly, monthly, yearly
4. Brief description
5. Typical participants (if any)
6. Typical location (if any)

Return as JSON:
{{
    "events": [
        {{
            "name": "string",
            "event_type": "repeated|extended|first_time",
            "frequency": "daily|weekly|monthly|yearly|null",
            "description": "string",
            "participants": ["list", "of", "names"],
            "location": "string or null"
        }}
    ]
}}

Only include events with clear evidence. Be conservative."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=800,
                temperature=0.3,
            )

            data = json.loads(response.choices[0].message.content)
            detected_events = []

            for event_data in data.get("events", []):
                existing = await self.db.execute(
                    select(GeneralEvent)
                    .where(GeneralEvent.user_id == user_id)
                    .where(GeneralEvent.name == event_data["name"])
                )
                if existing.scalar_one_or_none():
                    continue

                current_period = await self.get_current_life_period(user_id)

                event = await self.create_general_event(
                    user_id=user_id,
                    name=event_data["name"],
                    event_type=event_data["event_type"],
                    life_period_id=current_period.id if current_period else None,
                    description=event_data.get("description"),
                    frequency=event_data.get("frequency"),
                    participants=event_data.get("participants", []),
                    location_pattern=event_data.get("location"),
                )
                detected_events.append(event)

            logger.info(f"Detected {len(detected_events)} new general events for user {user_id}")
            return detected_events

        except Exception as e:
            logger.error(f"Error detecting general events: {e}")
            return []

    async def get_autobiography_summary(
        self,
        user_id: UUID,
    ) -> dict:
        """Get summary of user's autobiographical structure."""
        period_count = await self.db.scalar(
            select(func.count(LifePeriod.id))
            .where(LifePeriod.user_id == user_id)
        )

        event_count = await self.db.scalar(
            select(func.count(GeneralEvent.id))
            .where(GeneralEvent.user_id == user_id)
        )

        categorized_memories = await self.db.scalar(
            select(func.count(Memory.id))
            .where(Memory.user_id == user_id)
            .where(
                (Memory.life_period_id.isnot(None)) |
                (Memory.general_event_id.isnot(None))
            )
        )

        total_memories = await self.db.scalar(
            select(func.count(Memory.id))
            .where(Memory.user_id == user_id)
        )

        current_period = await self.get_current_life_period(user_id)

        periods = await self.get_life_periods(user_id)

        return {
            "life_period_count": period_count or 0,
            "general_event_count": event_count or 0,
            "categorized_memory_count": categorized_memories or 0,
            "total_memory_count": total_memories or 0,
            "categorization_rate": (
                categorized_memories / total_memories
                if total_memories
                else 0
            ),
            "current_period": {
                "id": str(current_period.id),
                "name": current_period.name,
                "start_date": current_period.start_date.isoformat(),
                "themes": current_period.themes,
            } if current_period else None,
            "periods_timeline": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "start_date": p.start_date.isoformat(),
                    "end_date": p.end_date.isoformat() if p.end_date else None,
                    "is_current": p.is_current,
                    "duration_years": round(p.duration_years, 1),
                }
                for p in periods
            ],
        }

    async def get_period_memories(
        self,
        user_id: UUID,
        period_id: UUID,
        limit: int = 50,
    ) -> list[Memory]:
        """Get memories belonging to a life period."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.life_period_id == period_id)
            .order_by(Memory.memory_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_event_memories(
        self,
        user_id: UUID,
        event_id: UUID,
        limit: int = 50,
    ) -> list[Memory]:
        """Get memories belonging to a general event."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.general_event_id == event_id)
            .order_by(Memory.memory_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
