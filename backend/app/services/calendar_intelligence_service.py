"""
Calendar Intelligence Service

Provides Iris-like intelligent calendar management:
- Intelligent rescheduling ("reorganize my day to give me a slow start")
- Conflict detection and resolution
- Deep work time blocking
- Schedule preference learning

Uses memories to understand user preferences and LLM for intelligent decisions.
"""

import json
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

import logging

from app.config import get_settings
from app.models.memory import Memory
from app.models.integration import ConnectedAccount
from app.services.sync_service import SyncService
from app.services.search_service import SearchService

logger = logging.getLogger(__name__)

settings = get_settings()


class CalendarIntelligenceService:
    """
    Intelligent calendar management service.

    Analyzes user's schedule, preferences (from memories), and uses LLM
    to make smart scheduling decisions like Iris.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.search_service = SearchService(db)
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    # ==================== INTELLIGENT RESCHEDULING ====================

    async def analyze_and_reorganize_schedule(
        self,
        user_id: UUID,
        date: datetime,
        instruction: str,
        preferences: Optional[dict] = None,
    ) -> dict:
        """
        Intelligently reorganize a day's schedule based on user instruction.

        This is the core Iris feature - "reorganize my day to give me a slow start"

        Args:
            user_id: User's ID
            date: The date to reorganize
            instruction: Natural language instruction (e.g., "slow morning", "meetings in afternoon")
            preferences: Optional override preferences

        Returns:
            Dict with proposed_changes, reasoning, and confirmation needed
        """
        # 1. Get all events for the day
        start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        events_result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=start_of_day,
            end_date=end_of_day,
        )

        if not events_result["success"]:
            return {
                "success": False,
                "message": events_result.get("message", "Failed to fetch calendar"),
                "proposed_changes": [],
            }

        events = events_result.get("events", [])

        if not events:
            return {
                "success": True,
                "message": "No events to reorganize - your day is clear!",
                "proposed_changes": [],
            }

        # 2. Get user's schedule preferences from memories
        schedule_prefs = await self._get_schedule_preferences(user_id)

        # 3. Use LLM to propose reorganization
        proposed_changes = await self._llm_reorganize_schedule(
            events=events,
            instruction=instruction,
            preferences={**schedule_prefs, **(preferences or {})},
            date=date,
        )

        return proposed_changes

    async def _get_schedule_preferences(self, user_id: UUID) -> dict:
        """
        Extract schedule preferences from user's memories and past behavior.

        Looks for patterns like:
        - "prefers meetings in the afternoon"
        - "likes mornings for deep work"
        - "always blocks lunch at noon"
        """
        # Search memories for scheduling-related content
        try:
            memories = await self.search_service.search(
                user_id=str(user_id),
                query="meeting preferences schedule morning afternoon focus time",
                limit=10,
            )

            # Also check user preferences table
            from app.models.adaptive import UserPreferences as UserPreference
            result = await self.db.execute(
                select(UserPreference).where(
                    and_(
                        UserPreference.user_id == user_id,
                        UserPreference.preference_type.in_([
                            "schedule_patterns",
                            "meeting_preferences",
                            "focus_time",
                        ])
                    )
                )
            )
            stored_prefs = result.scalars().all()

            # Build preferences dict
            preferences = {
                "preferred_meeting_times": None,  # e.g., "afternoon"
                "preferred_focus_times": None,    # e.g., "morning"
                "lunch_block": "12:00-13:00",     # Default
                "minimum_break_minutes": 15,
                "avoid_back_to_back": True,
            }

            # Extract from stored preferences
            for pref in stored_prefs:
                if pref.preference_type == "schedule_patterns":
                    data = json.loads(pref.preference_value) if isinstance(pref.preference_value, str) else pref.preference_value
                    preferences.update(data)
                elif pref.preference_type == "meeting_preferences":
                    data = json.loads(pref.preference_value) if isinstance(pref.preference_value, str) else pref.preference_value
                    preferences["preferred_meeting_times"] = data.get("preferred_times")
                elif pref.preference_type == "focus_time":
                    data = json.loads(pref.preference_value) if isinstance(pref.preference_value, str) else pref.preference_value
                    preferences["preferred_focus_times"] = data.get("preferred_times")

            # Analyze memories for patterns if no stored preferences
            if memories and not preferences["preferred_meeting_times"]:
                memory_context = "\n".join([m.content for m in memories[:5]])
                # Could use LLM to extract preferences from memories
                # For now, use sensible defaults

            return preferences

        except Exception as e:
            logger.error(f"Error getting schedule preferences: {e}")
            return {
                "preferred_meeting_times": "afternoon",
                "preferred_focus_times": "morning",
                "lunch_block": "12:00-13:00",
                "minimum_break_minutes": 15,
                "avoid_back_to_back": True,
            }

    async def _llm_reorganize_schedule(
        self,
        events: list,
        instruction: str,
        preferences: dict,
        date: datetime,
    ) -> dict:
        """
        Use LLM to intelligently reorganize the schedule.
        """
        # Format events for LLM
        events_text = self._format_events_for_llm(events)
        date_str = date.strftime("%A, %B %d, %Y")

        system_prompt = """You are a smart calendar assistant. Your job is to reorganize a user's schedule based on their instruction and preferences.

IMPORTANT RULES:
1. Only move events that CAN be moved (meetings with others should be flagged for notification)
2. Respect fixed events (deadlines, external meetings)
3. Maintain event durations - don't shorten meetings
4. Avoid conflicts - no overlapping events
5. Consider travel time between locations
6. Respect the user's preferences for meeting times, focus time, and breaks

Return your response as JSON with this structure:
{
    "proposed_changes": [
        {
            "event_id": "original_event_id",
            "event_title": "Event Title",
            "original_start": "2024-01-23T09:00:00",
            "original_end": "2024-01-23T10:00:00",
            "new_start": "2024-01-23T14:00:00",
            "new_end": "2024-01-23T15:00:00",
            "reason": "Moving to afternoon per your preference",
            "has_attendees": true,
            "attendees_to_notify": ["email1@example.com"]
        }
    ],
    "unchanged_events": [
        {
            "event_id": "id",
            "event_title": "Title",
            "reason": "Fixed deadline, cannot move"
        }
    ],
    "reasoning": "I reorganized your day to give you a slow start. Morning meetings moved to afternoon, freeing up 9-12 for focused work.",
    "conflicts_resolved": 0,
    "notifications_needed": 2
}"""

        user_prompt = f"""Reorganize this schedule for {date_str}:

USER'S INSTRUCTION: "{instruction}"

USER'S PREFERENCES:
- Preferred meeting times: {preferences.get('preferred_meeting_times', 'flexible')}
- Preferred focus times: {preferences.get('preferred_focus_times', 'morning')}
- Lunch block: {preferences.get('lunch_block', '12:00-13:00')}
- Minimum break between meetings: {preferences.get('minimum_break_minutes', 15)} minutes
- Avoid back-to-back meetings: {preferences.get('avoid_back_to_back', True)}

CURRENT SCHEDULE:
{events_text}

Analyze the schedule and propose changes that satisfy the user's instruction while respecting their preferences. Be smart about which events can be moved."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2000,
            )

            result = json.loads(response.choices[0].message.content)
            result["success"] = True
            return result

        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to analyze schedule: {str(e)}",
                "proposed_changes": [],
            }

    def _format_events_for_llm(self, events: list) -> str:
        """Format events list into readable text for LLM."""
        if not events:
            return "No events scheduled."

        lines = []
        for event in events:
            start = event.get("start_time", "")
            end = event.get("end_time", "")
            title = event.get("title", "Untitled")
            event_id = event.get("id", "")
            attendees = event.get("attendees", [])
            location = event.get("location", "")

            # Format time
            if isinstance(start, str):
                try:
                    start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    start_str = start_dt.strftime("%I:%M %p")
                except Exception:
                    start_str = start
            else:
                start_str = start.strftime("%I:%M %p") if hasattr(start, 'strftime') else str(start)

            if isinstance(end, str):
                try:
                    end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                    end_str = end_dt.strftime("%I:%M %p")
                except Exception:
                    end_str = end
            else:
                end_str = end.strftime("%I:%M %p") if hasattr(end, 'strftime') else str(end)

            attendee_count = len(attendees) if attendees else 0
            attendee_str = f" ({attendee_count} attendees)" if attendee_count > 0 else ""
            location_str = f" @ {location}" if location else ""

            lines.append(f"- [{event_id}] {start_str} - {end_str}: {title}{attendee_str}{location_str}")

        return "\n".join(lines)

    async def execute_reschedule(
        self,
        user_id: UUID,
        changes: list,
        send_notifications: bool = True,
    ) -> dict:
        """
        Execute the proposed schedule changes.

        Args:
            user_id: User's ID
            changes: List of changes from analyze_and_reorganize_schedule
            send_notifications: Whether to notify attendees

        Returns:
            Dict with success status and results
        """
        results = []
        errors = []

        for change in changes:
            try:
                # Parse new times
                new_start = datetime.fromisoformat(
                    change["new_start"].replace("Z", "+00:00")
                )
                new_end = datetime.fromisoformat(
                    change["new_end"].replace("Z", "+00:00")
                )

                # Update the event
                result = await self.sync_service.update_calendar_event(
                    user_id=user_id,
                    event_id=change["event_id"],
                    start_time=new_start,
                    end_time=new_end,
                    send_notifications=send_notifications and change.get("has_attendees", False),
                )

                if result["success"]:
                    results.append({
                        "event_id": change["event_id"],
                        "title": change["event_title"],
                        "status": "rescheduled",
                        "new_time": f"{new_start.strftime('%I:%M %p')} - {new_end.strftime('%I:%M %p')}",
                    })
                else:
                    errors.append({
                        "event_id": change["event_id"],
                        "title": change["event_title"],
                        "error": result.get("message", "Unknown error"),
                    })

            except Exception as e:
                errors.append({
                    "event_id": change.get("event_id", "unknown"),
                    "title": change.get("event_title", "Unknown"),
                    "error": str(e),
                })

        # Create a memory of this reorganization for learning
        if results:
            await self._record_schedule_change(user_id, results, errors)

        return {
            "success": len(errors) == 0,
            "rescheduled": len(results),
            "failed": len(errors),
            "results": results,
            "errors": errors,
            "message": f"Rescheduled {len(results)} events" + (f", {len(errors)} failed" if errors else ""),
        }

    async def _record_schedule_change(
        self,
        user_id: UUID,
        results: list,
        errors: list,
    ) -> None:
        """Record schedule changes as a memory for future learning."""
        try:
            from app.services.memory_service import MemoryService
            memory_service = MemoryService(self.db)

            # Create a summary of the changes
            changes_text = "\n".join([
                f"- {r['title']} moved to {r['new_time']}"
                for r in results
            ])

            content = f"Schedule reorganization:\n{changes_text}"

            await memory_service.create_memory(
                user_id=user_id,
                content=content,
                memory_type="decision",
                source_type="calendar_intelligence",
            )
        except Exception as e:
            logger.error(f"Error recording schedule change: {e}")

    # ==================== CONFLICT DETECTION ====================

    async def detect_conflicts(
        self,
        user_id: UUID,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> dict:
        """
        Detect scheduling conflicts in the user's calendar.

        Args:
            user_id: User's ID
            start_date: Start of range (defaults to today)
            end_date: End of range (defaults to 7 days from now)

        Returns:
            Dict with conflicts list and resolution suggestions
        """
        if not start_date:
            start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        if not end_date:
            end_date = start_date + timedelta(days=7)

        # Get all events in range
        events_result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        if not events_result["success"]:
            return {
                "success": False,
                "message": events_result.get("message", "Failed to fetch calendar"),
                "conflicts": [],
            }

        events = events_result.get("events", [])

        # Sort events by start time
        sorted_events = sorted(
            events,
            key=lambda e: e.get("start_time", "")
        )

        # Find overlapping events
        conflicts = []
        for i, event1 in enumerate(sorted_events):
            for event2 in sorted_events[i + 1:]:
                if self._events_overlap(event1, event2):
                    conflicts.append({
                        "event1": {
                            "id": event1.get("id"),
                            "title": event1.get("title"),
                            "start": event1.get("start_time"),
                            "end": event1.get("end_time"),
                        },
                        "event2": {
                            "id": event2.get("id"),
                            "title": event2.get("title"),
                            "start": event2.get("start_time"),
                            "end": event2.get("end_time"),
                        },
                        "overlap_minutes": self._calculate_overlap_minutes(event1, event2),
                    })

        # Generate resolution suggestions if conflicts exist
        if conflicts:
            conflicts = await self._add_resolution_suggestions(user_id, conflicts)

        return {
            "success": True,
            "conflicts": conflicts,
            "conflict_count": len(conflicts),
            "message": f"Found {len(conflicts)} scheduling conflicts" if conflicts else "No conflicts found",
        }

    def _events_overlap(self, event1: dict, event2: dict) -> bool:
        """Check if two events overlap."""
        try:
            start1 = event1.get("start_time", "")
            end1 = event1.get("end_time", "")
            start2 = event2.get("start_time", "")
            end2 = event2.get("end_time", "")

            # Parse times
            if isinstance(start1, str):
                start1 = datetime.fromisoformat(start1.replace("Z", "+00:00"))
            if isinstance(end1, str):
                end1 = datetime.fromisoformat(end1.replace("Z", "+00:00"))
            if isinstance(start2, str):
                start2 = datetime.fromisoformat(start2.replace("Z", "+00:00"))
            if isinstance(end2, str):
                end2 = datetime.fromisoformat(end2.replace("Z", "+00:00"))

            # Check overlap (events overlap if one starts before the other ends)
            return start1 < end2 and start2 < end1

        except Exception:
            return False

    def _calculate_overlap_minutes(self, event1: dict, event2: dict) -> int:
        """Calculate overlap duration in minutes."""
        try:
            start1 = datetime.fromisoformat(event1["start_time"].replace("Z", "+00:00"))
            end1 = datetime.fromisoformat(event1["end_time"].replace("Z", "+00:00"))
            start2 = datetime.fromisoformat(event2["start_time"].replace("Z", "+00:00"))
            end2 = datetime.fromisoformat(event2["end_time"].replace("Z", "+00:00"))

            overlap_start = max(start1, start2)
            overlap_end = min(end1, end2)

            if overlap_start < overlap_end:
                return int((overlap_end - overlap_start).total_seconds() / 60)
            return 0
        except Exception:
            return 0

    async def _add_resolution_suggestions(
        self,
        user_id: UUID,
        conflicts: list,
    ) -> list:
        """Add resolution suggestions to conflicts using LLM."""
        # For now, add simple suggestions
        # Could enhance with LLM for smarter suggestions
        for conflict in conflicts:
            event1 = conflict["event1"]
            event2 = conflict["event2"]

            # Simple heuristic: suggest moving the one with fewer/no attendees
            # In production, would use LLM for smarter analysis
            conflict["suggestions"] = [
                f"Move '{event1['title']}' to after '{event2['title']}'",
                f"Move '{event2['title']}' to before '{event1['title']}'",
                "Decline one of the meetings",
            ]

        return conflicts

    async def resolve_conflict(
        self,
        user_id: UUID,
        event_id: str,
        action: str,
        new_time: Optional[datetime] = None,
    ) -> dict:
        """
        Resolve a scheduling conflict.

        Args:
            user_id: User's ID
            event_id: Event to modify
            action: "reschedule", "delete", or "keep"
            new_time: New start time if rescheduling

        Returns:
            Dict with result
        """
        if action == "reschedule" and new_time:
            # Get original event to calculate duration
            events_result = await self.sync_service.get_calendar_events(
                user_id=user_id,
                start_date=datetime.now() - timedelta(days=30),
                end_date=datetime.now() + timedelta(days=30),
            )

            original_event = None
            for event in events_result.get("events", []):
                if event.get("id") == event_id:
                    original_event = event
                    break

            if not original_event:
                return {"success": False, "message": "Event not found"}

            # Calculate new end time
            orig_start = datetime.fromisoformat(
                original_event["start_time"].replace("Z", "+00:00")
            )
            orig_end = datetime.fromisoformat(
                original_event["end_time"].replace("Z", "+00:00")
            )
            duration = orig_end - orig_start
            new_end = new_time + duration

            return await self.sync_service.update_calendar_event(
                user_id=user_id,
                event_id=event_id,
                start_time=new_time,
                end_time=new_end,
                send_notifications=True,
            )

        elif action == "delete":
            return await self.sync_service.delete_calendar_event(
                user_id=user_id,
                event_id=event_id,
                send_notifications=True,
            )

        return {"success": True, "message": "No action taken"}

    # ==================== DEEP WORK TIME BLOCKING ====================

    async def find_focus_time_slots(
        self,
        user_id: UUID,
        date: Optional[datetime] = None,
        duration_minutes: int = 120,
        preferred_time: str = "morning",  # "morning", "afternoon", "any"
    ) -> dict:
        """
        Find optimal slots for deep work / focus time.

        Args:
            user_id: User's ID
            date: Date to search (defaults to today)
            duration_minutes: Minimum duration needed (default 2 hours)
            preferred_time: When user prefers focus time

        Returns:
            Dict with available slots ranked by suitability
        """
        if not date:
            date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        # Define search range based on preference
        if preferred_time == "morning":
            start_hour, end_hour = 7, 12
        elif preferred_time == "afternoon":
            start_hour, end_hour = 13, 18
        else:
            start_hour, end_hour = 7, 18

        time_min = date.replace(hour=start_hour, minute=0)
        time_max = date.replace(hour=end_hour, minute=0)

        # Find free slots
        result = await self.sync_service.find_free_slots(
            user_id=user_id,
            time_min=time_min,
            time_max=time_max,
            duration_minutes=duration_minutes,
        )

        if not result["success"]:
            return result

        # Filter and rank slots by suitability
        suitable_slots = []
        for slot in result.get("free_slots", []):
            slot_duration = slot.get("duration_minutes", 0)
            if slot_duration >= duration_minutes:
                # Score the slot (higher is better)
                score = self._score_focus_slot(slot, preferred_time)
                suitable_slots.append({
                    **slot,
                    "suitability_score": score,
                })

        # Sort by score
        suitable_slots.sort(key=lambda s: s["suitability_score"], reverse=True)

        return {
            "success": True,
            "slots": suitable_slots,
            "best_slot": suitable_slots[0] if suitable_slots else None,
            "message": f"Found {len(suitable_slots)} suitable focus time slots",
        }

    def _score_focus_slot(self, slot: dict, preferred_time: str) -> int:
        """Score a slot for focus time suitability."""
        score = 50  # Base score

        start = slot.get("start")
        if isinstance(start, str):
            try:
                start = datetime.fromisoformat(start.replace("Z", "+00:00"))
            except Exception:
                return score

        hour = start.hour

        # Prefer morning for focus (8-11am is optimal)
        if preferred_time == "morning" or preferred_time == "any":
            if 8 <= hour <= 11:
                score += 30
            elif 7 <= hour < 8 or 11 < hour <= 12:
                score += 15

        # Prefer afternoon (2-5pm is good)
        if preferred_time == "afternoon" or preferred_time == "any":
            if 14 <= hour <= 17:
                score += 25
            elif 13 <= hour < 14:
                score += 10

        # Bonus for longer slots
        duration = slot.get("duration_minutes", 0)
        if duration >= 180:  # 3+ hours
            score += 20
        elif duration >= 120:  # 2+ hours
            score += 10

        return score

    async def block_focus_time(
        self,
        user_id: UUID,
        start_time: datetime,
        duration_minutes: int = 120,
        title: str = "Focus Time",
        protect: bool = True,
    ) -> dict:
        """
        Block time for deep work on the calendar.

        Args:
            user_id: User's ID
            start_time: When to start focus time
            duration_minutes: How long (default 2 hours)
            title: Event title (default "Focus Time")
            protect: If True, mark as busy to prevent conflicts

        Returns:
            Dict with created event details
        """
        end_time = start_time + timedelta(minutes=duration_minutes)

        # Create calendar event
        result = await self.sync_service.create_calendar_event(
            user_id=user_id,
            title=title,
            start_time=start_time,
            end_time=end_time,
            description="Protected focus time - Do not disturb",
            send_notifications=False,
        )

        if result["success"]:
            # Record as a memory for learning preferences
            await self._record_focus_time_preference(user_id, start_time, duration_minutes)

        return result

    async def _record_focus_time_preference(
        self,
        user_id: UUID,
        start_time: datetime,
        duration_minutes: int,
    ) -> None:
        """Record focus time preference for learning."""
        try:
            from app.services.adaptive_learning_service import AdaptiveLearningService
            learning_service = AdaptiveLearningService(self.db)

            # Learn that user prefers focus time at this hour
            hour = start_time.hour
            time_of_day = "morning" if hour < 12 else "afternoon"

            await learning_service.learn_preference(
                user_id=user_id,
                preference_type="focus_time",
                preference_value=json.dumps({
                    "preferred_times": time_of_day,
                    "typical_duration": duration_minutes,
                    "typical_hour": hour,
                }),
                confidence=0.7,
                evidence=f"User blocked focus time at {start_time.strftime('%I:%M %p')}",
            )
        except Exception as e:
            logger.error(f"Error recording focus time preference: {e}")

    # ==================== SCHEDULE ANALYSIS ====================

    async def get_day_summary(
        self,
        user_id: UUID,
        date: Optional[datetime] = None,
    ) -> dict:
        """
        Get a smart summary of the day's schedule.

        Returns analysis including:
        - Total meeting hours
        - Free time blocks
        - Potential conflicts
        - Recommendations
        """
        if not date:
            date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        end_date = date + timedelta(days=1)

        # Get events
        events_result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=date,
            end_date=end_date,
        )

        events = events_result.get("events", [])

        # Calculate metrics
        total_meeting_minutes = 0
        meeting_count = len(events)

        for event in events:
            try:
                start = datetime.fromisoformat(event["start_time"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(event["end_time"].replace("Z", "+00:00"))
                total_meeting_minutes += (end - start).total_seconds() / 60
            except Exception:
                pass

        # Check conflicts
        conflicts_result = await self.detect_conflicts(user_id, date, end_date)
        conflict_count = conflicts_result.get("conflict_count", 0)

        # Get free slots
        free_result = await self.sync_service.find_free_slots(
            user_id=user_id,
            time_min=date.replace(hour=9, minute=0),
            time_max=date.replace(hour=18, minute=0),
            duration_minutes=30,
        )
        free_slots = free_result.get("free_slots", [])

        # Calculate free time
        total_free_minutes = sum(s.get("duration_minutes", 0) for s in free_slots)

        # Build summary
        summary = {
            "date": date.strftime("%A, %B %d"),
            "meeting_count": meeting_count,
            "total_meeting_hours": round(total_meeting_minutes / 60, 1),
            "free_hours": round(total_free_minutes / 60, 1),
            "conflict_count": conflict_count,
            "busiest_hour": self._find_busiest_hour(events),
            "longest_free_block": max((s.get("duration_minutes", 0) for s in free_slots), default=0),
            "events": events[:5],  # Top 5 events
            "recommendations": [],
        }

        # Add recommendations
        if conflict_count > 0:
            summary["recommendations"].append(
                f"You have {conflict_count} scheduling conflicts to resolve"
            )
        if total_meeting_minutes > 6 * 60:  # More than 6 hours of meetings
            summary["recommendations"].append(
                "Heavy meeting day - consider blocking focus time for tomorrow"
            )
        if total_free_minutes < 60:  # Less than 1 hour free
            summary["recommendations"].append(
                "Very busy day - protect time for breaks"
            )
        if not summary["recommendations"]:
            summary["recommendations"].append("Your schedule looks balanced!")

        return summary

    def _find_busiest_hour(self, events: list) -> Optional[str]:
        """Find the hour with most meetings."""
        if not events:
            return None

        hour_counts = {}
        for event in events:
            try:
                start = datetime.fromisoformat(event["start_time"].replace("Z", "+00:00"))
                hour = start.hour
                hour_counts[hour] = hour_counts.get(hour, 0) + 1
            except Exception:
                pass

        if hour_counts:
            busiest = max(hour_counts, key=hour_counts.get)
            return f"{busiest}:00"
        return None
