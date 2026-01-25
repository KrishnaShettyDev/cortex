"""
Commitment Service

Builds on IntentionService to provide proactive commitment tracking.

Features:
- Scan for overdue commitments
- Queue notifications for due/overdue items
- Track commitments to specific people
- Integration with ProactiveOrchestrator
"""

import logging
from uuid import UUID
from datetime import datetime, date, timedelta
from typing import Optional

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intention import Intention, IntentionStatus, IntentionType
from app.models.entity import Entity
from app.models.relationship import RelationshipHealth
from app.services.proactive_orchestrator import (
    ProactiveOrchestrator,
    QueuedNotification,
    NotificationType,
    UrgencyLevel,
)

logger = logging.getLogger(__name__)


class CommitmentService:
    """
    Service for tracking and notifying about commitments.

    Works with IntentionService but focuses on notification flow.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_due_commitments(
        self,
        user_id: UUID,
        include_overdue: bool = True,
        days_ahead: int = 1,
    ) -> list[dict]:
        """
        Get commitments that are due soon or overdue.

        Returns:
            List of commitment dicts with details
        """
        today = date.today()
        due_by = today + timedelta(days=days_ahead)

        conditions = [
            Intention.user_id == user_id,
            Intention.status.in_([
                IntentionStatus.PENDING,
                IntentionStatus.OVERDUE,
            ]),
            Intention.intention_type.in_([
                IntentionType.COMMITMENT,
                IntentionType.TASK,
            ]),
        ]

        if include_overdue:
            # Due today/tomorrow OR already overdue
            conditions.append(
                or_(
                    Intention.target_date <= due_by,
                    Intention.status == IntentionStatus.OVERDUE,
                )
            )
        else:
            # Only due soon, not overdue
            conditions.append(
                and_(
                    Intention.target_date <= due_by,
                    Intention.target_date >= today,
                )
            )

        result = await self.db.execute(
            select(Intention).where(
                and_(*conditions)
            ).order_by(
                Intention.target_date.asc().nullslast(),
                Intention.priority.desc(),
            )
        )
        intentions = list(result.scalars().all())

        commitments = []
        for i in intentions:
            days_overdue = 0
            if i.target_date:
                days_overdue = (today - i.target_date).days

            commitment = {
                "id": str(i.id),
                "description": i.description,
                "original_text": i.original_text,
                "type": i.intention_type.value,
                "status": i.status.value,
                "target_date": i.target_date.isoformat() if i.target_date else None,
                "days_overdue": max(0, days_overdue),
                "is_overdue": days_overdue > 0,
                "priority": i.priority or 0.5,
                "target_person": i.target_person,
                "target_action": i.target_action,
                "related_entity_id": str(i.related_entity_id) if i.related_entity_id else None,
            }

            # Get person info if related to an entity
            if i.related_entity_id:
                entity_info = await self._get_entity_info(user_id, i.related_entity_id)
                if entity_info:
                    commitment["person_name"] = entity_info.get("name")
                    commitment["relationship_tier"] = entity_info.get("tier")

            commitments.append(commitment)

        return commitments

    async def _get_entity_info(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> Optional[dict]:
        """Get entity name and relationship info."""
        try:
            result = await self.db.execute(
                select(Entity).where(
                    and_(
                        Entity.id == entity_id,
                        Entity.user_id == user_id,
                    )
                )
            )
            entity = result.scalar_one_or_none()

            if not entity:
                return None

            info = {"name": entity.name}

            # Get relationship tier
            health_result = await self.db.execute(
                select(RelationshipHealth).where(
                    and_(
                        RelationshipHealth.user_id == user_id,
                        RelationshipHealth.entity_id == entity_id,
                    )
                )
            )
            health = health_result.scalar_one_or_none()

            if health:
                info["tier"] = health.tier

            return info

        except Exception as e:
            logger.error(f"Error getting entity info: {e}")
            return None

    async def scan_and_queue_commitment_notifications(
        self,
        user_id: UUID,
        max_notifications: int = 3,
    ) -> dict:
        """
        Scan for due/overdue commitments and queue notifications.

        Returns:
            Dict with queued count and details
        """
        queued = []

        try:
            commitments = await self.get_due_commitments(
                user_id=user_id,
                include_overdue=True,
                days_ahead=1,
            )

            if not commitments:
                return {
                    "success": True,
                    "queued": 0,
                    "message": "No commitments due",
                }

            orchestrator = ProactiveOrchestrator(self.db)

            # Sort by priority: overdue first, then by urgency
            sorted_commitments = sorted(
                commitments,
                key=lambda c: (
                    -c.get("days_overdue", 0),  # Most overdue first
                    -(c.get("priority", 0.5)),  # Then by priority
                ),
            )

            for commitment in sorted_commitments[:max_notifications]:
                # Build notification title and body
                person = commitment.get("person_name") or commitment.get("target_person")
                description = commitment.get("description", "")

                if commitment.get("is_overdue"):
                    days = commitment.get("days_overdue", 1)
                    if person:
                        title = f"⚠️ Overdue commitment to {person}"
                    else:
                        title = f"⚠️ {days} day{'s' if days > 1 else ''} overdue"
                    urgency = UrgencyLevel.HIGH
                else:
                    if person:
                        title = f"📝 Promise to {person} due today"
                    else:
                        title = "📝 Commitment due today"
                    urgency = UrgencyLevel.MEDIUM

                body = description[:100]
                if len(description) > 100:
                    body += "..."

                notification = QueuedNotification(
                    notification_type=NotificationType.COMMITMENT,
                    title=title,
                    body=body,
                    user_id=user_id,
                    urgency_level=urgency,
                    source_service="commitment_service",
                    source_id=commitment.get("id", ""),
                    data={
                        "type": "commitment",
                        "commitment_id": commitment.get("id"),
                        "description": description,
                        "person_name": person,
                        "is_overdue": commitment.get("is_overdue"),
                        "days_overdue": commitment.get("days_overdue", 0),
                    },
                    days_overdue=commitment.get("days_overdue", 0),
                    is_from_inner_circle=commitment.get("relationship_tier") == "inner_circle",
                )

                await orchestrator.queue_notification(notification)

                queued.append({
                    "description": description[:50],
                    "person": person,
                    "is_overdue": commitment.get("is_overdue"),
                })

        except Exception as e:
            logger.error(f"Error scanning commitments: {e}")
            return {
                "success": False,
                "message": f"Error: {str(e)}",
            }

        return {
            "success": True,
            "queued": len(queued),
            "queued_commitments": queued,
            "message": f"Queued {len(queued)} commitment notifications",
        }

    async def get_commitment_summary(
        self,
        user_id: UUID,
    ) -> dict:
        """
        Get a summary of all pending commitments.

        Returns counts and categorized lists.
        """
        today = date.today()

        # Count by status
        result = await self.db.execute(
            select(
                Intention.status,
                func.count(Intention.id),
            ).where(
                and_(
                    Intention.user_id == user_id,
                    Intention.intention_type.in_([
                        IntentionType.COMMITMENT,
                        IntentionType.TASK,
                    ]),
                    Intention.status.in_([
                        IntentionStatus.PENDING,
                        IntentionStatus.OVERDUE,
                        IntentionStatus.IN_PROGRESS,
                    ]),
                )
            ).group_by(Intention.status)
        )

        counts = {row[0].value: row[1] for row in result}

        # Get overdue count
        overdue_result = await self.db.execute(
            select(func.count(Intention.id)).where(
                and_(
                    Intention.user_id == user_id,
                    Intention.status == IntentionStatus.OVERDUE,
                )
            )
        )
        overdue_count = overdue_result.scalar() or 0

        # Get due today
        due_today_result = await self.db.execute(
            select(func.count(Intention.id)).where(
                and_(
                    Intention.user_id == user_id,
                    Intention.target_date == today,
                    Intention.status.in_([
                        IntentionStatus.PENDING,
                        IntentionStatus.IN_PROGRESS,
                    ]),
                )
            )
        )
        due_today = due_today_result.scalar() or 0

        # Get commitments to people (relationship commitments)
        people_result = await self.db.execute(
            select(func.count(Intention.id)).where(
                and_(
                    Intention.user_id == user_id,
                    Intention.related_entity_id.isnot(None),
                    Intention.status.in_([
                        IntentionStatus.PENDING,
                        IntentionStatus.OVERDUE,
                    ]),
                )
            )
        )
        to_people = people_result.scalar() or 0

        total = sum(counts.values())

        return {
            "total_pending": total,
            "overdue": overdue_count,
            "due_today": due_today,
            "to_people": to_people,
            "by_status": counts,
            "summary": self._build_summary_text(overdue_count, due_today, total),
        }

    def _build_summary_text(
        self,
        overdue: int,
        due_today: int,
        total: int,
    ) -> str:
        """Build a human-readable summary."""
        parts = []

        if overdue > 0:
            parts.append(f"{overdue} overdue")
        if due_today > 0:
            parts.append(f"{due_today} due today")
        if total > (overdue + due_today):
            remaining = total - overdue - due_today
            parts.append(f"{remaining} upcoming")

        if not parts:
            return "No pending commitments"

        return ", ".join(parts)

    async def mark_commitment_done(
        self,
        user_id: UUID,
        commitment_id: UUID,
    ) -> bool:
        """Mark a commitment as fulfilled."""
        result = await self.db.execute(
            select(Intention).where(
                and_(
                    Intention.id == commitment_id,
                    Intention.user_id == user_id,
                )
            )
        )
        intention = result.scalar_one_or_none()

        if not intention:
            return False

        intention.status = IntentionStatus.FULFILLED
        intention.fulfilled_at = datetime.utcnow()
        await self.db.commit()

        return True

    async def snooze_commitment(
        self,
        user_id: UUID,
        commitment_id: UUID,
        snooze_until: date,
    ) -> bool:
        """Snooze a commitment to a later date."""
        result = await self.db.execute(
            select(Intention).where(
                and_(
                    Intention.id == commitment_id,
                    Intention.user_id == user_id,
                )
            )
        )
        intention = result.scalar_one_or_none()

        if not intention:
            return False

        intention.target_date = snooze_until
        intention.status = IntentionStatus.PENDING
        await self.db.commit()

        return True
