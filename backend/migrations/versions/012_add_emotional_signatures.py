"""Add emotional signatures with 3D circumplex model

Revision ID: 012
Revises: 011
Create Date: 2026-01-24 12:00:00.000000

Implements Russell's Circumplex Model extended to 3D (Valence × Arousal × Dominance)
plus personal meaning factors for more accurate memory importance scoring.

Factors:
- Core emotions: valence, arousal, dominance
- Personal meaning: personal_significance, identity_relevance
- Flashbulb indicators: surprise, consequentiality
- Goal connections
- Computed importance_score
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '012'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cortex_emotional_signatures',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), nullable=False),
        sa.Column('memory_id', postgresql.UUID(as_uuid=True), nullable=False),

        # Russell's Circumplex (3D) - all range from -1 to 1
        sa.Column('valence', sa.Float(), nullable=False),  # Pleasure/displeasure (-1 to 1)
        sa.Column('arousal', sa.Float(), nullable=False),  # Activation/deactivation (-1 to 1)
        sa.Column('dominance', sa.Float(), nullable=False),  # Control/submission (-1 to 1)

        # Personal meaning factors (0 to 1)
        sa.Column('personal_significance', sa.Float(), nullable=False, server_default='0.5'),
        sa.Column('identity_relevance', sa.Float(), nullable=False, server_default='0.0'),

        # Flashbulb memory indicators (0 to 1)
        sa.Column('surprise', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('consequentiality', sa.Float(), nullable=False, server_default='0.0'),

        # Goal connections
        sa.Column('related_goals', postgresql.JSONB(), server_default='[]', nullable=False),

        # Detected emotions (AI-extracted)
        sa.Column('primary_emotion', sa.String(50), nullable=True),
        sa.Column('secondary_emotions', postgresql.JSONB(), server_default='[]', nullable=False),

        # Computed importance score (will be updated by trigger or application)
        sa.Column('importance_score', sa.Float(), nullable=False, server_default='0.5'),

        # Analysis metadata
        sa.Column('analyzed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('analysis_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('confidence', sa.Float(), nullable=True),  # Confidence in the analysis

        sa.ForeignKeyConstraint(['memory_id'], ['cortex_memories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('memory_id', name='uq_emotional_signature_memory'),
    )

    op.create_index('idx_emotional_memory', 'cortex_emotional_signatures', ['memory_id'])
    op.create_index('idx_emotional_importance', 'cortex_emotional_signatures', ['importance_score'])
    op.create_index('idx_emotional_valence_arousal', 'cortex_emotional_signatures', ['valence', 'arousal'])


def downgrade() -> None:
    op.drop_index('idx_emotional_valence_arousal', table_name='cortex_emotional_signatures')
    op.drop_index('idx_emotional_importance', table_name='cortex_emotional_signatures')
    op.drop_index('idx_emotional_memory', table_name='cortex_emotional_signatures')
    op.drop_table('cortex_emotional_signatures')
