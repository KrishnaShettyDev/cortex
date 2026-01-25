"""
CONTEXTUAL INTELLIGENCE ENGINE

This is the god-level layer. Not "summarize emails" - that's commodity.
This is "I know your entire life context and use it to anticipate everything."

What Iris can do: "Summarize my emails"
What Cortex does: "Josh emailed about the proposal. You've been anxious about this
                   for 2 weeks. Based on your 8 previous exchanges with him, he
                   responds well to data. Your last promise to him was delivering
                   by Friday. It's Thursday. Want me to draft something that buys
                   time while matching how you write to investors?"

The difference: MEMORY + ANTICIPATION + RELATIONSHIP AWARENESS + STYLE MATCHING

This isn't an email service. It's a chief of staff who has read every email
you've ever sent, knows every relationship, remembers every promise, and
understands your communication patterns with each person.
"""

import json
import logging
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List, Dict, Any
from uuid import UUID
from dataclasses import dataclass, field
from enum import Enum

from openai import AsyncOpenAI
from sqlalchemy import select, and_, or_, func, desc, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services.openai_client import get_openai_client
from app.models.entity import Entity
from app.models.memory import Memory
from app.models.relationship import (
    RelationshipHealth,
    RelationshipPromise,
    InteractionLog,
    ImportantDate,
)
from app.services.relationship_intelligence_service import RelationshipIntelligenceService
from app.services.proactive_intelligence_service import ProactiveIntelligenceService
from app.services.search_service import SearchService
from app.services.intelligence_implementations import (
    TheirPromisesService,
    get_connected_account_id,
)

settings = get_settings()
logger = logging.getLogger(__name__)


class UrgencyLevel(Enum):
    CRITICAL = "critical"      # Needs response NOW
    HIGH = "high"              # Today
    NORMAL = "normal"          # This week
    LOW = "low"                # Whenever
    FYI = "fyi"                # No action needed


class RelationshipType(Enum):
    INVESTOR = "investor"
    FAMILY = "family"
    CLOSE_FRIEND = "close_friend"
    COLLEAGUE = "colleague"
    PROFESSIONAL = "professional"
    ACQUAINTANCE = "acquaintance"
    UNKNOWN = "unknown"


@dataclass
class PersonContext:
    """Everything Cortex knows about a person."""
    name: str
    email: str = ""
    entity_id: Optional[UUID] = None
    relationship_type: RelationshipType = RelationshipType.UNKNOWN
    relationship_tier: str = "regular"

    # Interaction history
    total_interactions: int = 0
    last_interaction: Optional[datetime] = None
    days_since_contact: int = 999

    # Communication patterns
    their_communication_style: str = "unknown"
    your_style_with_them: str = "professional"

    # Relationship health
    relationship_score: float = 0.5
    relationship_trend: str = "stable"
    needs_reconnect: bool = False

    # Open items
    your_promises_to_them: List[str] = field(default_factory=list)
    their_promises_to_you: List[str] = field(default_factory=list)
    unresolved_topics: List[str] = field(default_factory=list)

    # Context
    how_you_met: str = "unknown"
    shared_interests: List[str] = field(default_factory=list)
    notable_facts: List[str] = field(default_factory=list)

    # Warnings
    has_tension: bool = False
    tension_reason: Optional[str] = None


@dataclass
class EmailContext:
    """Deep context for an email - not just content, but full situation awareness."""
    email_id: str
    sender: Optional[PersonContext] = None
    sender_email: str = ""
    sender_name: str = ""
    subject: str = ""
    snippet: str = ""
    received_at: Optional[datetime] = None

    # Intelligence
    urgency: UrgencyLevel = UrgencyLevel.NORMAL
    urgency_reason: str = ""

    # Thread context
    thread_id: str = ""
    thread_length: int = 1
    thread_summary: str = ""
    key_decisions_in_thread: List[str] = field(default_factory=list)
    unresolved_questions: List[str] = field(default_factory=list)

    # Action intelligence
    what_they_want: str = ""
    what_you_should_do: str = ""
    suggested_response_tone: str = ""

    # Memory connections
    related_memories: List[str] = field(default_factory=list)
    related_commitments: List[str] = field(default_factory=list)


@dataclass
class MeetingContext:
    """Everything you need before walking into a meeting."""
    event_id: str
    title: str
    start_time: Optional[datetime] = None
    attendees: List[PersonContext] = field(default_factory=list)

    # Preparation
    your_history_with_attendees: str = ""
    what_you_discussed_last_time: str = ""
    what_you_promised_last_time: List[str] = field(default_factory=list)
    what_they_promised_last_time: List[str] = field(default_factory=list)

    # Current state
    open_topics: List[str] = field(default_factory=list)
    their_likely_priorities: List[str] = field(default_factory=list)
    your_goals_for_this_meeting: List[str] = field(default_factory=list)

    # Warnings
    relationship_alerts: List[str] = field(default_factory=list)

    # Suggested talking points
    suggested_talking_points: List[str] = field(default_factory=list)
    questions_to_ask: List[str] = field(default_factory=list)
    things_to_avoid: List[str] = field(default_factory=list)


class ContextualIntelligenceEngine:
    """
    The brain that makes Cortex superhuman.

    Every interaction is informed by:
    - Full relationship history
    - Communication patterns
    - Promises and commitments
    - Emotional context
    - Timing awareness
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = get_openai_client()
        self.relationship_service = RelationshipIntelligenceService(db)
        self.proactive_service = ProactiveIntelligenceService(db, self.client)
        self.search_service = SearchService(db)

    # =========================================================================
    # PERSON INTELLIGENCE - Know everyone in the user's life
    # =========================================================================

    async def get_person_context(
        self,
        user_id: UUID,
        person_identifier: str  # Name or email
    ) -> Optional[PersonContext]:
        """
        Build complete context about a person from all data sources.

        Combines:
        - Entity data (name, email, relationship type)
        - Memory mentions (every time they were mentioned)
        - Relationship health (scores, trends)
        - Commitment tracking (promises made)
        """

        # 1. Find the person in entities
        entity = await self._find_entity(user_id, person_identifier)
        if not entity:
            return None

        entity_id = entity["id"]

        # 2. Get relationship health data
        health_data = await self.relationship_service.calculate_health_score(user_id, entity_id)
        health = await self.relationship_service.get_or_create_relationship_health(user_id, entity_id)

        # 3. Get memories mentioning this person
        memories = await self._get_memories_about_person(user_id, entity_id)

        # 4. Get open promises/commitments
        promises = await self.relationship_service.get_pending_promises(user_id, entity_id)

        # 5. Analyze relationship style (if we have enough data)
        relationship_analysis = await self._analyze_relationship_style(entity, memories)

        # 6. Extract notable facts
        notable_facts = await self._extract_notable_facts(memories)

        # 7. Get their promises to you (what they owe you)
        their_promises = []
        try:
            their_promises_service = TheirPromisesService(self.db, self.client)
            person_email = entity.get("email", "")
            if person_email:
                promises_data = await their_promises_service.get_promises_from_person(
                    user_id=user_id,
                    person_email=person_email,
                    status="pending"
                )
                their_promises = [p["action"] for p in promises_data]
        except Exception as e:
            logger.warning(f"Failed to get their promises: {e}")

        # 8. Build complete context
        return PersonContext(
            name=entity["name"],
            email=entity.get("email", ""),
            entity_id=entity_id,
            relationship_type=self._infer_relationship_type(entity, memories),
            relationship_tier=health.tier or "regular",
            total_interactions=len(memories),
            last_interaction=health.last_interaction_date,
            days_since_contact=health_data.get("days_since_contact", 999),
            their_communication_style=relationship_analysis.get("their_style", "unknown"),
            your_style_with_them=relationship_analysis.get("your_style", "professional"),
            relationship_score=health_data.get("health_score", 50) / 100,
            relationship_trend=health_data.get("trend", "stable"),
            needs_reconnect=health_data.get("needs_reconnect", False),
            your_promises_to_them=[p["description"] for p in promises],
            their_promises_to_you=their_promises,
            unresolved_topics=[],
            how_you_met=entity.get("metadata", {}).get("how_met", "unknown") if entity.get("extra_data") else "unknown",
            shared_interests=[],
            notable_facts=notable_facts,
            has_tension=health.has_tension if health else False,
            tension_reason=health.tension_reason if health else None,
        )

    async def get_who_is(
        self,
        user_id: UUID,
        name: str
    ) -> str:
        """
        "Who is Sarah?" - Return everything known, formatted for chat.

        Not just database lookup. Full intelligence briefing.
        """
        context = await self.get_person_context(user_id, name)

        if not context:
            return f"I don't have much information about {name} yet. Tell me about them?"

        # Build natural language briefing
        briefing_parts = []

        # Identity
        briefing_parts.append(f"**{context.name}**")
        if context.email:
            briefing_parts.append(f"Email: {context.email}")

        # Relationship
        rel_desc = self._describe_relationship(context)
        briefing_parts.append(rel_desc)

        # Health score
        health_pct = int(context.relationship_score * 100)
        briefing_parts.append(f"Relationship health: {health_pct}/100 ({context.relationship_trend})")

        # Recent interaction
        if context.days_since_contact < 7:
            briefing_parts.append(f"You last connected {context.days_since_contact} days ago.")
        elif context.days_since_contact < 30:
            briefing_parts.append(f"It's been {context.days_since_contact} days since you talked.")
        elif context.days_since_contact < 999:
            briefing_parts.append(f"It's been {context.days_since_contact} days. Might want to reach out.")

        # Open items
        if context.your_promises_to_them:
            briefing_parts.append(f"\n**You owe them:** {', '.join(context.your_promises_to_them[:3])}")
        if context.their_promises_to_you:
            briefing_parts.append(f"**They owe you:** {', '.join(context.their_promises_to_you[:3])}")

        # Notable facts
        if context.notable_facts:
            briefing_parts.append(f"\n**Notes:** {'. '.join(context.notable_facts[:3])}")

        # Communication tip
        if context.their_communication_style and context.their_communication_style != "unknown":
            briefing_parts.append(f"\nThey tend to be {context.their_communication_style}. Adjust accordingly.")

        # Warnings
        if context.has_tension:
            briefing_parts.append(f"\nTension: {context.tension_reason or 'unresolved issues'}")
        elif context.needs_reconnect:
            briefing_parts.append(f"\nConsider reaching out - relationship may be cooling.")

        return "\n".join(briefing_parts)

    # =========================================================================
    # EMAIL INTELLIGENCE - Not summarization. Situation awareness.
    # =========================================================================

    async def analyze_email_with_full_context(
        self,
        user_id: UUID,
        email: dict
    ) -> EmailContext:
        """
        Analyze an email with FULL life context.

        Not "Email from Josh about proposal"
        But: "Josh (your lead investor, tends to be direct, you've been anxious
              about this for 2 weeks) is checking in on the proposal you promised
              by Friday. It's Thursday 4pm. He's been patient but this is his
              second follow-up. You should respond today with either delivery
              or a concrete new timeline. Match his direct style."
        """

        # Extract sender info
        sender_email = email.get("from", "")
        sender_name = self._extract_name_from_email(sender_email)

        # 1. Get full context about sender
        sender_context = await self.get_person_context(user_id, sender_email or sender_name)

        # 2. Find related memories and commitments
        subject = email.get("subject", "")
        snippet = email.get("snippet", email.get("body", ""))[:500]
        related = await self._find_related_context(user_id, f"{subject} {snippet}")

        # 3. Use GPT to synthesize situational awareness
        analysis = await self._synthesize_email_intelligence(
            email, sender_context, related
        )

        return EmailContext(
            email_id=email.get("id", ""),
            sender=sender_context,
            sender_email=sender_email,
            sender_name=sender_name,
            subject=subject,
            snippet=snippet[:200],
            received_at=self._parse_email_date(email.get("date")),
            urgency=UrgencyLevel(analysis.get("urgency", "normal")),
            urgency_reason=analysis.get("urgency_reason", ""),
            thread_id=email.get("thread_id", email.get("threadId", "")),
            thread_length=1,
            thread_summary="",
            key_decisions_in_thread=[],
            unresolved_questions=analysis.get("unresolved_questions", []),
            what_they_want=analysis.get("what_they_want", ""),
            what_you_should_do=analysis.get("recommended_action", ""),
            suggested_response_tone=analysis.get("tone", ""),
            related_memories=related.get("memories", []),
            related_commitments=related.get("commitments", []),
        )

    async def get_inbox_intelligence(
        self,
        user_id: UUID,
        emails: List[dict]
    ) -> dict:
        """
        Not "you have 12 unread emails."

        But: "You have 12 unread. 2 need attention NOW:
              - Josh (investor) followed up on proposal. You promised Friday. It's Thursday.
              - Mom asked about visiting. She sent 2 messages. Might feel ignored.

              3 can wait but track:
              - Sarah wants meeting. Good relationship but cooling - respond within 2 days.

              7 are FYI - I can summarize if you want."
        """
        if not emails:
            return {
                "total": 0,
                "critical": [],
                "high": [],
                "normal": [],
                "fyi": [],
                "briefing": "Your inbox is clear. Nice work.",
                "suggested_actions": []
            }

        # Analyze each email with full context (limit for performance)
        analyzed = []
        for email in emails[:15]:
            try:
                context = await self.analyze_email_with_full_context(user_id, email)
                analyzed.append(context)
            except Exception as e:
                logger.warning(f"Error analyzing email: {e}")
                continue

        # Categorize by urgency
        critical = [e for e in analyzed if e.urgency == UrgencyLevel.CRITICAL]
        high = [e for e in analyzed if e.urgency == UrgencyLevel.HIGH]
        normal = [e for e in analyzed if e.urgency == UrgencyLevel.NORMAL]
        fyi = [e for e in analyzed if e.urgency in [UrgencyLevel.LOW, UrgencyLevel.FYI]]

        # Build intelligence briefing
        briefing = self._build_inbox_briefing(critical, high, normal, fyi, len(emails))

        return {
            "total": len(emails),
            "analyzed": len(analyzed),
            "critical": [self._email_context_to_dict(e) for e in critical],
            "high": [self._email_context_to_dict(e) for e in high],
            "normal": [self._email_context_to_dict(e) for e in normal],
            "fyi": [self._email_context_to_dict(e) for e in fyi],
            "briefing": briefing,
            "suggested_actions": self._suggest_inbox_actions(critical, high)
        }

    # =========================================================================
    # SMART REPLY - Not template. Contextual, style-matched, relationship-aware.
    # =========================================================================

    async def draft_reply(
        self,
        user_id: UUID,
        email: dict,
        intent: str = None  # Optional: "buy time", "confirm", "decline", etc.
    ) -> dict:
        """
        Draft a reply that sounds like YOU, appropriate for THIS relationship.

        Not: Generic professional template
        But: Matches your exact style with this person, accounts for relationship
             state, references relevant history, handles any promises appropriately.
        """

        # 1. Get full email context
        email_context = await self.analyze_email_with_full_context(user_id, email)

        # 2. Get relevant memories to potentially reference
        relevant_context = await self._get_relevant_for_reply(user_id, email_context)

        # 3. Generate contextual reply
        reply = await self._generate_contextual_reply(
            email_context,
            relevant_context,
            intent
        )

        return {
            "draft": reply.get("content", ""),
            "tone_explanation": reply.get("tone_rationale", ""),
            "references_used": reply.get("references", []),
            "warnings": reply.get("warnings", []),
            "alternatives": reply.get("alternatives", [])
        }

    # =========================================================================
    # MEETING INTELLIGENCE - Full prep, not just calendar info
    # =========================================================================

    async def get_meeting_prep(
        self,
        user_id: UUID,
        event: dict
    ) -> MeetingContext:
        """
        Prepare for a meeting with full context.

        Not: "Meeting with Sarah at 3pm"
        But: "Meeting with Sarah (product at Stripe, you met at YC event).
              Last time you met (Jan 5), you discussed partnership.
              You promised to send pricing by Jan 15 - you haven't.
              She mentioned budget approval needed from her CEO.
              She's been responsive but your relationship is cooling (no contact 20 days).

              Suggested talking points:
              - Apologize for delayed pricing (don't over-explain)
              - Ask about CEO approval status
              - Propose concrete next steps

              Avoid:
              - Don't promise another timeline unless certain"
        """

        # Get context for all attendees
        attendees = []
        attendee_list = event.get("attendees", [])

        for attendee in attendee_list:
            email = attendee.get("email", "")
            if email:
                context = await self.get_person_context(user_id, email)
                if context:
                    attendees.append(context)

        # Build meeting prep using LLM
        prep = await self._synthesize_meeting_prep(user_id, event, attendees)

        # Parse start time
        start_time = None
        start_str = event.get("start", event.get("start_time"))
        if start_str:
            try:
                if isinstance(start_str, str):
                    start_time = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                elif isinstance(start_str, datetime):
                    start_time = start_str
            except Exception:
                pass

        return MeetingContext(
            event_id=event.get("id", ""),
            title=event.get("title", event.get("summary", "Meeting")),
            start_time=start_time,
            attendees=attendees,
            your_history_with_attendees=prep.get("history_summary", ""),
            what_you_discussed_last_time=prep.get("last_meeting_summary", ""),
            what_you_promised_last_time=prep.get("your_promises", []),
            what_they_promised_last_time=prep.get("their_promises", []),
            open_topics=prep.get("open_topics", []),
            their_likely_priorities=prep.get("their_priorities", []),
            your_goals_for_this_meeting=prep.get("your_goals", []),
            relationship_alerts=prep.get("alerts", []),
            suggested_talking_points=prep.get("talking_points", []),
            questions_to_ask=prep.get("questions", []),
            things_to_avoid=prep.get("avoid", [])
        )

    # =========================================================================
    # COMMITMENT TRACKING - What did I promise?
    # =========================================================================

    async def get_commitments(
        self,
        user_id: UUID,
        person_name: Optional[str] = None,
        direction: str = "both",  # "i_promised", "they_promised", "both"
        status: str = "pending"   # "pending", "overdue", "all"
    ) -> dict:
        """
        Get all commitments/promises, optionally filtered.
        """

        # Get pending intentions from proactive service
        intentions = await self.proactive_service.get_pending_intentions(user_id, limit=20)

        # Get relationship promises
        entity_id = None
        if person_name:
            entity = await self._find_entity(user_id, person_name)
            if entity:
                entity_id = entity["id"]

        relationship_promises = await self.relationship_service.get_pending_promises(
            user_id, entity_id
        )

        # Combine and format
        commitments = []

        for intent in intentions:
            # Filter by person if specified
            if person_name:
                subject = intent.get("subject", "") or ""
                action = intent.get("action", "") or ""
                if person_name.lower() not in subject.lower() and person_name.lower() not in action.lower():
                    continue

            days_old = 0
            if intent.get("created_at"):
                created = intent["created_at"]
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                days_old = (datetime.now(timezone.utc) - created).days

            commitments.append({
                "type": "intention",
                "action": intent.get("action", ""),
                "subject": intent.get("subject"),
                "days_old": days_old,
                "due_date": intent.get("due_date"),
                "is_overdue": intent.get("due_date") and intent["due_date"] < datetime.now(timezone.utc) if isinstance(intent.get("due_date"), datetime) else False,
            })

        for promise in relationship_promises:
            commitments.append({
                "type": "promise",
                "action": promise.get("description", ""),
                "person": promise.get("person_name"),
                "made_on": promise.get("made_on"),
                "due_date": promise.get("due_date"),
                "is_overdue": promise.get("is_overdue", False),
            })

        # Filter by status
        if status == "overdue":
            commitments = [c for c in commitments if c.get("is_overdue")]
        elif status == "pending":
            commitments = [c for c in commitments if not c.get("is_overdue")]

        return {
            "commitments": commitments,
            "count": len(commitments),
            "overdue_count": len([c for c in commitments if c.get("is_overdue")]),
        }

    # =========================================================================
    # RELATIONSHIP CHECK - Who to reach out to
    # =========================================================================

    async def get_relationship_check(
        self,
        user_id: UUID,
        relationship_type: str = "all",
        days_threshold: int = 14
    ) -> dict:
        """
        Check relationship health and get recommendations.
        """

        neglected = await self.relationship_service.get_neglected_relationships(
            user_id, limit=10
        )

        # Filter by type if specified
        if relationship_type != "all":
            # Would need to filter based on entity type
            pass

        # Filter by days threshold
        neglected = [r for r in neglected if r.get("days_since_contact", 0) >= days_threshold]

        if not neglected:
            return {
                "status": "healthy",
                "message": f"You've been in touch with everyone in the last {days_threshold} days. Nice!",
                "neglected": [],
            }

        return {
            "status": "needs_attention",
            "message": f"Found {len(neglected)} people you haven't contacted in {days_threshold}+ days.",
            "neglected": neglected,
        }

    # =========================================================================
    # DAILY INTELLIGENCE - Morning brief that actually helps
    # =========================================================================

    async def get_daily_intelligence(
        self,
        user_id: UUID
    ) -> dict:
        """
        Morning briefing that's actually actionable.
        """

        # Get pending commitments
        commitments = await self.get_commitments(user_id)
        overdue = [c for c in commitments.get("commitments", []) if c.get("is_overdue")]

        # Get relationship alerts
        relationship_check = await self.get_relationship_check(user_id, days_threshold=14)

        # Get upcoming important dates
        upcoming_dates = await self.relationship_service.get_upcoming_important_dates(
            user_id, days_ahead=7
        )

        # Build priority items
        priority_items = []

        # Overdue commitments are highest priority
        for c in overdue[:3]:
            priority_items.append({
                "type": "overdue_commitment",
                "description": c.get("action"),
                "person": c.get("person") or c.get("subject"),
                "urgency": "critical",
            })

        # Neglected relationships
        for r in relationship_check.get("neglected", [])[:2]:
            priority_items.append({
                "type": "neglected_relationship",
                "description": f"Haven't talked to {r.get('name')} in {r.get('days_since_contact')} days",
                "person": r.get("name"),
                "urgency": "high",
            })

        # Upcoming important dates
        for d in upcoming_dates[:2]:
            if d.get("days_until", 999) <= 3:
                priority_items.append({
                    "type": "important_date",
                    "description": f"{d.get('person_name')}'s {d.get('date_label')} in {d.get('days_until')} days",
                    "person": d.get("person_name"),
                    "urgency": "high" if d.get("days_until", 999) <= 1 else "normal",
                })

        return {
            "priority_items": priority_items,
            "commitments": commitments,
            "relationship_alerts": relationship_check,
            "upcoming_dates": upcoming_dates,
            "summary": self._build_daily_summary(priority_items),
        }

    # =========================================================================
    # HELPER METHODS
    # =========================================================================

    async def _find_entity(self, user_id: UUID, identifier: str) -> Optional[dict]:
        """Find entity by name or email."""
        try:
            result = await self.db.execute(
                select(Entity).where(
                    and_(
                        Entity.user_id == user_id,
                        or_(
                            Entity.name.ilike(f"%{identifier}%"),
                            Entity.email.ilike(f"%{identifier}%"),
                        )
                    )
                ).limit(1)
            )
            entity = result.scalar_one_or_none()

            if entity:
                return {
                    "id": entity.id,
                    "name": entity.name,
                    "email": entity.email,
                    "entity_type": entity.entity_type,
                    "extra_data": entity.extra_data,
                }
            return None
        except Exception as e:
            logger.warning(f"Error finding entity: {e}")
            return None

    async def _get_memories_about_person(
        self,
        user_id: UUID,
        entity_id: UUID
    ) -> List[dict]:
        """Get memories mentioning a person."""
        try:
            # Use text query to join through memory_entities
            result = await self.db.execute(
                text("""
                    SELECT m.id, m.content, m.summary, m.memory_type, m.created_at
                    FROM cortex_memories m
                    JOIN cortex_memory_entities me ON m.id = me.memory_id
                    WHERE m.user_id = :user_id
                    AND me.entity_id = :entity_id
                    ORDER BY m.created_at DESC
                    LIMIT 20
                """),
                {"user_id": str(user_id), "entity_id": str(entity_id)}
            )

            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "summary": row.summary,
                    "memory_type": row.memory_type,
                    "created_at": row.created_at,
                }
                for row in result.fetchall()
            ]
        except Exception as e:
            logger.warning(f"Error getting memories about person: {e}")
            return []

    async def _analyze_relationship_style(
        self,
        entity: dict,
        memories: List[dict]
    ) -> dict:
        """Use GPT to analyze relationship/communication style."""
        if not memories or len(memories) < 2:
            return {"their_style": "unknown", "your_style": "professional"}

        try:
            # Sample recent memories for analysis
            memory_text = "\n".join([
                m.get("summary") or (m.get("content", "")[:200] if m.get("content") else "")
                for m in memories[:5]
            ])

            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """Analyze the communication style based on these memories. Return JSON:
{
    "their_style": "formal" | "casual" | "data-driven" | "emotional" | "brief" | "unknown",
    "your_style": "how user communicates with them based on context"
}
Keep it brief."""
                    },
                    {"role": "user", "content": f"Person: {entity.get('name')}\n\nMemories:\n{memory_text}"}
                ],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=100,
            )

            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Error analyzing relationship style: {e}")
            return {"their_style": "unknown", "your_style": "professional"}

    async def _extract_notable_facts(self, memories: List[dict]) -> List[str]:
        """Extract notable facts from memories using GPT."""
        if not memories:
            return []

        try:
            memory_text = "\n".join([
                m.get("content", "")[:300] for m in memories[:5]
            ])

            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """Extract 2-3 notable facts about this person from the memories.
Return JSON: {"facts": ["fact1", "fact2"]}
Focus on: job, interests, family, important context.
Keep each fact under 15 words."""
                    },
                    {"role": "user", "content": memory_text}
                ],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=150,
            )

            result = json.loads(response.choices[0].message.content)
            return result.get("facts", [])[:3]
        except Exception as e:
            logger.warning(f"Error extracting facts: {e}")
            return []

    def _infer_relationship_type(self, entity: dict, memories: List[dict]) -> RelationshipType:
        """Infer relationship type from entity and memories."""
        entity_type = (entity.get("entity_type") or "").lower()
        name = (entity.get("name") or "").lower()

        # Check entity type
        if "investor" in entity_type or "vc" in entity_type:
            return RelationshipType.INVESTOR
        if "family" in entity_type:
            return RelationshipType.FAMILY
        if entity_type == "colleague" or "coworker" in entity_type:
            return RelationshipType.COLLEAGUE

        # Check name for family indicators
        family_words = ["mom", "dad", "mother", "father", "sister", "brother", "wife", "husband"]
        if any(word in name for word in family_words):
            return RelationshipType.FAMILY

        # Check memories for context
        if memories:
            all_content = " ".join([m.get("content", "").lower() for m in memories[:10]])
            if "investor" in all_content or "funding" in all_content:
                return RelationshipType.INVESTOR
            if "work" in all_content or "office" in all_content or "meeting" in all_content:
                return RelationshipType.COLLEAGUE

        return RelationshipType.PROFESSIONAL

    def _describe_relationship(self, context: PersonContext) -> str:
        """Generate natural language relationship description."""
        type_desc = {
            RelationshipType.INVESTOR: "an investor",
            RelationshipType.FAMILY: "family",
            RelationshipType.CLOSE_FRIEND: "a close friend",
            RelationshipType.COLLEAGUE: "a colleague",
            RelationshipType.PROFESSIONAL: "a professional contact",
            RelationshipType.ACQUAINTANCE: "an acquaintance",
            RelationshipType.UNKNOWN: "someone you know"
        }

        desc = f"Relationship: {type_desc.get(context.relationship_type, 'someone you know')}"

        if context.relationship_trend == "declining":
            desc += " (cooling)"
        elif context.relationship_trend == "healthy":
            desc += " (strong)"

        return desc

    async def _find_related_context(self, user_id: UUID, text: str) -> dict:
        """Find memories and commitments related to text."""
        try:
            # Use search service to find related memories
            memories = await self.search_service.search_fast(
                user_id=user_id,
                query=text,
                limit=3
            )

            memory_summaries = [
                m.summary or m.content[:100] for m in memories
            ]

            # Get related intentions
            intentions = await self.proactive_service.get_pending_intentions(user_id, limit=5)

            # Filter to relevant ones
            text_lower = text.lower()
            related_intentions = [
                i.get("action", "") for i in intentions
                if any(word in text_lower for word in (i.get("action", "").lower().split() + (i.get("subject") or "").lower().split()) if len(word) > 3)
            ]

            return {
                "memories": memory_summaries,
                "commitments": related_intentions[:2],
            }
        except Exception as e:
            logger.warning(f"Error finding related context: {e}")
            return {"memories": [], "commitments": []}

    async def _synthesize_email_intelligence(
        self,
        email: dict,
        sender_context: Optional[PersonContext],
        related: dict
    ) -> dict:
        """Use GPT to synthesize full email intelligence."""

        # Build context for analysis
        sender_info = "Unknown sender"
        if sender_context:
            sender_info = f"""
Sender: {sender_context.name}
Relationship: {sender_context.relationship_type.value}
Days since contact: {sender_context.days_since_contact}
Your promises to them: {sender_context.your_promises_to_them}
Relationship health: {int(sender_context.relationship_score * 100)}/100
"""

        prompt = f"""Analyze this email and determine urgency and recommended action.

EMAIL:
From: {email.get('from')}
Subject: {email.get('subject')}
Content: {email.get('snippet', email.get('body', ''))[:500]}

{sender_info}

Related context from memory: {related.get('memories', [])}
Open commitments related: {related.get('commitments', [])}

Return JSON:
{{
    "urgency": "critical" | "high" | "normal" | "low" | "fyi",
    "urgency_reason": "brief reason for urgency level",
    "what_they_want": "what they're asking for",
    "recommended_action": "what user should do",
    "tone": "suggested response tone",
    "unresolved_questions": ["any open questions in the thread"]
}}"""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=300,
            )

            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Error synthesizing email intelligence: {e}")
            return {
                "urgency": "normal",
                "urgency_reason": "",
                "what_they_want": "",
                "recommended_action": "",
                "tone": "professional",
                "unresolved_questions": [],
            }

    async def _generate_contextual_reply(
        self,
        email_context: EmailContext,
        relevant_context: dict,
        intent: str
    ) -> dict:
        """Generate reply using full context."""

        sender_info = ""
        if email_context.sender:
            sender_info = f"""
SENDER CONTEXT:
- Relationship: {email_context.sender.relationship_type.value}
- Health: {int(email_context.sender.relationship_score * 100)}/100 ({email_context.sender.relationship_trend})
- Days since contact: {email_context.sender.days_since_contact}
- You owe them: {email_context.sender.your_promises_to_them}
- Communication style: {email_context.sender.their_communication_style}
"""

        system_prompt = f"""You are drafting an email reply for the user.

{sender_info}

WHAT THEY WANT: {email_context.what_they_want}
USER'S INTENT FOR REPLY: {intent or 'respond appropriately'}

Generate a reply that:
1. Matches how the user would write to this person
2. Addresses what they're asking for
3. Handles any promises appropriately
4. Maintains the relationship
5. Is concise but complete

Return JSON:
{{
    "content": "the email body (no greeting line, just body)",
    "tone_rationale": "why this tone",
    "references": ["context referenced"],
    "warnings": ["any concerns"],
    "alternatives": ["1 alternative approach"]
}}"""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Email to reply to:\n\nFrom: {email_context.sender_name or email_context.sender_email}\nSubject: {email_context.subject}\n\n{email_context.snippet}"}
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=500,
            )

            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.warning(f"Error generating reply: {e}")
            return {
                "content": "",
                "tone_rationale": "",
                "references": [],
                "warnings": [f"Error: {str(e)}"],
                "alternatives": [],
            }

    async def _get_relevant_for_reply(
        self,
        user_id: UUID,
        email_context: EmailContext
    ) -> dict:
        """Get context relevant for drafting reply."""
        return await self._find_related_context(
            user_id,
            f"{email_context.subject} {email_context.snippet}"
        )

    async def _synthesize_meeting_prep(
        self,
        user_id: UUID,
        event: dict,
        attendees: List[PersonContext]
    ) -> dict:
        """Synthesize comprehensive meeting prep."""

        # Build attendee context
        attendee_context = []
        alerts = []
        all_promises = []

        for a in attendees:
            attendee_context.append(f"- {a.name}: {a.relationship_type.value}, health {int(a.relationship_score*100)}/100")

            if a.days_since_contact > 30:
                alerts.append(f"Haven't talked to {a.name} in {a.days_since_contact} days")

            if a.your_promises_to_them:
                all_promises.extend([f"To {a.name}: {p}" for p in a.your_promises_to_them])

            if a.has_tension:
                alerts.append(f"Tension with {a.name}: {a.tension_reason or 'unresolved issues'}")

        # Use GPT to generate talking points
        try:
            prompt = f"""Generate meeting prep for this meeting.

Meeting: {event.get('title', event.get('summary', 'Meeting'))}
Attendees:
{chr(10).join(attendee_context)}

Open promises: {all_promises}
Alerts: {alerts}

Return JSON:
{{
    "history_summary": "brief history with these people",
    "last_meeting_summary": "what was discussed last (if known)",
    "your_promises": ["promises to fulfill"],
    "their_promises": ["what they owe you"],
    "talking_points": ["3-5 suggested talking points"],
    "questions": ["2-3 questions to ask"],
    "avoid": ["things to avoid mentioning"],
    "alerts": ["relationship alerts"],
    "your_goals": ["suggested goals for this meeting"]
}}"""

            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=500,
            )

            result = json.loads(response.choices[0].message.content)
            result["alerts"] = alerts + result.get("alerts", [])
            return result

        except Exception as e:
            logger.warning(f"Error synthesizing meeting prep: {e}")
            return {
                "history_summary": "",
                "last_meeting_summary": "",
                "your_promises": all_promises,
                "their_promises": [],
                "talking_points": [],
                "questions": [],
                "avoid": [],
                "alerts": alerts,
                "your_goals": [],
            }

    def _build_inbox_briefing(
        self,
        critical: List[EmailContext],
        high: List[EmailContext],
        normal: List[EmailContext],
        fyi: List[EmailContext],
        total: int
    ) -> str:
        """Build natural language inbox briefing."""
        parts = []

        parts.append(f"You have {total} emails to review.")

        if critical:
            parts.append(f"\n**{len(critical)} need immediate attention:**")
            for email in critical[:3]:
                name = email.sender.name if email.sender else email.sender_name or "Someone"
                parts.append(f"- {name}: {email.urgency_reason or email.what_they_want}")

        if high:
            parts.append(f"\n**{len(high)} are important today:**")
            for email in high[:3]:
                name = email.sender.name if email.sender else email.sender_name or "Someone"
                parts.append(f"- {name}: {email.what_they_want or email.subject}")

        if normal:
            parts.append(f"\n{len(normal)} can wait but track them.")

        if fyi:
            parts.append(f"\n{len(fyi)} are FYI only.")

        return "\n".join(parts)

    def _suggest_inbox_actions(
        self,
        critical: List[EmailContext],
        high: List[EmailContext]
    ) -> List[dict]:
        """Generate suggested actions for important emails."""
        actions = []

        for email in critical[:2]:
            name = email.sender.name if email.sender else email.sender_name or "this email"
            actions.append({
                "action": f"Reply to {name}",
                "reason": email.urgency_reason,
                "suggested_approach": email.suggested_response_tone,
                "email_id": email.email_id,
            })

        return actions

    def _email_context_to_dict(self, ctx: EmailContext) -> dict:
        """Convert EmailContext to dict for JSON serialization."""
        return {
            "email_id": ctx.email_id,
            "sender_name": ctx.sender.name if ctx.sender else ctx.sender_name,
            "sender_email": ctx.sender_email,
            "subject": ctx.subject,
            "snippet": ctx.snippet,
            "urgency": ctx.urgency.value,
            "urgency_reason": ctx.urgency_reason,
            "what_they_want": ctx.what_they_want,
            "recommended_action": ctx.what_you_should_do,
            "suggested_tone": ctx.suggested_response_tone,
        }

    def _build_daily_summary(self, priority_items: List[dict]) -> str:
        """Build daily summary text."""
        if not priority_items:
            return "Nothing urgent today. Good time to be proactive."

        critical = [i for i in priority_items if i.get("urgency") == "critical"]
        high = [i for i in priority_items if i.get("urgency") == "high"]

        parts = []

        if critical:
            parts.append(f"{len(critical)} critical items need attention now.")
        if high:
            parts.append(f"{len(high)} important items for today.")

        return " ".join(parts) if parts else "A few items to track today."

    def _extract_name_from_email(self, email_str: str) -> str:
        """Extract name from email string like 'John Doe <john@example.com>'."""
        if not email_str:
            return ""

        if "<" in email_str:
            return email_str.split("<")[0].strip().strip('"')

        if "@" in email_str:
            return email_str.split("@")[0]

        return email_str

    def _parse_email_date(self, date_val) -> Optional[datetime]:
        """Parse email date from various formats."""
        if not date_val:
            return None

        if isinstance(date_val, datetime):
            return date_val

        if isinstance(date_val, str):
            try:
                return datetime.fromisoformat(date_val.replace("Z", "+00:00"))
            except Exception:
                pass

        return None


# Convenience function
def get_contextual_intelligence_engine(db: AsyncSession) -> ContextualIntelligenceEngine:
    return ContextualIntelligenceEngine(db)
