"""Add missing indexes to connection models

Revision ID: 022
Revises: 021
Create Date: 2026-01-25

Adds performance indexes to:
- MemoryConnection: memory_id_1, memory_id_2, connection_type
- PersonProfile: entity_id, relationship_type, last_interaction_date
- Decision: memory_id, topic, decision_date, outcome_status, embedding (HNSW)
"""
from alembic import op

revision = '022'
down_revision = '021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # MemoryConnection indexes
    op.create_index(
        'idx_memory_connections_memory_1',
        'cortex_memory_connections',
        ['memory_id_1'],
        if_not_exists=True
    )
    op.create_index(
        'idx_memory_connections_memory_2',
        'cortex_memory_connections',
        ['memory_id_2'],
        if_not_exists=True
    )
    op.create_index(
        'idx_memory_connections_type',
        'cortex_memory_connections',
        ['user_id', 'connection_type'],
        if_not_exists=True
    )

    # PersonProfile indexes
    op.create_index(
        'idx_person_profiles_entity',
        'cortex_person_profiles',
        ['entity_id'],
        if_not_exists=True
    )
    op.create_index(
        'idx_person_profiles_relationship',
        'cortex_person_profiles',
        ['user_id', 'relationship_type'],
        if_not_exists=True
    )
    op.create_index(
        'idx_person_profiles_last_interaction',
        'cortex_person_profiles',
        ['user_id', 'last_interaction_date'],
        if_not_exists=True
    )

    # Decision indexes
    op.create_index(
        'idx_decisions_memory',
        'cortex_decisions',
        ['memory_id'],
        if_not_exists=True
    )
    op.create_index(
        'idx_decisions_topic',
        'cortex_decisions',
        ['user_id', 'topic'],
        if_not_exists=True
    )
    op.create_index(
        'idx_decisions_date',
        'cortex_decisions',
        ['user_id', 'decision_date'],
        if_not_exists=True
    )
    op.create_index(
        'idx_decisions_outcome',
        'cortex_decisions',
        ['user_id', 'outcome_status'],
        if_not_exists=True
    )
    # HNSW index for vector similarity search on decisions
    op.create_index(
        'idx_decisions_embedding',
        'cortex_decisions',
        ['embedding'],
        postgresql_using='hnsw',
        postgresql_ops={'embedding': 'vector_cosine_ops'},
        if_not_exists=True
    )


def downgrade() -> None:
    # Drop Decision indexes
    op.drop_index('idx_decisions_embedding', table_name='cortex_decisions')
    op.drop_index('idx_decisions_outcome', table_name='cortex_decisions')
    op.drop_index('idx_decisions_date', table_name='cortex_decisions')
    op.drop_index('idx_decisions_topic', table_name='cortex_decisions')
    op.drop_index('idx_decisions_memory', table_name='cortex_decisions')

    # Drop PersonProfile indexes
    op.drop_index('idx_person_profiles_last_interaction', table_name='cortex_person_profiles')
    op.drop_index('idx_person_profiles_relationship', table_name='cortex_person_profiles')
    op.drop_index('idx_person_profiles_entity', table_name='cortex_person_profiles')

    # Drop MemoryConnection indexes
    op.drop_index('idx_memory_connections_type', table_name='cortex_memory_connections')
    op.drop_index('idx_memory_connections_memory_2', table_name='cortex_memory_connections')
    op.drop_index('idx_memory_connections_memory_1', table_name='cortex_memory_connections')
