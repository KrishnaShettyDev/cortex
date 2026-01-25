"""Add third party commitments table

Revision ID: 021
Revises: 020
Create Date: 2026-01-25

Tracks promises/commitments OTHERS made TO the user.
Extracted from emails and conversations via GPT analysis.

Examples:
- "Josh said he'd send the pricing by Friday"
- "Sarah promised to introduce me to her CEO"
- "Mike said he'll get back to me about the project"
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'cortex_third_party_commitments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=True),

        # Who made the promise
        sa.Column('person_name', sa.String(255), nullable=False),
        sa.Column('person_email', sa.String(255), nullable=True),

        # Commitment details
        sa.Column('action', sa.Text(), nullable=False),
        sa.Column('context', sa.Text(), nullable=True),
        sa.Column('original_text', sa.Text(), nullable=True),

        # Timeline
        sa.Column('extracted_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('mentioned_date', sa.String(100), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),

        # Status
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('fulfilled_at', sa.DateTime(), nullable=True),

        # Source tracking
        sa.Column('source_type', sa.String(50), nullable=True),
        sa.Column('source_id', sa.String(255), nullable=True),
        sa.Column('source_snippet', sa.Text(), nullable=True),

        # Tracking
        sa.Column('last_checked_at', sa.DateTime(), nullable=True),
        sa.Column('reminder_count', sa.Integer(), server_default='0'),
        sa.Column('last_reminded_at', sa.DateTime(), nullable=True),

        # Metadata
        sa.Column('confidence', sa.Float(), server_default='0.8'),
        sa.Column('importance', sa.Float(), server_default='0.5'),

        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),

        # Foreign keys
        sa.ForeignKeyConstraint(['user_id'], ['cortex_users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['entity_id'], ['cortex_entities.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )

    # Indexes for common queries
    op.create_index('idx_third_party_commits_user', 'cortex_third_party_commitments', ['user_id'])
    op.create_index('idx_third_party_commits_entity', 'cortex_third_party_commitments', ['entity_id'])
    op.create_index('idx_third_party_commits_status', 'cortex_third_party_commitments', ['status'])
    op.create_index('idx_third_party_commits_person', 'cortex_third_party_commitments', ['person_name'])
    op.create_index('idx_third_party_commits_due', 'cortex_third_party_commitments', ['due_date'])


def downgrade() -> None:
    op.drop_table('cortex_third_party_commitments')
