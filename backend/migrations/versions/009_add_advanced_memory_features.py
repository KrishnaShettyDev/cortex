"""Add advanced memory features: Decision outcomes, SM2 spaced repetition, memory consolidation

Revision ID: 009
Revises: 008
Create Date: 2026-01-23 10:00:00.000000

Features:
- Decision outcome tracking (track if decisions worked out)
- SM2 spaced repetition algorithm fields (easiness_factor, interval, repetitions)
- Memory consolidation tracking (parent/child relationships, consolidated_at)
- Temporal patterns table for detected recurring behaviors
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = '009'
down_revision: Union[str, None] = '008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ==================== DECISION OUTCOME TRACKING ====================
    # Add outcome tracking fields to decisions table
    op.add_column('cortex_decisions', sa.Column('outcome_status', sa.String(20), nullable=True))  # 'pending', 'successful', 'failed', 'abandoned', 'mixed'
    op.add_column('cortex_decisions', sa.Column('outcome_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cortex_decisions', sa.Column('outcome_notes', sa.Text(), nullable=True))
    op.add_column('cortex_decisions', sa.Column('outcome_memory_id', postgresql.UUID(as_uuid=True), nullable=True))  # Memory that recorded the outcome
    op.add_column('cortex_decisions', sa.Column('confidence_at_decision', sa.Float(), nullable=True, server_default='0.5'))  # How confident user was
    op.add_column('cortex_decisions', sa.Column('confidence_in_hindsight', sa.Float(), nullable=True))  # After knowing outcome
    op.add_column('cortex_decisions', sa.Column('lessons_learned', sa.Text(), nullable=True))  # AI-extracted lessons

    # Foreign key for outcome memory
    op.create_foreign_key(
        'fk_decision_outcome_memory',
        'cortex_decisions', 'cortex_memories',
        ['outcome_memory_id'], ['id'],
        ondelete='SET NULL'
    )

    # Index for finding pending decisions (need outcome tracking)
    op.create_index('idx_decisions_outcome_status', 'cortex_decisions', ['user_id', 'outcome_status'])
    op.create_index('idx_decisions_date', 'cortex_decisions', ['user_id', 'decision_date'])

    # ==================== SM2 SPACED REPETITION ====================
    # Add SM2 algorithm fields to memories table
    op.add_column('cortex_memories', sa.Column('easiness_factor', sa.Float(), nullable=False, server_default='2.5'))  # SM2: starts at 2.5
    op.add_column('cortex_memories', sa.Column('interval_days', sa.Integer(), nullable=False, server_default='1'))  # Days until next review
    op.add_column('cortex_memories', sa.Column('repetitions', sa.Integer(), nullable=False, server_default='0'))  # Successful reviews in a row
    op.add_column('cortex_memories', sa.Column('next_review_date', sa.Date(), nullable=True))  # When to surface this memory
    op.add_column('cortex_memories', sa.Column('last_quality_score', sa.Integer(), nullable=True))  # Last SM2 quality (0-5)

    # Index for finding memories due for review
    op.create_index('idx_cortex_memories_next_review', 'cortex_memories', ['user_id', 'next_review_date'])

    # ==================== MEMORY CONSOLIDATION ====================
    # Add consolidation tracking to memories
    op.add_column('cortex_memories', sa.Column('consolidated_into_id', postgresql.UUID(as_uuid=True), nullable=True))  # Parent if consolidated
    op.add_column('cortex_memories', sa.Column('consolidated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cortex_memories', sa.Column('is_consolidated_memory', sa.Boolean(), nullable=False, server_default='false'))  # Is this a synthesized memory?
    op.add_column('cortex_memories', sa.Column('source_memory_ids', postgresql.JSONB(), nullable=True))  # For consolidated memories: list of source IDs

    # Self-referential foreign key for consolidation
    op.create_foreign_key(
        'fk_memory_consolidated_into',
        'cortex_memories', 'cortex_memories',
        ['consolidated_into_id'], ['id'],
        ondelete='SET NULL'
    )

    # ==================== TEMPORAL PATTERNS ====================
    # Table for detected temporal patterns (e.g., "You always feel tired on Mondays")
    op.create_table(
        'cortex_temporal_patterns',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Pattern definition
        sa.Column('pattern_type', sa.String(50), nullable=False),  # 'daily', 'weekly', 'monthly', 'seasonal', 'event_triggered'
        sa.Column('trigger', sa.String(255), nullable=False),  # e.g., "Monday morning", "after meetings", "end of month"
        sa.Column('behavior', sa.Text(), nullable=False),  # What happens: "You tend to feel tired"
        sa.Column('recommendation', sa.Text(), nullable=True),  # AI suggestion: "Consider scheduling light tasks"

        # Pattern strength and evidence
        sa.Column('confidence', sa.Float(), nullable=False, server_default='0.5'),
        sa.Column('occurrence_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('last_occurred', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source_memory_ids', postgresql.JSONB(), server_default='[]', nullable=False),

        # Embedding for semantic search
        sa.Column('embedding', Vector(1536), nullable=True),

        # User interaction
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('confirmed_by_user', sa.Boolean(), nullable=True),  # User confirmed this pattern is real
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_temporal_patterns_user', 'cortex_temporal_patterns', ['user_id'])
    op.create_index('idx_temporal_patterns_type', 'cortex_temporal_patterns', ['user_id', 'pattern_type'])
    op.create_index('idx_temporal_patterns_confidence', 'cortex_temporal_patterns', ['user_id', 'confidence'])

    # ==================== DECISION ACCURACY METRICS ====================
    # Table for tracking decision-making accuracy over time
    op.create_table(
        'cortex_decision_metrics',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Aggregated metrics
        sa.Column('topic', sa.String(255), nullable=False),  # Decision topic/category
        sa.Column('total_decisions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('successful_decisions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_decisions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('success_rate', sa.Float(), nullable=True),  # Calculated: successful / (successful + failed)

        # Trend analysis
        sa.Column('avg_confidence_when_successful', sa.Float(), nullable=True),
        sa.Column('avg_confidence_when_failed', sa.Float(), nullable=True),
        sa.Column('common_success_factors', postgresql.JSONB(), nullable=True),  # AI-extracted patterns
        sa.Column('common_failure_factors', postgresql.JSONB(), nullable=True),

        # Time tracking
        sa.Column('period_start', sa.Date(), nullable=False),
        sa.Column('period_end', sa.Date(), nullable=False),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_decision_metrics_user', 'cortex_decision_metrics', ['user_id'])
    op.create_index('idx_decision_metrics_topic', 'cortex_decision_metrics', ['user_id', 'topic'])


def downgrade() -> None:
    # Drop decision metrics table
    op.drop_index('idx_decision_metrics_topic', table_name='cortex_decision_metrics')
    op.drop_index('idx_decision_metrics_user', table_name='cortex_decision_metrics')
    op.drop_table('cortex_decision_metrics')

    # Drop temporal patterns table
    op.drop_index('idx_temporal_patterns_confidence', table_name='cortex_temporal_patterns')
    op.drop_index('idx_temporal_patterns_type', table_name='cortex_temporal_patterns')
    op.drop_index('idx_temporal_patterns_user', table_name='cortex_temporal_patterns')
    op.drop_table('cortex_temporal_patterns')

    # Remove consolidation columns from memories
    op.drop_constraint('fk_memory_consolidated_into', 'cortex_memories', type_='foreignkey')
    op.drop_column('cortex_memories', 'source_memory_ids')
    op.drop_column('cortex_memories', 'is_consolidated_memory')
    op.drop_column('cortex_memories', 'consolidated_at')
    op.drop_column('cortex_memories', 'consolidated_into_id')

    # Remove SM2 columns from memories
    op.drop_index('idx_cortex_memories_next_review', table_name='cortex_memories')
    op.drop_column('cortex_memories', 'last_quality_score')
    op.drop_column('cortex_memories', 'next_review_date')
    op.drop_column('cortex_memories', 'repetitions')
    op.drop_column('cortex_memories', 'interval_days')
    op.drop_column('cortex_memories', 'easiness_factor')

    # Remove outcome tracking from decisions
    op.drop_index('idx_decisions_date', table_name='cortex_decisions')
    op.drop_index('idx_decisions_outcome_status', table_name='cortex_decisions')
    op.drop_constraint('fk_decision_outcome_memory', 'cortex_decisions', type_='foreignkey')
    op.drop_column('cortex_decisions', 'lessons_learned')
    op.drop_column('cortex_decisions', 'confidence_in_hindsight')
    op.drop_column('cortex_decisions', 'confidence_at_decision')
    op.drop_column('cortex_decisions', 'outcome_memory_id')
    op.drop_column('cortex_decisions', 'outcome_notes')
    op.drop_column('cortex_decisions', 'outcome_date')
    op.drop_column('cortex_decisions', 'outcome_status')
