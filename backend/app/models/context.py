"""Memory Context Model.

Captures rich context at memory encoding time to enable context-dependent
retrieval (encoding specificity principle from cognitive science).
"""
import uuid
from datetime import datetime, time
from sqlalchemy import String, DateTime, Time, ForeignKey, Float, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class MemoryContext(Base):
    """Rich context captured at memory encoding time.

    Based on encoding specificity principle: memories are more easily
    retrieved when the retrieval context matches the encoding context.
    """

    __tablename__ = "cortex_memory_contexts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Location context
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Temporal context
    local_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    time_of_day: Mapped[str | None] = mapped_column(String(20), nullable=True)
    day_of_week: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_weekend: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Environmental context
    weather: Mapped[str | None] = mapped_column(String(50), nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Activity context
    activity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    activity_category: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Social context
    people_present: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    social_setting: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Device context
    device_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    app_source: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="context")

    __table_args__ = (
        Index("idx_context_memory", "memory_id"),
        Index("idx_context_location", "latitude", "longitude"),
        Index("idx_context_time", "time_of_day", "day_of_week"),
        Index("idx_context_activity", "activity_category"),
    )

    def __repr__(self) -> str:
        return f"<MemoryContext {self.id} for memory {self.memory_id}>"

    @classmethod
    def get_time_of_day(cls, hour: int) -> str:
        """Determine time of day category from hour."""
        if 5 <= hour < 12:
            return "morning"
        elif 12 <= hour < 17:
            return "afternoon"
        elif 17 <= hour < 21:
            return "evening"
        else:
            return "night"

    @classmethod
    def is_weekend_day(cls, day_of_week: str) -> bool:
        """Check if day is a weekend."""
        return day_of_week.lower() in ("saturday", "sunday")

    def matches_current_context(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        time_of_day: str | None = None,
        day_of_week: str | None = None,
        activity_category: str | None = None,
        location_type: str | None = None,
    ) -> float:
        """Calculate context match score (0-1) for retrieval.

        Used for context reinstatement during memory retrieval.
        """
        score = 0.0
        factors = 0

        if latitude is not None and longitude is not None and self.latitude and self.longitude:
            distance = self._haversine_distance(
                latitude, longitude, self.latitude, self.longitude
            )
            if distance < 0.5:  # Within 500m
                score += 1.0
            elif distance < 2:  # Within 2km
                score += 0.5
            factors += 1

        if time_of_day and self.time_of_day:
            if time_of_day.lower() == self.time_of_day.lower():
                score += 1.0
            factors += 1

        if day_of_week and self.day_of_week:
            if day_of_week.lower() == self.day_of_week.lower():
                score += 1.0
            elif self.is_weekend is not None:
                is_current_weekend = self.is_weekend_day(day_of_week)
                if is_current_weekend == self.is_weekend:
                    score += 0.5
            factors += 1

        if activity_category and self.activity_category:
            if activity_category.lower() == self.activity_category.lower():
                score += 1.0
            factors += 1

        if location_type and self.location_type:
            if location_type.lower() == self.location_type.lower():
                score += 1.0
            factors += 1

        return score / factors if factors > 0 else 0.0

    @staticmethod
    def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two points in km."""
        import math
        R = 6371  # Earth's radius in km

        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)

        a = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c
