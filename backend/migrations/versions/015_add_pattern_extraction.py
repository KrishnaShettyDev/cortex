"""Add pattern extraction tables for Phase 3.3.

Revision ID: 015
Revises: 014
Create Date: 2026-01-24

Patterns enable Cortex to detect behavioral patterns like:
- "You always overcommit after a good week"
- "Every time you skip the gym for 3 days, you abandon it for a month"
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers
revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create cortex_patterns table
    op.create_table(
        'cortex_patterns',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('cortex_users.id', ondelete='CASCADE'), nullable=False),

        # Pattern description
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=False),

        # Pattern structure: "When [trigger], you [behavior]"
        sa.Column('trigger', sa.Text, nullable=False),
        sa.Column('behavior', sa.Text, nullable=False),
        sa.Column('consequence', sa.Text, nullable=True),

        # Classification
        sa.Column('pattern_type', sa.String(20), default='behavioral'),
        sa.Column('valence', sa.String(20), default='neutral'),

        # Evidence
        sa.Column('evidence_memory_ids', JSONB, default=[]),
        sa.Column('evidence_count', sa.Integer, default=0),

        # Timing
        sa.Column('typical_delay_hours', sa.Integer, nullable=True),
        sa.Column('typical_duration_days', sa.Integer, nullable=True),

        # Confidence and learning
        sa.Column('confidence', sa.Float, default=0.5),
        sa.Column('last_observed', sa.DateTime, nullable=True),
        sa.Column('times_predicted', sa.Integer, default=0),
        sa.Column('times_accurate', sa.Integer, default=0),

        # Status
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('is_acknowledged', sa.Boolean, default=False),
        sa.Column('user_confirmed', sa.Boolean, nullable=True),

        # Chat templates
        sa.Column('prediction_template', sa.Text, nullable=True),
        sa.Column('warning_template', sa.Text, nullable=True),

        # Temporal patterns
        sa.Column('day_of_week', sa.Integer, nullable=True),
        sa.Column('time_of_day', sa.String(20), nullable=True),
        sa.Column('month_of_year', sa.Integer, nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now()),
    )

    # Create cortex_pattern_occurrences table
    op.create_table(
        'cortex_pattern_occurrences',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('pattern_id', UUID(as_uuid=True), sa.ForeignKey('cortex_patterns.id', ondelete='CASCADE'), nullable=False),

        # Related memories
        sa.Column('trigger_memory_id', UUID(as_uuid=True), sa.ForeignKey('cortex_memories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('behavior_memory_id', UUID(as_uuid=True), sa.ForeignKey('cortex_memories.id', ondelete='SET NULL'), nullable=True),

        # Tracking
        sa.Column('predicted', sa.Boolean, default=False),
        sa.Column('observed', sa.Boolean, default=False),
        sa.Column('predicted_at', sa.DateTime, nullable=True),
        sa.Column('observed_at', sa.DateTime, nullable=True),

        # Prediction accuracy
        sa.Column('prediction_was_accurate', sa.Boolean, nullable=True),
        sa.Column('user_prevented', sa.Boolean, nullable=True),

        # Context
        sa.Column('notes', sa.Text, nullable=True),

        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
    )

    # Create indexes
    op.create_index('idx_patterns_user', 'cortex_patterns', ['user_id'])
    op.create_index('idx_patterns_type', 'cortex_patterns', ['pattern_type'])
    op.create_index('idx_patterns_valence', 'cortex_patterns', ['valence'])
    op.create_index('idx_patterns_active', 'cortex_patterns', ['is_active'])
    op.create_index('idx_patterns_confidence', 'cortex_patterns', ['confidence'])

    op.create_index('idx_pattern_occurrences_pattern', 'cortex_pattern_occurrences', ['pattern_id'])
    op.create_index('idx_pattern_occurrences_trigger', 'cortex_pattern_occurrences', ['trigger_memory_id'])
    op.create_index('idx_pattern_occurrences_behavior', 'cortex_pattern_occurrences', ['behavior_memory_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_pattern_occurrences_behavior', 'cortex_pattern_occurrences')
    op.drop_index('idx_pattern_occurrences_trigger', 'cortex_pattern_occurrences')
    op.drop_index('idx_pattern_occurrences_pattern', 'cortex_pattern_occurrences')

    op.drop_index('idx_patterns_confidence', 'cortex_patterns')
    op.drop_index('idx_patterns_active', 'cortex_patterns')
    op.drop_index('idx_patterns_valence', 'cortex_patterns')
    op.drop_index('idx_patterns_type', 'cortex_patterns')
    op.drop_index('idx_patterns_user', 'cortex_patterns')

    # Drop tables
    op.drop_table('cortex_pattern_occurrences')
    op.drop_table('cortex_patterns')
