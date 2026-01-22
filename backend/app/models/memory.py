import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, Index, Computed, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TSVECTOR
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

    __table_args__ = (
        Index("idx_cortex_memories_user_date", "user_id", "memory_date"),
        Index("idx_cortex_memories_type", "user_id", "memory_type"),
        Index("idx_cortex_memories_strength", "user_id", "strength"),  # For adaptive learning queries
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
