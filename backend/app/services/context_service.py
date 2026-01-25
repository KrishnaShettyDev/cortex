"""Context Capture and Matching Service.

Implements context-dependent memory based on encoding specificity principle.
Captures rich context at encoding time and uses it for retrieval enhancement.
"""
import logging
import math
from datetime import datetime, timezone, time
from uuid import UUID
from typing import Optional
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.models import Memory
from app.models.context import MemoryContext
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class CapturedContext:
    """Context data captured from client."""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None
    location_type: Optional[str] = None
    local_time: Optional[time] = None
    time_of_day: Optional[str] = None
    day_of_week: Optional[str] = None
    is_weekend: Optional[bool] = None
    weather: Optional[str] = None
    temperature: Optional[float] = None
    activity: Optional[str] = None
    activity_category: Optional[str] = None
    people_present: Optional[list[str]] = None
    social_setting: Optional[str] = None
    device_type: Optional[str] = None
    app_source: Optional[str] = None


class ContextService:
    """Service for capturing and matching memory contexts."""

    LOCATION_TYPES = {
        "home": ["house", "apartment", "residence", "home"],
        "work": ["office", "workplace", "company", "business"],
        "cafe": ["coffee", "cafe", "starbucks", "coffeeshop"],
        "gym": ["fitness", "gym", "workout", "exercise"],
        "restaurant": ["restaurant", "dining", "food", "eatery"],
        "park": ["park", "garden", "outdoor", "recreation"],
        "store": ["shop", "store", "mall", "retail"],
        "transit": ["station", "airport", "bus", "train", "transit"],
    }

    ACTIVITY_CATEGORIES = {
        "work": ["meeting", "working", "coding", "writing", "email"],
        "health": ["exercising", "running", "gym", "walking", "yoga"],
        "social": ["talking", "meeting", "dining", "party", "gathering"],
        "leisure": ["reading", "watching", "gaming", "relaxing", "browsing"],
        "errands": ["shopping", "commuting", "driving", "cleaning"],
        "learning": ["studying", "course", "lecture", "reading"],
    }

    def __init__(self, db: AsyncSession):
        self.db = db

    async def capture_context(
        self,
        memory_id: UUID,
        context_data: CapturedContext,
    ) -> MemoryContext:
        """Capture and store context for a memory."""
        now = datetime.now(timezone.utc)

        time_of_day = context_data.time_of_day
        if time_of_day is None and context_data.local_time:
            time_of_day = MemoryContext.get_time_of_day(context_data.local_time.hour)

        day_of_week = context_data.day_of_week
        if day_of_week is None:
            day_of_week = now.strftime("%A").lower()

        is_weekend = context_data.is_weekend
        if is_weekend is None:
            is_weekend = MemoryContext.is_weekend_day(day_of_week)

        location_type = context_data.location_type
        if location_type is None and context_data.location_name:
            location_type = self._infer_location_type(context_data.location_name)

        activity_category = context_data.activity_category
        if activity_category is None and context_data.activity:
            activity_category = self._infer_activity_category(context_data.activity)

        context = MemoryContext(
            memory_id=memory_id,
            latitude=context_data.latitude,
            longitude=context_data.longitude,
            location_name=context_data.location_name,
            location_type=location_type,
            local_time=context_data.local_time or now.time(),
            time_of_day=time_of_day or MemoryContext.get_time_of_day(now.hour),
            day_of_week=day_of_week,
            is_weekend=is_weekend,
            weather=context_data.weather,
            temperature=context_data.temperature,
            activity=context_data.activity,
            activity_category=activity_category,
            people_present=context_data.people_present or [],
            social_setting=context_data.social_setting or self._infer_social_setting(
                context_data.people_present
            ),
            device_type=context_data.device_type,
            app_source=context_data.app_source,
        )

        self.db.add(context)
        await self.db.commit()

        logger.info(f"Captured context for memory {memory_id}")
        return context

    async def get_context(self, memory_id: UUID) -> Optional[MemoryContext]:
        """Get context for a memory."""
        result = await self.db.execute(
            select(MemoryContext).where(MemoryContext.memory_id == memory_id)
        )
        return result.scalar_one_or_none()

    async def find_memories_by_context(
        self,
        user_id: UUID,
        context: CapturedContext,
        limit: int = 20,
        min_match_score: float = 0.3,
    ) -> list[tuple[Memory, float]]:
        """Find memories that match the given context.

        Returns list of (memory, match_score) tuples sorted by score.
        """
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.consolidated_into_id.is_(None))
            .order_by(Memory.memory_date.desc())
            .limit(500)
        )
        memories = list(result.scalars().all())

        scored_memories = []
        for memory in memories:
            if memory.context is None:
                continue

            score = memory.context.matches_current_context(
                latitude=context.latitude,
                longitude=context.longitude,
                time_of_day=context.time_of_day,
                day_of_week=context.day_of_week,
                activity_category=context.activity_category,
                location_type=context.location_type,
            )

            if score >= min_match_score:
                scored_memories.append((memory, score))

        scored_memories.sort(key=lambda x: x[1], reverse=True)
        return scored_memories[:limit]

    async def get_weather(
        self,
        latitude: float,
        longitude: float,
    ) -> Optional[dict]:
        """Fetch current weather for location using Open-Meteo API (free, no key needed)."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": latitude,
                        "longitude": longitude,
                        "current": "temperature_2m,weather_code",
                    },
                )
                if response.status_code == 200:
                    data = response.json()
                    current = data.get("current", {})
                    weather_code = current.get("weather_code", 0)
                    return {
                        "temperature": current.get("temperature_2m"),
                        "weather": self._weather_code_to_string(weather_code),
                    }
        except Exception as e:
            logger.warning(f"Failed to fetch weather: {e}")
        return None

    def _weather_code_to_string(self, code: int) -> str:
        """Convert WMO weather code to human readable string."""
        weather_codes = {
            0: "clear",
            1: "mostly_clear",
            2: "partly_cloudy",
            3: "cloudy",
            45: "foggy",
            48: "foggy",
            51: "drizzle",
            53: "drizzle",
            55: "drizzle",
            61: "rainy",
            63: "rainy",
            65: "heavy_rain",
            71: "snowy",
            73: "snowy",
            75: "heavy_snow",
            80: "showers",
            81: "showers",
            82: "heavy_showers",
            95: "thunderstorm",
            96: "thunderstorm",
            99: "thunderstorm",
        }
        return weather_codes.get(code, "unknown")

    def _infer_location_type(self, location_name: str) -> Optional[str]:
        """Infer location type from name."""
        name_lower = location_name.lower()
        for loc_type, keywords in self.LOCATION_TYPES.items():
            if any(keyword in name_lower for keyword in keywords):
                return loc_type
        return None

    def _infer_activity_category(self, activity: str) -> Optional[str]:
        """Infer activity category from activity name."""
        activity_lower = activity.lower()
        for category, keywords in self.ACTIVITY_CATEGORIES.items():
            if any(keyword in activity_lower for keyword in keywords):
                return category
        return None

    def _infer_social_setting(self, people_present: Optional[list[str]]) -> str:
        """Infer social setting from people present."""
        if not people_present:
            return "alone"
        count = len(people_present)
        if count == 1:
            return "one_on_one"
        elif count <= 3:
            return "small_group"
        else:
            return "large_group"

    async def enrich_context_from_location(
        self,
        context: CapturedContext,
    ) -> CapturedContext:
        """Enrich context with weather and location type if coordinates available."""
        if context.latitude is not None and context.longitude is not None:
            if context.weather is None or context.temperature is None:
                weather_data = await self.get_weather(context.latitude, context.longitude)
                if weather_data:
                    context.weather = context.weather or weather_data.get("weather")
                    context.temperature = context.temperature or weather_data.get("temperature")

        return context

    async def get_context_summary(
        self,
        user_id: UUID,
        days: int = 30,
    ) -> dict:
        """Get summary of context patterns for a user."""
        from sqlalchemy import func
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(
                MemoryContext.time_of_day,
                MemoryContext.day_of_week,
                MemoryContext.location_type,
                MemoryContext.activity_category,
                func.count(MemoryContext.id).label("count"),
            )
            .join(Memory, MemoryContext.memory_id == Memory.id)
            .where(Memory.user_id == user_id)
            .where(MemoryContext.created_at >= cutoff)
            .group_by(
                MemoryContext.time_of_day,
                MemoryContext.day_of_week,
                MemoryContext.location_type,
                MemoryContext.activity_category,
            )
        )
        rows = result.all()

        time_counts: dict[str, int] = {}
        day_counts: dict[str, int] = {}
        location_counts: dict[str, int] = {}
        activity_counts: dict[str, int] = {}

        for row in rows:
            if row.time_of_day:
                time_counts[row.time_of_day] = time_counts.get(row.time_of_day, 0) + row.count
            if row.day_of_week:
                day_counts[row.day_of_week] = day_counts.get(row.day_of_week, 0) + row.count
            if row.location_type:
                location_counts[row.location_type] = location_counts.get(row.location_type, 0) + row.count
            if row.activity_category:
                activity_counts[row.activity_category] = activity_counts.get(row.activity_category, 0) + row.count

        return {
            "time_of_day_distribution": time_counts,
            "day_of_week_distribution": day_counts,
            "location_type_distribution": location_counts,
            "activity_category_distribution": activity_counts,
            "total_contextualized_memories": sum(time_counts.values()),
        }
