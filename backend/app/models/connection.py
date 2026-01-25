"""Models for intelligence features: connections, profiles, and decisions."""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Float, Text, Date, DateTime, ForeignKey, CheckConstraint, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.database import Base


class MemoryConnection(Base):
    """Tracks discovered relationships between memories."""

    __tablename__ = "cortex_memory_connections"

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

    # Connected memories (memory_id_1 < memory_id_2 enforced by check constraint)
    memory_id_1: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
    )
    memory_id_2: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Connection metadata
    connection_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'semantic', 'entity', 'temporal'
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Notification tracking
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    memory_1: Mapped["Memory"] = relationship("Memory", foreign_keys=[memory_id_1])
    memory_2: Mapped["Memory"] = relationship("Memory", foreign_keys=[memory_id_2])

    __table_args__ = (
        CheckConstraint("memory_id_1 < memory_id_2", name="ck_connection_order"),
        UniqueConstraint("memory_id_1", "memory_id_2", name="uq_connection_pair"),
        Index("idx_memory_connections_memory_1", "memory_id_1"),
        Index("idx_memory_connections_memory_2", "memory_id_2"),
        Index("idx_memory_connections_type", "user_id", "connection_type"),
    )

    def __repr__(self) -> str:
        return f"<MemoryConnection {self.connection_type} strength={self.strength:.2f}>"


class PersonProfile(Base):
    """Cached aggregated intelligence about a person."""

    __tablename__ = "cortex_person_profiles"

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
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_entities.id", ondelete="CASCADE"),
        nullable=False,
    )

    # LLM-generated summary
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationship classification
    relationship_type: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )  # 'colleague', 'friend', 'family', 'contact', 'professional'

    # Common topics discussed
    topics: Mapped[list] = mapped_column(JSONB, default=list)

    # Sentiment analysis
    sentiment_trend: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )  # 'positive', 'neutral', 'negative', 'mixed'

    # Interaction tracking
    last_interaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_meeting_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Meeting prep notes
    context_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    user: Mapped["User"] = relationship("User")
    entity: Mapped["Entity"] = relationship("Entity")

    __table_args__ = (
        UniqueConstraint("user_id", "entity_id", name="uq_user_entity_profile"),
        Index("idx_person_profiles_entity", "entity_id"),
        Index("idx_person_profiles_relationship", "user_id", "relationship_type"),
        Index("idx_person_profiles_last_interaction", "user_id", "last_interaction_date"),
    )

    def __repr__(self) -> str:
        return f"<PersonProfile entity_id={self.entity_id}>"


class Decision(Base):
    """Extracted decisions from memories for contextual search and outcome tracking."""

    __tablename__ = "cortex_decisions"

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
    )

    # Decision content
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    decision_text: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Embedding for semantic search
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(1536),
        nullable=True,
    )

    # ==================== OUTCOME TRACKING ====================
    # Status: 'pending', 'successful', 'failed', 'abandoned', 'mixed'
    outcome_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    outcome_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    outcome_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_memory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Confidence tracking for learning
    confidence_at_decision: Mapped[float | None] = mapped_column(Float, default=0.5)
    confidence_in_hindsight: Mapped[float | None] = mapped_column(Float, nullable=True)

    # AI-extracted lessons from the outcome
    lessons_learned: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    memory: Mapped["Memory"] = relationship("Memory", foreign_keys=[memory_id])
    outcome_memory: Mapped["Memory"] = relationship("Memory", foreign_keys=[outcome_memory_id])

    __table_args__ = (
        Index("idx_decisions_memory", "memory_id"),
        Index("idx_decisions_topic", "user_id", "topic"),
        Index("idx_decisions_date", "user_id", "decision_date"),
        Index("idx_decisions_outcome", "user_id", "outcome_status"),
        Index(
            "idx_decisions_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    def __repr__(self) -> str:
        status = f" [{self.outcome_status}]" if self.outcome_status else ""
        return f"<Decision topic='{self.topic[:30]}...'{status}>"

    @property
    def has_outcome(self) -> bool:
        """Check if this decision has a recorded outcome."""
        return self.outcome_status is not None and self.outcome_status != 'pending'

    @property
    def was_successful(self) -> bool:
        """Check if this decision had a successful outcome."""
        return self.outcome_status == 'successful'
