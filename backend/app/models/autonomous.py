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


class AutonomousActionStatus(str, enum.Enum):
    PENDING = "pending"  # Ready for user to approve/dismiss
    APPROVED = "approved"  # User approved, awaiting execution
    DISMISSED = "dismissed"  # User dismissed
    EXPIRED = "expired"  # Expired without action
    EXECUTED = "executed"  # Successfully executed
    FAILED = "failed"  # Execution failed


class AutonomousActionType(str, enum.Enum):
    EMAIL_REPLY = "email_reply"
    EMAIL_COMPOSE = "email_compose"
    CALENDAR_CREATE = "calendar_create"
    CALENDAR_RESCHEDULE = "calendar_reschedule"
    CALENDAR_CANCEL = "calendar_cancel"
    MEETING_PREP = "meeting_prep"
    REMINDER_CREATE = "reminder_create"
    TASK_CREATE = "task_create"
    FOLLOWUP = "followup"


class AutonomousAction(Base):
    """
    Iris-style autonomous action suggestions.

    Cortex proactively generates actionable suggestions:
    - "Reply to Sarah's urgent email" with pre-filled draft
    - "Reschedule conflicting meeting" with suggested time
    - "Block focus time" with calendar event ready

    User sees card with one-tap approve/dismiss.
    """
    __tablename__ = "cortex_autonomous_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)

    # Action details
    action_type = Column(String(50), nullable=False)  # email_reply, calendar_create, etc.
    title = Column(String(255), nullable=False)  # Card title: "Reply to Sarah"
    description = Column(Text)  # Card description/preview

    # Pre-filled action payload - ready to execute
    action_payload = Column(JSONB, nullable=False)
    # Email: {thread_id, to, subject, body}
    # Calendar: {title, start_time, end_time, attendees, location}
    # Reminder: {title, due_at, notes}

    # Context & reasoning
    reason = Column(Text)  # Why suggested: "Sarah usually expects reply within 2h"
    source_type = Column(String(50))  # "email", "calendar", "pattern", "memory"
    source_id = Column(String(255))  # Reference to source (thread_id, event_id, etc.)

    # Scoring
    confidence_score = Column(Float, default=0.5)  # 0-1, higher = more confident
    priority_score = Column(Float, default=50.0)  # 0-100, for ordering

    # Status tracking
    status = Column(String(20), default="pending")

    # User feedback
    user_feedback = Column(String(50))  # helpful, not_helpful, wrong_timing, incorrect
    user_modification = Column(JSONB)  # If user edited before approving

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)  # Auto-expire after X hours
    surfaced_at = Column(DateTime)  # When shown to user
    actioned_at = Column(DateTime)  # When user approved/dismissed
    executed_at = Column(DateTime)  # When action was executed

    # Error tracking
    error_message = Column(Text)  # If execution failed

    # Relationships
    user = relationship("User", back_populates="autonomous_actions")
    feedback_entries = relationship("ActionFeedback", back_populates="autonomous_action", cascade="all, delete-orphan")


class ActionFeedback(Base):
    """
    Detailed feedback on autonomous actions for learning.

    Tracks:
    - What user modified before approving
    - Why user dismissed
    - Rating for executed actions
    """
    __tablename__ = "cortex_action_feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("cortex_users.id"), nullable=False)
    autonomous_action_id = Column(UUID(as_uuid=True), ForeignKey("cortex_autonomous_actions.id"), nullable=False)

    # Feedback details
    feedback_type = Column(String(30), nullable=False)  # approved, dismissed, modified, expired
    rating = Column(Integer)  # 1-5 optional rating
    comment = Column(Text)  # User comment

    # Modification details
    modification_summary = Column(Text)  # What user changed
    original_payload = Column(JSONB)  # Original suggestion
    modified_payload = Column(JSONB)  # User's modifications

    # Dismiss reason (if dismissed)
    dismiss_reason = Column(String(50))  # wrong_timing, not_relevant, incorrect, too_aggressive

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="action_feedback")
    autonomous_action = relationship("AutonomousAction", back_populates="feedback_entries")
