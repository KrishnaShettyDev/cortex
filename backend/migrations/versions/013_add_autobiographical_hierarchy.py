"""Add autobiographical memory hierarchy

Revision ID: 013
Revises: 012
Create Date: 2026-01-24 13:00:00.000000

Implements Conway's Self-Memory System (SMS):
- Life Periods: Major life chapters (e.g., "College years", "First job")
- General Events: Recurring or extended events within periods
- Specific Memories: Individual episodic memories

This hierarchy improves retrieval by enabling top-down search through
autobiographical knowledge structures.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector


revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Life Periods - Major chapters of life
    op.create_table(
        'cortex_life_periods',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),

        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('is_current', sa.Boolean(), nullable=False, server_default='false'),

        # Themes and goals associated with this period
        sa.Column('themes', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('identity_goals', postgresql.JSONB(), server_default='[]', nullable=False),

        # Key people and places
        sa.Column('key_people', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('key_locations', postgresql.JSONB(), server_default='[]', nullable=False),

        # Semantic embedding for similarity search
        sa.Column('embedding', Vector(1536), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_life_periods_user', 'cortex_life_periods', ['user_id'])
    op.create_index('idx_life_periods_dates', 'cortex_life_periods', ['user_id', 'start_date', 'end_date'])
    op.create_index('idx_life_periods_current', 'cortex_life_periods', ['user_id', 'is_current'])

    # General Events - Recurring or extended events
    op.create_table(
        'cortex_general_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('life_period_id', postgresql.UUID(as_uuid=True), nullable=True),

        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),

        # Event type: repeated (weekly dinner), extended (vacation), first_time (first day at job)
        sa.Column('event_type', sa.String(50), nullable=False),
        # Frequency for repeated events: daily, weekly, monthly, yearly
        sa.Column('frequency', sa.String(20), nullable=True),

        # Participants and location
        sa.Column('participants', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('location_pattern', sa.String(255), nullable=True),

        # Occurrence tracking
        sa.Column('first_occurrence', sa.Date(), nullable=True),
        sa.Column('last_occurrence', sa.Date(), nullable=True),
        sa.Column('occurrence_count', sa.Integer(), nullable=False, server_default='1'),

        # Semantic embedding
        sa.Column('embedding', Vector(1536), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['life_period_id'], ['cortex_life_periods.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_general_events_user', 'cortex_general_events', ['user_id'])
    op.create_index('idx_general_events_period', 'cortex_general_events', ['life_period_id'])
    op.create_index('idx_general_events_type', 'cortex_general_events', ['user_id', 'event_type'])

    # Add hierarchy references to memories
    op.add_column('cortex_memories', sa.Column('life_period_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('cortex_memories', sa.Column('general_event_id', postgresql.UUID(as_uuid=True), nullable=True))

    op.create_foreign_key(
        'fk_memory_life_period',
        'cortex_memories', 'cortex_life_periods',
        ['life_period_id'], ['id'],
        ondelete='SET NULL'
    )
    op.create_foreign_key(
        'fk_memory_general_event',
        'cortex_memories', 'cortex_general_events',
        ['general_event_id'], ['id'],
        ondelete='SET NULL'
    )

    op.create_index('idx_memories_life_period', 'cortex_memories', ['life_period_id'])
    op.create_index('idx_memories_general_event', 'cortex_memories', ['general_event_id'])


def downgrade() -> None:
    # Remove memory hierarchy references
    op.drop_index('idx_memories_general_event', table_name='cortex_memories')
    op.drop_index('idx_memories_life_period', table_name='cortex_memories')
    op.drop_constraint('fk_memory_general_event', 'cortex_memories', type_='foreignkey')
    op.drop_constraint('fk_memory_life_period', 'cortex_memories', type_='foreignkey')
    op.drop_column('cortex_memories', 'general_event_id')
    op.drop_column('cortex_memories', 'life_period_id')

    # Drop general events
    op.drop_index('idx_general_events_type', table_name='cortex_general_events')
    op.drop_index('idx_general_events_period', table_name='cortex_general_events')
    op.drop_index('idx_general_events_user', table_name='cortex_general_events')
    op.drop_table('cortex_general_events')

    # Drop life periods
    op.drop_index('idx_life_periods_current', table_name='cortex_life_periods')
    op.drop_index('idx_life_periods_dates', table_name='cortex_life_periods')
    op.drop_index('idx_life_periods_user', table_name='cortex_life_periods')
    op.drop_table('cortex_life_periods')
