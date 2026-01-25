"""Autobiographical Memory Hierarchy Models.

Implements Conway's Self-Memory System (SMS):
- Life Periods: Major life chapters
- General Events: Recurring or extended events
- Specific Memories: Individual episodes

This hierarchical structure improves memory retrieval through
top-down search within autobiographical knowledge structures.
"""
import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, DateTime, Date, ForeignKey, Integer, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.database import Base


class LifePeriod(Base):
    """A major chapter or period in life.

    Examples:
    - "College years" (2018-2022)
    - "First job at TechCorp" (2022-2024)
    - "Living in San Francisco" (2024-present)

    Life periods provide the highest level of autobiographical organization.
    """

    __tablename__ = "cortex_life_periods"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Themes define the character of this period
    themes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Goals that defined this period
    identity_goals: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Important people during this period
    key_people: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Important locations
    key_locations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Semantic embedding for similarity
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="life_periods")
    general_events: Mapped[list["GeneralEvent"]] = relationship(
        "GeneralEvent",
        back_populates="life_period",
        cascade="all, delete-orphan",
    )
    memories: Mapped[list["Memory"]] = relationship(
        "Memory",
        back_populates="life_period",
    )

    __table_args__ = (
        Index("idx_life_periods_user", "user_id"),
        Index("idx_life_periods_dates", "user_id", "start_date", "end_date"),
        Index("idx_life_periods_current", "user_id", "is_current"),
    )

    def __repr__(self) -> str:
        return f"<LifePeriod '{self.name}' ({self.start_date} - {self.end_date or 'present'})>"

    @property
    def duration_days(self) -> int:
        """Get duration in days."""
        end = self.end_date or date.today()
        return (end - self.start_date).days

    @property
    def duration_years(self) -> float:
        """Get duration in years."""
        return self.duration_days / 365.25

    def contains_date(self, check_date: date) -> bool:
        """Check if a date falls within this period."""
        if check_date < self.start_date:
            return False
        if self.end_date and check_date > self.end_date:
            return False
        return True


class GeneralEvent(Base):
    """A recurring or extended event within a life period.

    Types:
    - repeated: Regular occurrences (weekly dinners, morning runs)
    - extended: Multi-day events (vacations, conferences)
    - first_time: Significant firsts (first day at work, first date)

    General events group related specific memories together.
    """

    __tablename__ = "cortex_general_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    life_period_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_life_periods.id", ondelete="SET NULL"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Event classification
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)  # repeated, extended, first_time
    frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)  # daily, weekly, monthly, yearly

    # Participants and location
    participants: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    location_pattern: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Occurrence tracking
    first_occurrence: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_occurrence: Mapped[date | None] = mapped_column(Date, nullable=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Semantic embedding
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="general_events")
    life_period: Mapped["LifePeriod | None"] = relationship(
        "LifePeriod",
        back_populates="general_events",
    )
    memories: Mapped[list["Memory"]] = relationship(
        "Memory",
        back_populates="general_event",
    )

    __table_args__ = (
        Index("idx_general_events_user", "user_id"),
        Index("idx_general_events_period", "life_period_id"),
        Index("idx_general_events_type", "user_id", "event_type"),
    )

    def __repr__(self) -> str:
        return f"<GeneralEvent '{self.name}' ({self.event_type})>"

    def record_occurrence(self, occurrence_date: date) -> None:
        """Record a new occurrence of this event."""
        if self.first_occurrence is None or occurrence_date < self.first_occurrence:
            self.first_occurrence = occurrence_date
        if self.last_occurrence is None or occurrence_date > self.last_occurrence:
            self.last_occurrence = occurrence_date
        self.occurrence_count += 1

    @property
    def is_active(self) -> bool:
        """Check if this is an ongoing/active event."""
        if self.event_type == "repeated":
            if self.last_occurrence:
                days_since = (date.today() - self.last_occurrence).days
                if self.frequency == "daily":
                    return days_since < 7
                elif self.frequency == "weekly":
                    return days_since < 30
                elif self.frequency == "monthly":
                    return days_since < 90
                elif self.frequency == "yearly":
                    return days_since < 400
        return False
