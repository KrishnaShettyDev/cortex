"""Add intelligence tables for connections, profiles, and decisions

Revision ID: 005
Revises: 004
Create Date: 2026-01-20 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Memory connections table - tracks discovered relationships between memories
    op.create_table(
        'cortex_memory_connections',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('memory_id_1', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('memory_id_2', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('connection_type', sa.String(50), nullable=False),  # 'semantic', 'entity', 'temporal'
        sa.Column('strength', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id_1'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id_2'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('memory_id_1 < memory_id_2', name='ck_connection_order'),
    )
    op.create_index('idx_connections_user', 'cortex_memory_connections', ['user_id'])
    op.create_index('idx_connections_unnotified', 'cortex_memory_connections', ['user_id', 'notified_at'],
                    postgresql_where=sa.text('notified_at IS NULL'))
    op.create_unique_constraint('uq_connection_pair', 'cortex_memory_connections', ['memory_id_1', 'memory_id_2'])

    # Person profiles table - cached aggregated person intelligence
    op.create_table(
        'cortex_person_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('relationship_type', sa.String(50), nullable=True),  # 'colleague', 'friend', 'family', 'contact'
        sa.Column('topics', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('sentiment_trend', sa.String(20), nullable=True),  # 'positive', 'neutral', 'negative', 'mixed'
        sa.Column('last_interaction_date', sa.Date(), nullable=True),
        sa.Column('next_meeting_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('context_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_person_profiles_user', 'cortex_person_profiles', ['user_id'])
    op.create_index('idx_person_profiles_next_meeting', 'cortex_person_profiles', ['next_meeting_date'],
                    postgresql_where=sa.text('next_meeting_date IS NOT NULL'))
    op.create_unique_constraint('uq_user_entity_profile', 'cortex_person_profiles', ['user_id', 'entity_id'])

    # Decisions table - extracted decisions from memories
    op.create_table(
        'cortex_decisions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('topic', sa.String(255), nullable=False),
        sa.Column('decision_text', sa.Text(), nullable=False),
        sa.Column('context', sa.Text(), nullable=True),
        sa.Column('decision_date', sa.Date(), nullable=False),
        sa.Column('embedding', Vector(1536), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_decisions_user', 'cortex_decisions', ['user_id'])
    op.create_index('idx_decisions_topic', 'cortex_decisions', ['user_id', 'topic'])
    op.execute("""
        CREATE INDEX idx_decisions_embedding ON cortex_decisions
        USING hnsw (embedding vector_cosine_ops)
    """)


def downgrade() -> None:
    # Drop decisions table
    op.execute('DROP INDEX IF EXISTS idx_decisions_embedding')
    op.drop_index('idx_decisions_topic', table_name='cortex_decisions')
    op.drop_index('idx_decisions_user', table_name='cortex_decisions')
    op.drop_table('cortex_decisions')

    # Drop person profiles table
    op.drop_constraint('uq_user_entity_profile', 'cortex_person_profiles', type_='unique')
    op.drop_index('idx_person_profiles_next_meeting', table_name='cortex_person_profiles')
    op.drop_index('idx_person_profiles_user', table_name='cortex_person_profiles')
    op.drop_table('cortex_person_profiles')

    # Drop connections table
    op.drop_constraint('uq_connection_pair', 'cortex_memory_connections', type_='unique')
    op.drop_index('idx_connections_unnotified', table_name='cortex_memory_connections')
    op.drop_index('idx_connections_user', table_name='cortex_memory_connections')
    op.drop_table('cortex_memory_connections')
