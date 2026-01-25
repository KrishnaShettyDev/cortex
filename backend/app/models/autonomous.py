"""
Autonomous Email Models - Iris-like Proactive Features

Enables:
- Scheduled email sending ("send this at 9am tomorrow")
- Email snooze ("remind me about this Friday")
- Auto-draft suggestions (proactive reply drafts)
- Autonomous follow-ups (auto-send after X days)
"""

import enum
from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Float, Boolean, Enum, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class ScheduledEmailStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ScheduledEmail(Base):
    """
    Emails scheduled to be sent at a future time.

    User says: "Send this email at 9am tomorrow"
    Cortex schedules it, sends automatically via background job.
    """
    __tablename__ = "cortex_scheduled_emails"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # Email content
    to_recipients = Column(JSONB, nullable=False)  # [{email, name}]
    cc_recipients = Column(JSONB)  # [{email, name}]
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)

    # Scheduling
    scheduled_for = Column(DateTime, nullable=False)
    timezone = Column(String(50), default="UTC")

    # Status (using String to match migration schema)
    status = Column(String(20), default="pending")
    sent_at = Column(DateTime)
    error_message = Column(Text)

    # Reply context (if replying to a thread)
    thread_id = Column(String(255))  # Gmail thread ID
    in_reply_to = Column(String(255))  # Message ID being replied to

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="scheduled_emails")


class SnoozedEmail(Base):
    """
    Emails snoozed to resurface later.

    User says: "Remind me about this email Friday"
    Cortex snoozes it, sends notification when due.
    """
    __tablename__ = "cortex_snoozed_emails"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # Email reference
    thread_id = Column(String(255), nullable=False)
    message_id = Column(String(255))
    subject = Column(String(500))
    sender = Column(String(255))
    snippet = Column(Text)

    # Snooze details
    snooze_until = Column(DateTime, nullable=False)
    reason = Column(Text)  # Why user snoozed it

    # Status
    is_active = Column(Boolean, default=True)
    notified_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="snoozed_emails")


class AutoDraftStatus(str, enum.Enum):
    PENDING = "pending"  # Draft ready, waiting for user
    SENT = "sent"  # User approved and sent
    DISMISSED = "dismissed"  # User dismissed
    EXPIRED = "expired"  # Too old, no longer relevant


class AutoDraft(Base):
    """
    Proactively generated email drafts.

    Cortex sees important email → generates draft reply → surfaces in chat.
    "I drafted a reply to Sarah's urgent email. Want me to send it?"
    """
    __tablename__ = "cortex_auto_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # Original email
    thread_id = Column(String(255), nullable=False)
    original_subject = Column(String(500))
    original_sender = Column(String(255))
    original_snippet = Column(Text)

    # Generated draft
    draft_subject = Column(String(500))
    draft_body = Column(Text, nullable=False)

    # Why it was drafted
    reason = Column(Text)  # "Urgent email from boss", "Follow-up needed"
    priority = Column(Float, default=0.5)  # 0-1, higher = more important

    # Status (using String to match migration schema)
    status = Column(String(20), default="pending")
    surfaced_at = Column(DateTime)  # When shown to user
    actioned_at = Column(DateTime)  # When user sent/dismissed

    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)  # After this, mark as expired

    # Relationships
    user = relationship("User", back_populates="auto_drafts")


class AutoFollowUpRule(Base):
    """
    Rules for automatic follow-up emails.

    User says: "Auto follow up if no reply in 3 days"
    Cortex tracks and sends follow-up automatically.
    """
    __tablename__ = "cortex_auto_followup_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # Target email
    thread_id = Column(String(255), nullable=False)
    original_subject = Column(String(500))
    original_recipient = Column(String(255))

    # Follow-up config
    days_to_wait = Column(Integer, default=3)
    max_followups = Column(Integer, default=2)
    followups_sent = Column(Integer, default=0)
    urgency = Column(String(20), default="normal")  # gentle, normal, urgent

    # Custom message (optional)
    custom_message = Column(Text)  # If null, AI generates

    # Status
    is_active = Column(Boolean, default=True)
    last_checked = Column(DateTime)
    last_followup_sent = Column(DateTime)
    reply_received = Column(Boolean, default=False)
    completed_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="auto_followup_rules")
