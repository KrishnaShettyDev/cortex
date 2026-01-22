"""Adaptive Learning Models - For tracking feedback, preferences, and memory access patterns."""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, DateTime, Date, ForeignKey, Float, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class UserFeedback(Base):
    """Tracks user feedback (thumbs up/down) on AI responses for learning."""

    __tablename__ = "cortex_user_feedback"

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

    # Context
    conversation_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Feedback type: 'positive', 'negative', 'correction'
    feedback_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Context: 'response', 'suggestion', 'memory_retrieval', 'action'
    feedback_context: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # What happened
    user_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    correction_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # User's correction

    # Which memories were used (for reinforcement)
    memories_used: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="feedbacks")

    def __repr__(self) -> str:
        return f"<UserFeedback {self.id} ({self.feedback_type})>"


class UserPreferences(Base):
    """Stores learned user preferences and patterns."""

    __tablename__ = "cortex_user_preferences"

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

    # Preference categorization
    # Types: 'communication_style', 'interests', 'schedule', 'relationships', 'topics', 'behavior'
    preference_type: Mapped[str] = mapped_column(String(50), nullable=False)
    preference_key: Mapped[str] = mapped_column(String(100), nullable=False)
    preference_value: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Learning confidence
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    evidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_observed: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
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
    user: Mapped["User"] = relationship("User", backref="preferences")

    def __repr__(self) -> str:
        return f"<UserPreferences {self.preference_type}:{self.preference_key}>"


class MemoryAccessLog(Base):
    """Tracks when and how memories are accessed for reinforcement learning."""

    __tablename__ = "cortex_memory_access_log"

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
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Access context
    # Types: 'search', 'chat_retrieval', 'connection', 'direct', 'suggestion'
    access_type: Mapped[str] = mapped_column(String(30), nullable=False)
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    was_useful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="memory_accesses")
    memory: Mapped["Memory"] = relationship("Memory", backref="access_logs")

    def __repr__(self) -> str:
        return f"<MemoryAccessLog {self.memory_id} ({self.access_type})>"


class Insight(Base):
    """Stores extracted patterns and insights from memory analysis."""

    __tablename__ = "cortex_insights"

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

    # Insight content
    # Types: 'pattern', 'summary', 'prediction', 'connection', 'trend'
    insight_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Source tracking
    source_memory_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)

    # Time relevance
    relevance_period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    relevance_period_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Notification tracking
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="insights")

    def __repr__(self) -> str:
        return f"<Insight {self.id} ({self.insight_type})>"
