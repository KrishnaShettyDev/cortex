import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.database import Base


class Entity(Base):
    """Entity model - people, places, topics, and companies extracted from memories."""

    __tablename__ = "cortex_entities"

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

    # Entity info
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'person', 'place', 'topic', 'company'

    # Optional metadata
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    extra_data: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    # Stats
    mention_count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Embedding for semantic matching
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(1536),
        nullable=True,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="entities")
    memories: Mapped[list["Memory"]] = relationship(
        "Memory",
        secondary="cortex_memory_entities",
        back_populates="entities",
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", "entity_type", name="uq_cortex_entity_user_name_type"),
    )

    def __repr__(self) -> str:
        return f"<Entity {self.name} ({self.entity_type})>"


class MemoryEntity(Base):
    """Junction table for Memory-Entity many-to-many relationship."""

    __tablename__ = "cortex_memory_entities"

    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        primary_key=True,
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_entities.id", ondelete="CASCADE"),
        primary_key=True,
    )
