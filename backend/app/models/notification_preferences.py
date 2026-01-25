"""Notification preferences model for user-specific notification settings."""

import uuid
from datetime import datetime, time
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Integer, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class NotificationPreferences(Base):
    """User preferences for proactive notifications."""

    __tablename__ = "cortex_notification_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Feature toggles
    enable_morning_briefing: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_evening_briefing: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_meeting_prep: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_email_alerts: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_commitment_reminders: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_pattern_warnings: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_reconnection_nudges: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_memory_insights: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    enable_important_dates: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    # Daily notification budget
    max_notifications_per_day: Mapped[int] = mapped_column(
        Integer,
        default=8,
        nullable=False,
    )
    max_urgent_per_day: Mapped[int] = mapped_column(
        Integer,
        default=3,
        nullable=False,
    )

    # Quiet hours
    quiet_hours_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    quiet_hours_start: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
        default=time(22, 0),  # 10 PM
    )
    quiet_hours_end: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
        default=time(7, 0),  # 7 AM
    )

    # Briefing timing
    morning_briefing_time: Mapped[time] = mapped_column(
        Time,
        default=time(8, 0),
        nullable=False,
    )
    evening_briefing_time: Mapped[time] = mapped_column(
        Time,
        default=time(18, 0),
        nullable=False,
    )

    # Meeting prep timing
    meeting_prep_minutes_before: Mapped[int] = mapped_column(
        Integer,
        default=30,
        nullable=False,
    )

    # Timezone
    timezone: Mapped[str] = mapped_column(
        String(50),
        default="UTC",
        nullable=False,
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
    user: Mapped["User"] = relationship(
        "User",
        back_populates="notification_preferences",
    )

    def __repr__(self) -> str:
        return f"<NotificationPreferences user={self.user_id} max={self.max_notifications_per_day}/day>"

    def is_feature_enabled(self, feature: str) -> bool:
        """Check if a specific notification feature is enabled."""
        feature_map = {
            "morning_briefing": self.enable_morning_briefing,
            "evening_briefing": self.enable_evening_briefing,
            "meeting_prep": self.enable_meeting_prep,
            "email_alerts": self.enable_email_alerts,
            "urgent_email": self.enable_email_alerts,
            "commitment_reminders": self.enable_commitment_reminders,
            "commitment": self.enable_commitment_reminders,
            "pattern_warnings": self.enable_pattern_warnings,
            "pattern_warning": self.enable_pattern_warnings,
            "reconnection_nudges": self.enable_reconnection_nudges,
            "reconnection": self.enable_reconnection_nudges,
            "memory_insights": self.enable_memory_insights,
            "memory_insight": self.enable_memory_insights,
            "important_dates": self.enable_important_dates,
            "important_date": self.enable_important_dates,
            "briefing": self.enable_morning_briefing or self.enable_evening_briefing,
        }
        return feature_map.get(feature, True)

    def is_quiet_hours(self, current_time: time) -> bool:
        """Check if current time is within quiet hours."""
        if not self.quiet_hours_enabled:
            return False

        start = self.quiet_hours_start
        end = self.quiet_hours_end

        if start is None or end is None:
            return False

        # Handle overnight quiet hours (e.g., 22:00 - 07:00)
        if start > end:
            return current_time >= start or current_time < end
        else:
            return start <= current_time < end
