"""Add autonomous email features

Revision ID: 016
Revises: 015
Create Date: 2026-01-24

Enables Iris-like autonomous email features:
- Scheduled email sending
- Email snooze/remind later
- Auto-draft suggestions
- Autonomous follow-ups
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Scheduled emails table
    op.create_table(
        'cortex_scheduled_emails',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('to_recipients', postgresql.JSONB(), nullable=False),
        sa.Column('cc_recipients', postgresql.JSONB(), nullable=True),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('scheduled_for', sa.DateTime(), nullable=False),
        sa.Column('timezone', sa.String(50), server_default='UTC'),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('thread_id', sa.String(255), nullable=True),
        sa.Column('in_reply_to', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_scheduled_emails_user', 'cortex_scheduled_emails', ['user_id'])
    op.create_index('idx_scheduled_emails_status', 'cortex_scheduled_emails', ['status'])
    op.create_index('idx_scheduled_emails_scheduled_for', 'cortex_scheduled_emails', ['scheduled_for'])

    # Snoozed emails table
    op.create_table(
        'cortex_snoozed_emails',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('thread_id', sa.String(255), nullable=False),
        sa.Column('message_id', sa.String(255), nullable=True),
        sa.Column('subject', sa.String(500), nullable=True),
        sa.Column('sender', sa.String(255), nullable=True),
        sa.Column('snippet', sa.Text(), nullable=True),
        sa.Column('snooze_until', sa.DateTime(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('notified_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_snoozed_emails_user', 'cortex_snoozed_emails', ['user_id'])
    op.create_index('idx_snoozed_emails_snooze_until', 'cortex_snoozed_emails', ['snooze_until'])
    op.create_index('idx_snoozed_emails_active', 'cortex_snoozed_emails', ['is_active'])

    # Auto-drafts table
    op.create_table(
        'cortex_auto_drafts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('thread_id', sa.String(255), nullable=False),
        sa.Column('original_subject', sa.String(500), nullable=True),
        sa.Column('original_sender', sa.String(255), nullable=True),
        sa.Column('original_snippet', sa.Text(), nullable=True),
        sa.Column('draft_subject', sa.String(500), nullable=True),
        sa.Column('draft_body', sa.Text(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('priority', sa.Float(), server_default='0.5'),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('surfaced_at', sa.DateTime(), nullable=True),
        sa.Column('actioned_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_auto_drafts_user', 'cortex_auto_drafts', ['user_id'])
    op.create_index('idx_auto_drafts_status', 'cortex_auto_drafts', ['status'])
    op.create_index('idx_auto_drafts_priority', 'cortex_auto_drafts', ['priority'])

    # Auto follow-up rules table
    op.create_table(
        'cortex_auto_followup_rules',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('thread_id', sa.String(255), nullable=False),
        sa.Column('original_subject', sa.String(500), nullable=True),
        sa.Column('original_recipient', sa.String(255), nullable=True),
        sa.Column('days_to_wait', sa.Integer(), server_default='3'),
        sa.Column('max_followups', sa.Integer(), server_default='2'),
        sa.Column('followups_sent', sa.Integer(), server_default='0'),
        sa.Column('urgency', sa.String(20), server_default='normal'),
        sa.Column('custom_message', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('last_checked', sa.DateTime(), nullable=True),
        sa.Column('last_followup_sent', sa.DateTime(), nullable=True),
        sa.Column('reply_received', sa.Boolean(), server_default='false'),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_auto_followup_user', 'cortex_auto_followup_rules', ['user_id'])
    op.create_index('idx_auto_followup_active', 'cortex_auto_followup_rules', ['is_active'])
    op.create_index('idx_auto_followup_thread', 'cortex_auto_followup_rules', ['thread_id'])


def downgrade() -> None:
    op.drop_table('cortex_auto_followup_rules')
    op.drop_table('cortex_auto_drafts')
    op.drop_table('cortex_snoozed_emails')
    op.drop_table('cortex_scheduled_emails')
