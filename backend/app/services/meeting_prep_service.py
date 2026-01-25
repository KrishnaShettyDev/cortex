"""
Meeting Prep Service

Enhanced meeting preparation with relationship context.

Provides:
- Relationship context (health score, last contact)
- Pending commitments to attendees
- Recent email threads with attendees
- Previous meeting notes
- Relevant memories
- Proactive notifications via orchestrator
"""

import json
import logging
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc

from app.config import get_settings
from app.models.memory import Memory
from app.models.entity import Entity
from app.models.relationship import RelationshipHealth, InteractionLog
from app.models.intention import Intention, IntentionStatus
from app.models.connection import PersonProfile
from app.services.sync_service import SyncService
from app.services.proactive_orchestrator import (
    ProactiveOrchestrator,
    QueuedNotification,
    NotificationType,
    UrgencyLevel,
)

settings = get_settings()
logger = logging.getLogger(__name__)


class MeetingPrepService:
    """Enhanced meeting preparation with relationship intelligence."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    async def get_meeting_prep(
        self,
        user_id: UUID,
        person_name: str,
        meeting_time: Optional[datetime] = None,
    ) -> dict:
        """
        Get comprehensive meeting preparation for a person.

        Returns relationship context, commitments, recent interactions, etc.
        """
        # Find the entity
        entity = await self._get_entity_by_name(user_id, person_name)
        if not entity:
            return {
                "success": False,
                "message": f"Person '{person_name}' not found",
            }

        prep = {
            "person_name": entity.name,
            "meeting_time": meeting_time.isoformat() if meeting_time else None,
        }

        # 1. Get relationship health
        relationship = await self._get_relationship_health(user_id, entity.id)
        prep["relationship"] = relationship

        # 2. Get pending commitments to this person
        commitments = await self._get_pending_commitments(user_id, entity.id)
        prep["pending_commitments"] = commitments

        # 3. Get recent interactions
        interactions = await self._get_recent_interactions(user_id, entity.id)
        prep["recent_interactions"] = interactions

        # 4. Get relevant memories
        memories = await self._get_relevant_memories(user_id, person_name)
        prep["key_memories"] = memories

        # 5. Get recent email threads
        emails = await self._get_recent_emails(user_id, person_name)
        prep["recent_emails"] = emails

        # 6. Generate briefing summary
        briefing = await self._generate_briefing(prep)
        prep["briefing"] = briefing

        prep["success"] = True
        return prep

    async def _get_entity_by_name(
        self,
        user_id: UUID,
        person_name: str,
    ) -> Optional[Entity]:
        """Get entity by name."""
        result = await self.db.execute(
            select(Entity).where(
                and_(
                    Entity.user_id == user_id,
                    Entity.entity_type == "person",
                    Entity.name.ilike(f"%{person_name}%"),
                )
            )
        )
        return result.scalar_one_or_none()

    async def _get_relationship_health(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> dict:
        """Get relationship health metrics."""
        result = await self.db.execute(
            select(RelationshipHealth).where(
                and_(
                    RelationshipHealth.user_id == user_id,
                    RelationshipHealth.entity_id == entity_id,
                )
            )
        )
        health = result.scalar_one_or_none()

        if not health:
            return {
                "tier": "unknown",
                "health_score": None,
                "last_interaction": None,
                "days_since_contact": None,
                "trend": "unknown",
            }

        return {
            "tier": health.tier,
            "health_score": health.health_score,
            "last_interaction": health.last_interaction_date.isoformat() if health.last_interaction_date else None,
            "last_interaction_type": health.last_interaction_type,
            "days_since_contact": health.days_since_contact,
            "trend": health.health_trend,
            "has_tension": health.has_tension,
            "tension_reason": health.tension_reason if health.has_tension else None,
        }

    async def _get_pending_commitments(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> list[dict]:
        """Get pending commitments/intentions related to this person."""
        result = await self.db.execute(
            select(Intention).where(
                and_(
                    Intention.user_id == user_id,
                    Intention.status.in_([
                        IntentionStatus.PENDING,
                        IntentionStatus.OVERDUE,
                    ]),
                    or_(
                        Intention.related_entity_id == entity_id,
                        Intention.content.ilike(f"%{entity_id}%"),
                    )
                )
            ).order_by(Intention.target_date.asc().nullslast())
        )
        intentions = list(result.scalars().all())

        return [
            {
                "content": i.content,
                "type": i.intention_type,
                "target_date": i.target_date.isoformat() if i.target_date else None,
                "is_overdue": i.status == IntentionStatus.OVERDUE,
                "priority": i.priority,
            }
            for i in intentions[:5]
        ]

    async def _get_recent_interactions(
        self,
        user_id: UUID,
        entity_id: UUID,
        limit: int = 5,
    ) -> list[dict]:
        """Get recent interactions with this person."""
        try:
            result = await self.db.execute(
                select(InteractionLog).where(
                    and_(
                        InteractionLog.user_id == user_id,
                        InteractionLog.entity_id == entity_id,
                    )
                ).order_by(InteractionLog.interaction_date.desc()).limit(limit)
            )
            interactions = list(result.scalars().all())

            return [
                {
                    "type": i.interaction_type,
                    "date": i.interaction_date.isoformat() if i.interaction_date else None,
                    "summary": i.summary,
                    "sentiment": i.sentiment,
                }
                for i in interactions
            ]
        except Exception as e:
            logger.error(f"Error getting interactions: {e}")
            return []

    async def _get_relevant_memories(
        self,
        user_id: UUID,
        person_name: str,
        limit: int = 5,
    ) -> list[dict]:
        """Get relevant memories mentioning this person."""
        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    or_(
                        Memory.content.ilike(f"%{person_name}%"),
                        Memory.summary.ilike(f"%{person_name}%"),
                    )
                )
            ).order_by(Memory.memory_date.desc()).limit(limit)
        )
        memories = list(result.scalars().all())

        return [
            {
                "date": m.memory_date.isoformat() if m.memory_date else None,
                "summary": m.summary[:150] if m.summary else m.content[:150],
                "type": m.memory_type,
            }
            for m in memories
        ]

    async def _get_recent_emails(
        self,
        user_id: UUID,
        person_name: str,
        days: int = 14,
    ) -> list[dict]:
        """Get recent email threads with this person."""
        try:
            since = datetime.utcnow() - timedelta(days=days)
            query = f"from:{person_name} after:{since.strftime('%Y/%m/%d')}"

            result = await self.sync_service.search_emails(
                user_id=user_id,
                query=query,
                max_results=5,
            )

            emails = result.get("emails", [])

            return [
                {
                    "subject": e.get("subject", "No Subject"),
                    "date": e.get("date"),
                    "snippet": e.get("snippet", "")[:100],
                    "thread_id": e.get("threadId"),
                }
                for e in emails
            ]
        except Exception as e:
            logger.error(f"Error getting emails: {e}")
            return []

    async def _generate_briefing(self, prep: dict) -> str:
        """Generate a concise briefing from the prep data."""
        try:
            # Build context for LLM
            context_parts = []

            # Relationship
            rel = prep.get("relationship", {})
            if rel.get("days_since_contact"):
                context_parts.append(
                    f"Last talked: {rel['days_since_contact']} days ago"
                )
            if rel.get("has_tension"):
                context_parts.append(f"⚠️ Tension: {rel.get('tension_reason')}")

            # Commitments
            commitments = prep.get("pending_commitments", [])
            if commitments:
                for c in commitments[:2]:
                    marker = "⚠️ OVERDUE: " if c.get("is_overdue") else "📝 "
                    context_parts.append(f"{marker}{c['content'][:50]}")

            # Recent memories
            memories = prep.get("key_memories", [])
            if memories:
                context_parts.append(f"Recent topics: {', '.join([m['summary'][:30] for m in memories[:2]])}")

            # Recent emails
            emails = prep.get("recent_emails", [])
            if emails:
                context_parts.append(f"Recent email: {emails[0].get('subject', '')[:50]}")

            if not context_parts:
                return f"Meeting with {prep.get('person_name', 'someone')}"

            # Use LLM to create natural briefing
            prompt = f"""Create a brief, natural meeting prep summary (2-3 bullet points) from this context about {prep.get('person_name', 'them')}:

Context:
{chr(10).join(context_parts)}

Be concise and actionable. Highlight anything urgent or important."""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=150,
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            logger.error(f"Error generating briefing: {e}")
            # Fallback to basic briefing
            parts = []
            rel = prep.get("relationship", {})
            if rel.get("days_since_contact"):
                parts.append(f"Last talked {rel['days_since_contact']} days ago")
            commitments = prep.get("pending_commitments", [])
            if commitments:
                parts.append(f"{len(commitments)} pending commitment(s)")
            return " • ".join(parts) if parts else "No specific prep notes"

    async def scan_and_queue_meeting_preps(
        self,
        user_id: UUID,
        minutes_before: int = 30,
    ) -> dict:
        """
        Scan for upcoming meetings and queue prep notifications.

        Args:
            user_id: User's ID
            minutes_before: How many minutes before to notify

        Returns:
            Dict with queued meetings
        """
        queued = []

        try:
            # Get calendar events
            now = datetime.utcnow()
            window_start = now + timedelta(minutes=minutes_before - 5)
            window_end = now + timedelta(minutes=minutes_before + 10)

            # Sync calendar to get upcoming events
            events = await self.sync_service.get_calendar_events(
                user_id=user_id,
                start_date=window_start,
                end_date=window_end + timedelta(hours=1),
            )

            if not events or not events.get("events"):
                return {
                    "success": True,
                    "queued": 0,
                    "message": "No upcoming meetings to prep for",
                }

            orchestrator = ProactiveOrchestrator(self.db)

            for event in events.get("events", []):
                event_start_str = event.get("start", {}).get("dateTime")
                if not event_start_str:
                    continue

                event_start = datetime.fromisoformat(
                    event_start_str.replace("Z", "+00:00")
                )
                if event_start.tzinfo:
                    event_start = event_start.replace(tzinfo=None)

                # Check if in our notification window
                if not (window_start <= event_start <= window_end):
                    continue

                # Get attendees
                attendees = event.get("attendees", [])
                organizer = event.get("organizer", {})

                # Find a person to prep for
                person_name = None
                for attendee in attendees:
                    if not attendee.get("self", False):
                        person_name = attendee.get("displayName") or attendee.get("email", "").split("@")[0]
                        break

                if not person_name and organizer and not organizer.get("self", False):
                    person_name = organizer.get("displayName") or organizer.get("email", "").split("@")[0]

                if not person_name:
                    person_name = "meeting attendees"

                # Get meeting prep
                prep = await self.get_meeting_prep(
                    user_id=user_id,
                    person_name=person_name,
                    meeting_time=event_start,
                )

                # Calculate minutes until meeting
                minutes_until = int((event_start - now).total_seconds() / 60)

                # Create notification
                meeting_title = event.get("summary", "Meeting")
                notification = QueuedNotification(
                    notification_type=NotificationType.MEETING_PREP,
                    title=f"📅 {meeting_title} in {minutes_until}m",
                    body=prep.get("briefing", f"Meeting with {person_name}"),
                    user_id=user_id,
                    urgency_level=UrgencyLevel.HIGH if minutes_until <= 15 else UrgencyLevel.MEDIUM,
                    source_service="meeting_prep_service",
                    source_id=event.get("id", ""),
                    data={
                        "type": "meeting_prep",
                        "event_id": event.get("id"),
                        "person_name": person_name,
                        "meeting_time": event_start.isoformat(),
                        "meeting_title": meeting_title,
                        "prep": prep,
                    },
                    time_sensitivity_minutes=minutes_until,
                    is_from_inner_circle=prep.get("relationship", {}).get("tier") == "inner_circle",
                )

                await orchestrator.queue_notification(notification)

                queued.append({
                    "meeting": meeting_title,
                    "person": person_name,
                    "in_minutes": minutes_until,
                })

        except Exception as e:
            logger.error(f"Error scanning for meetings: {e}")
            return {
                "success": False,
                "message": f"Error: {str(e)}",
            }

        return {
            "success": True,
            "queued": len(queued),
            "queued_meetings": queued,
            "message": f"Queued {len(queued)} meeting prep notifications",
        }

    async def get_meeting_summary(
        self,
        user_id: UUID,
        event_id: str,
    ) -> dict:
        """Get a summary of a past meeting for follow-up."""
        # This would analyze memories created during/after the meeting
        # and suggest follow-up actions
        pass  # To be implemented based on meeting notes feature
