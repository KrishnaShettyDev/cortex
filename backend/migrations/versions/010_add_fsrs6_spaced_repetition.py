"""Add FSRS-6 spaced repetition system

Revision ID: 010
Revises: 009
Create Date: 2026-01-24 10:00:00.000000

FSRS-6 (Free Spaced Repetition Scheduler) is state-of-the-art with 21 trainable parameters.
This migration adds:
- FSRS-specific fields to memories (stability, difficulty, state)
- User-specific FSRS parameters table (trainable via review history)
- Review logs table for tracking individual reviews and training parameters
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # FSRS-6 fields on memories - these supplement/replace SM2 fields
    op.add_column('cortex_memories', sa.Column('fsrs_stability', sa.Float(), nullable=False, server_default='1.0'))
    op.add_column('cortex_memories', sa.Column('fsrs_difficulty', sa.Float(), nullable=False, server_default='0.3'))
    op.add_column('cortex_memories', sa.Column('fsrs_last_review', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cortex_memories', sa.Column('fsrs_reps', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cortex_memories', sa.Column('fsrs_lapses', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cortex_memories', sa.Column('fsrs_state', sa.String(20), nullable=False, server_default='new'))
    op.add_column('cortex_memories', sa.Column('fsrs_scheduled_days', sa.Float(), nullable=True))
    op.add_column('cortex_memories', sa.Column('fsrs_elapsed_days', sa.Float(), nullable=True))

    # Index for FSRS state queries
    op.create_index('idx_cortex_memories_fsrs_state', 'cortex_memories', ['user_id', 'fsrs_state'])

    # FSRS Parameters table - 21 trainable parameters per user
    op.create_table(
        'cortex_fsrs_parameters',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # The 21 FSRS-6 parameters (stored as JSONB for flexibility)
        # w0-w20: weights for the algorithm
        sa.Column('parameters', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),

        # Training metadata
        sa.Column('review_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_optimized', sa.DateTime(timezone=True), nullable=True),
        sa.Column('optimization_rmse', sa.Float(), nullable=True),  # Root mean square error after optimization

        # Parameter version for tracking changes
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_fsrs_parameters_user')
    )
    op.create_index('idx_fsrs_parameters_user', 'cortex_fsrs_parameters', ['user_id'])

    # Review logs table - essential for FSRS parameter training
    op.create_table(
        'cortex_review_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Review data
        sa.Column('rating', sa.Integer(), nullable=False),  # 1=Again, 2=Hard, 3=Good, 4=Easy
        sa.Column('state', sa.String(20), nullable=False),  # State before review: new, learning, review, relearning

        # Scheduling data (for parameter training)
        sa.Column('scheduled_days', sa.Float(), nullable=True),  # Days since last review (scheduled)
        sa.Column('elapsed_days', sa.Float(), nullable=True),  # Days since last review (actual)

        # Memory state at time of review
        sa.Column('stability_before', sa.Float(), nullable=True),
        sa.Column('difficulty_before', sa.Float(), nullable=True),
        sa.Column('stability_after', sa.Float(), nullable=True),
        sa.Column('difficulty_after', sa.Float(), nullable=True),

        # Calculated retrievability at time of review
        sa.Column('retrievability', sa.Float(), nullable=True),

        # Review metadata
        sa.Column('review_duration_ms', sa.Integer(), nullable=True),  # How long user spent reviewing
        sa.Column('review_time', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_review_logs_user', 'cortex_review_logs', ['user_id'])
    op.create_index('idx_review_logs_memory', 'cortex_review_logs', ['memory_id'])
    op.create_index('idx_review_logs_time', 'cortex_review_logs', ['user_id', 'review_time'])


def downgrade() -> None:
    # Drop review logs table
    op.drop_index('idx_review_logs_time', table_name='cortex_review_logs')
    op.drop_index('idx_review_logs_memory', table_name='cortex_review_logs')
    op.drop_index('idx_review_logs_user', table_name='cortex_review_logs')
    op.drop_table('cortex_review_logs')

    # Drop FSRS parameters table
    op.drop_index('idx_fsrs_parameters_user', table_name='cortex_fsrs_parameters')
    op.drop_table('cortex_fsrs_parameters')

    # Remove FSRS columns from memories
    op.drop_index('idx_cortex_memories_fsrs_state', table_name='cortex_memories')
    op.drop_column('cortex_memories', 'fsrs_elapsed_days')
    op.drop_column('cortex_memories', 'fsrs_scheduled_days')
    op.drop_column('cortex_memories', 'fsrs_state')
    op.drop_column('cortex_memories', 'fsrs_lapses')
    op.drop_column('cortex_memories', 'fsrs_reps')
    op.drop_column('cortex_memories', 'fsrs_last_review')
    op.drop_column('cortex_memories', 'fsrs_difficulty')
    op.drop_column('cortex_memories', 'fsrs_stability')
