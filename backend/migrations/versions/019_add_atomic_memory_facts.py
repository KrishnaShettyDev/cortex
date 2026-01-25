"""Add atomic memory facts for MemoryBench SOTA implementation.

This migration adds:
1. cortex_memory_facts - Atomic facts extracted from memories
2. cortex_entity_relations - Entity relationships for multi-hop reasoning

Revision ID: 019_add_atomic_memory_facts
Revises: 018_add_proactive_notifications
Create Date: 2024-01-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector


# revision identifiers
revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create memory_facts table
    op.create_table(
        "cortex_memory_facts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("memory_id", UUID(as_uuid=True), sa.ForeignKey("cortex_memories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False),

        # Fact content
        sa.Column("fact_text", sa.Text, nullable=False),
        sa.Column("fact_type", sa.String(50), nullable=False),
        sa.Column("confidence", sa.Float, server_default="1.0"),

        # Entity information
        sa.Column("subject_entity", sa.String(255), nullable=True),
        sa.Column("object_entity", sa.String(255), nullable=True),
        sa.Column("relation", sa.String(100), nullable=True),

        # Temporal grounding
        sa.Column("document_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("temporal_expression", sa.String(255), nullable=True),

        # Versioning
        sa.Column("supersedes_fact_id", UUID(as_uuid=True), nullable=True),
        sa.Column("superseded_by_fact_id", UUID(as_uuid=True), nullable=True),
        sa.Column("is_current", sa.Boolean, server_default="true"),

        # Search
        sa.Column("embedding", Vector(1536), nullable=True),

        # Timestamps
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Add self-referential foreign keys
    op.create_foreign_key(
        "fk_fact_supersedes",
        "cortex_memory_facts", "cortex_memory_facts",
        ["supersedes_fact_id"], ["id"],
        ondelete="SET NULL"
    )
    op.create_foreign_key(
        "fk_fact_superseded_by",
        "cortex_memory_facts", "cortex_memory_facts",
        ["superseded_by_fact_id"], ["id"],
        ondelete="SET NULL"
    )

    # Create indexes for memory_facts
    op.create_index("idx_facts_user_id", "cortex_memory_facts", ["user_id"])
    op.create_index("idx_facts_memory_id", "cortex_memory_facts", ["memory_id"])
    op.create_index("idx_facts_subject", "cortex_memory_facts", ["subject_entity"])
    op.create_index("idx_facts_object", "cortex_memory_facts", ["object_entity"])
    op.create_index("idx_facts_event_date", "cortex_memory_facts", ["event_date"])
    op.create_index("idx_facts_is_current", "cortex_memory_facts", ["is_current"])
    op.create_index("idx_facts_fact_type", "cortex_memory_facts", ["fact_type"])

    # Create vector index for semantic search
    op.execute("""
        CREATE INDEX idx_facts_embedding ON cortex_memory_facts
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """)

    # Create entity_relations table
    op.create_table(
        "cortex_entity_relations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False),

        # Relationship
        sa.Column("source_entity", sa.String(255), nullable=False),
        sa.Column("relation_type", sa.String(100), nullable=False),
        sa.Column("target_entity", sa.String(255), nullable=False),

        # Source
        sa.Column("source_fact_id", UUID(as_uuid=True), sa.ForeignKey("cortex_memory_facts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confidence", sa.Float, server_default="1.0"),

        # Versioning
        sa.Column("is_current", sa.Boolean, server_default="true"),
        sa.Column("valid_from", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),

        # Timestamps
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Create indexes for entity_relations
    op.create_index("idx_relations_user_id", "cortex_entity_relations", ["user_id"])
    op.create_index("idx_relations_source", "cortex_entity_relations", ["source_entity"])
    op.create_index("idx_relations_target", "cortex_entity_relations", ["target_entity"])
    op.create_index("idx_relations_type", "cortex_entity_relations", ["relation_type"])
    op.create_index("idx_relations_is_current", "cortex_entity_relations", ["is_current"])


def downgrade() -> None:
    # Drop entity_relations
    op.drop_index("idx_relations_is_current", "cortex_entity_relations")
    op.drop_index("idx_relations_type", "cortex_entity_relations")
    op.drop_index("idx_relations_target", "cortex_entity_relations")
    op.drop_index("idx_relations_source", "cortex_entity_relations")
    op.drop_index("idx_relations_user_id", "cortex_entity_relations")
    op.drop_table("cortex_entity_relations")

    # Drop memory_facts
    op.execute("DROP INDEX IF EXISTS idx_facts_embedding")
    op.drop_index("idx_facts_fact_type", "cortex_memory_facts")
    op.drop_index("idx_facts_is_current", "cortex_memory_facts")
    op.drop_index("idx_facts_event_date", "cortex_memory_facts")
    op.drop_index("idx_facts_object", "cortex_memory_facts")
    op.drop_index("idx_facts_subject", "cortex_memory_facts")
    op.drop_index("idx_facts_memory_id", "cortex_memory_facts")
    op.drop_index("idx_facts_user_id", "cortex_memory_facts")
    op.drop_table("cortex_memory_facts")
