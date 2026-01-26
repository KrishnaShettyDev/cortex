"""
Autonomous Action Service - Iris-style Proactive Suggestions

Generates ready-to-execute action suggestions that users can approve with one tap:
- Email reply drafts (pre-filled content)
- Calendar event creation (reschedule conflicts, add focus time)
- Meeting prep reminders
- Follow-up suggestions

Actions are scored by confidence and priority, respecting user preferences
and notification budgets from the ProactiveOrchestrator.

Integration with ProactiveOrchestrator:
- Respects quiet hours from user preferences
- Applies daily action budget (separate from notification budget)
- Logs all actions for learning
"""

import logging
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update, func

from app.config import get_settings
from app.models.autonomous import (
    AutonomousAction,
    AutonomousActionStatus,
    ActionFeedback,
)
from app.models.notification_preferences import NotificationPreferences
from app.services.sync_service import SyncService
from app.services.email_intelligence_service import EmailIntelligenceService
from app.services.email_urgency_service import EmailUrgencyService

settings = get_settings()
logger = logging.getLogger(__name__)


class AutonomousActionService:
    """
    Service for generating, managing, and executing autonomous actions.

    Iris-style proactive suggestions with one-tap approve/dismiss.
    """

    # Configuration
    MAX_PENDING_ACTIONS = 5  # Max pending actions per user at once
    DEFAULT_EXPIRY_HOURS = 24  # Actions expire after 24h
    MIN_CONFIDENCE_THRESHOLD = 0.4  # Don't surface low-confidence actions
    MIN_PRIORITY_THRESHOLD = 40.0  # Minimum priority to surface

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.email_intelligence = EmailIntelligenceService(db)
        self.email_urgency = EmailUrgencyService(db)

    # ==================== ACTION RETRIEVAL ====================

    async def get_pending_actions(
        self,
        user_id: UUID,
        limit: int = 5,
    ) -> list[AutonomousAction]:
        """Get pending autonomous actions for a user, ordered by priority."""
        result = await self.db.execute(
            select(AutonomousAction)
            .where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.status == "pending",
                    AutonomousAction.expires_at > datetime.utcnow(),
                )
            )
            .order_by(AutonomousAction.priority_score.desc())
            .limit(limit)
        )
        actions = result.scalars().all()

        # Update surfaced_at for tracking
        for action in actions:
            if not action.surfaced_at:
                action.surfaced_at = datetime.utcnow()
        await self.db.commit()

        return list(actions)

    async def get_action_by_id(
        self,
        action_id: UUID,
        user_id: UUID,
    ) -> Optional[AutonomousAction]:
        """Get a specific action by ID, ensuring it belongs to the user."""
        result = await self.db.execute(
            select(AutonomousAction).where(
                and_(
                    AutonomousAction.id == action_id,
                    AutonomousAction.user_id == user_id,
                )
            )
        )
        return result.scalar_one_or_none()

    # ==================== ACTION GENERATION ====================

    async def generate_actions(self, user_id: UUID) -> list[AutonomousAction]:
        """
        Generate autonomous actions based on current context.

        Analyzes emails, calendar, and patterns to create actionable suggestions.
        """
        # Check if we should generate (respect quiet hours, pending count)
        can_generate, reason = await self._can_generate_actions(user_id)
        if not can_generate:
            logger.info(f"Skipping action generation for {user_id}: {reason}")
            return []

        actions: list[AutonomousAction] = []

        try:
            # 1. Email reply suggestions (from urgent/important emails)
            email_actions = await self._generate_email_actions(user_id)
            actions.extend(email_actions)
            logger.info(f"Generated {len(email_actions)} email actions for {user_id}")

            # 2. Calendar suggestions (conflicts, focus blocks, prep)
            calendar_actions = await self._generate_calendar_actions(user_id)
            actions.extend(calendar_actions)
            logger.info(f"Generated {len(calendar_actions)} calendar actions for {user_id}")

            # 3. Follow-up suggestions
            followup_actions = await self._generate_followup_actions(user_id)
            actions.extend(followup_actions)
            logger.info(f"Generated {len(followup_actions)} followup actions for {user_id}")

        except Exception as e:
            logger.error(f"Error generating actions for {user_id}: {e}")

        # Filter by confidence and priority
        filtered = [
            a for a in actions
            if a.confidence_score >= self.MIN_CONFIDENCE_THRESHOLD
            and a.priority_score >= self.MIN_PRIORITY_THRESHOLD
        ]

        # Sort by priority and take top N
        filtered.sort(key=lambda a: a.priority_score, reverse=True)
        top_actions = filtered[:self.MAX_PENDING_ACTIONS]

        # Check for duplicates before storing
        for action in top_actions:
            existing = await self._check_duplicate_action(user_id, action)
            if not existing:
                self.db.add(action)

        await self.db.commit()

        return top_actions

    async def _can_generate_actions(self, user_id: UUID) -> tuple[bool, str]:
        """
        Check if we should generate actions for this user.

        Respects:
        - Maximum pending actions limit
        - User's quiet hours (with timezone support)
        - Feature enablement settings
        """
        # Check existing pending actions count
        result = await self.db.execute(
            select(func.count(AutonomousAction.id)).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.status == "pending",
                    AutonomousAction.expires_at > datetime.utcnow(),
                )
            )
        )
        pending_count = result.scalar() or 0

        if pending_count >= self.MAX_PENDING_ACTIONS:
            return False, f"Already have {pending_count} pending actions"

        # Check quiet hours from notification preferences (with timezone support)
        prefs = await self._get_user_preferences(user_id)

        if prefs and prefs.quiet_hours_enabled:
            if self._is_quiet_hours(prefs):
                return False, "Currently in quiet hours"

        return True, "OK"

    async def _get_user_preferences(self, user_id: UUID) -> Optional[NotificationPreferences]:
        """Get notification preferences for a user."""
        result = await self.db.execute(
            select(NotificationPreferences).where(
                NotificationPreferences.user_id == user_id
            )
        )
        return result.scalar_one_or_none()

    def _is_quiet_hours(self, prefs: NotificationPreferences) -> bool:
        """
        Check if current time is within user's quiet hours.
        Uses user's timezone for accurate quiet hours calculation.
        """
        if not prefs.quiet_hours_enabled:
            return False

        try:
            # Get user's timezone
            tz = ZoneInfo(prefs.timezone) if prefs.timezone else ZoneInfo("UTC")
            now_local = datetime.now(tz)
            current_time = now_local.time()

            # Use the model's quiet hours check if available
            if hasattr(prefs, 'is_quiet_hours') and callable(prefs.is_quiet_hours):
                return prefs.is_quiet_hours(current_time)

            # Fallback: manual quiet hours check
            if prefs.quiet_hours_start and prefs.quiet_hours_end:
                from datetime import time as dt_time
                start_parts = prefs.quiet_hours_start.split(":")
                end_parts = prefs.quiet_hours_end.split(":")

                start_time = dt_time(int(start_parts[0]), int(start_parts[1]) if len(start_parts) > 1 else 0)
                end_time = dt_time(int(end_parts[0]), int(end_parts[1]) if len(end_parts) > 1 else 0)

                # Handle overnight quiet hours (e.g., 22:00 - 07:00)
                if start_time > end_time:
                    return current_time >= start_time or current_time < end_time
                else:
                    return start_time <= current_time < end_time

            return False
        except Exception as e:
            logger.warning(f"Error checking quiet hours: {e}")
            return False

    async def _check_duplicate_action(
        self,
        user_id: UUID,
        action: AutonomousAction,
    ) -> Optional[AutonomousAction]:
        """Check if a similar action already exists to avoid duplicates."""
        result = await self.db.execute(
            select(AutonomousAction).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.action_type == action.action_type,
                    AutonomousAction.source_id == action.source_id,
                    AutonomousAction.status == "pending",
                )
            )
        )
        return result.scalar_one_or_none()

    # ==================== EMAIL ACTION GENERATION ====================

    async def _generate_email_actions(self, user_id: UUID) -> list[AutonomousAction]:
        """Generate email reply/followup actions from urgent emails."""
        actions = []

        try:
            # Get urgent email summary
            urgent_summary = await self.email_urgency.get_urgent_email_summary(
                user_id=user_id,
                hours=24,
            )

            urgent_emails = urgent_summary.get("urgent", [])

            # Also consider moderate priority that need response
            moderate_emails = urgent_summary.get("moderate", [])

            # Process top urgent emails
            for email in urgent_emails[:3]:
                action = await self._create_email_reply_action(user_id, email, is_urgent=True)
                if action:
                    actions.append(action)

            # Process top moderate emails if we have room
            remaining_slots = 3 - len(actions)
            for email in moderate_emails[:remaining_slots]:
                action = await self._create_email_reply_action(user_id, email, is_urgent=False)
                if action:
                    actions.append(action)

        except Exception as e:
            logger.error(f"Error generating email actions for {user_id}: {e}")

        return actions

    async def _create_email_reply_action(
        self,
        user_id: UUID,
        email_info: dict,
        is_urgent: bool = False,
    ) -> Optional[AutonomousAction]:
        """Create a pre-filled email reply action."""
        try:
            # Extract sender info
            sender = email_info.get("from", "Unknown")
            subject = email_info.get("subject", "No Subject")
            urgency_score = email_info.get("urgency_score", 0.5)

            # Need to get thread_id - search for the email
            search_result = await self.sync_service.search_emails(
                user_id=user_id,
                query=f"from:{sender} subject:{subject[:50]}",
                max_results=1,
            )

            emails = search_result.get("emails", [])
            if not emails:
                return None

            thread_id = emails[0].get("threadId")
            if not thread_id:
                return None

            # Generate reply draft
            reply_result = await self.email_intelligence.generate_reply(
                user_id=user_id,
                thread_id=thread_id,
            )

            if not reply_result.get("success"):
                return None

            # Extract sender name for title
            sender_name = sender.split("<")[0].strip().strip('"')
            if not sender_name or "@" in sender_name:
                sender_name = sender.split("@")[0] if "@" in sender else sender

            # Calculate confidence based on:
            # - Urgency score (higher = more confident this needs reply)
            # - Whether we could generate a good draft
            confidence = min(0.9, 0.5 + (urgency_score * 0.4))

            # Priority based on urgency
            priority = 60 + (urgency_score * 30) if is_urgent else 40 + (urgency_score * 20)

            action = AutonomousAction(
                user_id=user_id,
                action_type="email_reply",
                title=f"Reply to {sender_name}",
                description=reply_result.get("body", "")[:150] + "...",
                action_payload={
                    "thread_id": thread_id,
                    "to": sender,
                    "subject": reply_result.get("subject", f"Re: {subject}"),
                    "body": reply_result.get("body", ""),
                },
                reason=f"{'Urgent email' if is_urgent else 'Email'} needs response" +
                       (f", urgency score: {urgency_score:.0%}" if urgency_score > 0.7 else ""),
                source_type="email",
                source_id=thread_id,
                confidence_score=confidence,
                priority_score=priority,
                expires_at=datetime.utcnow() + timedelta(hours=self.DEFAULT_EXPIRY_HOURS),
            )

            return action

        except Exception as e:
            logger.error(f"Error creating email reply action: {e}")
            return None

    # ==================== CALENDAR ACTION GENERATION ====================

    async def _generate_calendar_actions(self, user_id: UUID) -> list[AutonomousAction]:
        """Generate calendar actions (conflicts, focus time, prep reminders)."""
        actions = []

        try:
            # Import here to avoid circular imports
            from app.services.calendar_intelligence_service import CalendarIntelligenceService
            calendar_intel = CalendarIntelligenceService(self.db)

            # 1. Check for calendar conflicts
            conflict_actions = await self._generate_conflict_actions(user_id, calendar_intel)
            actions.extend(conflict_actions)

            # 2. Check for meeting prep opportunities
            prep_actions = await self._generate_prep_actions(user_id, calendar_intel)
            actions.extend(prep_actions)

            # 3. Suggest focus time if gaps detected
            # (Would need pattern analysis - simplified for now)

        except Exception as e:
            logger.error(f"Error generating calendar actions for {user_id}: {e}")

        return actions

    async def _generate_conflict_actions(
        self,
        user_id: UUID,
        calendar_intel,
    ) -> list[AutonomousAction]:
        """Generate actions for calendar conflicts."""
        actions = []

        try:
            # Get upcoming events to check for conflicts
            events = await self.sync_service.get_calendar_events(
                user_id=user_id,
                days_ahead=7,
            )

            calendar_events = events.get("events", [])

            # Simple conflict detection
            # (Real implementation would use calendar_intel.detect_conflicts)
            for i, event in enumerate(calendar_events):
                for j, other in enumerate(calendar_events):
                    if i >= j:
                        continue

                    # Check for time overlap
                    start1 = event.get("start", {}).get("dateTime")
                    end1 = event.get("end", {}).get("dateTime")
                    start2 = other.get("start", {}).get("dateTime")
                    end2 = other.get("end", {}).get("dateTime")

                    if not all([start1, end1, start2, end2]):
                        continue

                    # Parse times
                    try:
                        s1 = datetime.fromisoformat(start1.replace("Z", "+00:00"))
                        e1 = datetime.fromisoformat(end1.replace("Z", "+00:00"))
                        s2 = datetime.fromisoformat(start2.replace("Z", "+00:00"))
                        e2 = datetime.fromisoformat(end2.replace("Z", "+00:00"))

                        # Check overlap
                        if s1 < e2 and s2 < e1:
                            # Found conflict - suggest rescheduling the less important one
                            event_to_reschedule = event
                            conflicting = other

                            # Simple heuristic: reschedule shorter meeting
                            if (e1 - s1) > (e2 - s2):
                                event_to_reschedule = other
                                conflicting = event

                            action = AutonomousAction(
                                user_id=user_id,
                                action_type="calendar_reschedule",
                                title=f"Resolve conflict: {event_to_reschedule.get('summary', 'Event')[:30]}",
                                description=f"Conflicts with {conflicting.get('summary', 'another event')}",
                                action_payload={
                                    "event_id": event_to_reschedule.get("id"),
                                    "event_title": event_to_reschedule.get("summary"),
                                    "current_start": start1 if event_to_reschedule == event else start2,
                                    "conflict_with": conflicting.get("summary"),
                                    # Suggested new time would be calculated
                                },
                                reason=f"Time conflict detected between meetings",
                                source_type="calendar",
                                source_id=event_to_reschedule.get("id"),
                                confidence_score=0.7,
                                priority_score=85,
                                expires_at=datetime.utcnow() + timedelta(hours=12),
                            )
                            actions.append(action)
                            break  # Only one conflict action per event

                    except Exception:
                        continue

        except Exception as e:
            logger.error(f"Error generating conflict actions: {e}")

        return actions[:2]  # Limit to 2 conflict actions

    async def _generate_prep_actions(
        self,
        user_id: UUID,
        calendar_intel,
    ) -> list[AutonomousAction]:
        """Generate meeting prep reminder actions."""
        actions = []

        try:
            # Get meetings in next 4 hours
            events = await self.sync_service.get_calendar_events(
                user_id=user_id,
                days_ahead=1,
            )

            now = datetime.utcnow()
            cutoff = now + timedelta(hours=4)

            for event in events.get("events", []):
                start_str = event.get("start", {}).get("dateTime")
                if not start_str:
                    continue

                try:
                    start = datetime.fromisoformat(start_str.replace("Z", "+00:00")).replace(tzinfo=None)

                    # Check if meeting is in next 4 hours
                    if now < start < cutoff:
                        # Check if it's an important meeting (has attendees)
                        attendees = event.get("attendees", [])
                        if len(attendees) >= 2:
                            hours_until = (start - now).total_seconds() / 3600

                            action = AutonomousAction(
                                user_id=user_id,
                                action_type="meeting_prep",
                                title=f"Prep for: {event.get('summary', 'Meeting')[:30]}",
                                description=f"Meeting in {hours_until:.1f} hours with {len(attendees)} attendees",
                                action_payload={
                                    "event_id": event.get("id"),
                                    "event_title": event.get("summary"),
                                    "start_time": start_str,
                                    "attendees": [a.get("email") for a in attendees[:5]],
                                },
                                reason=f"Important meeting coming up in {hours_until:.0f}h",
                                source_type="calendar",
                                source_id=event.get("id"),
                                confidence_score=0.8,
                                priority_score=75,
                                expires_at=start,  # Expire when meeting starts
                            )
                            actions.append(action)

                except Exception:
                    continue

        except Exception as e:
            logger.error(f"Error generating prep actions: {e}")

        return actions[:2]  # Limit to 2 prep actions

    # ==================== FOLLOW-UP ACTION GENERATION ====================

    async def _generate_followup_actions(self, user_id: UUID) -> list[AutonomousAction]:
        """Generate follow-up suggestions for emails awaiting response."""
        actions = []

        try:
            # Get emails awaiting replies
            awaiting = await self.email_intelligence.get_awaiting_replies(
                user_id=user_id,
                days_threshold=3,
            )

            for email in awaiting.get("awaiting_replies", [])[:2]:
                thread_id = email.get("thread_id")
                days_waiting = email.get("days_without_reply", 3)

                # Generate follow-up draft
                followup = await self.email_intelligence.generate_followup(
                    user_id=user_id,
                    thread_id=thread_id,
                    urgency="gentle" if days_waiting < 5 else "normal",
                )

                if not followup.get("success"):
                    continue

                action = AutonomousAction(
                    user_id=user_id,
                    action_type="followup",
                    title=f"Follow up: {email.get('subject', 'Email')[:30]}",
                    description=f"No reply in {days_waiting} days from {email.get('to', 'recipient')}",
                    action_payload={
                        "thread_id": thread_id,
                        "to": email.get("to"),
                        "subject": followup.get("subject", f"Re: {email.get('subject', '')}"),
                        "body": followup.get("body", ""),
                    },
                    reason=f"Sent {days_waiting} days ago, no response yet",
                    source_type="email",
                    source_id=thread_id,
                    confidence_score=0.6,
                    priority_score=50 + min(days_waiting * 5, 30),
                    expires_at=datetime.utcnow() + timedelta(hours=48),
                )
                actions.append(action)

        except Exception as e:
            logger.error(f"Error generating followup actions: {e}")

        return actions

    # ==================== ACTION EXECUTION ====================

    async def approve_action(
        self,
        action_id: UUID,
        user_id: UUID,
        modifications: Optional[dict] = None,
    ) -> dict:
        """
        Approve and execute an autonomous action.

        Args:
            action_id: The action to approve
            user_id: User's ID (for verification)
            modifications: Optional modifications to the action payload

        Returns:
            Dict with execution result
        """
        action = await self.get_action_by_id(action_id, user_id)
        if not action:
            return {"success": False, "message": "Action not found"}

        if action.status != "pending":
            return {"success": False, "message": f"Action already {action.status}"}

        # Apply modifications if provided
        payload = dict(action.action_payload)
        if modifications:
            payload.update(modifications)
            action.user_modification = modifications

        # Execute based on type
        try:
            result = await self._execute_action(action.action_type, payload, user_id)

            if result.get("success"):
                action.status = "executed"
                action.executed_at = datetime.utcnow()
            else:
                action.status = "failed"
                action.error_message = result.get("message", "Execution failed")

            action.actioned_at = datetime.utcnow()

            # Log feedback
            await self._log_feedback(
                user_id=user_id,
                action_id=action_id,
                feedback_type="approved",
                modifications=modifications,
                original_payload=action.action_payload,
            )

            await self.db.commit()

            return result

        except Exception as e:
            logger.error(f"Error executing action {action_id}: {e}")
            action.status = "failed"
            action.error_message = str(e)
            action.actioned_at = datetime.utcnow()
            await self.db.commit()
            return {"success": False, "message": str(e)}

    async def _execute_action(
        self,
        action_type: str,
        payload: dict,
        user_id: UUID,
    ) -> dict:
        """Execute the action via appropriate service."""
        if action_type == "email_reply":
            return await self.sync_service.reply_to_thread(
                user_id=user_id,
                thread_id=payload["thread_id"],
                body=payload["body"],
            )

        elif action_type == "followup":
            return await self.sync_service.reply_to_thread(
                user_id=user_id,
                thread_id=payload["thread_id"],
                body=payload["body"],
            )

        elif action_type == "calendar_create":
            start_time = datetime.fromisoformat(payload["start_time"].replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(payload["end_time"].replace("Z", "+00:00"))

            return await self.sync_service.create_calendar_event(
                user_id=user_id,
                title=payload["title"],
                start_time=start_time,
                end_time=end_time,
                description=payload.get("description"),
                location=payload.get("location"),
                attendees=[{"email": e} for e in payload.get("attendees", [])],
            )

        elif action_type == "calendar_reschedule":
            # For reschedule, we need to update the event
            # This is more complex and would need free time finding
            return {
                "success": False,
                "message": "Reschedule requires manual confirmation - please review in calendar",
                "event_id": payload.get("event_id"),
            }

        elif action_type == "meeting_prep":
            # Meeting prep is informational - mark as acknowledged
            return {
                "success": True,
                "message": f"Acknowledged prep for {payload.get('event_title', 'meeting')}",
            }

        else:
            return {"success": False, "message": f"Unknown action type: {action_type}"}

    # ==================== ACTION DISMISSAL ====================

    async def dismiss_action(
        self,
        action_id: UUID,
        user_id: UUID,
        reason: Optional[str] = None,
    ) -> dict:
        """
        Dismiss an autonomous action.

        Args:
            action_id: The action to dismiss
            user_id: User's ID
            reason: Optional reason for dismissal

        Returns:
            Dict with result
        """
        action = await self.get_action_by_id(action_id, user_id)
        if not action:
            return {"success": False, "message": "Action not found"}

        if action.status != "pending":
            return {"success": False, "message": f"Action already {action.status}"}

        action.status = "dismissed"
        action.actioned_at = datetime.utcnow()
        action.user_feedback = reason

        # Log feedback
        await self._log_feedback(
            user_id=user_id,
            action_id=action_id,
            feedback_type="dismissed",
            dismiss_reason=reason,
        )

        await self.db.commit()

        return {"success": True, "message": "Action dismissed"}

    # ==================== FEEDBACK TRACKING ====================

    async def _log_feedback(
        self,
        user_id: UUID,
        action_id: UUID,
        feedback_type: str,
        modifications: Optional[dict] = None,
        original_payload: Optional[dict] = None,
        dismiss_reason: Optional[str] = None,
        rating: Optional[int] = None,
    ) -> None:
        """Log feedback for learning."""
        feedback = ActionFeedback(
            user_id=user_id,
            autonomous_action_id=action_id,
            feedback_type=feedback_type,
            rating=rating,
            dismiss_reason=dismiss_reason,
            modification_summary=str(modifications) if modifications else None,
            original_payload=original_payload,
            modified_payload=modifications,
        )
        self.db.add(feedback)
        # Commit is handled by caller

    async def submit_feedback(
        self,
        action_id: UUID,
        user_id: UUID,
        rating: Optional[int] = None,
        feedback_type: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> dict:
        """
        Submit additional feedback on an action.

        Args:
            action_id: The action to provide feedback on
            user_id: User's ID
            rating: 1-5 rating
            feedback_type: helpful, not_helpful, wrong_timing, etc.
            comment: Optional comment

        Returns:
            Dict with result
        """
        action = await self.get_action_by_id(action_id, user_id)
        if not action:
            return {"success": False, "message": "Action not found"}

        # Update action's user_feedback if provided
        if feedback_type:
            action.user_feedback = feedback_type

        # Add feedback entry
        feedback = ActionFeedback(
            user_id=user_id,
            autonomous_action_id=action_id,
            feedback_type=feedback_type or "feedback",
            rating=rating,
            comment=comment,
        )
        self.db.add(feedback)
        await self.db.commit()

        return {"success": True, "message": "Feedback recorded"}

    # ==================== MAINTENANCE ====================

    async def expire_old_actions(self) -> int:
        """
        Expire actions past their expiry time.

        Returns count of expired actions.
        """
        result = await self.db.execute(
            update(AutonomousAction)
            .where(
                and_(
                    AutonomousAction.status == "pending",
                    AutonomousAction.expires_at < datetime.utcnow(),
                )
            )
            .values(status="expired")
        )
        await self.db.commit()
        return result.rowcount or 0

    async def get_action_stats(self, user_id: UUID) -> dict:
        """Get statistics on autonomous actions for a user."""
        # Count by status
        result = await self.db.execute(
            select(
                AutonomousAction.status,
                func.count(AutonomousAction.id),
            )
            .where(AutonomousAction.user_id == user_id)
            .group_by(AutonomousAction.status)
        )
        status_counts = {row[0]: row[1] for row in result.fetchall()}

        # Get approval rate
        total_actioned = status_counts.get("executed", 0) + status_counts.get("dismissed", 0)
        approval_rate = (
            status_counts.get("executed", 0) / total_actioned
            if total_actioned > 0
            else 0
        )

        return {
            "pending": status_counts.get("pending", 0),
            "executed": status_counts.get("executed", 0),
            "dismissed": status_counts.get("dismissed", 0),
            "expired": status_counts.get("expired", 0),
            "total": sum(status_counts.values()),
            "approval_rate": round(approval_rate, 2),
        }

    async def get_actions_generated_today(self, user_id: UUID) -> int:
        """
        Get count of actions generated today for a user.
        Used for tracking and potential daily generation limits.
        """
        prefs = await self._get_user_preferences(user_id)
        tz = ZoneInfo(prefs.timezone) if prefs and prefs.timezone else ZoneInfo("UTC")

        now_local = datetime.now(tz)
        from datetime import time as dt_time
        today_start = datetime.combine(now_local.date(), dt_time.min, tzinfo=tz)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

        result = await self.db.execute(
            select(func.count(AutonomousAction.id)).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.created_at >= today_start_utc,
                )
            )
        )
        return result.scalar() or 0

    async def get_detailed_stats(self, user_id: UUID, days: int = 7) -> dict:
        """
        Get detailed statistics on autonomous actions for a user.

        Provides insights similar to the ProactiveOrchestrator notification stats.
        """
        cutoff = datetime.utcnow() - timedelta(days=days)

        # Basic counts
        base_stats = await self.get_action_stats(user_id)

        # Actions by type
        by_type_result = await self.db.execute(
            select(
                AutonomousAction.action_type,
                func.count(AutonomousAction.id),
            )
            .where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.created_at >= cutoff,
                )
            )
            .group_by(AutonomousAction.action_type)
        )
        by_type = {row[0]: row[1] for row in by_type_result}

        # Approval rate by type
        approval_by_type = {}
        for action_type in by_type.keys():
            executed = await self.db.execute(
                select(func.count(AutonomousAction.id)).where(
                    and_(
                        AutonomousAction.user_id == user_id,
                        AutonomousAction.action_type == action_type,
                        AutonomousAction.status == "executed",
                        AutonomousAction.created_at >= cutoff,
                    )
                )
            )
            dismissed = await self.db.execute(
                select(func.count(AutonomousAction.id)).where(
                    and_(
                        AutonomousAction.user_id == user_id,
                        AutonomousAction.action_type == action_type,
                        AutonomousAction.status == "dismissed",
                        AutonomousAction.created_at >= cutoff,
                    )
                )
            )
            exec_count = executed.scalar() or 0
            dismiss_count = dismissed.scalar() or 0
            total = exec_count + dismiss_count
            approval_by_type[action_type] = round(exec_count / total, 2) if total > 0 else 0

        # Average confidence of approved vs dismissed
        avg_confidence_executed = await self.db.execute(
            select(func.avg(AutonomousAction.confidence_score)).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.status == "executed",
                    AutonomousAction.created_at >= cutoff,
                )
            )
        )
        avg_confidence_dismissed = await self.db.execute(
            select(func.avg(AutonomousAction.confidence_score)).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.status == "dismissed",
                    AutonomousAction.created_at >= cutoff,
                )
            )
        )

        return {
            **base_stats,
            "period_days": days,
            "by_type": by_type,
            "approval_rate_by_type": approval_by_type,
            "avg_confidence_executed": round(avg_confidence_executed.scalar() or 0, 2),
            "avg_confidence_dismissed": round(avg_confidence_dismissed.scalar() or 0, 2),
            "average_per_day": round(base_stats["total"] / days, 1) if days > 0 else 0,
        }

    async def get_learning_insights(self, user_id: UUID) -> dict:
        """
        Get insights for improving action suggestions based on user feedback.

        This data can be used to adjust confidence thresholds and action types.
        """
        # Get feedback patterns
        result = await self.db.execute(
            select(
                ActionFeedback.feedback_type,
                func.count(ActionFeedback.id),
            )
            .where(ActionFeedback.user_id == user_id)
            .group_by(ActionFeedback.feedback_type)
        )
        feedback_counts = {row[0]: row[1] for row in result.fetchall()}

        # Get most modified fields (when users edit before approving)
        modified_actions = await self.db.execute(
            select(AutonomousAction).where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.user_modification.isnot(None),
                )
            ).limit(50)
        )
        modification_patterns = {}
        for action in modified_actions.scalars().all():
            if action.user_modification:
                for field in action.user_modification.keys():
                    modification_patterns[field] = modification_patterns.get(field, 0) + 1

        # Get dismiss reasons
        dismiss_reasons = await self.db.execute(
            select(
                AutonomousAction.user_feedback,
                func.count(AutonomousAction.id),
            )
            .where(
                and_(
                    AutonomousAction.user_id == user_id,
                    AutonomousAction.status == "dismissed",
                    AutonomousAction.user_feedback.isnot(None),
                )
            )
            .group_by(AutonomousAction.user_feedback)
        )
        dismiss_reason_counts = {row[0]: row[1] for row in dismiss_reasons.fetchall()}

        return {
            "feedback_patterns": feedback_counts,
            "common_modifications": modification_patterns,
            "dismiss_reasons": dismiss_reason_counts,
            "recommendations": self._generate_recommendations(
                feedback_counts, modification_patterns, dismiss_reason_counts
            ),
        }

    def _generate_recommendations(
        self,
        feedback: dict,
        modifications: dict,
        dismiss_reasons: dict,
    ) -> list[str]:
        """Generate recommendations for improving action suggestions."""
        recommendations = []

        # High dismiss rate
        total_feedback = sum(feedback.values())
        if total_feedback > 10:
            dismiss_rate = feedback.get("dismissed", 0) / total_feedback
            if dismiss_rate > 0.5:
                recommendations.append(
                    "Consider raising the confidence threshold - many actions are being dismissed"
                )

        # Common modifications
        if modifications:
            most_modified = max(modifications.items(), key=lambda x: x[1])
            if most_modified[1] > 5:
                recommendations.append(
                    f"Users frequently modify '{most_modified[0]}' - consider improving this field's generation"
                )

        # Timing issues
        if dismiss_reasons.get("wrong_timing", 0) > 3:
            recommendations.append(
                "Many actions dismissed for timing - consider adjusting when actions are generated"
            )

        return recommendations
