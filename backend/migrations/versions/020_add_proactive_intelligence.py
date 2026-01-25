"""Add proactive intelligence tables

Revision ID: 020
Revises: 019
Create Date: 2025-01-25

Tracks user intentions ("I should call mom") and enables proactive features.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # User intentions table - tracks "open loops"
    op.create_table(
        'cortex_user_intentions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('uuid_generate_v4()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('cortex_users.id', ondelete='CASCADE'), nullable=False),

        # The intention itself
        sa.Column('action', sa.Text(), nullable=False),  # "call mom", "review proposal"
        sa.Column('subject', sa.Text(), nullable=True),   # "mom", "Q4 proposal"

        # Context
        sa.Column('source_memory_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('cortex_memories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('extracted_from', sa.Text(), nullable=True),  # Original text

        # Status tracking
        sa.Column('status', sa.String(20), server_default='pending', nullable=False),  # pending, completed, dismissed
        sa.Column('confidence', sa.Float(), server_default='0.8', nullable=False),

        # Timing
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_reminded_at', sa.DateTime(timezone=True), nullable=True),

        # Deduplication
        sa.Column('intention_hash', sa.String(64), nullable=True),
    )

    # Indexes for efficient queries (prefixed with 'idx_user_int_' to avoid collision with cortex_intentions)
    op.create_index('idx_user_int_status', 'cortex_user_intentions', ['user_id', 'status'])
    op.create_index('idx_user_int_pending', 'cortex_user_intentions', ['user_id'], postgresql_where=sa.text("status = 'pending'"))
    op.create_index('idx_user_int_due', 'cortex_user_intentions', ['user_id', 'due_date'], postgresql_where=sa.text("status = 'pending'"))
    op.create_index('idx_user_int_hash', 'cortex_user_intentions', ['user_id', 'intention_hash'])


def downgrade() -> None:
    op.drop_index('idx_user_int_hash')
    op.drop_index('idx_user_int_due')
    op.drop_index('idx_user_int_pending')
    op.drop_index('idx_user_int_status')
    op.drop_table('cortex_user_intentions')
