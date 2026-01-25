"""Add relationship intelligence tables

Revision ID: 017
Revises: 016
Create Date: 2026-01-24

Enables relationship intelligence:
- Health scoring
- Important dates
- Interaction logs
- Promises tracking
- Relationship insights
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Relationship health table
    op.create_table(
        'cortex_relationship_health',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tier', sa.String(30), server_default='regular'),
        sa.Column('health_score', sa.Float(), server_default='50.0'),
        sa.Column('frequency_score', sa.Float(), server_default='0.5'),
        sa.Column('sentiment_score', sa.Float(), server_default='0.5'),
        sa.Column('reciprocity_score', sa.Float(), server_default='0.5'),
        sa.Column('commitment_score', sa.Float(), server_default='0.5'),
        sa.Column('health_trend', sa.String(20), server_default='stable'),
        sa.Column('ideal_contact_days', sa.Integer(), server_default='14'),
        sa.Column('last_interaction_date', sa.Date(), nullable=True),
        sa.Column('last_interaction_type', sa.String(50), nullable=True),
        sa.Column('days_since_contact', sa.Integer(), server_default='0'),
        sa.Column('needs_reconnect', sa.Boolean(), server_default='false'),
        sa.Column('last_nudge_sent', sa.DateTime(), nullable=True),
        sa.Column('nudge_count', sa.Integer(), server_default='0'),
        sa.Column('has_tension', sa.Boolean(), server_default='false'),
        sa.Column('tension_reason', sa.Text(), nullable=True),
        sa.Column('has_unresolved', sa.Boolean(), server_default='false'),
        sa.Column('unresolved_items', postgresql.JSONB(), server_default='[]'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'entity_id', name='uq_relationship_health_user_entity')
    )
    op.create_index('idx_rel_health_user', 'cortex_relationship_health', ['user_id'])
    op.create_index('idx_rel_health_score', 'cortex_relationship_health', ['health_score'])
    op.create_index('idx_rel_health_needs_reconnect', 'cortex_relationship_health', ['needs_reconnect'])

    # Important dates table
    op.create_table(
        'cortex_important_dates',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('date_type', sa.String(50), nullable=False),
        sa.Column('date_label', sa.String(255), nullable=True),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('day', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=True),
        sa.Column('reminder_days_before', sa.Integer(), server_default='3'),
        sa.Column('last_reminded', sa.DateTime(), nullable=True),
        sa.Column('source_memory_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_memory_id'], ['cortex_memories.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_important_dates_user', 'cortex_important_dates', ['user_id'])
    op.create_index('idx_important_dates_month_day', 'cortex_important_dates', ['month', 'day'])

    # Interaction logs table
    op.create_table(
        'cortex_interaction_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('interaction_type', sa.String(30), nullable=False),
        sa.Column('interaction_date', sa.DateTime(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('sentiment', sa.Float(), server_default='0.5'),
        sa.Column('source_type', sa.String(50), nullable=True),
        sa.Column('source_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('topics', postgresql.JSONB(), server_default='[]'),
        sa.Column('promises_made', postgresql.JSONB(), server_default='[]'),
        sa.Column('duration_minutes', sa.Integer(), nullable=True),
        sa.Column('initiated_by_user', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_interaction_logs_user', 'cortex_interaction_logs', ['user_id'])
    op.create_index('idx_interaction_logs_entity', 'cortex_interaction_logs', ['entity_id'])
    op.create_index('idx_interaction_logs_date', 'cortex_interaction_logs', ['interaction_date'])

    # Relationship promises table
    op.create_table(
        'cortex_relationship_promises',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('original_text', sa.Text(), nullable=True),
        sa.Column('made_on', sa.Date(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('fulfilled_on', sa.Date(), nullable=True),
        sa.Column('importance', sa.Float(), server_default='0.5'),
        sa.Column('source_memory_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reminder_count', sa.Integer(), server_default='0'),
        sa.Column('last_reminded', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_memory_id'], ['cortex_memories.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_rel_promises_user', 'cortex_relationship_promises', ['user_id'])
    op.create_index('idx_rel_promises_status', 'cortex_relationship_promises', ['status'])

    # Relationship insights table
    op.create_table(
        'cortex_relationship_insights',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('insight_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('priority', sa.Float(), server_default='0.5'),
        sa.Column('suggested_action', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('dismissed_at', sa.DateTime(), nullable=True),
        sa.Column('acted_on', sa.Boolean(), server_default='false'),
        sa.Column('evidence_memory_ids', postgresql.JSONB(), server_default='[]'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_rel_insights_user', 'cortex_relationship_insights', ['user_id'])
    op.create_index('idx_rel_insights_active', 'cortex_relationship_insights', ['is_active'])
    op.create_index('idx_rel_insights_type', 'cortex_relationship_insights', ['insight_type'])


def downgrade() -> None:
    op.drop_table('cortex_relationship_insights')
    op.drop_table('cortex_relationship_promises')
    op.drop_table('cortex_interaction_logs')
    op.drop_table('cortex_important_dates')
    op.drop_table('cortex_relationship_health')
