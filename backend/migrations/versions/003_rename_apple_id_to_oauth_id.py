"""Rename apple_id to oauth_id in cortex_users

Revision ID: 003
Revises: d287a788e6cf
Create Date: 2026-01-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003'
down_revision: Union[str, None] = 'd287a788e6cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename column from apple_id to oauth_id
    op.alter_column(
        'cortex_users',
        'apple_id',
        new_column_name='oauth_id'
    )

    # Update the index name (optional but good practice)
    op.drop_index('ix_cortex_users_apple_id', table_name='cortex_users')
    op.create_index('ix_cortex_users_oauth_id', 'cortex_users', ['oauth_id'], unique=True)


def downgrade() -> None:
    # Rename column back to apple_id
    op.alter_column(
        'cortex_users',
        'oauth_id',
        new_column_name='apple_id'
    )

    # Restore the original index name
    op.drop_index('ix_cortex_users_oauth_id', table_name='cortex_users')
    op.create_index('ix_cortex_users_apple_id', 'cortex_users', ['apple_id'], unique=True)
