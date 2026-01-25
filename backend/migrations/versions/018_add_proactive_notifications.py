"""Add proactive notification tables

Revision ID: 018
Revises: 017
Create Date: 2026-01-24

Enables proactive notification system:
- NotificationLog: Tracks all proactive notifications
- NotificationPreferences: User settings for notifications
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '018'
down_revision = '017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Notification preferences table
    op.create_table(
        'cortex_notification_preferences',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Feature toggles
        sa.Column('enable_morning_briefing', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_evening_briefing', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_meeting_prep', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_email_alerts', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_commitment_reminders', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_pattern_warnings', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_reconnection_nudges', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_memory_insights', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('enable_important_dates', sa.Boolean(), server_default='true', nullable=False),

        # Daily notification budget
        sa.Column('max_notifications_per_day', sa.Integer(), server_default='8', nullable=False),
        sa.Column('max_urgent_per_day', sa.Integer(), server_default='3', nullable=False),

        # Quiet hours
        sa.Column('quiet_hours_enabled', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('quiet_hours_start', sa.Time(), nullable=True),
        sa.Column('quiet_hours_end', sa.Time(), nullable=True),

        # Briefing timing
        sa.Column('morning_briefing_time', sa.Time(), server_default='08:00:00', nullable=False),
        sa.Column('evening_briefing_time', sa.Time(), server_default='18:00:00', nullable=False),

        # Meeting prep timing
        sa.Column('meeting_prep_minutes_before', sa.Integer(), server_default='30', nullable=False),

        # Timezone
        sa.Column('timezone', sa.String(50), server_default='UTC', nullable=False),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_notification_preferences_user')
    )
    op.create_index('idx_notification_prefs_user', 'cortex_notification_preferences', ['user_id'])

    # Notification log table
    op.create_table(
        'cortex_notification_log',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Notification details
        sa.Column('notification_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),

        # Scoring and priority
        sa.Column('priority_score', sa.Float(), server_default='0.0', nullable=False),
        sa.Column('urgency_level', sa.String(20), server_default='medium', nullable=False),

        # Source tracking
        sa.Column('source_service', sa.String(50), nullable=True),
        sa.Column('source_id', sa.String(255), nullable=True),

        # Status tracking
        sa.Column('status', sa.String(20), server_default='queued', nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),

        # Engagement tracking
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('action_taken', sa.String(50), nullable=True),

        # Consolidation
        sa.Column('consolidated_into_id', postgresql.UUID(as_uuid=True), nullable=True),

        # Snooze support
        sa.Column('snoozed_until', sa.DateTime(timezone=True), nullable=True),

        # Metadata
        sa.Column('data', postgresql.JSONB(), nullable=True),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),

        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['consolidated_into_id'],
            ['cortex_notification_log.id'],
            ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_notification_log_user', 'cortex_notification_log', ['user_id'])
    op.create_index('idx_notification_log_user_date', 'cortex_notification_log', ['user_id', 'created_at'])
    op.create_index('idx_notification_log_user_status', 'cortex_notification_log', ['user_id', 'status'])
    op.create_index('idx_notification_log_user_type', 'cortex_notification_log', ['user_id', 'notification_type'])
    op.create_index('idx_notification_log_snoozed', 'cortex_notification_log', ['status', 'snoozed_until'])


def downgrade() -> None:
    op.drop_table('cortex_notification_log')
    op.drop_table('cortex_notification_preferences')
