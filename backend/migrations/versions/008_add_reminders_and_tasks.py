"""Add reminders and tasks tables for smart notifications

Revision ID: 008
Revises: 007
Create Date: 2026-01-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create reminders table
    op.create_table(
        'cortex_reminders',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('cortex_users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('reminder_type', sa.String(20), nullable=False, default='time'),
        sa.Column('remind_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('location_name', sa.String(255), nullable=True),
        sa.Column('location_latitude', sa.Float(), nullable=True),
        sa.Column('location_longitude', sa.Float(), nullable=True),
        sa.Column('location_radius_meters', sa.Integer(), nullable=True, default=200),
        sa.Column('event_id', sa.String(255), nullable=True),
        sa.Column('minutes_before_event', sa.Integer(), nullable=True, default=15),
        sa.Column('status', sa.String(20), nullable=False, default='pending'),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_recurring', sa.Boolean(), default=False),
        sa.Column('recurrence_pattern', sa.String(50), nullable=True),
        sa.Column('source_message', sa.Text(), nullable=True),
        sa.Column('conversation_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Create indexes for reminders
    op.create_index('idx_cortex_reminders_user_id', 'cortex_reminders', ['user_id'])
    op.create_index('idx_cortex_reminders_remind_at', 'cortex_reminders', ['remind_at'])
    op.create_index('idx_cortex_reminders_status', 'cortex_reminders', ['status'])
    op.create_index('idx_cortex_reminders_user_status', 'cortex_reminders', ['user_id', 'status'])
    op.create_index('idx_cortex_reminders_pending_time', 'cortex_reminders', ['status', 'remind_at'])

    # Create tasks table
    op.create_table(
        'cortex_tasks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('cortex_users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_completed', sa.Boolean(), default=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=True, default=3),
        sa.Column('source_type', sa.String(50), nullable=True),
        sa.Column('source_id', sa.String(255), nullable=True),
        sa.Column('extracted_from', sa.Text(), nullable=True),
        sa.Column('related_person', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Create indexes for tasks
    op.create_index('idx_cortex_tasks_user_id', 'cortex_tasks', ['user_id'])
    op.create_index('idx_cortex_tasks_is_completed', 'cortex_tasks', ['is_completed'])
    op.create_index('idx_cortex_tasks_user_status', 'cortex_tasks', ['user_id', 'is_completed'])
    op.create_index('idx_cortex_tasks_due_date', 'cortex_tasks', ['user_id', 'due_date'])


def downgrade() -> None:
    # Drop tasks table and indexes
    op.drop_index('idx_cortex_tasks_due_date', 'cortex_tasks')
    op.drop_index('idx_cortex_tasks_user_status', 'cortex_tasks')
    op.drop_index('idx_cortex_tasks_is_completed', 'cortex_tasks')
    op.drop_index('idx_cortex_tasks_user_id', 'cortex_tasks')
    op.drop_table('cortex_tasks')

    # Drop reminders table and indexes
    op.drop_index('idx_cortex_reminders_pending_time', 'cortex_reminders')
    op.drop_index('idx_cortex_reminders_user_status', 'cortex_reminders')
    op.drop_index('idx_cortex_reminders_status', 'cortex_reminders')
    op.drop_index('idx_cortex_reminders_remind_at', 'cortex_reminders')
    op.drop_index('idx_cortex_reminders_user_id', 'cortex_reminders')
    op.drop_table('cortex_reminders')
