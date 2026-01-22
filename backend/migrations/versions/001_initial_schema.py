"""Initial schema with all tables

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable extensions
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "vector"')

    # Create cortex_users table
    op.create_table(
        'cortex_users',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('apple_id', sa.String(255), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('apple_id'),
        sa.UniqueConstraint('email')
    )
    op.create_index('ix_cortex_users_apple_id', 'cortex_users', ['apple_id'])
    op.create_index('ix_cortex_users_email', 'cortex_users', ['email'])

    # Create cortex_memories table
    op.create_table(
        'cortex_memories',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('memory_type', sa.String(50), nullable=False),
        sa.Column('source_id', sa.String(255), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('audio_url', sa.Text(), nullable=True),
        sa.Column('photo_url', sa.Text(), nullable=True),
        sa.Column('embedding', postgresql.ARRAY(sa.Float()), nullable=True),  # Will be cast to vector
        sa.Column('memory_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column(
            'search_vector',
            postgresql.TSVECTOR(),
            sa.Computed(
                "setweight(to_tsvector('english', coalesce(summary, '')), 'A') || "
                "setweight(to_tsvector('english', coalesce(content, '')), 'B')",
                persisted=True
            ),
            nullable=True
        ),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Convert embedding column to vector type
    op.execute('ALTER TABLE cortex_memories ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536)')

    # Create indexes for memories
    op.create_index('idx_cortex_memories_user_id', 'cortex_memories', ['user_id'])
    op.create_index('idx_cortex_memories_user_date', 'cortex_memories', ['user_id', 'memory_date'])
    op.create_index('idx_cortex_memories_type', 'cortex_memories', ['user_id', 'memory_type'])
    op.execute('CREATE INDEX idx_cortex_memories_embedding ON cortex_memories USING hnsw (embedding vector_cosine_ops)')
    op.execute('CREATE INDEX idx_cortex_memories_search ON cortex_memories USING gin(search_vector)')

    # Create cortex_entities table
    op.create_table(
        'cortex_entities',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('entity_type', sa.String(50), nullable=False),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(), server_default='{}', nullable=True),
        sa.Column('mention_count', sa.Integer(), server_default='1', nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('embedding', postgresql.ARRAY(sa.Float()), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'name', 'entity_type', name='uq_cortex_entity_user_name_type')
    )

    # Convert embedding column to vector type
    op.execute('ALTER TABLE cortex_entities ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536)')

    op.create_index('idx_cortex_entities_user', 'cortex_entities', ['user_id'])
    op.create_index('idx_cortex_entities_type', 'cortex_entities', ['user_id', 'entity_type'])

    # Create cortex_memory_entities junction table
    op.create_table(
        'cortex_memory_entities',
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('memory_id', 'entity_id')
    )

    # Create cortex_connected_accounts table
    op.create_table(
        'cortex_connected_accounts',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('composio_connection_id', sa.String(255), nullable=False),
        sa.Column('scopes', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'provider', name='uq_cortex_connected_account_user_provider')
    )
    op.create_index('idx_cortex_connected_accounts_user', 'cortex_connected_accounts', ['user_id'])

    # Create cortex_sync_state table
    op.create_table(
        'cortex_sync_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=False),
        sa.Column('last_sync_token', sa.Text(), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'provider', 'resource_type', name='uq_cortex_sync_state_user_provider_resource')
    )
    op.create_index('idx_cortex_sync_state_user', 'cortex_sync_state', ['user_id'])


def downgrade() -> None:
    op.drop_table('cortex_sync_state')
    op.drop_table('cortex_connected_accounts')
    op.drop_table('cortex_memory_entities')
    op.drop_table('cortex_entities')
    op.drop_table('cortex_memories')
    op.drop_table('cortex_users')
    op.execute('DROP EXTENSION IF EXISTS "vector"')
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp"')
