"""Add prospective memory intentions table.

Revision ID: 014
Revises: 013
Create Date: 2026-01-24

Phase 4.1: Prospective Memory
Tracks user intentions for proactive nudges.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create intentions table
    op.create_table(
        'cortex_intentions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('uuid_generate_v4()')),
        sa.Column('user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('cortex_users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_memory_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('cortex_memories.id', ondelete='SET NULL')),

        # Intention content
        sa.Column('description', sa.Text, nullable=False),
        sa.Column('original_text', sa.Text),

        # Classification
        sa.Column('intention_type', sa.String(20), default='task'),
        sa.Column('status', sa.String(20), default='active'),

        # Timing
        sa.Column('detected_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('due_date', sa.Date),
        sa.Column('due_time', sa.DateTime(timezone=True)),
        sa.Column('deadline_flexibility', sa.String(20)),

        # Context
        sa.Column('target_person', sa.String(255)),
        sa.Column('target_action', sa.String(255)),
        sa.Column('related_project', sa.String(255)),

        # Tracking
        sa.Column('reminder_count', sa.Integer, default=0),
        sa.Column('last_reminded_at', sa.DateTime(timezone=True)),
        sa.Column('snoozed_until', sa.DateTime(timezone=True)),

        # Fulfillment
        sa.Column('fulfilled_at', sa.DateTime(timezone=True)),
        sa.Column('fulfillment_memory_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('cortex_memories.id', ondelete='SET NULL')),
        sa.Column('fulfillment_confidence', sa.Float),

        # User feedback
        sa.Column('user_confirmed', sa.Boolean),
        sa.Column('user_notes', sa.Text),

        # Priority
        sa.Column('importance', sa.Float, default=0.5),
        sa.Column('urgency', sa.Float, default=0.5),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Indexes for efficient queries
    op.create_index('idx_intentions_user', 'cortex_intentions', ['user_id'])
    op.create_index('idx_intentions_status', 'cortex_intentions', ['user_id', 'status'])
    op.create_index('idx_intentions_due', 'cortex_intentions', ['user_id', 'due_date', 'status'])


def downgrade() -> None:
    op.drop_index('idx_intentions_due')
    op.drop_index('idx_intentions_status')
    op.drop_index('idx_intentions_user')
    op.drop_table('cortex_intentions')
