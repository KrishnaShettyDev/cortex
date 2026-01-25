"""Add rich context capture for memories

Revision ID: 011
Revises: 010
Create Date: 2026-01-24 11:00:00.000000

Rich context at memory encoding improves retrieval through context reinstatement.
Based on cognitive science: encoding specificity principle.

Captures:
- Location (coordinates, name, type)
- Time (local time, day of week, weekend)
- Environment (weather, temperature)
- Activity (what user was doing)
- Social (who was present)
- Device (capture source)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '011'
down_revision: Union[str, None] = '010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cortex_memory_contexts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Location context
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('location_name', sa.String(255), nullable=True),
        sa.Column('location_type', sa.String(50), nullable=True),  # home, work, cafe, gym, etc.

        # Temporal context
        sa.Column('local_time', sa.Time(), nullable=True),
        sa.Column('time_of_day', sa.String(20), nullable=True),  # morning, afternoon, evening, night
        sa.Column('day_of_week', sa.String(10), nullable=True),  # monday, tuesday, etc.
        sa.Column('is_weekend', sa.Boolean(), nullable=True),

        # Environmental context
        sa.Column('weather', sa.String(50), nullable=True),  # sunny, cloudy, rainy, etc.
        sa.Column('temperature', sa.Float(), nullable=True),  # Celsius

        # Activity context
        sa.Column('activity', sa.String(100), nullable=True),  # working, exercising, commuting, etc.
        sa.Column('activity_category', sa.String(50), nullable=True),  # work, health, social, etc.

        # Social context
        sa.Column('people_present', postgresql.JSONB(), server_default='[]', nullable=False),  # List of names/entities
        sa.Column('social_setting', sa.String(50), nullable=True),  # alone, family, friends, colleagues

        # Device context
        sa.Column('device_type', sa.String(50), nullable=True),  # iphone, android, web
        sa.Column('app_source', sa.String(50), nullable=True),  # voice, text, email, calendar

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_index('idx_context_memory', 'cortex_memory_contexts', ['memory_id'])
    op.create_index('idx_context_location', 'cortex_memory_contexts', ['latitude', 'longitude'])
    op.create_index('idx_context_time', 'cortex_memory_contexts', ['time_of_day', 'day_of_week'])
    op.create_index('idx_context_activity', 'cortex_memory_contexts', ['activity_category'])


def downgrade() -> None:
    op.drop_index('idx_context_activity', table_name='cortex_memory_contexts')
    op.drop_index('idx_context_time', table_name='cortex_memory_contexts')
    op.drop_index('idx_context_location', table_name='cortex_memory_contexts')
    op.drop_index('idx_context_memory', table_name='cortex_memory_contexts')
    op.drop_table('cortex_memory_contexts')
