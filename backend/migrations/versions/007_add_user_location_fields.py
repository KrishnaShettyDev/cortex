"""Add location fields to users table for automatic location tracking

Revision ID: 007
Revises: 006
Create Date: 2026-01-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add location columns to users table
    op.add_column('cortex_users', sa.Column('location_lat', sa.Float(), nullable=True))
    op.add_column('cortex_users', sa.Column('location_lng', sa.Float(), nullable=True))
    op.add_column('cortex_users', sa.Column('location_updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('cortex_users', 'location_updated_at')
    op.drop_column('cortex_users', 'location_lng')
    op.drop_column('cortex_users', 'location_lat')
