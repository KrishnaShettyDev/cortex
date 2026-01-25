import uuid
from datetime import datetime, date
from sqlalchemy import String, Text, DateTime, Date, ForeignKey, Index, Computed, Float, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TSVECTOR, JSONB
from pgvector.sqlalchemy import Vector

from app.database import Base


class Memory(Base):
    """Memory model - the core unit of stored information."""

    __tablename__ = "cortex_memories"

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

    # Content
    content: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Adaptive Learning Fields
    strength: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)  # Memory strength (0-1), decays over time
    emotional_weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)  # Emotional importance (0-1)
    access_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # How many times retrieved
    last_accessed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # Last retrieval time

    # SM2 Spaced Repetition Algorithm Fields (legacy, kept for backwards compatibility)
    easiness_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # FSRS-6 Spaced Repetition Fields (state-of-the-art algorithm)
    fsrs_stability: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    fsrs_difficulty: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    fsrs_last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fsrs_reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fsrs_lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fsrs_state: Mapped[str] = mapped_column(String(20), nullable=False, default='new')
    fsrs_scheduled_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    fsrs_elapsed_days: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Memory Consolidation Fields
    consolidated_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="SET NULL"),
        nullable=True,
    )  # If this memory was merged into another

    # Autobiographical Hierarchy
    life_period_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_life_periods.id", ondelete="SET NULL"),
        nullable=True,
    )
    general_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_general_events.id", ondelete="SET NULL"),
        nullable=True,
    )
    consolidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_consolidated_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # Is this a synthesized memory?
    source_memory_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # For consolidated memories: list of source IDs

    # Type: 'voice', 'text', 'photo', 'email', 'calendar'
    memory_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Source metadata for integrations
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Media URLs (stored in R2)
    audio_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Vector embedding for semantic search (1536 dimensions for text-embedding-3-small)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(1536),
        nullable=True,
    )

    # Timestamps
    memory_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
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

    # Full-text search vector (generated column)
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(summary, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(content, '')), 'B')",
            persisted=True,
        ),
        nullable=True,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="memories")
    entities: Mapped[list["Entity"]] = relationship(
        "Entity",
        secondary="cortex_memory_entities",
        back_populates="memories",
    )
    # Self-referential relationship for consolidation
    consolidated_into: Mapped["Memory | None"] = relationship(
        "Memory",
        remote_side=[id],
        foreign_keys=[consolidated_into_id],
        uselist=False,
    )
    # FSRS review logs
    review_logs: Mapped[list["ReviewLog"]] = relationship(
        "ReviewLog",
        back_populates="memory",
        cascade="all, delete-orphan",
    )
    # Rich context capture
    context: Mapped["MemoryContext | None"] = relationship(
        "MemoryContext",
        back_populates="memory",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # 3D Emotional signature
    emotional_signature: Mapped["EmotionalSignature | None"] = relationship(
        "EmotionalSignature",
        back_populates="memory",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # Autobiographical hierarchy
    life_period: Mapped["LifePeriod | None"] = relationship(
        "LifePeriod",
        back_populates="memories",
    )
    general_event: Mapped["GeneralEvent | None"] = relationship(
        "GeneralEvent",
        back_populates="memories",
    )

    __table_args__ = (
        Index("idx_cortex_memories_user_date", "user_id", "memory_date"),
        Index("idx_cortex_memories_type", "user_id", "memory_type"),
        Index("idx_cortex_memories_strength", "user_id", "strength"),
        Index("idx_cortex_memories_next_review", "user_id", "next_review_date"),
        Index("idx_cortex_memories_fsrs_state", "user_id", "fsrs_state"),
        Index("idx_memories_life_period", "life_period_id"),
        Index("idx_memories_general_event", "general_event_id"),
        Index(
            "idx_cortex_memories_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index(
            "idx_cortex_memories_search",
            "search_vector",
            postgresql_using="gin",
        ),
    )

    def __repr__(self) -> str:
        return f"<Memory {self.id} ({self.memory_type})>"

    @property
    def is_due_for_review(self) -> bool:
        """Check if this memory is due for spaced repetition review (FSRS-based)."""
        if self.next_review_date is None:
            return False
        return date.today() >= self.next_review_date

    @property
    def fsrs_retrievability(self) -> float:
        """Calculate current retrievability using FSRS formula.

        R(t,S) = (1 + factor × t/S)^(-decay)
        where factor=19/81, decay=0.5 (default FSRS-6 parameters)
        """
        if self.fsrs_last_review is None or self.fsrs_stability <= 0:
            return 1.0 if self.fsrs_state == 'new' else 0.9

        from datetime import timezone
        now = datetime.now(timezone.utc)
        last_review = self.fsrs_last_review
        if last_review.tzinfo is None:
            last_review = last_review.replace(tzinfo=timezone.utc)

        elapsed_days = (now - last_review).total_seconds() / 86400
        factor = 19 / 81  # FSRS default
        decay = 0.5  # FSRS default w20

        return pow(1 + factor * elapsed_days / self.fsrs_stability, -decay)

    @property
    def was_consolidated(self) -> bool:
        """Check if this memory was merged into another."""
        return self.consolidated_into_id is not None
