"""
Pattern model for tracking behavioral patterns extracted from user memories.

Patterns enable Cortex to:
- "You always overcommit after a good week"
- "Every time you skip the gym for 3 days, you abandon it for a month"
- "When you're stressed, you stop responding to friends"
"""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Boolean,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.memory import Memory


class PatternType(str, Enum):
    """Types of behavioral patterns."""
    BEHAVIORAL = "behavioral"      # "You always X when Y"
    TEMPORAL = "temporal"          # "Every Monday you..."
    EMOTIONAL = "emotional"        # "When stressed, you..."
    SOCIAL = "social"              # "With person X, you..."
    COMMITMENT = "commitment"      # "You overcommit when..."
    AVOIDANCE = "avoidance"        # "You avoid X after..."
    CYCLICAL = "cyclical"          # "Every few weeks you..."


class PatternValence(str, Enum):
    """Whether the pattern is positive, negative, or neutral."""
    POSITIVE = "positive"    # Good habit, healthy pattern
    NEGATIVE = "negative"    # Bad habit, self-sabotage
    NEUTRAL = "neutral"      # Just an observation


class Pattern(Base):
    """
    A detected behavioral pattern from user's memories.

    Examples:
    - trigger: "good week at work"
      behavior: "overcommit to new projects"
      pattern_type: "commitment"
      valence: "negative"

    - trigger: "skip gym 3 days"
      behavior: "abandon exercise routine for a month"
      pattern_type: "avoidance"
      valence: "negative"

    - trigger: "morning meditation"
      behavior: "more productive and calm throughout day"
      pattern_type: "behavioral"
      valence: "positive"
    """
    __tablename__ = "cortex_patterns"

    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)

    # Pattern description
    name = Column(String(255), nullable=False)  # Short name: "Post-success overcommitment"
    description = Column(Text, nullable=False)  # Full description for display

    # Pattern structure: "When [trigger], you [behavior]"
    trigger = Column(Text, nullable=False)      # What triggers the pattern
    behavior = Column(Text, nullable=False)     # What behavior follows
    consequence = Column(Text)                  # What typically happens after (optional)

    # Classification
    pattern_type = Column(String(20), default=PatternType.BEHAVIORAL.value)
    valence = Column(String(20), default=PatternValence.NEUTRAL.value)

    # Evidence - memories that support this pattern
    evidence_memory_ids = Column(JSONB, default=list)  # List of memory IDs
    evidence_count = Column(Integer, default=0)        # How many times observed

    # Pattern timing
    typical_delay_hours = Column(Integer)       # How long between trigger and behavior
    typical_duration_days = Column(Integer)     # How long the behavior lasts

    # Confidence and learning
    confidence = Column(Float, default=0.5)     # 0-1 confidence in this pattern
    last_observed = Column(DateTime)            # When we last saw this pattern occur
    times_predicted = Column(Integer, default=0)  # How many times we predicted it
    times_accurate = Column(Integer, default=0)   # How many predictions were accurate

    # Pattern status
    is_active = Column(Boolean, default=True)   # Whether to track this pattern
    is_acknowledged = Column(Boolean, default=False)  # User has seen this pattern
    user_confirmed = Column(Boolean)            # User confirmed/denied accuracy (None = not asked)

    # For chat integration - the "call" Cortex can make
    prediction_template = Column(Text)          # "You're about to {behavior} again."
    warning_template = Column(Text)             # "I notice {trigger}. Last time..."

    # Temporal patterns
    day_of_week = Column(Integer)               # 0=Monday, for weekly patterns
    time_of_day = Column(String(20))            # morning, afternoon, evening, night
    month_of_year = Column(Integer)             # For seasonal patterns

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="patterns")

    def __repr__(self) -> str:
        return f"<Pattern {self.name}: When {self.trigger[:30]}...>"

    @property
    def accuracy_rate(self) -> float:
        """Calculate prediction accuracy rate."""
        if self.times_predicted == 0:
            return 0.0
        return self.times_accurate / self.times_predicted

    @property
    def is_strong(self) -> bool:
        """Whether this pattern has strong evidence."""
        return self.confidence >= 0.7 and self.evidence_count >= 3

    def to_chat_context(self) -> str:
        """Format for inclusion in chat context."""
        valence_emoji = {
            PatternValence.POSITIVE.value: "✓",
            PatternValence.NEGATIVE.value: "⚠",
            PatternValence.NEUTRAL.value: "•",
        }
        emoji = valence_emoji.get(self.valence, "•")

        return f"{emoji} PATTERN: When {self.trigger}, user tends to {self.behavior}"


class PatternOccurrence(Base):
    """
    Records when a pattern was observed or predicted.

    This allows tracking:
    - When patterns actually occur (observed=True)
    - When we predicted a pattern might occur (predicted=True)
    - Whether predictions were accurate
    """
    __tablename__ = "cortex_pattern_occurrences"

    id = Column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    pattern_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_patterns.id", ondelete="CASCADE"), nullable=False)

    # The memory that triggered/showed this occurrence
    trigger_memory_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))
    behavior_memory_id = Column(PGUUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))

    # Tracking
    predicted = Column(Boolean, default=False)   # Did we predict this?
    observed = Column(Boolean, default=False)    # Did we observe it happen?
    predicted_at = Column(DateTime)
    observed_at = Column(DateTime)

    # For predictions
    prediction_was_accurate = Column(Boolean)    # Was the prediction correct?
    user_prevented = Column(Boolean)             # Did user consciously prevent it?

    # Context
    notes = Column(Text)                         # Any additional context

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    pattern = relationship("Pattern")
