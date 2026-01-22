"""Reminder and Task models for smart notifications."""

import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Text, Index, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ReminderStatus(str, Enum):
    """Status of a reminder."""
    PENDING = "pending"
    SENT = "sent"
    SNOOZED = "snoozed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ReminderType(str, Enum):
    """Type of reminder trigger."""
    TIME = "time"  # Time-based reminder
    LOCATION = "location"  # Location-based reminder
    EVENT = "event"  # Before a calendar event


class Reminder(Base):
    """User reminders - time-based, location-based, or event-based."""

    __tablename__ = "cortex_reminders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Reminder content
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    body: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Trigger configuration
    reminder_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ReminderType.TIME.value,
    )

    # Time-based trigger
    remind_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    # Location-based trigger
    location_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    location_latitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    location_longitude: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    location_radius_meters: Mapped[int | None] = mapped_column(
        nullable=True,
        default=200,  # 200 meters default radius
    )

    # Event-based trigger (remind X minutes before event)
    event_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    minutes_before_event: Mapped[int | None] = mapped_column(
        nullable=True,
        default=15,
    )

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=ReminderStatus.PENDING.value,
        index=True,
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Recurrence (optional)
    is_recurring: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )
    recurrence_pattern: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )  # daily, weekly, monthly, etc.

    # Source tracking
    source_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )  # Original user message that created this reminder
    conversation_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    # Timestamps
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
    user: Mapped["User"] = relationship("User", back_populates="reminders")

    __table_args__ = (
        Index("idx_cortex_reminders_user_status", "user_id", "status"),
        Index("idx_cortex_reminders_pending_time", "status", "remind_at"),
    )

    def __repr__(self) -> str:
        return f"<Reminder {self.title} for user {self.user_id}>"


class Task(Base):
    """Tasks extracted from conversations or created manually."""

    __tablename__ = "cortex_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Task content
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Status
    is_completed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Optional due date
    due_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Priority (1-5, 1 being highest)
    priority: Mapped[int | None] = mapped_column(
        nullable=True,
        default=3,
    )

    # Source tracking
    source_type: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )  # 'conversation', 'email', 'manual'
    source_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )  # conversation_id, email_id, etc.
    extracted_from: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )  # Original text the task was extracted from

    # Related person (if task involves someone)
    related_person: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Timestamps
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
    user: Mapped["User"] = relationship("User", back_populates="tasks")

    __table_args__ = (
        Index("idx_cortex_tasks_user_status", "user_id", "is_completed"),
        Index("idx_cortex_tasks_due_date", "user_id", "due_date"),
    )

    def __repr__(self) -> str:
        return f"<Task {self.title[:30]} for user {self.user_id}>"
