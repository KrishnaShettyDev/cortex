"""Add email column to connected_accounts

Revision ID: 002
Revises: 001
Create Date: 2026-01-19 20:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add email column to cortex_connected_accounts
    op.add_column(
        'cortex_connected_accounts',
        sa.Column('email', sa.String(255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('cortex_connected_accounts', 'email')
