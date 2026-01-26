"""Add autonomous actions for Iris-style proactive suggestions

Revision ID: 023
Revises: 022
Create Date: 2026-01-26

Enables Iris-style autonomous action suggestions:
- Pre-filled action cards (email replies, calendar events)
- One-tap approve/dismiss workflow
- Feedback tracking for learning
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Autonomous actions table - Iris-style proactive suggestions
    op.create_table(
        'cortex_autonomous_actions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Action details
        sa.Column('action_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),

        # Pre-filled action payload
        sa.Column('action_payload', postgresql.JSONB(), nullable=False),

        # Context & reasoning
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('source_type', sa.String(50), nullable=True),
        sa.Column('source_id', sa.String(255), nullable=True),

        # Scoring
        sa.Column('confidence_score', sa.Float(), server_default='0.5'),
        sa.Column('priority_score', sa.Float(), server_default='50.0'),

        # Status tracking
        sa.Column('status', sa.String(20), server_default='pending'),

        # User feedback
        sa.Column('user_feedback', sa.String(50), nullable=True),
        sa.Column('user_modification', postgresql.JSONB(), nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('surfaced_at', sa.DateTime(), nullable=True),
        sa.Column('actioned_at', sa.DateTime(), nullable=True),
        sa.Column('executed_at', sa.DateTime(), nullable=True),

        # Error tracking
        sa.Column('error_message', sa.Text(), nullable=True),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Indexes for autonomous actions
    op.create_index('idx_autonomous_actions_user', 'cortex_autonomous_actions', ['user_id'])
    op.create_index('idx_autonomous_actions_status', 'cortex_autonomous_actions', ['status'])
    op.create_index('idx_autonomous_actions_type', 'cortex_autonomous_actions', ['action_type'])
    op.create_index('idx_autonomous_actions_created', 'cortex_autonomous_actions', ['created_at'])
    op.create_index('idx_autonomous_actions_expires', 'cortex_autonomous_actions', ['expires_at'])
    op.create_index('idx_autonomous_actions_priority', 'cortex_autonomous_actions', ['priority_score'])
    # Composite index for fetching pending actions by user
    op.create_index(
        'idx_autonomous_actions_user_pending',
        'cortex_autonomous_actions',
        ['user_id', 'status'],
        postgresql_where=sa.text("status = 'pending'")
    )

    # Action feedback table - for learning from user behavior
    op.create_table(
        'cortex_action_feedback',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('autonomous_action_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Feedback details
        sa.Column('feedback_type', sa.String(30), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),

        # Modification details
        sa.Column('modification_summary', sa.Text(), nullable=True),
        sa.Column('original_payload', postgresql.JSONB(), nullable=True),
        sa.Column('modified_payload', postgresql.JSONB(), nullable=True),

        # Dismiss reason
        sa.Column('dismiss_reason', sa.String(50), nullable=True),

        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['autonomous_action_id'],
            ['cortex_autonomous_actions.id'],
            ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id')
    )

    # Indexes for action feedback
    op.create_index('idx_action_feedback_user', 'cortex_action_feedback', ['user_id'])
    op.create_index('idx_action_feedback_action', 'cortex_action_feedback', ['autonomous_action_id'])
    op.create_index('idx_action_feedback_type', 'cortex_action_feedback', ['feedback_type'])
    op.create_index('idx_action_feedback_created', 'cortex_action_feedback', ['created_at'])


def downgrade() -> None:
    op.drop_table('cortex_action_feedback')
    op.drop_table('cortex_autonomous_actions')
