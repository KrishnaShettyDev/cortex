"""Add adaptive learning tables for memory strength, feedback, and user preferences

Revision ID: 006
Revises: 005
Create Date: 2026-01-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '006'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add adaptive learning columns to memories table
    op.add_column('cortex_memories', sa.Column('strength', sa.Float(), nullable=False, server_default='1.0'))
    op.add_column('cortex_memories', sa.Column('emotional_weight', sa.Float(), nullable=False, server_default='0.5'))
    op.add_column('cortex_memories', sa.Column('access_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cortex_memories', sa.Column('last_accessed', sa.DateTime(timezone=True), nullable=True))

    # Index for finding memories by strength (for decay processing)
    op.create_index('idx_memories_strength', 'cortex_memories', ['user_id', 'strength'])

    # User feedback table - tracks thumbs up/down on AI responses
    op.create_table(
        'cortex_user_feedback',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('conversation_id', sa.String(255), nullable=True),
        sa.Column('message_id', sa.String(255), nullable=True),
        sa.Column('feedback_type', sa.String(20), nullable=False),  # 'positive', 'negative', 'correction'
        sa.Column('feedback_context', sa.String(50), nullable=True),  # 'response', 'suggestion', 'memory_retrieval'
        sa.Column('user_query', sa.Text(), nullable=True),
        sa.Column('ai_response', sa.Text(), nullable=True),
        sa.Column('correction_text', sa.Text(), nullable=True),  # User's correction if provided
        sa.Column('memories_used', postgresql.JSONB(), server_default='[]', nullable=False),  # IDs of memories retrieved
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_feedback_user', 'cortex_user_feedback', ['user_id'])
    op.create_index('idx_feedback_type', 'cortex_user_feedback', ['user_id', 'feedback_type'])

    # User preferences table - learned patterns about the user
    op.create_table(
        'cortex_user_preferences',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('preference_type', sa.String(50), nullable=False),  # 'communication_style', 'interests', 'schedule', etc.
        sa.Column('preference_key', sa.String(100), nullable=False),  # Specific preference name
        sa.Column('preference_value', postgresql.JSONB(), nullable=False),  # Value (can be string, array, object)
        sa.Column('confidence', sa.Float(), nullable=False, server_default='0.5'),  # How confident we are (0-1)
        sa.Column('evidence_count', sa.Integer(), nullable=False, server_default='1'),  # How many times observed
        sa.Column('last_observed', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_preferences_user', 'cortex_user_preferences', ['user_id'])
    op.create_unique_constraint('uq_user_preference', 'cortex_user_preferences', ['user_id', 'preference_type', 'preference_key'])

    # Memory access log - tracks which memories are retrieved and when
    op.create_table(
        'cortex_memory_access_log',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('access_type', sa.String(30), nullable=False),  # 'search', 'chat_retrieval', 'connection', 'direct'
        sa.Column('query_text', sa.Text(), nullable=True),  # What triggered the retrieval
        sa.Column('relevance_score', sa.Float(), nullable=True),  # How relevant the memory was
        sa.Column('was_useful', sa.Boolean(), nullable=True),  # Did user interact positively?
        sa.Column('accessed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_access_log_user', 'cortex_memory_access_log', ['user_id'])
    op.create_index('idx_access_log_memory', 'cortex_memory_access_log', ['memory_id'])
    op.create_index('idx_access_log_time', 'cortex_memory_access_log', ['user_id', 'accessed_at'])

    # Insights table - patterns and abstractions extracted from memories
    op.create_table(
        'cortex_insights',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('insight_type', sa.String(50), nullable=False),  # 'pattern', 'summary', 'prediction', 'connection'
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('source_memory_ids', postgresql.JSONB(), server_default='[]', nullable=False),  # Memories this was derived from
        sa.Column('confidence', sa.Float(), nullable=False, server_default='0.5'),
        sa.Column('relevance_period_start', sa.Date(), nullable=True),  # Time period this insight covers
        sa.Column('relevance_period_end', sa.Date(), nullable=True),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_insights_user', 'cortex_insights', ['user_id'])
    op.create_index('idx_insights_type', 'cortex_insights', ['user_id', 'insight_type'])

    # Add reinforcement_count to memory_connections for tracking strength changes
    op.add_column('cortex_memory_connections', sa.Column('reinforcement_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('cortex_memory_connections', sa.Column('last_reinforced', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Remove reinforcement columns from connections
    op.drop_column('cortex_memory_connections', 'last_reinforced')
    op.drop_column('cortex_memory_connections', 'reinforcement_count')

    # Drop insights table
    op.drop_index('idx_insights_type', table_name='cortex_insights')
    op.drop_index('idx_insights_user', table_name='cortex_insights')
    op.drop_table('cortex_insights')

    # Drop memory access log table
    op.drop_index('idx_access_log_time', table_name='cortex_memory_access_log')
    op.drop_index('idx_access_log_memory', table_name='cortex_memory_access_log')
    op.drop_index('idx_access_log_user', table_name='cortex_memory_access_log')
    op.drop_table('cortex_memory_access_log')

    # Drop user preferences table
    op.drop_constraint('uq_user_preference', 'cortex_user_preferences', type_='unique')
    op.drop_index('idx_preferences_user', table_name='cortex_user_preferences')
    op.drop_table('cortex_user_preferences')

    # Drop user feedback table
    op.drop_index('idx_feedback_type', table_name='cortex_user_feedback')
    op.drop_index('idx_feedback_user', table_name='cortex_user_feedback')
    op.drop_table('cortex_user_feedback')

    # Remove adaptive columns from memories
    op.drop_index('idx_memories_strength', table_name='cortex_memories')
    op.drop_column('cortex_memories', 'last_accessed')
    op.drop_column('cortex_memories', 'access_count')
    op.drop_column('cortex_memories', 'emotional_weight')
    op.drop_column('cortex_memories', 'strength')
