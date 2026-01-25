"""
MemoryFact model for atomic fact storage.

This implements the atomic memory extraction pattern used by SOTA memory systems
like Supermemory and Mem0 for better retrieval and reasoning.
"""

from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Text, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector

from app.database import Base


class MemoryFact(Base):
    """
    Atomic fact extracted from a memory.

    Instead of storing full conversations, we extract discrete facts like:
    - "Sarah got promoted to VP"
    - "User prefers Italian food"
    - "Meeting with John scheduled for Friday"

    This enables:
    - Better retrieval (search for specific facts)
    - Temporal reasoning (when did X happen)
    - Knowledge updates (Sarah now works at Google, not Meta)
    - Multi-hop reasoning (through entity relationships)
    """

    __tablename__ = "cortex_memory_facts"

    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    memory_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memories.id"), nullable=True)
    user_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # === Fact Content ===
    fact_text = Column(Text, nullable=False)
    fact_type = Column(String(50), nullable=False)  # person, event, preference, plan, location, etc.
    confidence = Column(Float, default=1.0)

    # === Entity Information ===
    subject_entity = Column(String(255), nullable=True)  # "Sarah", "User", "John"
    object_entity = Column(String(255), nullable=True)   # "VP", "Google", "Paris"
    relation = Column(String(100), nullable=True)        # "promoted_to", "works_at", "visited"

    # === Temporal Grounding ===
    document_date = Column(DateTime(timezone=True), nullable=False)  # When user mentioned this
    event_date = Column(DateTime(timezone=True), nullable=True)       # When it actually happened
    temporal_expression = Column(String(255), nullable=True)          # Original: "last week"

    # === Versioning (for knowledge updates) ===
    supersedes_fact_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memory_facts.id"), nullable=True)
    superseded_by_fact_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memory_facts.id"), nullable=True)
    is_current = Column(Boolean, default=True)  # False if superseded by newer fact

    # === Search ===
    embedding = Column(Vector(1536), nullable=True)

    # === Timestamps ===
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # === Relationships ===
    # Note: Memory.facts relationship should be added to Memory model when migration is run
    memory = relationship("Memory", foreign_keys=[memory_id])
    supersedes = relationship("MemoryFact", foreign_keys=[supersedes_fact_id], remote_side="MemoryFact.id", uselist=False)
    superseded_by = relationship("MemoryFact", foreign_keys=[superseded_by_fact_id], remote_side="MemoryFact.id", uselist=False)

    # === Indexes ===
    __table_args__ = (
        Index("idx_facts_user_id", "user_id"),
        Index("idx_facts_subject", "subject_entity"),
        Index("idx_facts_object", "object_entity"),
        Index("idx_facts_event_date", "event_date"),
        Index("idx_facts_is_current", "is_current"),
        Index("idx_facts_fact_type", "fact_type"),
    )

    def __repr__(self):
        return f"<MemoryFact(id={self.id}, fact='{self.fact_text[:50]}...', type={self.fact_type})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": str(self.id),
            "memory_id": str(self.memory_id) if self.memory_id else None,
            "fact_text": self.fact_text,
            "fact_type": self.fact_type,
            "confidence": self.confidence,
            "subject_entity": self.subject_entity,
            "object_entity": self.object_entity,
            "relation": self.relation,
            "document_date": self.document_date.isoformat() if self.document_date else None,
            "event_date": self.event_date.isoformat() if self.event_date else None,
            "temporal_expression": self.temporal_expression,
            "is_current": self.is_current,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EntityRelation(Base):
    """
    Entity relationships for multi-hop reasoning.

    Stores relationships like:
    - Sarah --works_at--> Google
    - John --is_friend_of--> User
    - Paris --visited_on--> 2024-01-15

    Enables queries like:
    - "Where does Sarah's manager work?" (multi-hop)
    - "Who did I meet at the Google office?" (relationship traversal)
    """

    __tablename__ = "cortex_entity_relations"

    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # === Relationship ===
    source_entity = Column(String(255), nullable=False)
    relation_type = Column(String(100), nullable=False)
    target_entity = Column(String(255), nullable=False)

    # === Source ===
    source_fact_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memory_facts.id"), nullable=True)
    confidence = Column(Float, default=1.0)

    # === Versioning ===
    is_current = Column(Boolean, default=True)
    valid_from = Column(DateTime(timezone=True), default=datetime.utcnow)
    valid_until = Column(DateTime(timezone=True), nullable=True)

    # === Timestamps ===
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # === Indexes ===
    __table_args__ = (
        Index("idx_relations_source", "source_entity"),
        Index("idx_relations_target", "target_entity"),
        Index("idx_relations_type", "relation_type"),
        Index("idx_relations_user_id", "user_id"),
    )

    def __repr__(self):
        return f"<EntityRelation({self.source_entity} --{self.relation_type}--> {self.target_entity})>"

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "id": str(self.id),
            "source_entity": self.source_entity,
            "relation_type": self.relation_type,
            "target_entity": self.target_entity,
            "confidence": self.confidence,
            "is_current": self.is_current,
            "valid_from": self.valid_from.isoformat() if self.valid_from else None,
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
        }
