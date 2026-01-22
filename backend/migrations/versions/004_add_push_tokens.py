"""Add push_tokens table for push notifications

Revision ID: 004
Revises: 003
Create Date: 2026-01-20 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cortex_push_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('push_token', sa.String(255), nullable=False),
        sa.Column('platform', sa.String(20), nullable=False),
        sa.Column('device_name', sa.String(255), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('push_token')
    )
    op.create_index('ix_cortex_push_tokens_user_id', 'cortex_push_tokens', ['user_id'])
    op.create_index('idx_cortex_push_tokens_user_active', 'cortex_push_tokens', ['user_id', 'is_active'])


def downgrade() -> None:
    op.drop_index('idx_cortex_push_tokens_user_active', table_name='cortex_push_tokens')
    op.drop_index('ix_cortex_push_tokens_user_id', table_name='cortex_push_tokens')
    op.drop_table('cortex_push_tokens')
