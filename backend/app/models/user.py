import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    """User model for authentication and data ownership."""

    __tablename__ = "cortex_users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    oauth_id: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Location fields - updated when app comes to foreground
    location_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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
    memories: Mapped[list["Memory"]] = relationship(
        "Memory",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    entities: Mapped[list["Entity"]] = relationship(
        "Entity",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    connected_accounts: Mapped[list["ConnectedAccount"]] = relationship(
        "ConnectedAccount",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    push_tokens: Mapped[list["PushToken"]] = relationship(
        "PushToken",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    reminders: Mapped[list["Reminder"]] = relationship(
        "Reminder",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    fsrs_parameters: Mapped["FSRSParameters | None"] = relationship(
        "FSRSParameters",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    review_logs: Mapped[list["ReviewLog"]] = relationship(
        "ReviewLog",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    life_periods: Mapped[list["LifePeriod"]] = relationship(
        "LifePeriod",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    general_events: Mapped[list["GeneralEvent"]] = relationship(
        "GeneralEvent",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    intentions: Mapped[list["Intention"]] = relationship(
        "Intention",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    patterns: Mapped[list["Pattern"]] = relationship(
        "Pattern",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    # Autonomous email features
    scheduled_emails: Mapped[list["ScheduledEmail"]] = relationship(
        "ScheduledEmail",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    snoozed_emails: Mapped[list["SnoozedEmail"]] = relationship(
        "SnoozedEmail",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    auto_drafts: Mapped[list["AutoDraft"]] = relationship(
        "AutoDraft",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    auto_followup_rules: Mapped[list["AutoFollowUpRule"]] = relationship(
        "AutoFollowUpRule",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    # Proactive notification features
    notification_logs: Mapped[list["NotificationLog"]] = relationship(
        "NotificationLog",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notification_preferences: Mapped["NotificationPreferences | None"] = relationship(
        "NotificationPreferences",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<User {self.email}>"
