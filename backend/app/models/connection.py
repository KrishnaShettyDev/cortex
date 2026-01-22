"""Models for intelligence features: connections, profiles, and decisions."""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Float, Text, Date, DateTime, ForeignKey, CheckConstraint, UniqueConstraint
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
    )

    def __repr__(self) -> str:
        return f"<PersonProfile entity_id={self.entity_id}>"


class Decision(Base):
    """Extracted decisions from memories for contextual search."""

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

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")
    memory: Mapped["Memory"] = relationship("Memory")

    def __repr__(self) -> str:
        return f"<Decision topic='{self.topic[:30]}...'>"
