"""Adaptive Learning Service - Core logic for memory reinforcement, decay, and user learning."""

import logging
from datetime import datetime, timedelta
from uuid import UUID
from typing import Optional
import json

from sqlalchemy import select, update, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.models import Memory, UserFeedback, UserPreferences, MemoryAccessLog, Insight, MemoryConnection
from app.config import settings

logger = logging.getLogger(__name__)


class AdaptiveLearningService:
    """Service for adaptive learning - memory strength, decay, reinforcement, and user preference learning."""

    # Decay and reinforcement constants
    DECAY_RATE = 0.995  # Daily decay multiplier (0.5% decay per day)
    MIN_STRENGTH = 0.1  # Minimum strength before memory becomes very weak
    REINFORCEMENT_BOOST = 0.05  # Strength boost when memory is accessed
    POSITIVE_FEEDBACK_BOOST = 0.1  # Boost when user gives positive feedback
    NEGATIVE_FEEDBACK_PENALTY = 0.05  # Penalty when user gives negative feedback
    EMOTIONAL_MEMORY_DECAY_REDUCTION = 0.5  # Emotional memories decay slower

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    # ==================== MEMORY ACCESS TRACKING ====================

    async def log_memory_access(
        self,
        user_id: UUID,
        memory_id: UUID,
        access_type: str,
        query_text: Optional[str] = None,
        relevance_score: Optional[float] = None,
    ) -> MemoryAccessLog:
        """Log a memory access and update memory strength."""
        # Create access log
        access_log = MemoryAccessLog(
            user_id=user_id,
            memory_id=memory_id,
            access_type=access_type,
            query_text=query_text,
            relevance_score=relevance_score,
        )
        self.db.add(access_log)

        # Update memory: increment access_count, update last_accessed, boost strength
        await self.db.execute(
            update(Memory)
            .where(Memory.id == memory_id)
            .values(
                access_count=Memory.access_count + 1,
                last_accessed=datetime.utcnow(),
                strength=func.least(Memory.strength + self.REINFORCEMENT_BOOST, 1.0),
            )
        )

        await self.db.commit()
        return access_log

    async def log_multiple_memory_accesses(
        self,
        user_id: UUID,
        memory_ids: list[UUID],
        access_type: str,
        query_text: Optional[str] = None,
    ) -> None:
        """Log multiple memory accesses (e.g., from search results)."""
        for memory_id in memory_ids:
            await self.log_memory_access(
                user_id=user_id,
                memory_id=memory_id,
                access_type=access_type,
                query_text=query_text,
            )

    # ==================== FEEDBACK PROCESSING ====================

    async def record_feedback(
        self,
        user_id: UUID,
        feedback_type: str,  # 'positive', 'negative', 'correction'
        feedback_context: str,  # 'response', 'suggestion', 'memory_retrieval'
        conversation_id: Optional[str] = None,
        message_id: Optional[str] = None,
        user_query: Optional[str] = None,
        ai_response: Optional[str] = None,
        correction_text: Optional[str] = None,
        memories_used: Optional[list[str]] = None,
    ) -> UserFeedback:
        """Record user feedback and apply reinforcement/penalty to related memories."""
        feedback = UserFeedback(
            user_id=user_id,
            feedback_type=feedback_type,
            feedback_context=feedback_context,
            conversation_id=conversation_id,
            message_id=message_id,
            user_query=user_query,
            ai_response=ai_response,
            correction_text=correction_text,
            memories_used=memories_used or [],
        )
        self.db.add(feedback)

        # Apply reinforcement/penalty to memories used
        if memories_used:
            memory_uuids = [UUID(m) for m in memories_used]
            if feedback_type == 'positive':
                # Boost strength of memories that led to good response
                await self.db.execute(
                    update(Memory)
                    .where(Memory.id.in_(memory_uuids))
                    .values(strength=func.least(Memory.strength + self.POSITIVE_FEEDBACK_BOOST, 1.0))
                )
            elif feedback_type == 'negative':
                # Slightly reduce strength of memories that led to bad response
                await self.db.execute(
                    update(Memory)
                    .where(Memory.id.in_(memory_uuids))
                    .values(strength=func.greatest(Memory.strength - self.NEGATIVE_FEEDBACK_PENALTY, self.MIN_STRENGTH))
                )

        await self.db.commit()

        # Learn from this feedback
        await self._learn_from_feedback(feedback)

        return feedback

    async def _learn_from_feedback(self, feedback: UserFeedback) -> None:
        """Extract learnings from feedback to update user preferences."""
        if not feedback.user_query or not feedback.ai_response:
            return

        # Use LLM to extract preference signals
        try:
            prompt = f"""Analyze this user interaction and extract any preferences or patterns.

User Query: {feedback.user_query}
AI Response: {feedback.ai_response}
User Feedback: {feedback.feedback_type}
{f"User Correction: {feedback.correction_text}" if feedback.correction_text else ""}

Extract preferences in JSON format:
{{
    "communication_style": "preference about how to communicate (or null)",
    "topic_interest": "topic they're interested in (or null)",
    "behavior_pattern": "any behavioral pattern noticed (or null)",
    "correction_learning": "what to do differently next time (or null)"
}}

Only include non-null values for clear signals. Be conservative."""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=200,
            )

            preferences = json.loads(response.choices[0].message.content)

            # Store learned preferences
            for pref_type, value in preferences.items():
                if value:
                    await self._update_preference(
                        user_id=feedback.user_id,
                        preference_type=pref_type,
                        preference_key=str(value)[:100],  # Truncate key
                        preference_value={"value": value, "source": "feedback"},
                    )

        except Exception as e:
            logger.error(f"Error learning from feedback: {e}")

    # ==================== USER PREFERENCES ====================

    async def _update_preference(
        self,
        user_id: UUID,
        preference_type: str,
        preference_key: str,
        preference_value: dict,
    ) -> None:
        """Update or create a user preference with confidence adjustment."""
        # Check if preference exists
        result = await self.db.execute(
            select(UserPreferences).where(
                and_(
                    UserPreferences.user_id == user_id,
                    UserPreferences.preference_type == preference_type,
                    UserPreferences.preference_key == preference_key,
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Increase confidence and evidence count
            existing.confidence = min(existing.confidence + 0.1, 1.0)
            existing.evidence_count += 1
            existing.last_observed = datetime.utcnow()
            existing.preference_value = preference_value
        else:
            # Create new preference
            pref = UserPreferences(
                user_id=user_id,
                preference_type=preference_type,
                preference_key=preference_key,
                preference_value=preference_value,
                confidence=0.5,
                evidence_count=1,
            )
            self.db.add(pref)

        await self.db.commit()

    async def get_user_preferences(self, user_id: UUID) -> dict:
        """Get all user preferences organized by type."""
        result = await self.db.execute(
            select(UserPreferences)
            .where(UserPreferences.user_id == user_id)
            .where(UserPreferences.confidence >= 0.5)  # Only confident preferences
            .order_by(UserPreferences.confidence.desc())
        )
        preferences = result.scalars().all()

        # Organize by type
        organized = {}
        for pref in preferences:
            if pref.preference_type not in organized:
                organized[pref.preference_type] = []
            organized[pref.preference_type].append({
                "key": pref.preference_key,
                "value": pref.preference_value,
                "confidence": pref.confidence,
            })

        return organized

    async def get_user_model_prompt(self, user_id: UUID) -> str:
        """Generate a dynamic system prompt section based on learned preferences."""
        preferences = await self.get_user_preferences(user_id)

        if not preferences:
            return ""

        prompt_parts = ["Based on what I've learned about you:"]

        if "communication_style" in preferences:
            styles = [p["key"] for p in preferences["communication_style"][:3]]
            prompt_parts.append(f"- You prefer {', '.join(styles)} communication")

        if "topic_interest" in preferences:
            topics = [p["key"] for p in preferences["topic_interest"][:5]]
            prompt_parts.append(f"- You're interested in: {', '.join(topics)}")

        if "behavior_pattern" in preferences:
            patterns = [p["key"] for p in preferences["behavior_pattern"][:3]]
            prompt_parts.append(f"- Patterns: {', '.join(patterns)}")

        if "correction_learning" in preferences:
            learnings = [p["key"] for p in preferences["correction_learning"][:3]]
            prompt_parts.append(f"- Remember: {', '.join(learnings)}")

        return "\n".join(prompt_parts)

    # ==================== MEMORY DECAY ====================

    async def apply_memory_decay(self, user_id: Optional[UUID] = None) -> int:
        """Apply decay to memory strength. Run daily via scheduler."""
        # Calculate days since last access for each memory
        now = datetime.utcnow()

        # Build query
        query = select(Memory).where(Memory.strength > self.MIN_STRENGTH)
        if user_id:
            query = query.where(Memory.user_id == user_id)

        result = await self.db.execute(query)
        memories = result.scalars().all()

        updated_count = 0
        for memory in memories:
            # Calculate decay based on days since last access
            last_access = memory.last_accessed or memory.created_at
            days_since_access = (now - last_access).days

            if days_since_access > 0:
                # Apply decay
                decay_factor = self.DECAY_RATE ** days_since_access

                # Emotional memories decay slower
                if memory.emotional_weight > 0.7:
                    decay_factor = decay_factor ** self.EMOTIONAL_MEMORY_DECAY_REDUCTION

                new_strength = max(memory.strength * decay_factor, self.MIN_STRENGTH)

                if new_strength != memory.strength:
                    memory.strength = new_strength
                    updated_count += 1

        await self.db.commit()
        logger.info(f"Applied decay to {updated_count} memories")
        return updated_count

    # ==================== CONNECTION REINFORCEMENT ====================

    async def reinforce_connection(self, connection_id: UUID) -> None:
        """Reinforce a memory connection when it's found useful."""
        await self.db.execute(
            update(MemoryConnection)
            .where(MemoryConnection.id == connection_id)
            .values(
                strength=func.least(MemoryConnection.strength + 0.1, 1.0),
                reinforcement_count=MemoryConnection.reinforcement_count + 1,
                last_reinforced=datetime.utcnow(),
            )
        )
        await self.db.commit()

    # ==================== PATTERN EXTRACTION ====================

    async def extract_patterns(self, user_id: UUID, days: int = 30) -> list[Insight]:
        """Extract patterns from recent memories and create insights."""
        # Get recent memories
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.created_at >= cutoff)
            .where(Memory.strength >= 0.5)  # Only strong memories
            .order_by(Memory.created_at.desc())
            .limit(50)
        )
        memories = result.scalars().all()

        if len(memories) < 5:
            return []

        # Prepare memory summaries for analysis
        memory_texts = [
            f"[{m.memory_date.strftime('%Y-%m-%d')}] {m.summary or m.content[:200]}"
            for m in memories
        ]

        try:
            prompt = f"""Analyze these memories and identify patterns, recurring themes, or insights.

Memories:
{chr(10).join(memory_texts)}

Identify up to 3 meaningful patterns or insights. For each, provide:
- A short title
- A description of the pattern
- Confidence (0-1) based on how strong the evidence is

Return as JSON:
{{
    "insights": [
        {{"title": "...", "content": "...", "confidence": 0.X, "type": "pattern|trend|summary"}}
    ]
}}

Only include genuinely interesting patterns. Be selective."""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=500,
            )

            data = json.loads(response.choices[0].message.content)
            insights = []

            for insight_data in data.get("insights", []):
                insight = Insight(
                    user_id=user_id,
                    insight_type=insight_data.get("type", "pattern"),
                    title=insight_data["title"],
                    content=insight_data["content"],
                    confidence=insight_data.get("confidence", 0.5),
                    source_memory_ids=[str(m.id) for m in memories[:10]],
                    relevance_period_start=(datetime.utcnow() - timedelta(days=days)).date(),
                    relevance_period_end=datetime.utcnow().date(),
                )
                self.db.add(insight)
                insights.append(insight)

            await self.db.commit()
            logger.info(f"Extracted {len(insights)} insights for user {user_id}")
            return insights

        except Exception as e:
            logger.error(f"Error extracting patterns: {e}")
            return []

    # ==================== EMOTIONAL WEIGHT DETECTION ====================

    async def analyze_emotional_weight(self, memory: Memory) -> float:
        """Analyze a memory's content to determine its emotional weight."""
        try:
            prompt = f"""Rate the emotional significance of this memory on a scale of 0.0 to 1.0.

Memory: {memory.content[:500]}

Consider:
- Personal importance (relationships, milestones, decisions)
- Emotional intensity (joy, fear, excitement, sadness)
- Life impact (career, health, family)

Return only a number between 0.0 and 1.0."""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=10,
            )

            weight = float(response.choices[0].message.content.strip())
            return max(0.0, min(1.0, weight))

        except Exception as e:
            logger.error(f"Error analyzing emotional weight: {e}")
            return 0.5  # Default neutral weight

    async def update_memory_emotional_weight(self, memory_id: UUID) -> float:
        """Update a memory's emotional weight based on content analysis."""
        result = await self.db.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        memory = result.scalar_one_or_none()

        if not memory:
            return 0.5

        weight = await self.analyze_emotional_weight(memory)
        memory.emotional_weight = weight
        await self.db.commit()

        return weight

    # ==================== SCHEDULE PREFERENCE LEARNING ====================

    async def learn_schedule_preferences(self, user_id: UUID, days: int = 30) -> dict:
        """
        Learn user's schedule preferences from calendar patterns.

        Analyzes:
        - When they typically schedule meetings
        - Preferred meeting durations
        - Preferred break patterns
        - Focus time patterns
        """
        from app.services.sync_service import SyncService
        sync_service = SyncService(self.db)

        # Get calendar events from the past N days
        start_date = datetime.utcnow() - timedelta(days=days)
        end_date = datetime.utcnow()

        events_result = await sync_service.get_calendar_events(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        events = events_result.get("events", [])

        if len(events) < 10:
            return {
                "success": False,
                "message": "Not enough calendar data to learn preferences",
            }

        # Analyze patterns
        patterns = self._analyze_calendar_patterns(events)

        # Store preferences
        await self.learn_preference(
            user_id=user_id,
            preference_type="schedule_patterns",
            preference_value=json.dumps(patterns),
            confidence=min(0.9, 0.5 + (len(events) / 100)),
            evidence=f"Analyzed {len(events)} calendar events",
        )

        return {
            "success": True,
            "patterns": patterns,
            "events_analyzed": len(events),
        }

    def _analyze_calendar_patterns(self, events: list) -> dict:
        """Analyze calendar events to extract scheduling patterns."""
        patterns = {
            "preferred_meeting_hours": [],
            "preferred_focus_hours": [],
            "typical_meeting_duration_mins": 60,
            "prefers_morning_meetings": False,
            "prefers_afternoon_meetings": False,
            "avg_meetings_per_day": 0,
            "busiest_day_of_week": None,
            "common_meeting_types": [],
        }

        if not events:
            return patterns

        # Track meeting hours
        meeting_hours = []
        durations = []
        day_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}  # Mon-Sun

        for event in events:
            try:
                start_str = event.get("start_time", "")
                end_str = event.get("end_time", "")

                if isinstance(start_str, str):
                    start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                    end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                else:
                    start = start_str
                    end = end_str

                # Track hour
                meeting_hours.append(start.hour)

                # Track duration
                duration_mins = (end - start).total_seconds() / 60
                durations.append(duration_mins)

                # Track day of week
                day_counts[start.weekday()] += 1

            except Exception:
                continue

        if meeting_hours:
            # Calculate preferred meeting times
            morning_count = sum(1 for h in meeting_hours if 8 <= h < 12)
            afternoon_count = sum(1 for h in meeting_hours if 12 <= h < 17)

            patterns["prefers_morning_meetings"] = morning_count > afternoon_count
            patterns["prefers_afternoon_meetings"] = afternoon_count > morning_count

            # Find most common hours
            from collections import Counter
            hour_counts = Counter(meeting_hours)
            patterns["preferred_meeting_hours"] = [h for h, _ in hour_counts.most_common(3)]

            # Infer focus hours (times with fewer meetings)
            all_hours = set(range(8, 18))
            busy_hours = set(patterns["preferred_meeting_hours"])
            patterns["preferred_focus_hours"] = list(all_hours - busy_hours)[:3]

        if durations:
            # Average meeting duration
            patterns["typical_meeting_duration_mins"] = int(sum(durations) / len(durations))

        # Busiest day
        if any(day_counts.values()):
            busiest_day_num = max(day_counts, key=day_counts.get)
            day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            patterns["busiest_day_of_week"] = day_names[busiest_day_num]

        # Average meetings per day
        unique_days = len(set(event.get("start_time", "")[:10] for event in events if event.get("start_time")))
        if unique_days > 0:
            patterns["avg_meetings_per_day"] = round(len(events) / unique_days, 1)

        return patterns

    async def learn_preference(
        self,
        user_id: UUID,
        preference_type: str,
        preference_value: str,
        confidence: float,
        evidence: str,
    ) -> None:
        """Store a learned preference."""
        from app.models.adaptive import UserPreferences as UserPreference

        try:
            # Check if preference exists
            result = await self.db.execute(
                select(UserPreference).where(
                    and_(
                        UserPreference.user_id == user_id,
                        UserPreference.preference_type == preference_type,
                    )
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.preference_value = preference_value
                existing.confidence = confidence
                existing.evidence = evidence
                existing.updated_at = datetime.utcnow()
            else:
                pref = UserPreference(
                    user_id=user_id,
                    preference_type=preference_type,
                    preference_value=preference_value,
                    confidence=confidence,
                    evidence=evidence,
                )
                self.db.add(pref)

            await self.db.commit()

        except Exception as e:
            logger.error(f"Error storing preference: {e}")

    async def get_schedule_preferences(self, user_id: UUID) -> dict:
        """Get learned schedule preferences."""
        from app.models.adaptive import UserPreferences as UserPreference

        try:
            result = await self.db.execute(
                select(UserPreference).where(
                    and_(
                        UserPreference.user_id == user_id,
                        UserPreference.preference_type == "schedule_patterns",
                    )
                )
            )
            pref = result.scalar_one_or_none()

            if pref:
                return json.loads(pref.preference_value)

            # If no stored preferences, try to learn them
            learn_result = await self.learn_schedule_preferences(user_id)
            return learn_result.get("patterns", {})

        except Exception as e:
            logger.error(f"Error getting schedule preferences: {e}")
            return {}

    # ==================== STATISTICS ====================

    async def get_learning_stats(self, user_id: UUID) -> dict:
        """Get statistics about the adaptive learning system for a user."""
        # Memory stats
        memory_result = await self.db.execute(
            select(
                func.count(Memory.id),
                func.avg(Memory.strength),
                func.avg(Memory.emotional_weight),
                func.sum(Memory.access_count),
            )
            .where(Memory.user_id == user_id)
        )
        memory_stats = memory_result.one()

        # Feedback stats
        feedback_result = await self.db.execute(
            select(
                func.count(UserFeedback.id),
                func.count(UserFeedback.id).filter(UserFeedback.feedback_type == 'positive'),
                func.count(UserFeedback.id).filter(UserFeedback.feedback_type == 'negative'),
            )
            .where(UserFeedback.user_id == user_id)
        )
        feedback_stats = feedback_result.one()

        # Preference stats
        pref_result = await self.db.execute(
            select(func.count(UserPreferences.id))
            .where(UserPreferences.user_id == user_id)
        )
        pref_count = pref_result.scalar()

        # Insight stats
        insight_result = await self.db.execute(
            select(func.count(Insight.id))
            .where(Insight.user_id == user_id)
        )
        insight_count = insight_result.scalar()

        return {
            "memories": {
                "total": memory_stats[0] or 0,
                "average_strength": round(memory_stats[1] or 0, 3),
                "average_emotional_weight": round(memory_stats[2] or 0, 3),
                "total_accesses": memory_stats[3] or 0,
            },
            "feedback": {
                "total": feedback_stats[0] or 0,
                "positive": feedback_stats[1] or 0,
                "negative": feedback_stats[2] or 0,
            },
            "preferences_learned": pref_count or 0,
            "insights_generated": insight_count or 0,
        }
