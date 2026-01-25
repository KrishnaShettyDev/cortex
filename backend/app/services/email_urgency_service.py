"""
Email Urgency Service

Scores unread emails for urgency and queues high-priority notifications.

Scoring factors:
- Keyword detection ("urgent", "asap", "deadline")
- Sender relationship tier (inner circle = higher)
- Age of email (older unread = more urgent)
- Question detection (needs response)
- Thread activity (waiting for your reply)
"""

import json
import re
import logging
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.config import get_settings
from app.models.relationship import RelationshipHealth, RelationshipTier
from app.models.entity import Entity
from app.services.sync_service import SyncService
from app.services.proactive_orchestrator import (
    ProactiveOrchestrator,
    QueuedNotification,
    NotificationType,
    UrgencyLevel,
)

settings = get_settings()
logger = logging.getLogger(__name__)


# Keywords that indicate urgency
URGENT_KEYWORDS = [
    "urgent", "asap", "immediately", "deadline", "today",
    "time-sensitive", "critical", "important", "priority",
    "action required", "please respond", "need response",
    "eod", "end of day", "before the meeting", "escalation",
]

# Keywords that indicate a question/request
QUESTION_KEYWORDS = [
    "?", "can you", "could you", "would you", "will you",
    "please", "need you to", "your thoughts", "let me know",
    "get back to", "waiting for", "your input", "your feedback",
]


class EmailUrgencyService:
    """Service for scoring email urgency and queueing notifications."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def get_sender_relationship_tier(
        self,
        user_id: UUID,
        sender_email: str,
    ) -> Optional[str]:
        """Get the relationship tier for an email sender."""
        try:
            # Find entity by email
            result = await self.db.execute(
                select(Entity).where(
                    and_(
                        Entity.user_id == user_id,
                        Entity.entity_type == "person",
                        Entity.metadata["email"].astext == sender_email,
                    )
                )
            )
            entity = result.scalar_one_or_none()

            if not entity:
                # Try to find by name match from email
                sender_name = sender_email.split("@")[0].replace(".", " ").title()
                result = await self.db.execute(
                    select(Entity).where(
                        and_(
                            Entity.user_id == user_id,
                            Entity.entity_type == "person",
                            Entity.name.ilike(f"%{sender_name}%"),
                        )
                    )
                )
                entity = result.scalar_one_or_none()

            if not entity:
                return None

            # Get relationship health
            result = await self.db.execute(
                select(RelationshipHealth).where(
                    and_(
                        RelationshipHealth.user_id == user_id,
                        RelationshipHealth.entity_id == entity.id,
                    )
                )
            )
            health = result.scalar_one_or_none()

            if health:
                return health.tier

            return None

        except Exception as e:
            logger.error(f"Error getting relationship tier: {e}")
            return None

    def calculate_keyword_score(self, subject: str, snippet: str) -> float:
        """
        Calculate urgency score based on keywords.

        Returns a score from 0.0 to 1.0.
        """
        text = f"{subject} {snippet}".lower()
        score = 0.0

        # Check urgent keywords
        for keyword in URGENT_KEYWORDS:
            if keyword in text:
                score += 0.15
                if keyword in ["urgent", "asap", "immediately", "critical"]:
                    score += 0.1  # Extra weight for strong urgency words

        # Check question keywords
        for keyword in QUESTION_KEYWORDS:
            if keyword in text:
                score += 0.05

        # Check for all caps (shouting)
        if subject.isupper() and len(subject) > 10:
            score += 0.1

        # Check for exclamation points
        if subject.count("!") >= 2:
            score += 0.05

        return min(score, 1.0)

    def calculate_age_score(self, email_date: datetime) -> float:
        """
        Calculate urgency based on email age.

        Older unread emails are more urgent.
        Returns a score from 0.0 to 1.0.
        """
        now = datetime.utcnow()
        age_hours = (now - email_date).total_seconds() / 3600

        if age_hours < 2:
            return 0.0
        elif age_hours < 6:
            return 0.1
        elif age_hours < 12:
            return 0.2
        elif age_hours < 24:
            return 0.3
        elif age_hours < 48:
            return 0.5
        elif age_hours < 72:
            return 0.7
        else:
            return 0.9

    def calculate_relationship_score(self, tier: Optional[str]) -> float:
        """
        Calculate urgency based on sender relationship.

        Inner circle = highest priority.
        Returns a score from 0.0 to 1.0.
        """
        if not tier:
            return 0.3  # Unknown sender gets moderate score

        tier_scores = {
            "inner_circle": 1.0,
            "close": 0.7,
            "professional": 0.5,
            "regular": 0.4,
            "distant": 0.2,
        }

        return tier_scores.get(tier, 0.3)

    async def calculate_email_urgency(
        self,
        user_id: UUID,
        email: dict,
    ) -> dict:
        """
        Calculate overall urgency score for an email.

        Returns:
            Dict with urgency_score (0-1), urgency_level, and factors
        """
        subject = email.get("subject", "")
        snippet = email.get("snippet", "")
        sender = email.get("from", "")
        date_str = email.get("date", "")

        # Parse sender email
        sender_email = ""
        email_match = re.search(r'<([^>]+)>', sender)
        if email_match:
            sender_email = email_match.group(1)
        elif "@" in sender:
            sender_email = sender.split()[0] if " " in sender else sender

        # Calculate component scores
        keyword_score = self.calculate_keyword_score(subject, snippet)

        # Get sender relationship tier
        tier = await self.get_sender_relationship_tier(user_id, sender_email)
        relationship_score = self.calculate_relationship_score(tier)

        # Calculate age score
        try:
            if date_str:
                # Parse various date formats
                email_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if email_date.tzinfo:
                    email_date = email_date.replace(tzinfo=None)
            else:
                email_date = datetime.utcnow()
            age_score = self.calculate_age_score(email_date)
        except Exception:
            age_score = 0.2
            email_date = datetime.utcnow()

        # Weighted combination
        urgency_score = (
            keyword_score * 0.4 +
            relationship_score * 0.35 +
            age_score * 0.25
        )

        # Determine urgency level
        if urgency_score >= 0.7:
            urgency_level = UrgencyLevel.HIGH
        elif urgency_score >= 0.4:
            urgency_level = UrgencyLevel.MEDIUM
        else:
            urgency_level = UrgencyLevel.LOW

        return {
            "urgency_score": round(urgency_score, 2),
            "urgency_level": urgency_level,
            "is_from_inner_circle": tier == "inner_circle",
            "factors": {
                "keyword_score": round(keyword_score, 2),
                "relationship_score": round(relationship_score, 2),
                "relationship_tier": tier,
                "age_score": round(age_score, 2),
            },
            "email_date": email_date.isoformat() if email_date else None,
        }

    async def scan_and_queue_urgent_emails(
        self,
        user_id: UUID,
        min_urgency: float = 0.5,
        max_notifications: int = 3,
    ) -> dict:
        """
        Scan unread emails and queue urgent ones for notification.

        Args:
            user_id: User's ID
            min_urgency: Minimum urgency score to notify (0-1)
            max_notifications: Max notifications to queue at once

        Returns:
            Dict with queued count and email details
        """
        queued = []
        skipped = []

        try:
            # Get unread emails from the last 48 hours
            since = datetime.utcnow() - timedelta(hours=48)
            query = f"is:unread after:{since.strftime('%Y/%m/%d')}"

            result = await self.sync_service.search_emails(
                user_id=user_id,
                query=query,
                max_results=30,
            )

            emails = result.get("emails", [])

            if not emails:
                return {
                    "success": True,
                    "queued": 0,
                    "message": "No unread emails to process",
                }

            # Score each email
            scored_emails = []
            for email in emails:
                urgency = await self.calculate_email_urgency(user_id, email)
                scored_emails.append({
                    "email": email,
                    **urgency,
                })

            # Sort by urgency score descending
            scored_emails.sort(key=lambda x: x["urgency_score"], reverse=True)

            # Queue notifications for high urgency emails
            orchestrator = ProactiveOrchestrator(self.db)

            for scored in scored_emails[:max_notifications]:
                if scored["urgency_score"] < min_urgency:
                    skipped.append({
                        "subject": scored["email"].get("subject", ""),
                        "urgency_score": scored["urgency_score"],
                        "reason": "Below threshold",
                    })
                    continue

                email = scored["email"]
                sender = email.get("from", "Unknown")
                subject = email.get("subject", "No Subject")

                # Clean sender for display
                sender_name = sender.split("<")[0].strip().strip('"')
                if not sender_name:
                    sender_name = sender.split("@")[0]

                notification = QueuedNotification(
                    notification_type=NotificationType.URGENT_EMAIL,
                    title=f"📧 {sender_name}",
                    body=subject[:100],
                    user_id=user_id,
                    urgency_level=scored["urgency_level"],
                    source_service="email_urgency_service",
                    source_id=email.get("threadId", email.get("id", "")),
                    data={
                        "type": "urgent_email",
                        "thread_id": email.get("threadId"),
                        "message_id": email.get("id"),
                        "from": sender,
                        "subject": subject,
                        "urgency_score": scored["urgency_score"],
                        "factors": scored["factors"],
                    },
                    is_from_inner_circle=scored.get("is_from_inner_circle", False),
                )

                await orchestrator.queue_notification(notification)

                queued.append({
                    "subject": subject,
                    "from": sender_name,
                    "urgency_score": scored["urgency_score"],
                    "urgency_level": scored["urgency_level"].value,
                })

        except Exception as e:
            logger.error(f"Error scanning urgent emails for {user_id}: {e}")
            return {
                "success": False,
                "message": f"Error scanning emails: {str(e)}",
            }

        return {
            "success": True,
            "queued": len(queued),
            "queued_emails": queued,
            "skipped": len(skipped),
            "message": f"Queued {len(queued)} urgent email notifications",
        }

    async def get_urgent_email_summary(
        self,
        user_id: UUID,
        hours: int = 24,
    ) -> dict:
        """
        Get a summary of urgent unread emails.

        Returns a summary without queueing notifications.
        """
        try:
            since = datetime.utcnow() - timedelta(hours=hours)
            query = f"is:unread after:{since.strftime('%Y/%m/%d')}"

            result = await self.sync_service.search_emails(
                user_id=user_id,
                query=query,
                max_results=50,
            )

            emails = result.get("emails", [])

            if not emails:
                return {
                    "success": True,
                    "total_unread": 0,
                    "urgent": [],
                    "summary": "No unread emails",
                }

            # Score each email
            urgent = []
            moderate = []
            low = []

            for email in emails:
                urgency = await self.calculate_email_urgency(user_id, email)
                email_info = {
                    "from": email.get("from", "Unknown"),
                    "subject": email.get("subject", "No Subject"),
                    "urgency_score": urgency["urgency_score"],
                    "factors": urgency["factors"],
                }

                if urgency["urgency_score"] >= 0.7:
                    urgent.append(email_info)
                elif urgency["urgency_score"] >= 0.4:
                    moderate.append(email_info)
                else:
                    low.append(email_info)

            # Generate summary
            summary_parts = []
            if urgent:
                summary_parts.append(f"{len(urgent)} urgent email{'s' if len(urgent) > 1 else ''}")
            if moderate:
                summary_parts.append(f"{len(moderate)} need attention")
            if low:
                summary_parts.append(f"{len(low)} low priority")

            return {
                "success": True,
                "total_unread": len(emails),
                "urgent": urgent,
                "moderate": moderate,
                "low": low,
                "summary": ", ".join(summary_parts) if summary_parts else "No emails to report",
            }

        except Exception as e:
            logger.error(f"Error getting urgent email summary: {e}")
            return {
                "success": False,
                "message": f"Error: {str(e)}",
            }

    async def analyze_email_with_llm(
        self,
        user_id: UUID,
        email: dict,
    ) -> dict:
        """
        Use LLM for deeper analysis of email urgency and required action.

        Only used for emails that score moderately high on keyword/relationship.
        """
        try:
            subject = email.get("subject", "")
            snippet = email.get("snippet", "")
            sender = email.get("from", "")

            prompt = f"""Analyze this email for urgency and required action.

From: {sender}
Subject: {subject}
Preview: {snippet}

Return JSON:
{{
    "urgency_level": "high|medium|low",
    "requires_response": true|false,
    "response_deadline": "today|tomorrow|this_week|none",
    "action_type": "reply|review|approve|schedule|none",
    "summary": "Brief 1-sentence summary of what's needed",
    "key_details": ["detail 1", "detail 2"]
}}"""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You analyze emails for urgency. Be concise and accurate.",
                    },
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=300,
            )

            return json.loads(response.choices[0].message.content)

        except Exception as e:
            logger.error(f"LLM email analysis error: {e}")
            return {
                "urgency_level": "unknown",
                "requires_response": False,
                "action_type": "review",
                "summary": "Unable to analyze",
            }
