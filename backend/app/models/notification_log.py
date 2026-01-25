"""Notification log model for tracking all proactive notifications."""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Float, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class NotificationLog(Base):
    """Log of all proactive notifications sent, queued, or suppressed."""

    __tablename__ = "cortex_notification_log"

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

    # Notification details
    notification_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # meeting_prep, urgent_email, commitment, pattern_warning, briefing, etc.

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    body: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Scoring and priority
    priority_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )
    urgency_level: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="medium",
    )  # high, medium, low

    # Source tracking
    source_service: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )  # briefing_service, pattern_service, email_urgency_service, etc.
    source_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )  # ID of related entity (meeting, email, commitment, etc.)

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="queued",
    )  # queued, sent, consolidated, suppressed, dismissed, snoozed

    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Engagement tracking
    opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    action_taken: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )  # tapped, dismissed, snoozed, etc.

    # Consolidation
    consolidated_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_notification_log.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Snooze support
    snoozed_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Metadata
    data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )  # Additional notification data (deep link info, etc.)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="notification_logs",
    )

    __table_args__ = (
        Index("idx_notification_log_user_date", "user_id", "created_at"),
        Index("idx_notification_log_user_status", "user_id", "status"),
        Index("idx_notification_log_user_type", "user_id", "notification_type"),
    )

    def __repr__(self) -> str:
        return f"<NotificationLog {self.notification_type}: {self.title[:30]} ({self.status})>"
