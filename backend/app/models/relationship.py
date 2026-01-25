"""
Relationship Intelligence Models

Enables:
- Relationship health scoring
- Important dates tracking (birthdays, anniversaries)
- Interaction history and patterns
- Reconnection nudges
- Relationship warnings (tensions, unresolved issues)
- Promises/commitments to people
"""

import enum
from datetime import datetime, date
from uuid import uuid4
from sqlalchemy import Column, String, Text, Date, DateTime, ForeignKey, Float, Boolean, Integer, Enum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class RelationshipTier(str, enum.Enum):
    """Relationship importance tiers."""
    INNER_CIRCLE = "inner_circle"  # Family, best friends, partner
    CLOSE = "close"  # Good friends, close colleagues
    REGULAR = "regular"  # Regular contacts, acquaintances
    DISTANT = "distant"  # Rarely interact
    PROFESSIONAL = "professional"  # Work contacts only


class InteractionType(str, enum.Enum):
    """Types of interactions with people."""
    MEETING = "meeting"
    CALL = "call"
    EMAIL = "email"
    MESSAGE = "message"
    SOCIAL = "social"  # Social gathering
    MENTIONED = "mentioned"  # Just mentioned in a memory
    THOUGHT_OF = "thought_of"  # User thought about them


class RelationshipHealth(Base):
    """
    Tracks relationship health metrics for each person.

    Health score is computed from:
    - Interaction frequency
    - Sentiment trend
    - Promises kept/broken
    - Time since last contact
    """
    __tablename__ = "cortex_relationship_health"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"), nullable=False)

    # Relationship classification (using String to match migration schema)
    tier = Column(String(30), default="regular")

    # Health metrics (0-100)
    health_score = Column(Float, default=50.0)

    # Component scores (0-1)
    frequency_score = Column(Float, default=0.5)  # How often they interact
    sentiment_score = Column(Float, default=0.5)  # Positive vs negative interactions
    reciprocity_score = Column(Float, default=0.5)  # Two-way vs one-way
    commitment_score = Column(Float, default=0.5)  # Promises kept

    # Trend
    health_trend = Column(String(20), default="stable")  # improving, stable, declining

    # Optimal interaction frequency (days)
    ideal_contact_days = Column(Integer, default=14)  # Based on tier

    # Last interaction
    last_interaction_date = Column(Date)
    last_interaction_type = Column(String(50))
    days_since_contact = Column(Integer, default=0)

    # Nudge tracking
    needs_reconnect = Column(Boolean, default=False)
    last_nudge_sent = Column(DateTime)
    nudge_count = Column(Integer, default=0)

    # Warnings
    has_tension = Column(Boolean, default=False)
    tension_reason = Column(Text)
    has_unresolved = Column(Boolean, default=False)
    unresolved_items = Column(JSONB, default=list)  # List of unresolved issues

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")


class ImportantDate(Base):
    """
    Tracks important dates for people (birthdays, anniversaries, etc.)
    """
    __tablename__ = "cortex_important_dates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"), nullable=False)

    # Date info
    date_type = Column(String(50), nullable=False)  # birthday, anniversary, work_anniversary, custom
    date_label = Column(String(255))  # "Birthday", "Wedding Anniversary", "Started at Company"

    # The date (just month/day for recurring, or full date)
    month = Column(Integer, nullable=False)  # 1-12
    day = Column(Integer, nullable=False)  # 1-31
    year = Column(Integer)  # Optional - for calculating age/years

    # Reminder settings
    reminder_days_before = Column(Integer, default=3)  # Remind X days before
    last_reminded = Column(DateTime)

    # Memory reference (where we learned this)
    source_memory_id = Column(UUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))

    # Notes
    notes = Column(Text)  # "She likes flowers", "Don't mention last year"

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")


class InteractionLog(Base):
    """
    Detailed log of all interactions with people.
    Auto-extracted from memories, emails, calendar.
    """
    __tablename__ = "cortex_interaction_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"), nullable=False)

    # Interaction details (using String to match migration schema)
    interaction_type = Column(String(30), nullable=False)
    interaction_date = Column(DateTime, nullable=False)

    # Content summary
    summary = Column(Text)

    # Sentiment of this interaction
    sentiment = Column(Float, default=0.5)  # 0 = very negative, 1 = very positive

    # Source
    source_type = Column(String(50))  # memory, email, calendar
    source_id = Column(UUID(as_uuid=True))  # Reference to memory/email/event

    # Topics discussed
    topics = Column(JSONB, default=list)

    # Promises made in this interaction
    promises_made = Column(JSONB, default=list)  # [{promise, due_date, fulfilled}]

    # Duration (for meetings/calls)
    duration_minutes = Column(Integer)

    # Who initiated
    initiated_by_user = Column(Boolean)  # True if user reached out first

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")


class RelationshipPromise(Base):
    """
    Tracks promises/commitments made to specific people.

    "I told John I'd review his proposal"
    "I promised Mom I'd call more often"
    """
    __tablename__ = "cortex_relationship_promises"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"), nullable=False)

    # Promise details
    description = Column(Text, nullable=False)
    original_text = Column(Text)  # Exact words from memory

    # Timeline
    made_on = Column(Date, nullable=False)
    due_date = Column(Date)  # If there's a deadline

    # Status
    status = Column(String(20), default="pending")  # pending, fulfilled, broken, forgotten
    fulfilled_on = Column(Date)

    # Impact on relationship
    importance = Column(Float, default=0.5)  # How important to them

    # Source
    source_memory_id = Column(UUID(as_uuid=True), ForeignKey("cortex_memories.id", ondelete="SET NULL"))

    # Reminder tracking
    reminder_count = Column(Integer, default=0)
    last_reminded = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")


class ThirdPartyCommitment(Base):
    """
    Tracks promises/commitments OTHERS made TO the user.

    "Josh said he'd send the pricing by Friday"
    "Sarah promised to introduce me to her CEO"
    "Mike said he'll get back to me about the project"

    Extracted from emails and conversations via GPT analysis.
    """
    __tablename__ = "cortex_third_party_commitments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"), nullable=True)  # Person who made the promise

    # Who made the promise (may not have an entity yet)
    person_name = Column(String(255), nullable=False)
    person_email = Column(String(255))

    # Commitment details
    action = Column(Text, nullable=False)  # What they promised to do
    context = Column(Text)  # Brief context of the promise
    original_text = Column(Text)  # Exact words from email/message

    # Timeline
    extracted_at = Column(DateTime, default=datetime.utcnow)
    mentioned_date = Column(String(100))  # "by Friday", "next week", etc. (as mentioned)
    due_date = Column(Date)  # Parsed date if possible

    # Status
    status = Column(String(20), default="pending")  # pending, fulfilled, broken, expired, unknown
    fulfilled_at = Column(DateTime)

    # Source tracking
    source_type = Column(String(50))  # email, chat, memory
    source_id = Column(String(255))  # email_id, thread_id, memory_id
    source_snippet = Column(Text)  # Snippet of the source for context

    # Tracking
    last_checked_at = Column(DateTime)
    reminder_count = Column(Integer, default=0)
    last_reminded_at = Column(DateTime)

    # Metadata
    confidence = Column(Float, default=0.8)  # GPT extraction confidence
    importance = Column(Float, default=0.5)  # How important this promise is

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")


class RelationshipInsight(Base):
    """
    AI-generated insights about relationships.

    "You've been talking to Sarah less since the project ended"
    "John seems frustrated - last 3 interactions were tense"
    """
    __tablename__ = "cortex_relationship_insights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(UUID(as_uuid=True), ForeignKey("cortex_entities.id", ondelete="CASCADE"))  # Nullable for general insights

    # Insight content
    insight_type = Column(String(50), nullable=False)  # declining_contact, tension_detected, milestone, pattern
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)

    # Severity/importance
    priority = Column(Float, default=0.5)  # 0-1

    # Action suggestion
    suggested_action = Column(Text)

    # Status
    is_active = Column(Boolean, default=True)
    dismissed_at = Column(DateTime)
    acted_on = Column(Boolean, default=False)

    # Evidence (memory IDs that support this insight)
    evidence_memory_ids = Column(JSONB, default=list)

    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)  # Some insights are time-sensitive

    # Relationships
    user = relationship("User")
    entity = relationship("Entity")
