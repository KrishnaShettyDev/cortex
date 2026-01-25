"""
Relationship Intelligence Service

Provides deep relationship understanding:
- Health scoring based on interaction patterns
- Important date tracking and reminders
- Reconnection nudges
- Tension/warning detection
- Promise tracking
- AI-generated relationship insights

All features integrate seamlessly with chat.
"""

import json
import logging
from datetime import datetime, date, timedelta
from uuid import UUID
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.entity import Entity
from app.models.memory import Memory
from app.models.relationship import (
    RelationshipHealth,
    RelationshipTier,
    ImportantDate,
    InteractionLog,
    InteractionType,
    RelationshipPromise,
    RelationshipInsight,
)

settings = get_settings()
logger = logging.getLogger(__name__)


# Tier-based ideal contact frequencies (in days)
TIER_CONTACT_DAYS = {
    "inner_circle": 3,
    "close": 7,
    "regular": 14,
    "distant": 30,
    "professional": 30,
}


class RelationshipIntelligenceService:
    """
    Service for relationship intelligence.

    Tracks relationship health, important dates, and provides
    proactive nudges and insights.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    # ==================== HEALTH SCORING ====================

    async def get_or_create_relationship_health(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> RelationshipHealth:
        """Get or create a relationship health record for a person."""
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
            # Get entity to determine tier
            entity_result = await self.db.execute(
                select(Entity).where(Entity.id == entity_id)
            )
            entity = entity_result.scalar_one_or_none()

            health = RelationshipHealth(
                user_id=user_id,
                entity_id=entity_id,
                tier="regular",
                health_score=50.0,
            )
            self.db.add(health)
            await self.db.commit()
            await self.db.refresh(health)

        return health

    async def calculate_health_score(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> dict:
        """
        Calculate relationship health score based on multiple factors.

        Returns:
            Dict with health_score (0-100) and component scores
        """
        health = await self.get_or_create_relationship_health(user_id, entity_id)

        # Get recent interactions (last 90 days)
        ninety_days_ago = datetime.utcnow() - timedelta(days=90)
        result = await self.db.execute(
            select(InteractionLog).where(
                and_(
                    InteractionLog.user_id == user_id,
                    InteractionLog.entity_id == entity_id,
                    InteractionLog.interaction_date >= ninety_days_ago,
                )
            ).order_by(desc(InteractionLog.interaction_date))
        )
        interactions = list(result.scalars().all())

        # 1. Frequency score (based on tier)
        ideal_days = TIER_CONTACT_DAYS.get(health.tier, 14)
        if interactions:
            days_since = (datetime.utcnow() - interactions[0].interaction_date).days
            health.days_since_contact = days_since
            health.last_interaction_date = interactions[0].interaction_date.date()
            health.last_interaction_type = interactions[0].interaction_type

            # Score: 1.0 if on track, decreasing as time passes
            frequency_score = max(0, 1.0 - (days_since / (ideal_days * 3)))
        else:
            frequency_score = 0.2
            health.days_since_contact = 999

        # 2. Sentiment score (average of recent interactions)
        if interactions:
            sentiment_score = sum(i.sentiment or 0.5 for i in interactions[:10]) / min(len(interactions), 10)
        else:
            sentiment_score = 0.5

        # 3. Reciprocity score (how many were initiated by user)
        if interactions:
            initiated = sum(1 for i in interactions if i.initiated_by_user)
            reciprocity_score = 1.0 - abs(0.5 - (initiated / len(interactions)))
        else:
            reciprocity_score = 0.5

        # 4. Commitment score (promises kept vs broken)
        result = await self.db.execute(
            select(RelationshipPromise).where(
                and_(
                    RelationshipPromise.user_id == user_id,
                    RelationshipPromise.entity_id == entity_id,
                    RelationshipPromise.status != "pending",
                )
            )
        )
        promises = list(result.scalars().all())
        if promises:
            fulfilled = sum(1 for p in promises if p.status == "fulfilled")
            commitment_score = fulfilled / len(promises)
        else:
            commitment_score = 0.5

        # Update health record
        health.frequency_score = frequency_score
        health.sentiment_score = sentiment_score
        health.reciprocity_score = reciprocity_score
        health.commitment_score = commitment_score

        # Calculate overall health score (weighted average)
        health_score = (
            frequency_score * 0.35 +
            sentiment_score * 0.30 +
            reciprocity_score * 0.15 +
            commitment_score * 0.20
        ) * 100

        health.health_score = health_score

        # Determine trend (compare to previous)
        if health_score > 60:
            health.health_trend = "healthy"
        elif health_score > 40:
            health.health_trend = "stable"
        else:
            health.health_trend = "declining"

        # Check if needs reconnect
        health.needs_reconnect = health.days_since_contact > ideal_days

        await self.db.commit()

        return {
            "health_score": round(health_score, 1),
            "frequency_score": round(frequency_score, 2),
            "sentiment_score": round(sentiment_score, 2),
            "reciprocity_score": round(reciprocity_score, 2),
            "commitment_score": round(commitment_score, 2),
            "trend": health.health_trend,
            "days_since_contact": health.days_since_contact,
            "needs_reconnect": health.needs_reconnect,
        }

    async def set_relationship_tier(
        self,
        user_id: UUID,
        entity_id: UUID,
        tier: str,
    ) -> dict:
        """Set the relationship tier for a person."""
        health = await self.get_or_create_relationship_health(user_id, entity_id)
        health.tier = tier
        health.ideal_contact_days = TIER_CONTACT_DAYS.get(tier, 14)
        await self.db.commit()

        return {
            "success": True,
            "tier": tier,
            "ideal_contact_days": health.ideal_contact_days,
        }

    # ==================== INTERACTION LOGGING ====================

    async def log_interaction(
        self,
        user_id: UUID,
        entity_id: UUID,
        interaction_type: str,
        interaction_date: datetime,
        summary: str = None,
        sentiment: float = 0.5,
        source_type: str = None,
        source_id: UUID = None,
        topics: list = None,
        duration_minutes: int = None,
        initiated_by_user: bool = None,
    ) -> InteractionLog:
        """Log an interaction with a person."""
        log = InteractionLog(
            user_id=user_id,
            entity_id=entity_id,
            interaction_type=interaction_type,
            interaction_date=interaction_date,
            summary=summary,
            sentiment=sentiment,
            source_type=source_type,
            source_id=source_id,
            topics=topics or [],
            duration_minutes=duration_minutes,
            initiated_by_user=initiated_by_user,
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)

        # Update health score
        await self.calculate_health_score(user_id, entity_id)

        return log

    async def extract_interactions_from_memory(
        self,
        memory: Memory,
    ) -> list[InteractionLog]:
        """
        Extract interaction logs from a memory.

        Analyzes memory content to find mentions of people
        and the nature of the interaction.
        """
        if not memory.entities:
            return []

        interactions = []

        # Get person entities from this memory
        person_entities = [e for e in memory.entities if e.entity_type == "person"]

        for entity in person_entities:
            # Determine interaction type from memory
            content_lower = memory.content.lower()
            if any(word in content_lower for word in ["met", "meeting", "saw", "visited"]):
                interaction_type = "meeting"
            elif any(word in content_lower for word in ["called", "call", "phone"]):
                interaction_type = "call"
            elif any(word in content_lower for word in ["emailed", "email", "wrote"]):
                interaction_type = "email"
            elif any(word in content_lower for word in ["texted", "messaged", "chat"]):
                interaction_type = "message"
            else:
                interaction_type = "mentioned"

            # Analyze sentiment (simple heuristic, could use LLM)
            positive_words = ["happy", "great", "wonderful", "enjoyed", "loved", "fun", "good"]
            negative_words = ["angry", "frustrated", "upset", "argued", "difficult", "tense"]

            positive_count = sum(1 for w in positive_words if w in content_lower)
            negative_count = sum(1 for w in negative_words if w in content_lower)

            if positive_count > negative_count:
                sentiment = 0.7
            elif negative_count > positive_count:
                sentiment = 0.3
            else:
                sentiment = 0.5

            log = await self.log_interaction(
                user_id=memory.user_id,
                entity_id=entity.id,
                interaction_type=interaction_type,
                interaction_date=memory.memory_date,
                summary=memory.summary or memory.content[:200],
                sentiment=sentiment,
                source_type="memory",
                source_id=memory.id,
            )
            interactions.append(log)

        return interactions

    # ==================== IMPORTANT DATES ====================

    async def add_important_date(
        self,
        user_id: UUID,
        entity_id: UUID,
        date_type: str,
        month: int,
        day: int,
        year: int = None,
        date_label: str = None,
        notes: str = None,
        source_memory_id: UUID = None,
    ) -> ImportantDate:
        """Add an important date for a person (birthday, anniversary, etc.)."""
        important_date = ImportantDate(
            user_id=user_id,
            entity_id=entity_id,
            date_type=date_type,
            date_label=date_label or date_type.replace("_", " ").title(),
            month=month,
            day=day,
            year=year,
            notes=notes,
            source_memory_id=source_memory_id,
        )
        self.db.add(important_date)
        await self.db.commit()
        await self.db.refresh(important_date)

        return important_date

    async def get_upcoming_important_dates(
        self,
        user_id: UUID,
        days_ahead: int = 14,
    ) -> list[dict]:
        """Get important dates coming up in the next X days."""
        today = date.today()
        upcoming = []

        result = await self.db.execute(
            select(ImportantDate, Entity).join(Entity).where(
                ImportantDate.user_id == user_id
            )
        )
        dates = result.all()

        for imp_date, entity in dates:
            # Calculate this year's occurrence
            try:
                this_year_date = date(today.year, imp_date.month, imp_date.day)
            except ValueError:
                # Invalid date (e.g., Feb 29 in non-leap year)
                continue

            # If already passed this year, check next year
            if this_year_date < today:
                try:
                    this_year_date = date(today.year + 1, imp_date.month, imp_date.day)
                except ValueError:
                    continue

            days_until = (this_year_date - today).days

            if 0 <= days_until <= days_ahead:
                # Calculate age/years if year is known
                years = None
                if imp_date.year:
                    years = this_year_date.year - imp_date.year

                upcoming.append({
                    "id": str(imp_date.id),
                    "person_name": entity.name,
                    "entity_id": str(entity.id),
                    "date_type": imp_date.date_type,
                    "date_label": imp_date.date_label,
                    "date": this_year_date.isoformat(),
                    "days_until": days_until,
                    "years": years,
                    "notes": imp_date.notes,
                    "reminder_days_before": imp_date.reminder_days_before or 3,
                    "last_reminded": imp_date.last_reminded,
                })

        # Sort by days until
        upcoming.sort(key=lambda x: x["days_until"])

        return upcoming

    async def extract_dates_from_memory(
        self,
        memory: Memory,
    ) -> list[ImportantDate]:
        """Use LLM to extract important dates from a memory."""
        prompt = f"""Extract any important dates mentioned in this memory about people.

Memory: "{memory.content}"

Return JSON array:
[{{"person_name": "John", "date_type": "birthday", "month": 3, "day": 15, "year": 1990, "notes": "Likes chocolate cake"}}]

Date types: birthday, anniversary, work_anniversary, memorial, other
Only include if a specific date is mentioned or can be inferred.
Return empty array if no dates found."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "Extract important dates from text. Return valid JSON array."},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                max_tokens=500,
            )

            result = json.loads(response.choices[0].message.content)
            dates_data = result.get("dates", result) if isinstance(result, dict) else result

            extracted = []
            for date_info in dates_data:
                # Find entity by name
                entity_result = await self.db.execute(
                    select(Entity).where(
                        and_(
                            Entity.user_id == memory.user_id,
                            Entity.name.ilike(f"%{date_info['person_name']}%"),
                            Entity.entity_type == "person",
                        )
                    )
                )
                entity = entity_result.scalar_one_or_none()

                if entity:
                    imp_date = await self.add_important_date(
                        user_id=memory.user_id,
                        entity_id=entity.id,
                        date_type=date_info.get("date_type", "other"),
                        month=date_info["month"],
                        day=date_info["day"],
                        year=date_info.get("year"),
                        notes=date_info.get("notes"),
                        source_memory_id=memory.id,
                    )
                    extracted.append(imp_date)

            return extracted

        except Exception as e:
            logger.error(f"Error extracting dates from memory: {e}")
            return []

    # ==================== PROMISES ====================

    async def add_promise(
        self,
        user_id: UUID,
        entity_id: UUID,
        description: str,
        original_text: str = None,
        due_date: date = None,
        importance: float = 0.5,
        source_memory_id: UUID = None,
    ) -> RelationshipPromise:
        """Track a promise made to someone."""
        promise = RelationshipPromise(
            user_id=user_id,
            entity_id=entity_id,
            description=description,
            original_text=original_text,
            made_on=date.today(),
            due_date=due_date,
            importance=importance,
            source_memory_id=source_memory_id,
        )
        self.db.add(promise)
        await self.db.commit()
        await self.db.refresh(promise)

        return promise

    async def get_pending_promises(
        self,
        user_id: UUID,
        entity_id: UUID = None,
    ) -> list[dict]:
        """Get pending promises, optionally filtered by person."""
        query = select(RelationshipPromise, Entity).join(Entity).where(
            and_(
                RelationshipPromise.user_id == user_id,
                RelationshipPromise.status == "pending",
            )
        )

        if entity_id:
            query = query.where(RelationshipPromise.entity_id == entity_id)

        result = await self.db.execute(query.order_by(RelationshipPromise.due_date))
        promises = result.all()

        return [
            {
                "id": str(p.id),
                "person_name": e.name,
                "entity_id": str(e.id),
                "description": p.description,
                "made_on": p.made_on.isoformat(),
                "due_date": p.due_date.isoformat() if p.due_date else None,
                "importance": p.importance,
                "is_overdue": p.due_date and p.due_date < date.today(),
            }
            for p, e in promises
        ]

    async def fulfill_promise(
        self,
        user_id: UUID,
        promise_id: UUID,
    ) -> dict:
        """Mark a promise as fulfilled."""
        result = await self.db.execute(
            select(RelationshipPromise).where(
                and_(
                    RelationshipPromise.id == promise_id,
                    RelationshipPromise.user_id == user_id,
                )
            )
        )
        promise = result.scalar_one_or_none()

        if not promise:
            return {"success": False, "message": "Promise not found"}

        promise.status = "fulfilled"
        promise.fulfilled_on = date.today()
        await self.db.commit()

        # Recalculate health score
        await self.calculate_health_score(user_id, promise.entity_id)

        return {"success": True, "message": "Promise marked as fulfilled"}

    # ==================== INSIGHTS ====================

    async def generate_relationship_insights(
        self,
        user_id: UUID,
    ) -> list[RelationshipInsight]:
        """Generate AI-powered relationship insights for all relationships."""
        insights = []

        # Get all relationships with health data
        result = await self.db.execute(
            select(RelationshipHealth, Entity).join(Entity).where(
                RelationshipHealth.user_id == user_id
            )
        )
        relationships = result.all()

        for health, entity in relationships:
            # Check for declining relationships
            if health.health_trend == "declining" and health.health_score < 40:
                insight = RelationshipInsight(
                    user_id=user_id,
                    entity_id=entity.id,
                    insight_type="declining_contact",
                    title=f"Relationship with {entity.name} needs attention",
                    description=f"You haven't connected with {entity.name} in {health.days_since_contact} days. "
                                f"Your relationship health score is {health.health_score:.0f}/100.",
                    priority=0.7,
                    suggested_action=f"Reach out to {entity.name} - a quick message or call would help.",
                )
                self.db.add(insight)
                insights.append(insight)

            # Check for overdue reconnections
            if health.needs_reconnect and health.days_since_contact > health.ideal_contact_days * 2:
                insight = RelationshipInsight(
                    user_id=user_id,
                    entity_id=entity.id,
                    insight_type="overdue_reconnect",
                    title=f"Time to reconnect with {entity.name}",
                    description=f"It's been {health.days_since_contact} days since you talked to {entity.name}. "
                                f"For your relationship tier, you'd ideally connect every {health.ideal_contact_days} days.",
                    priority=0.6,
                    suggested_action=f"Schedule a quick catch-up with {entity.name}.",
                )
                self.db.add(insight)
                insights.append(insight)

            # Check for tension
            if health.has_tension:
                insight = RelationshipInsight(
                    user_id=user_id,
                    entity_id=entity.id,
                    insight_type="tension_detected",
                    title=f"Tension with {entity.name}",
                    description=health.tension_reason or f"Recent interactions with {entity.name} have been tense.",
                    priority=0.8,
                    suggested_action=f"Consider addressing the situation with {entity.name} directly.",
                )
                self.db.add(insight)
                insights.append(insight)

        # Check for broken promises
        result = await self.db.execute(
            select(RelationshipPromise, Entity).join(Entity).where(
                and_(
                    RelationshipPromise.user_id == user_id,
                    RelationshipPromise.status == "pending",
                    RelationshipPromise.due_date < date.today(),
                )
            )
        )
        overdue_promises = result.all()

        for promise, entity in overdue_promises:
            insight = RelationshipInsight(
                user_id=user_id,
                entity_id=entity.id,
                insight_type="broken_promise",
                title=f"Overdue promise to {entity.name}",
                description=f"You promised {entity.name}: \"{promise.description}\" - this was due {promise.due_date}.",
                priority=0.75,
                suggested_action=f"Either fulfill this promise or apologize to {entity.name}.",
            )
            self.db.add(insight)
            insights.append(insight)

        await self.db.commit()
        return insights

    async def get_active_insights(
        self,
        user_id: UUID,
        limit: int = 10,
    ) -> list[dict]:
        """Get active relationship insights."""
        result = await self.db.execute(
            select(RelationshipInsight, Entity)
            .outerjoin(Entity, RelationshipInsight.entity_id == Entity.id)
            .where(
                and_(
                    RelationshipInsight.user_id == user_id,
                    RelationshipInsight.is_active == True,
                )
            )
            .order_by(desc(RelationshipInsight.priority))
            .limit(limit)
        )
        insights = result.all()

        return [
            {
                "id": str(insight.id),
                "type": insight.insight_type,
                "title": insight.title,
                "description": insight.description,
                "person_name": entity.name if entity else None,
                "priority": insight.priority,
                "suggested_action": insight.suggested_action,
                "created_at": insight.created_at.isoformat(),
            }
            for insight, entity in insights
        ]

    # ==================== RELATIONSHIP SUMMARY ====================

    async def get_relationship_summary(
        self,
        user_id: UUID,
        entity_id: UUID,
    ) -> dict:
        """Get a comprehensive summary of a relationship."""
        # Get entity
        result = await self.db.execute(
            select(Entity).where(Entity.id == entity_id)
        )
        entity = result.scalar_one_or_none()

        if not entity:
            return {"success": False, "message": "Person not found"}

        # Get health data
        health_data = await self.calculate_health_score(user_id, entity_id)
        health = await self.get_or_create_relationship_health(user_id, entity_id)

        # Get recent interactions
        result = await self.db.execute(
            select(InteractionLog).where(
                and_(
                    InteractionLog.user_id == user_id,
                    InteractionLog.entity_id == entity_id,
                )
            ).order_by(desc(InteractionLog.interaction_date)).limit(5)
        )
        recent_interactions = [
            {
                "type": i.interaction_type or "unknown",
                "date": i.interaction_date.isoformat(),
                "summary": i.summary,
                "sentiment": i.sentiment,
            }
            for i in result.scalars().all()
        ]

        # Get pending promises
        pending_promises = await self.get_pending_promises(user_id, entity_id)

        # Get upcoming dates
        all_dates = await self.get_upcoming_important_dates(user_id, days_ahead=60)
        person_dates = [d for d in all_dates if d["entity_id"] == str(entity_id)]

        # Get active insights for this person
        result = await self.db.execute(
            select(RelationshipInsight).where(
                and_(
                    RelationshipInsight.user_id == user_id,
                    RelationshipInsight.entity_id == entity_id,
                    RelationshipInsight.is_active == True,
                )
            )
        )
        insights = [
            {
                "type": i.insight_type,
                "title": i.title,
                "action": i.suggested_action,
            }
            for i in result.scalars().all()
        ]

        return {
            "success": True,
            "person_name": entity.name,
            "relationship_tier": health.tier or "regular",
            "health": health_data,
            "recent_interactions": recent_interactions,
            "pending_promises": pending_promises,
            "upcoming_dates": person_dates,
            "insights": insights,
            "warnings": {
                "has_tension": health.has_tension,
                "tension_reason": health.tension_reason,
                "needs_reconnect": health.needs_reconnect,
            },
        }

    # ==================== CHAT CONTEXT ====================

    async def get_relationship_context_for_chat(
        self,
        user_id: UUID,
    ) -> str:
        """Get relationship context to inject into chat. All queries run in parallel."""
        import asyncio

        # Define all queries as coroutines
        async def get_neglected():
            result = await self.db.execute(
                select(RelationshipHealth, Entity).join(Entity).where(
                    and_(
                        RelationshipHealth.user_id == user_id,
                        RelationshipHealth.needs_reconnect == True,
                    )
                ).order_by(RelationshipHealth.days_since_contact.desc()).limit(3)
            )
            return result.all()

        async def get_overdue():
            result = await self.db.execute(
                select(RelationshipPromise, Entity).join(Entity).where(
                    and_(
                        RelationshipPromise.user_id == user_id,
                        RelationshipPromise.status == "pending",
                        RelationshipPromise.due_date < date.today(),
                    )
                ).limit(3)
            )
            return result.all()

        async def get_tensions():
            result = await self.db.execute(
                select(RelationshipHealth, Entity).join(Entity).where(
                    and_(
                        RelationshipHealth.user_id == user_id,
                        RelationshipHealth.has_tension == True,
                    )
                ).limit(2)
            )
            return result.all()

        # Run all queries in parallel
        neglected, upcoming, overdue, tensions = await asyncio.gather(
            get_neglected(),
            self.get_upcoming_important_dates(user_id, days_ahead=7),
            get_overdue(),
            get_tensions(),
        )

        # Build context from results
        context_parts = []

        if neglected:
            context_parts.append("\n**RELATIONSHIPS NEEDING ATTENTION:**")
            for health, entity in neglected:
                context_parts.append(
                    f"- {entity.name}: {health.days_since_contact} days since contact "
                    f"(health: {health.health_score:.0f}/100)"
                )

        if upcoming:
            context_parts.append("\n**UPCOMING IMPORTANT DATES:**")
            for d in upcoming[:3]:
                context_parts.append(
                    f"- {d['person_name']}'s {d['date_label']}: {d['days_until']} days"
                )

        if overdue:
            context_parts.append("\n**OVERDUE PROMISES:**")
            for promise, entity in overdue:
                context_parts.append(
                    f"- To {entity.name}: \"{promise.description[:50]}...\""
                )

        if tensions:
            context_parts.append("\n**RELATIONSHIP WARNINGS:**")
            for health, entity in tensions:
                context_parts.append(
                    f"- Tension with {entity.name}: {health.tension_reason or 'unresolved issues'}"
                )

        return "\n".join(context_parts) if context_parts else ""

    async def get_neglected_relationships(
        self,
        user_id: UUID,
        limit: int = 5,
    ) -> list[dict]:
        """Get relationships that need reconnection, sorted by urgency."""
        result = await self.db.execute(
            select(RelationshipHealth, Entity).join(Entity).where(
                and_(
                    RelationshipHealth.user_id == user_id,
                    RelationshipHealth.needs_reconnect == True,
                )
            ).order_by(desc(RelationshipHealth.days_since_contact)).limit(limit)
        )
        neglected = result.all()

        return [
            {
                "relationship_id": str(health.id),
                "entity_id": str(entity.id),
                "name": entity.name,
                "days_since_contact": health.days_since_contact,
                "health_score": health.health_score,
                "tier": health.tier or "regular",
                "ideal_contact_days": health.ideal_contact_days,
            }
            for health, entity in neglected
        ]

    async def update_all_health_scores(
        self,
        user_id: UUID,
    ) -> int:
        """Update health scores for all relationships of a user."""
        result = await self.db.execute(
            select(RelationshipHealth).where(RelationshipHealth.user_id == user_id)
        )
        relationships = list(result.scalars().all())

        updated = 0
        for health in relationships:
            try:
                await self.calculate_health_score(user_id, health.entity_id)
                updated += 1
            except Exception as e:
                logger.error(f"Error updating health for {health.entity_id}: {e}")

        return updated

    async def record_nudge_sent(
        self,
        relationship_id: str,
    ) -> None:
        """Record that a reconnection nudge was sent."""
        try:
            result = await self.db.execute(
                select(RelationshipHealth).where(
                    RelationshipHealth.id == UUID(relationship_id)
                )
            )
            health = result.scalar_one_or_none()
            if health:
                health.last_nudge_sent = datetime.utcnow()
                health.nudge_count = (health.nudge_count or 0) + 1
                await self.db.commit()
        except Exception as e:
            logger.error(f"Error recording nudge: {e}")

    async def mark_date_reminded(
        self,
        date_id: str,
    ) -> None:
        """Mark an important date as reminded."""
        try:
            result = await self.db.execute(
                select(ImportantDate).where(ImportantDate.id == UUID(date_id))
            )
            imp_date = result.scalar_one_or_none()
            if imp_date:
                imp_date.last_reminded = datetime.utcnow()
                await self.db.commit()
        except Exception as e:
            logger.error(f"Error marking date reminded: {e}")

    async def record_promise_reminder(
        self,
        promise_id: str,
    ) -> None:
        """Record that a promise reminder was sent."""
        try:
            result = await self.db.execute(
                select(RelationshipPromise).where(
                    RelationshipPromise.id == UUID(promise_id)
                )
            )
            promise = result.scalar_one_or_none()
            if promise:
                promise.reminder_count = (promise.reminder_count or 0) + 1
                promise.last_reminded = datetime.utcnow()
                await self.db.commit()
        except Exception as e:
            logger.error(f"Error recording promise reminder: {e}")

    async def get_meeting_prep_context(
        self,
        user_id: UUID,
        person_name: str,
    ) -> str:
        """
        Get relationship context for meeting prep.

        When user has a meeting with someone, provide relevant context.
        """
        # Find entity
        result = await self.db.execute(
            select(Entity).where(
                and_(
                    Entity.user_id == user_id,
                    Entity.name.ilike(f"%{person_name}%"),
                    Entity.entity_type == "person",
                )
            )
        )
        entity = result.scalar_one_or_none()

        if not entity:
            return f"No relationship data for {person_name}"

        summary = await self.get_relationship_summary(user_id, entity.id)

        if not summary.get("success"):
            return f"No relationship data for {person_name}"

        lines = [f"**Meeting with {entity.name}:**"]

        # Health warning
        health = summary["health"]
        if health["health_score"] < 50:
            lines.append(f"⚠️ Relationship health: {health['health_score']:.0f}/100 ({health['trend']})")

        # Last interaction
        if summary["recent_interactions"]:
            last = summary["recent_interactions"][0]
            lines.append(f"Last contact: {last['date'][:10]} ({last['type']})")

        # Pending promises
        if summary["pending_promises"]:
            lines.append("Promises you owe them:")
            for p in summary["pending_promises"][:2]:
                lines.append(f"  - {p['description']}")

        # Warnings
        if summary["warnings"]["has_tension"]:
            lines.append(f"⚠️ Tension: {summary['warnings']['tension_reason']}")

        # Upcoming dates
        if summary["upcoming_dates"]:
            for d in summary["upcoming_dates"][:1]:
                lines.append(f"Coming up: {d['date_label']} in {d['days_until']} days")

        return "\n".join(lines)


# Singleton helper
def get_relationship_intelligence_service(db: AsyncSession) -> RelationshipIntelligenceService:
    return RelationshipIntelligenceService(db)
