"""add_service_and_status_to_connected_accounts

Revision ID: d287a788e6cf
Revises: 002
Create Date: 2026-01-19 22:31:38.092749

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 'd287a788e6cf'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns
    op.add_column('cortex_connected_accounts',
        sa.Column('service', sa.String(50), nullable=False, server_default='all'))
    op.add_column('cortex_connected_accounts',
        sa.Column('status', sa.String(50), nullable=False, server_default='active'))

    # Drop old constraint
    op.drop_constraint('uq_cortex_connected_account_user_provider', 'cortex_connected_accounts', type_='unique')

    # Create new constraint that includes service
    op.create_unique_constraint(
        'uq_cortex_connected_account_user_provider_service',
        'cortex_connected_accounts',
        ['user_id', 'provider', 'service']
    )


def downgrade() -> None:
    # Drop new constraint
    op.drop_constraint('uq_cortex_connected_account_user_provider_service', 'cortex_connected_accounts', type_='unique')

    # Recreate old constraint
    op.create_unique_constraint(
        'uq_cortex_connected_account_user_provider',
        'cortex_connected_accounts',
        ['user_id', 'provider']
    )

    # Drop columns
    op.drop_column('cortex_connected_accounts', 'status')
    op.drop_column('cortex_connected_accounts', 'service')
