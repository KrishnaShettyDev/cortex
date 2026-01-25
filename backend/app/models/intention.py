"""Prospective Memory - Intentions Model.

Tracks user intentions extracted from memories:
- "I'll email Sarah tomorrow"
- "I need to finish the proposal by Friday"
- "I should call mom this weekend"

Enables proactive nudges when intentions go unfulfilled.
"""
from datetime import datetime, date
from uuid import uuid4
from enum import Enum

from sqlalchemy import (
    Column, String, Text, Float, Boolean, Integer,
    DateTime, Date, ForeignKey, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class IntentionStatus(str, Enum):
    """Status of an intention."""
    ACTIVE = "active"           # Not yet due
    DUE = "due"                 # Due date reached, not fulfilled
    OVERDUE = "overdue"         # Past due, not fulfilled
    FULFILLED = "fulfilled"     # User completed it
    ABANDONED = "abandoned"     # User explicitly abandoned
    EXPIRED = "expired"         # Too old, no longer relevant


class IntentionType(str, Enum):
    """Type of intention."""
    TASK = "task"               # "I need to do X"
    COMMITMENT = "commitment"   # "I'll do X for someone"
    GOAL = "goal"               # "I want to achieve X"
    HABIT = "habit"             # "I should do X regularly"
    AVOIDANCE = "avoidance"     # "I need to stop doing X"


class Intention(Base):
    """
    User intention extracted from memory.

    Prospective memory = remembering to do something in the future.
    """
    __tablename__ = "cortex_intentions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)

    # Source memory where intention was detected
    source_memory_id = Column(UUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))

    # The intention itself
    description = Column(Text, nullable=False)  # "Email Sarah about the proposal"
    original_text = Column(Text)  # Original text from memory: "I'll email Sarah tomorrow"

    # Classification (using String to match migration schema)
    intention_type = Column(String(20), default="task")
    status = Column(String(20), default="active")

    # Timing
    detected_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    due_date = Column(Date)  # When it should be done
    due_time = Column(DateTime(timezone=True))  # Specific time if mentioned
    deadline_flexibility = Column(String(20))  # "strict", "flexible", "anytime"

    # Context
    target_person = Column(String(255))  # "Sarah" if it involves someone
    target_action = Column(String(255))  # "email", "call", "finish", "submit"
    related_project = Column(String(255))  # Project/topic if detected

    # Tracking
    reminder_count = Column(Integer, default=0)  # How many times we've reminded
    last_reminded_at = Column(DateTime(timezone=True))
    snoozed_until = Column(DateTime(timezone=True))

    # Fulfillment
    fulfilled_at = Column(DateTime(timezone=True))
    fulfillment_memory_id = Column(UUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))
    fulfillment_confidence = Column(Float)  # How confident we are it was fulfilled

    # User feedback
    user_confirmed = Column(Boolean)  # User confirmed fulfilled/abandoned
    user_notes = Column(Text)

    # Priority scoring
    importance = Column(Float, default=0.5)  # 0-1 based on language
    urgency = Column(Float, default=0.5)  # 0-1 based on deadline

    # Metadata
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="intentions")
    source_memory = relationship("Memory", foreign_keys=[source_memory_id])
    fulfillment_memory = relationship("Memory", foreign_keys=[fulfillment_memory_id])

    __table_args__ = (
        Index("idx_intentions_user", "user_id"),
        Index("idx_intentions_status", "user_id", "status"),
        Index("idx_intentions_due", "user_id", "due_date", "status"),
        # Note: partial index with where clause removed to avoid enum issues
    )

    @property
    def is_overdue(self) -> bool:
        """Check if intention is overdue."""
        if not self.due_date:
            return False
        return date.today() > self.due_date and self.status not in [
            "fulfilled", "abandoned", "expired"
        ]

    @property
    def days_until_due(self) -> int | None:
        """Days until due date (negative if overdue)."""
        if not self.due_date:
            return None
        return (self.due_date - date.today()).days

    @property
    def priority_score(self) -> float:
        """Combined priority score for sorting."""
        urgency_factor = self.urgency
        if self.days_until_due is not None:
            if self.days_until_due < 0:  # Overdue
                urgency_factor = min(1.0, 0.8 + abs(self.days_until_due) * 0.05)
            elif self.days_until_due == 0:  # Due today
                urgency_factor = 0.9
            elif self.days_until_due <= 3:  # Due soon
                urgency_factor = max(urgency_factor, 0.7)

        return (self.importance * 0.4 + urgency_factor * 0.6)

    def mark_fulfilled(self, memory_id: UUID = None, confidence: float = 1.0):
        """Mark intention as fulfilled."""
        self.status = "fulfilled"
        self.fulfilled_at = datetime.utcnow()
        self.fulfillment_memory_id = memory_id
        self.fulfillment_confidence = confidence

    def mark_abandoned(self, notes: str = None):
        """Mark intention as abandoned by user."""
        self.status = "abandoned"
        self.user_confirmed = True
        self.user_notes = notes

    def snooze(self, until: datetime):
        """Snooze reminders until a specific time."""
        self.snoozed_until = until
        self.reminder_count += 1
        self.last_reminded_at = datetime.utcnow()
