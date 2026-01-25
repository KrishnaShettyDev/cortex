"""
Autonomous Email Service - Iris-like Proactive Email Features

Handles:
- Scheduled email sending (via chat: "send this at 9am tomorrow")
- Email snooze (via chat: "remind me about this Friday")
- Auto-draft generation (proactively drafts replies to important emails)
- Autonomous follow-ups (auto-sends follow-ups after X days)

All features work seamlessly through chat - no extra UI needed.
"""

import json
import logging
from datetime import datetime, timedelta
from uuid import UUID
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.autonomous import (
    ScheduledEmail,
    ScheduledEmailStatus,
    SnoozedEmail,
    AutoDraft,
    AutoDraftStatus,
    AutoFollowUpRule,
)
from app.services.sync_service import SyncService
from app.services.email_intelligence_service import EmailIntelligenceService

settings = get_settings()
logger = logging.getLogger(__name__)


class AutonomousEmailService:
    """
    Service for autonomous email operations.

    All features are exposed via GPT function calling tools in chat_service.
    No separate UI needed.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)
        self.sync_service = SyncService(db)
        self.email_intelligence = EmailIntelligenceService(db)

    # ==================== SCHEDULED SEND ====================

    async def schedule_email(
        self,
        user_id: UUID,
        to: list[dict],
        subject: str,
        body: str,
        scheduled_for: datetime,
        cc: list[dict] = None,
        thread_id: str = None,
        timezone: str = "UTC",
    ) -> dict:
        """
        Schedule an email to be sent at a future time.

        Called via chat: "Send this email at 9am tomorrow"
        """
        try:
            scheduled_email = ScheduledEmail(
                user_id=user_id,
                to_recipients=to,
                cc_recipients=cc,
                subject=subject,
                body=body,
                scheduled_for=scheduled_for,
                timezone=timezone,
                thread_id=thread_id,
                status="pending",
            )
            self.db.add(scheduled_email)
            await self.db.commit()
            await self.db.refresh(scheduled_email)

            return {
                "success": True,
                "scheduled_email_id": str(scheduled_email.id),
                "scheduled_for": scheduled_for.isoformat(),
                "message": f"Email scheduled for {scheduled_for.strftime('%B %d at %I:%M %p')}",
            }
        except Exception as e:
            logger.error(f"Error scheduling email: {e}")
            return {"success": False, "message": str(e)}

    async def get_pending_scheduled_emails(
        self,
        within_minutes: int = 5,
    ) -> list[ScheduledEmail]:
        """Get scheduled emails that should be sent now."""
        now = datetime.utcnow()
        window = now + timedelta(minutes=within_minutes)

        result = await self.db.execute(
            select(ScheduledEmail).where(
                and_(
                    ScheduledEmail.status == "pending",
                    ScheduledEmail.scheduled_for <= window,
                )
            )
        )
        return list(result.scalars().all())

    async def send_scheduled_email(self, scheduled_email: ScheduledEmail) -> bool:
        """Send a scheduled email."""
        try:
            if scheduled_email.thread_id:
                # Reply to thread
                result = await self.sync_service.reply_to_thread(
                    user_id=scheduled_email.user_id,
                    thread_id=scheduled_email.thread_id,
                    body=scheduled_email.body,
                    cc=[r.get("email") for r in (scheduled_email.cc_recipients or [])],
                )
            else:
                # New email
                result = await self.sync_service.send_email(
                    user_id=scheduled_email.user_id,
                    to=scheduled_email.to_recipients,
                    subject=scheduled_email.subject,
                    body=scheduled_email.body,
                    cc=scheduled_email.cc_recipients,
                )

            if result.get("success"):
                scheduled_email.status = "sent"
                scheduled_email.sent_at = datetime.utcnow()
            else:
                scheduled_email.status = "failed"
                scheduled_email.error_message = result.get("message", "Unknown error")

            await self.db.commit()
            return result.get("success", False)

        except Exception as e:
            logger.error(f"Error sending scheduled email {scheduled_email.id}: {e}")
            scheduled_email.status = "failed"
            scheduled_email.error_message = str(e)
            await self.db.commit()
            return False

    async def cancel_scheduled_email(
        self,
        user_id: UUID,
        scheduled_email_id: UUID,
    ) -> dict:
        """Cancel a scheduled email."""
        result = await self.db.execute(
            select(ScheduledEmail).where(
                and_(
                    ScheduledEmail.id == scheduled_email_id,
                    ScheduledEmail.user_id == user_id,
                    ScheduledEmail.status == "pending",
                )
            )
        )
        scheduled_email = result.scalar_one_or_none()

        if not scheduled_email:
            return {"success": False, "message": "Scheduled email not found or already sent"}

        scheduled_email.status = "cancelled"
        await self.db.commit()

        return {"success": True, "message": "Scheduled email cancelled"}

    async def list_scheduled_emails(self, user_id: UUID) -> list[dict]:
        """List user's pending scheduled emails."""
        result = await self.db.execute(
            select(ScheduledEmail).where(
                and_(
                    ScheduledEmail.user_id == user_id,
                    ScheduledEmail.status == "pending",
                )
            ).order_by(ScheduledEmail.scheduled_for)
        )
        emails = result.scalars().all()

        return [
            {
                "id": str(e.id),
                "subject": e.subject,
                "to": e.to_recipients,
                "scheduled_for": e.scheduled_for.isoformat(),
            }
            for e in emails
        ]

    # ==================== EMAIL SNOOZE ====================

    async def snooze_email(
        self,
        user_id: UUID,
        thread_id: str,
        snooze_until: datetime,
        reason: str = None,
    ) -> dict:
        """
        Snooze an email to resurface later.

        Called via chat: "Remind me about this email Friday"
        """
        try:
            # Get email details for context
            thread_result = await self.sync_service.get_email_thread(
                user_id=user_id,
                thread_id=thread_id,
            )

            subject = None
            sender = None
            snippet = None
            message_id = None

            if thread_result.get("success") and thread_result.get("messages"):
                last_msg = thread_result["messages"][-1]
                subject = last_msg.get("subject")
                sender = last_msg.get("from")
                snippet = last_msg.get("snippet", last_msg.get("body", ""))[:200]
                message_id = last_msg.get("id")

            snoozed = SnoozedEmail(
                user_id=user_id,
                thread_id=thread_id,
                message_id=message_id,
                subject=subject,
                sender=sender,
                snippet=snippet,
                snooze_until=snooze_until,
                reason=reason,
                is_active=True,
            )
            self.db.add(snoozed)
            await self.db.commit()
            await self.db.refresh(snoozed)

            return {
                "success": True,
                "snoozed_email_id": str(snoozed.id),
                "snooze_until": snooze_until.isoformat(),
                "message": f"Email snoozed until {snooze_until.strftime('%B %d at %I:%M %p')}",
            }
        except Exception as e:
            logger.error(f"Error snoozing email: {e}")
            return {"success": False, "message": str(e)}

    async def get_due_snoozed_emails(
        self,
        within_minutes: int = 5,
    ) -> list[SnoozedEmail]:
        """Get snoozed emails that are due now."""
        now = datetime.utcnow()
        window = now + timedelta(minutes=within_minutes)

        result = await self.db.execute(
            select(SnoozedEmail).where(
                and_(
                    SnoozedEmail.is_active == True,
                    SnoozedEmail.snooze_until <= window,
                    SnoozedEmail.notified_at.is_(None),
                )
            )
        )
        return list(result.scalars().all())

    async def mark_snoozed_notified(self, snoozed_id: UUID) -> None:
        """Mark a snoozed email as notified."""
        result = await self.db.execute(
            select(SnoozedEmail).where(SnoozedEmail.id == snoozed_id)
        )
        snoozed = result.scalar_one_or_none()
        if snoozed:
            snoozed.notified_at = datetime.utcnow()
            snoozed.is_active = False
            await self.db.commit()

    # ==================== AUTO-DRAFT SUGGESTIONS ====================

    async def generate_auto_draft(
        self,
        user_id: UUID,
        thread_id: str,
        priority: float = 0.5,
        reason: str = None,
    ) -> Optional[AutoDraft]:
        """
        Proactively generate a draft reply to an email.

        Called by background job when important email detected.
        """
        try:
            # Get thread details
            thread_result = await self.sync_service.get_email_thread(
                user_id=user_id,
                thread_id=thread_id,
            )

            if not thread_result.get("success") or not thread_result.get("messages"):
                return None

            messages = thread_result["messages"]
            last_msg = messages[-1]

            # Generate draft using email intelligence service
            draft_result = await self.email_intelligence.generate_reply(
                user_id=user_id,
                thread_id=thread_id,
            )

            if not draft_result.get("success"):
                return None

            auto_draft = AutoDraft(
                user_id=user_id,
                thread_id=thread_id,
                original_subject=last_msg.get("subject"),
                original_sender=last_msg.get("from"),
                original_snippet=last_msg.get("snippet", "")[:200],
                draft_subject=draft_result.get("subject"),
                draft_body=draft_result.get("body"),
                reason=reason,
                priority=priority,
                status="pending",
                expires_at=datetime.utcnow() + timedelta(days=3),
            )
            self.db.add(auto_draft)
            await self.db.commit()
            await self.db.refresh(auto_draft)

            return auto_draft

        except Exception as e:
            logger.error(f"Error generating auto draft: {e}")
            return None

    async def get_pending_auto_drafts(self, user_id: UUID) -> list[AutoDraft]:
        """Get user's pending auto-drafts for chat context."""
        result = await self.db.execute(
            select(AutoDraft).where(
                and_(
                    AutoDraft.user_id == user_id,
                    AutoDraft.status == "pending",
                    or_(
                        AutoDraft.expires_at.is_(None),
                        AutoDraft.expires_at > datetime.utcnow(),
                    )
                )
            ).order_by(AutoDraft.priority.desc()).limit(5)
        )
        return list(result.scalars().all())

    async def send_auto_draft(
        self,
        user_id: UUID,
        draft_id: UUID,
        modifications: str = None,
    ) -> dict:
        """Send an auto-drafted email (user approved)."""
        result = await self.db.execute(
            select(AutoDraft).where(
                and_(
                    AutoDraft.id == draft_id,
                    AutoDraft.user_id == user_id,
                    AutoDraft.status == "pending",
                )
            )
        )
        draft = result.scalar_one_or_none()

        if not draft:
            return {"success": False, "message": "Draft not found or already actioned"}

        body = draft.draft_body
        if modifications:
            # Apply modifications via LLM
            body = await self._apply_modifications(body, modifications)

        # Send the reply
        send_result = await self.sync_service.reply_to_thread(
            user_id=user_id,
            thread_id=draft.thread_id,
            body=body,
        )

        if send_result.get("success"):
            draft.status = "sent"
            draft.actioned_at = datetime.utcnow()
            await self.db.commit()
            return {"success": True, "message": "Email sent"}
        else:
            return send_result

    async def dismiss_auto_draft(
        self,
        user_id: UUID,
        draft_id: UUID,
    ) -> dict:
        """Dismiss an auto-draft (user didn't want it)."""
        result = await self.db.execute(
            select(AutoDraft).where(
                and_(
                    AutoDraft.id == draft_id,
                    AutoDraft.user_id == user_id,
                )
            )
        )
        draft = result.scalar_one_or_none()

        if not draft:
            return {"success": False, "message": "Draft not found"}

        draft.status = "dismissed"
        draft.actioned_at = datetime.utcnow()
        await self.db.commit()

        return {"success": True, "message": "Draft dismissed"}

    async def _apply_modifications(self, body: str, modifications: str) -> str:
        """Apply user's modifications to a draft."""
        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Modify the email draft based on the user's instructions. Return only the modified email body.",
                    },
                    {
                        "role": "user",
                        "content": f"Original draft:\n{body}\n\nModifications: {modifications}",
                    },
                ],
                temperature=0.7,
                max_tokens=1500,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error applying modifications: {e}")
            return body

    # ==================== AUTO FOLLOW-UP ====================

    async def create_auto_followup_rule(
        self,
        user_id: UUID,
        thread_id: str,
        days_to_wait: int = 3,
        max_followups: int = 2,
        urgency: str = "normal",
        custom_message: str = None,
    ) -> dict:
        """
        Create an automatic follow-up rule.

        Called via chat: "Follow up automatically if no reply in 3 days"
        """
        try:
            # Get thread details
            thread_result = await self.sync_service.get_email_thread(
                user_id=user_id,
                thread_id=thread_id,
            )

            original_subject = None
            original_recipient = None

            if thread_result.get("success") and thread_result.get("messages"):
                last_msg = thread_result["messages"][-1]
                original_subject = last_msg.get("subject")
                # Get recipient from the last message we sent
                original_recipient = last_msg.get("to", [{}])[0].get("email") if last_msg.get("to") else None

            rule = AutoFollowUpRule(
                user_id=user_id,
                thread_id=thread_id,
                original_subject=original_subject,
                original_recipient=original_recipient,
                days_to_wait=days_to_wait,
                max_followups=max_followups,
                urgency=urgency,
                custom_message=custom_message,
                is_active=True,
            )
            self.db.add(rule)
            await self.db.commit()
            await self.db.refresh(rule)

            return {
                "success": True,
                "rule_id": str(rule.id),
                "message": f"Auto follow-up enabled. Will send up to {max_followups} follow-ups, waiting {days_to_wait} days between each.",
            }
        except Exception as e:
            logger.error(f"Error creating auto follow-up rule: {e}")
            return {"success": False, "message": str(e)}

    async def get_active_followup_rules(self) -> list[AutoFollowUpRule]:
        """Get all active follow-up rules that need checking."""
        result = await self.db.execute(
            select(AutoFollowUpRule).where(
                and_(
                    AutoFollowUpRule.is_active == True,
                    AutoFollowUpRule.reply_received == False,
                )
            )
        )
        return list(result.scalars().all())

    async def process_followup_rule(self, rule: AutoFollowUpRule) -> dict:
        """Process a follow-up rule - check for reply and send follow-up if needed."""
        try:
            # Check if reply was received
            thread_result = await self.sync_service.get_email_thread(
                user_id=rule.user_id,
                thread_id=rule.thread_id,
            )

            if not thread_result.get("success"):
                return {"success": False, "message": "Could not check thread"}

            messages = thread_result.get("messages", [])

            # Check if there's a reply (message not from user)
            # Simple heuristic: if last message is from someone else, we got a reply
            if messages:
                last_msg = messages[-1]
                # If last message is not from us, we got a reply
                sender = last_msg.get("from", "")
                # Check if sender contains our recipient email (they replied)
                if rule.original_recipient and rule.original_recipient.lower() in sender.lower():
                    rule.reply_received = True
                    rule.is_active = False
                    rule.completed_at = datetime.utcnow()
                    await self.db.commit()
                    return {"success": True, "action": "reply_received", "message": "Reply received, auto follow-up completed"}

            # Check if it's time for a follow-up
            last_action = rule.last_followup_sent or rule.created_at
            days_since = (datetime.utcnow() - last_action).days

            if days_since >= rule.days_to_wait:
                if rule.followups_sent >= rule.max_followups:
                    rule.is_active = False
                    rule.completed_at = datetime.utcnow()
                    await self.db.commit()
                    return {"success": True, "action": "max_reached", "message": "Max follow-ups reached"}

                # Generate and send follow-up
                followup_result = await self.email_intelligence.generate_followup(
                    user_id=rule.user_id,
                    thread_id=rule.thread_id,
                    urgency=rule.urgency,
                )

                if not followup_result.get("success"):
                    return {"success": False, "message": "Could not generate follow-up"}

                body = rule.custom_message or followup_result.get("body")

                # Send the follow-up
                send_result = await self.sync_service.reply_to_thread(
                    user_id=rule.user_id,
                    thread_id=rule.thread_id,
                    body=body,
                )

                if send_result.get("success"):
                    rule.followups_sent += 1
                    rule.last_followup_sent = datetime.utcnow()
                    await self.db.commit()
                    return {"success": True, "action": "followup_sent", "message": f"Follow-up #{rule.followups_sent} sent"}
                else:
                    return {"success": False, "message": "Could not send follow-up"}

            rule.last_checked = datetime.utcnow()
            await self.db.commit()
            return {"success": True, "action": "no_action", "message": "Not yet time for follow-up"}

        except Exception as e:
            logger.error(f"Error processing follow-up rule {rule.id}: {e}")
            return {"success": False, "message": str(e)}

    async def cancel_auto_followup(
        self,
        user_id: UUID,
        rule_id: UUID,
    ) -> dict:
        """Cancel an auto follow-up rule."""
        result = await self.db.execute(
            select(AutoFollowUpRule).where(
                and_(
                    AutoFollowUpRule.id == rule_id,
                    AutoFollowUpRule.user_id == user_id,
                )
            )
        )
        rule = result.scalar_one_or_none()

        if not rule:
            return {"success": False, "message": "Auto follow-up rule not found"}

        rule.is_active = False
        rule.completed_at = datetime.utcnow()
        await self.db.commit()

        return {"success": True, "message": "Auto follow-up cancelled"}

    # ==================== PROACTIVE CONTEXT FOR CHAT ====================

    async def get_proactive_email_context(self, user_id: UUID) -> str:
        """
        Get proactive email context for chat.

        Surfaces:
        - Pending auto-drafts
        - Scheduled emails
        - Active follow-up rules
        """
        context_parts = []

        # Pending auto-drafts
        drafts = await self.get_pending_auto_drafts(user_id)
        if drafts:
            context_parts.append("\n**PENDING EMAIL DRAFTS (AI-generated, awaiting approval):**")
            for draft in drafts[:3]:
                context_parts.append(
                    f"- Reply to {draft.original_sender}: \"{draft.original_subject}\" - {draft.reason or 'Ready to send'}"
                )

        # Scheduled emails
        scheduled = await self.list_scheduled_emails(user_id)
        if scheduled:
            context_parts.append("\n**SCHEDULED EMAILS:**")
            for email in scheduled[:3]:
                context_parts.append(
                    f"- \"{email['subject']}\" scheduled for {email['scheduled_for']}"
                )

        # Active follow-up rules
        result = await self.db.execute(
            select(AutoFollowUpRule).where(
                and_(
                    AutoFollowUpRule.user_id == user_id,
                    AutoFollowUpRule.is_active == True,
                )
            ).limit(3)
        )
        rules = result.scalars().all()
        if rules:
            context_parts.append("\n**ACTIVE AUTO FOLLOW-UPS:**")
            for rule in rules:
                context_parts.append(
                    f"- Tracking reply from {rule.original_recipient}: \"{rule.original_subject}\" ({rule.followups_sent}/{rule.max_followups} follow-ups sent)"
                )

        return "\n".join(context_parts) if context_parts else ""


# Singleton instance
autonomous_email_service = None


def get_autonomous_email_service(db: AsyncSession) -> AutonomousEmailService:
    return AutonomousEmailService(db)
