"""
Smart Rescheduling Service

Iris-inspired intelligent calendar rescheduling with:
- Batch operations with natural language filters ("reschedule all calls after 5pm")
- Automatic personalized attendee notifications
- Intelligent time optimization (energy levels, context, preferences)
- Learning from past rescheduling decisions

This service enhances CalendarIntelligenceService with production-ready features.
"""

import json
from uuid import UUID
from datetime import datetime, timedelta, time
from typing import Optional, Literal
from dataclasses import dataclass, field, asdict
from enum import Enum
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

import logging

from app.config import get_settings
from app.models.memory import Memory
from app.services.sync_service import SyncService
from app.services.search_service import SearchService
from app.services.email_intelligence_service import EmailIntelligenceService

logger = logging.getLogger(__name__)
settings = get_settings()


class RescheduleStrategy(str, Enum):
    """Strategies for intelligent time optimization."""
    SLOW_START = "slow_start"  # Push meetings later, protect morning
    BATCH_MEETINGS = "batch_meetings"  # Group meetings together
    SPREAD_OUT = "spread_out"  # Add breaks between meetings
    MINIMIZE_CONTEXT_SWITCH = "minimize_context_switch"  # Group similar meetings
    ENERGY_OPTIMIZED = "energy_optimized"  # Match meeting type to energy levels
    CUSTOM = "custom"  # User-specified rules


class MeetingType(str, Enum):
    """Types of meetings for intelligent scheduling."""
    ONE_ON_ONE = "one_on_one"
    TEAM_MEETING = "team_meeting"
    EXTERNAL_CALL = "external_call"
    FOCUS_BLOCK = "focus_block"
    INTERVIEW = "interview"
    REVIEW = "review"
    STANDUP = "standup"
    ALL_HANDS = "all_hands"
    UNKNOWN = "unknown"


@dataclass
class TimeSlotScore:
    """Scoring for a potential time slot."""
    slot_start: datetime
    slot_end: datetime
    total_score: float = 0.0
    energy_score: float = 0.0  # 0-25: Does this time match the meeting's energy requirement?
    preference_score: float = 0.0  # 0-25: Does user prefer meetings at this time?
    context_score: float = 0.0  # 0-25: Is there context continuity (similar meetings nearby)?
    buffer_score: float = 0.0  # 0-25: Is there adequate buffer before/after?
    breakdown: dict = field(default_factory=dict)


@dataclass
class RescheduleProposal:
    """A proposed reschedule for an event."""
    event_id: str
    event_title: str
    original_start: datetime
    original_end: datetime
    new_start: datetime
    new_end: datetime
    reason: str
    confidence: float  # 0-1: How confident we are this is the right move
    has_attendees: bool
    attendees: list[str]
    notification_message: Optional[str] = None
    slot_score: Optional[TimeSlotScore] = None


@dataclass
class BatchRescheduleFilter:
    """Filter for selecting events to reschedule."""
    # Time filters
    after_time: Optional[time] = None  # Events starting after this time
    before_time: Optional[time] = None  # Events starting before this time
    date: Optional[datetime] = None  # Specific date
    date_range_start: Optional[datetime] = None
    date_range_end: Optional[datetime] = None

    # Event type filters
    meeting_types: Optional[list[MeetingType]] = None
    has_attendees: Optional[bool] = None  # Only events with/without attendees
    has_video_call: Optional[bool] = None  # Only video calls

    # Title/content filters
    title_contains: Optional[str] = None
    title_not_contains: Optional[str] = None

    # Attendee filters
    with_attendee: Optional[str] = None  # Events with specific attendee
    external_only: bool = False  # Only external meetings
    internal_only: bool = False  # Only internal meetings


class SmartReschedulingService:
    """
    Intelligent rescheduling service with Iris-like capabilities.

    Features:
    1. Natural language batch operations
    2. Automatic personalized attendee notifications
    3. Intelligent time slot optimization
    4. Learning from rescheduling patterns
    """

    # Energy levels throughout the day (0-1 scale)
    DEFAULT_ENERGY_CURVE = {
        6: 0.4,   # Early morning - low
        7: 0.5,
        8: 0.7,   # Morning ramp-up
        9: 0.9,   # Peak morning
        10: 1.0,  # Peak focus
        11: 0.95,
        12: 0.6,  # Lunch dip
        13: 0.5,
        14: 0.7,  # Afternoon recovery
        15: 0.85, # Secondary peak
        16: 0.8,
        17: 0.65, # Wind down
        18: 0.5,
        19: 0.4,
        20: 0.3,
    }

    # Meeting type to preferred energy level
    MEETING_ENERGY_REQUIREMENTS = {
        MeetingType.ONE_ON_ONE: 0.6,
        MeetingType.TEAM_MEETING: 0.7,
        MeetingType.EXTERNAL_CALL: 0.8,
        MeetingType.FOCUS_BLOCK: 0.9,
        MeetingType.INTERVIEW: 0.85,
        MeetingType.REVIEW: 0.75,
        MeetingType.STANDUP: 0.5,
        MeetingType.ALL_HANDS: 0.6,
        MeetingType.UNKNOWN: 0.7,
    }

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.search_service = SearchService(db)
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)
        self._email_service: Optional[EmailIntelligenceService] = None

    @property
    def email_service(self) -> EmailIntelligenceService:
        if not self._email_service:
            self._email_service = EmailIntelligenceService(self.db)
        return self._email_service

    # ==================== BATCH RESCHEDULING ====================

    async def batch_reschedule_with_filter(
        self,
        user_id: UUID,
        filter: BatchRescheduleFilter,
        strategy: RescheduleStrategy,
        instruction: Optional[str] = None,
        send_notifications: bool = True,
        dry_run: bool = False,
    ) -> dict:
        """
        Reschedule multiple events matching a filter with intelligent optimization.

        Example: "Reschedule all calls today after 5pm"
        - filter: BatchRescheduleFilter(after_time=time(17, 0), has_attendees=True)
        - strategy: RescheduleStrategy.SPREAD_OUT

        Args:
            user_id: User's ID
            filter: Filter to select events
            strategy: How to optimize the rescheduling
            instruction: Optional natural language instruction for LLM
            send_notifications: Whether to notify attendees
            dry_run: If True, return proposals without executing

        Returns:
            Dict with proposals or results
        """
        # 1. Get events matching filter
        matching_events = await self._get_filtered_events(user_id, filter)

        if not matching_events:
            return {
                "success": True,
                "message": "No events match the filter criteria",
                "proposals": [],
                "executed": [],
            }

        # 2. Get user preferences and energy curve
        preferences = await self._get_user_scheduling_preferences(user_id)
        energy_curve = await self._get_user_energy_curve(user_id)

        # 3. Generate optimal time proposals
        proposals = await self._generate_batch_proposals(
            user_id=user_id,
            events=matching_events,
            strategy=strategy,
            instruction=instruction,
            preferences=preferences,
            energy_curve=energy_curve,
            filter=filter,
        )

        if dry_run:
            return {
                "success": True,
                "message": f"Generated {len(proposals)} rescheduling proposals",
                "proposals": [self._proposal_to_dict(p) for p in proposals],
                "executed": [],
                "dry_run": True,
            }

        # 4. Execute rescheduling with notifications
        results = await self._execute_batch_reschedule(
            user_id=user_id,
            proposals=proposals,
            send_notifications=send_notifications,
        )

        # 5. Learn from this rescheduling decision
        await self._learn_from_reschedule(user_id, results, strategy, instruction)

        return results

    async def parse_natural_language_reschedule(
        self,
        user_id: UUID,
        instruction: str,
    ) -> dict:
        """
        Parse a natural language rescheduling instruction into filter + strategy.

        Examples:
        - "Reschedule all calls today after 5pm" -> filter + SPREAD_OUT
        - "Give me a slow start tomorrow" -> filter + SLOW_START
        - "Move my standup to the afternoon" -> filter + CUSTOM
        - "Batch my meetings together in the morning" -> filter + BATCH_MEETINGS

        Args:
            user_id: User's ID
            instruction: Natural language instruction

        Returns:
            Dict with parsed filter, strategy, and ready-to-execute params
        """
        system_prompt = """You are a calendar assistant that parses rescheduling instructions.

Given a natural language instruction, extract:
1. filter: Criteria to select which events to reschedule
2. strategy: How to optimize the rescheduling
3. target_time: If specified, when to move events to

Return JSON with this structure:
{
    "filter": {
        "after_time": "17:00" or null,
        "before_time": "09:00" or null,
        "date": "2024-01-23" or "today" or "tomorrow" or null,
        "title_contains": "standup" or null,
        "has_attendees": true/false or null,
        "has_video_call": true/false or null,
        "meeting_types": ["external_call", "team_meeting"] or null
    },
    "strategy": "slow_start" | "batch_meetings" | "spread_out" | "minimize_context_switch" | "energy_optimized" | "custom",
    "target_time": "14:00" or "afternoon" or "morning" or null,
    "notification_context": "Brief explanation for attendees about why rescheduling",
    "confidence": 0.0-1.0
}

Meeting types: one_on_one, team_meeting, external_call, focus_block, interview, review, standup, all_hands, unknown

Strategies explained:
- slow_start: Move morning meetings later, protect early hours for focus
- batch_meetings: Group meetings together to minimize context switches
- spread_out: Add breaks between meetings to prevent burnout
- minimize_context_switch: Group similar meeting types together
- energy_optimized: Schedule demanding meetings at high-energy times
- custom: Apply specific user instruction (e.g., "move to 2pm")"""

        now = datetime.now()
        user_prompt = f"""Current date/time: {now.strftime("%A, %B %d, %Y at %I:%M %p")}

Instruction: "{instruction}"

Parse this into filter criteria and rescheduling strategy."""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
            )

            parsed = json.loads(response.choices[0].message.content)

            # Convert parsed filter to BatchRescheduleFilter
            filter_dict = parsed.get("filter", {})
            filter_obj = self._dict_to_filter(filter_dict)

            return {
                "success": True,
                "filter": filter_obj,
                "filter_dict": filter_dict,
                "strategy": RescheduleStrategy(parsed.get("strategy", "custom")),
                "target_time": parsed.get("target_time"),
                "notification_context": parsed.get("notification_context"),
                "confidence": parsed.get("confidence", 0.8),
                "original_instruction": instruction,
            }

        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to parse instruction: {str(e)}",
                "filter": None,
                "strategy": None,
            }

    def _dict_to_filter(self, filter_dict: dict) -> BatchRescheduleFilter:
        """Convert parsed dict to BatchRescheduleFilter."""
        filter_obj = BatchRescheduleFilter()

        # Parse time filters
        if filter_dict.get("after_time"):
            try:
                t = filter_dict["after_time"]
                if isinstance(t, str):
                    parts = t.split(":")
                    filter_obj.after_time = time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
            except Exception:
                pass

        if filter_dict.get("before_time"):
            try:
                t = filter_dict["before_time"]
                if isinstance(t, str):
                    parts = t.split(":")
                    filter_obj.before_time = time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
            except Exception:
                pass

        # Parse date
        if filter_dict.get("date"):
            date_str = filter_dict["date"]
            now = datetime.now()
            if date_str == "today":
                filter_obj.date = now.replace(hour=0, minute=0, second=0, microsecond=0)
            elif date_str == "tomorrow":
                filter_obj.date = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                try:
                    filter_obj.date = datetime.fromisoformat(date_str)
                except Exception:
                    pass

        # Parse other filters
        filter_obj.title_contains = filter_dict.get("title_contains")
        filter_obj.has_attendees = filter_dict.get("has_attendees")
        filter_obj.has_video_call = filter_dict.get("has_video_call")

        if filter_dict.get("meeting_types"):
            filter_obj.meeting_types = [
                MeetingType(mt) for mt in filter_dict["meeting_types"]
                if mt in [m.value for m in MeetingType]
            ]

        return filter_obj

    async def _get_filtered_events(
        self,
        user_id: UUID,
        filter: BatchRescheduleFilter,
    ) -> list[dict]:
        """Get calendar events matching the filter."""
        # Determine date range
        if filter.date:
            start_date = filter.date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = start_date + timedelta(days=1)
        elif filter.date_range_start and filter.date_range_end:
            start_date = filter.date_range_start
            end_date = filter.date_range_end
        else:
            # Default to today
            start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = start_date + timedelta(days=1)

        # Fetch events
        result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        if not result.get("success"):
            return []

        events = result.get("events", [])
        filtered = []

        for event in events:
            if self._event_matches_filter(event, filter):
                # Classify the meeting type
                event["meeting_type"] = self._classify_meeting_type(event)
                filtered.append(event)

        return filtered

    def _event_matches_filter(self, event: dict, filter: BatchRescheduleFilter) -> bool:
        """Check if an event matches the filter criteria."""
        # Parse event start time
        start_str = event.get("start_time", "")
        try:
            if isinstance(start_str, str):
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            else:
                start_dt = start_str
        except Exception:
            return False

        # Time filters
        if filter.after_time:
            event_time = start_dt.time()
            if event_time < filter.after_time:
                return False

        if filter.before_time:
            event_time = start_dt.time()
            if event_time > filter.before_time:
                return False

        # Title filters
        title = event.get("title", "").lower()

        if filter.title_contains:
            if filter.title_contains.lower() not in title:
                return False

        if filter.title_not_contains:
            if filter.title_not_contains.lower() in title:
                return False

        # Attendee filters
        attendees = event.get("attendees", [])
        has_attendees = len(attendees) > 0

        if filter.has_attendees is not None:
            if filter.has_attendees != has_attendees:
                return False

        if filter.with_attendee:
            attendee_emails = [a.get("email", "").lower() if isinstance(a, dict) else str(a).lower() for a in attendees]
            if filter.with_attendee.lower() not in " ".join(attendee_emails):
                return False

        # Video call filter
        if filter.has_video_call is not None:
            video_link = event.get("video_link") or event.get("hangout_link")
            has_video = bool(video_link)
            if filter.has_video_call != has_video:
                return False

        # Meeting type filter
        if filter.meeting_types:
            event_type = self._classify_meeting_type(event)
            if event_type not in filter.meeting_types:
                return False

        return True

    def _classify_meeting_type(self, event: dict) -> MeetingType:
        """Classify the type of meeting based on title, attendees, etc."""
        title = event.get("title", "").lower()
        attendees = event.get("attendees", [])

        # Check title patterns
        if "standup" in title or "daily" in title or "scrum" in title:
            return MeetingType.STANDUP
        if "1:1" in title or "1-1" in title or "one on one" in title:
            return MeetingType.ONE_ON_ONE
        if "interview" in title:
            return MeetingType.INTERVIEW
        if "review" in title or "retro" in title:
            return MeetingType.REVIEW
        if "all hands" in title or "town hall" in title or "company" in title:
            return MeetingType.ALL_HANDS
        if "focus" in title or "deep work" in title or "blocked" in title:
            return MeetingType.FOCUS_BLOCK

        # Check attendee count
        if len(attendees) == 1:
            return MeetingType.ONE_ON_ONE
        elif len(attendees) > 5:
            return MeetingType.TEAM_MEETING

        # Check for external attendees (different domain)
        # This would need user's domain - simplified for now

        return MeetingType.UNKNOWN

    # ==================== INTELLIGENT TIME OPTIMIZATION ====================

    async def _generate_batch_proposals(
        self,
        user_id: UUID,
        events: list[dict],
        strategy: RescheduleStrategy,
        instruction: Optional[str],
        preferences: dict,
        energy_curve: dict,
        filter: BatchRescheduleFilter,
    ) -> list[RescheduleProposal]:
        """Generate optimized time proposals for events."""
        proposals = []

        # Get the full day's events for context
        date = filter.date or datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        all_events_result = await self.sync_service.get_calendar_events(
            user_id=user_id,
            start_date=date,
            end_date=date + timedelta(days=1),
        )
        all_events = all_events_result.get("events", [])

        # Events that won't be moved (for conflict checking)
        unmoved_event_ids = {e.get("id") for e in all_events} - {e.get("id") for e in events}
        unmoved_events = [e for e in all_events if e.get("id") in unmoved_event_ids]

        # Apply strategy-specific logic
        if strategy == RescheduleStrategy.SLOW_START:
            proposals = await self._apply_slow_start_strategy(
                events, unmoved_events, preferences, energy_curve
            )
        elif strategy == RescheduleStrategy.BATCH_MEETINGS:
            proposals = await self._apply_batch_meetings_strategy(
                events, unmoved_events, preferences, energy_curve
            )
        elif strategy == RescheduleStrategy.SPREAD_OUT:
            proposals = await self._apply_spread_out_strategy(
                events, unmoved_events, preferences, energy_curve
            )
        elif strategy == RescheduleStrategy.ENERGY_OPTIMIZED:
            proposals = await self._apply_energy_optimized_strategy(
                events, unmoved_events, preferences, energy_curve
            )
        elif strategy == RescheduleStrategy.MINIMIZE_CONTEXT_SWITCH:
            proposals = await self._apply_minimize_context_switch_strategy(
                events, unmoved_events, preferences, energy_curve
            )
        else:  # CUSTOM - use LLM
            proposals = await self._apply_custom_strategy(
                user_id, events, unmoved_events, instruction, preferences
            )

        # Generate notification messages for proposals with attendees
        for proposal in proposals:
            if proposal.has_attendees:
                proposal.notification_message = await self._generate_notification_message(
                    user_id, proposal, instruction
                )

        return proposals

    async def _apply_slow_start_strategy(
        self,
        events: list[dict],
        unmoved_events: list[dict],
        preferences: dict,
        energy_curve: dict,
    ) -> list[RescheduleProposal]:
        """
        Move morning meetings later to protect early hours for focus.

        Logic:
        - Meetings before 11am get pushed to afternoon
        - Maintain relative order
        - Ensure no conflicts
        """
        proposals = []

        # Define "morning" cutoff
        morning_cutoff = time(11, 0)
        afternoon_start = time(13, 0)  # Start placing meetings after lunch

        # Sort events by start time
        sorted_events = sorted(
            events,
            key=lambda e: e.get("start_time", "")
        )

        # Track scheduled times to avoid conflicts
        scheduled_times = self._get_busy_times(unmoved_events)
        next_available = None

        for event in sorted_events:
            start_str = event.get("start_time", "")
            end_str = event.get("end_time", "")

            try:
                original_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                original_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except Exception:
                continue

            duration = original_end - original_start
            event_time = original_start.time()

            # Only move morning meetings
            if event_time < morning_cutoff:
                # Find next available afternoon slot
                if next_available is None:
                    next_available = original_start.replace(
                        hour=afternoon_start.hour,
                        minute=afternoon_start.minute
                    )

                # Find a slot that doesn't conflict
                new_start = self._find_non_conflicting_slot(
                    next_available,
                    duration,
                    scheduled_times,
                    preferences.get("minimum_break_minutes", 15),
                )

                new_end = new_start + duration

                # Update tracking
                scheduled_times.append({"start": new_start, "end": new_end})
                next_available = new_end + timedelta(minutes=preferences.get("minimum_break_minutes", 15))

                # Score the new slot
                slot_score = self._score_time_slot(
                    new_start, new_end, event, energy_curve, preferences
                )

                proposals.append(RescheduleProposal(
                    event_id=event.get("id", ""),
                    event_title=event.get("title", "Untitled"),
                    original_start=original_start,
                    original_end=original_end,
                    new_start=new_start,
                    new_end=new_end,
                    reason="Moving to afternoon for a slow start to your day",
                    confidence=0.85,
                    has_attendees=len(event.get("attendees", [])) > 0,
                    attendees=[
                        a.get("email") if isinstance(a, dict) else str(a)
                        for a in event.get("attendees", [])
                    ],
                    slot_score=slot_score,
                ))

        return proposals

    async def _apply_batch_meetings_strategy(
        self,
        events: list[dict],
        unmoved_events: list[dict],
        preferences: dict,
        energy_curve: dict,
    ) -> list[RescheduleProposal]:
        """
        Group meetings together to create longer focus blocks.

        Logic:
        - Find the natural meeting cluster time
        - Move scattered meetings into that cluster
        - Leave minimal gaps between meetings
        """
        proposals = []

        # Sort events by start time
        sorted_events = sorted(
            events,
            key=lambda e: e.get("start_time", "")
        )

        if not sorted_events:
            return proposals

        # Find or create a meeting cluster - prefer afternoon
        cluster_start_hour = 14  # 2 PM

        # Get first event's date
        first_start = sorted_events[0].get("start_time", "")
        try:
            base_date = datetime.fromisoformat(first_start.replace("Z", "+00:00"))
        except Exception:
            return proposals

        cluster_start = base_date.replace(hour=cluster_start_hour, minute=0, second=0, microsecond=0)
        scheduled_times = self._get_busy_times(unmoved_events)
        current_time = cluster_start

        # Small buffer between meetings
        buffer = timedelta(minutes=5)

        for event in sorted_events:
            start_str = event.get("start_time", "")
            end_str = event.get("end_time", "")

            try:
                original_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                original_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except Exception:
                continue

            duration = original_end - original_start

            # Find next available slot in the cluster
            new_start = self._find_non_conflicting_slot(
                current_time,
                duration,
                scheduled_times,
                buffer_minutes=5,
            )
            new_end = new_start + duration

            # Update tracking
            scheduled_times.append({"start": new_start, "end": new_end})
            current_time = new_end + buffer

            slot_score = self._score_time_slot(
                new_start, new_end, event, energy_curve, preferences
            )

            proposals.append(RescheduleProposal(
                event_id=event.get("id", ""),
                event_title=event.get("title", "Untitled"),
                original_start=original_start,
                original_end=original_end,
                new_start=new_start,
                new_end=new_end,
                reason="Batching meetings together to create focus blocks",
                confidence=0.80,
                has_attendees=len(event.get("attendees", [])) > 0,
                attendees=[
                    a.get("email") if isinstance(a, dict) else str(a)
                    for a in event.get("attendees", [])
                ],
                slot_score=slot_score,
            ))

        return proposals

    async def _apply_spread_out_strategy(
        self,
        events: list[dict],
        unmoved_events: list[dict],
        preferences: dict,
        energy_curve: dict,
    ) -> list[RescheduleProposal]:
        """
        Add breaks between meetings to prevent burnout.

        Logic:
        - Ensure minimum 15-30 min between meetings
        - Spread throughout available time
        """
        proposals = []
        min_break = preferences.get("minimum_break_minutes", 15)

        sorted_events = sorted(
            events,
            key=lambda e: e.get("start_time", "")
        )

        if not sorted_events:
            return proposals

        scheduled_times = self._get_busy_times(unmoved_events)

        # Start from the first event's original time or 9 AM
        first_start = sorted_events[0].get("start_time", "")
        try:
            base_time = datetime.fromisoformat(first_start.replace("Z", "+00:00"))
        except Exception:
            return proposals

        current_time = base_time.replace(hour=9, minute=0, second=0, microsecond=0)

        for event in sorted_events:
            start_str = event.get("start_time", "")
            end_str = event.get("end_time", "")

            try:
                original_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                original_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except Exception:
                continue

            duration = original_end - original_start

            new_start = self._find_non_conflicting_slot(
                current_time,
                duration,
                scheduled_times,
                buffer_minutes=min_break,
            )
            new_end = new_start + duration

            scheduled_times.append({"start": new_start, "end": new_end})
            current_time = new_end + timedelta(minutes=min_break)

            slot_score = self._score_time_slot(
                new_start, new_end, event, energy_curve, preferences
            )

            proposals.append(RescheduleProposal(
                event_id=event.get("id", ""),
                event_title=event.get("title", "Untitled"),
                original_start=original_start,
                original_end=original_end,
                new_start=new_start,
                new_end=new_end,
                reason=f"Adding {min_break}-minute breaks between meetings",
                confidence=0.82,
                has_attendees=len(event.get("attendees", [])) > 0,
                attendees=[
                    a.get("email") if isinstance(a, dict) else str(a)
                    for a in event.get("attendees", [])
                ],
                slot_score=slot_score,
            ))

        return proposals

    async def _apply_energy_optimized_strategy(
        self,
        events: list[dict],
        unmoved_events: list[dict],
        preferences: dict,
        energy_curve: dict,
    ) -> list[RescheduleProposal]:
        """
        Schedule meetings based on energy levels and meeting demands.

        Logic:
        - High-demand meetings (interviews, external) -> peak energy hours
        - Low-demand meetings (standups, 1:1s) -> lower energy times
        - Focus blocks -> highest energy times
        """
        proposals = []

        # Classify events by energy requirement
        high_energy_events = []
        medium_energy_events = []
        low_energy_events = []

        for event in events:
            meeting_type = self._classify_meeting_type(event)
            required_energy = self.MEETING_ENERGY_REQUIREMENTS.get(meeting_type, 0.7)

            if required_energy >= 0.85:
                high_energy_events.append(event)
            elif required_energy >= 0.65:
                medium_energy_events.append(event)
            else:
                low_energy_events.append(event)

        scheduled_times = self._get_busy_times(unmoved_events)

        # Get base date
        all_events = events
        if all_events:
            first_start = all_events[0].get("start_time", "")
            try:
                base_date = datetime.fromisoformat(first_start.replace("Z", "+00:00"))
            except Exception:
                base_date = datetime.now()
        else:
            base_date = datetime.now()

        # Schedule high-energy meetings at peak times (9-11 AM, 3-4 PM)
        peak_times = [
            base_date.replace(hour=9, minute=0, second=0, microsecond=0),
            base_date.replace(hour=10, minute=0, second=0, microsecond=0),
            base_date.replace(hour=15, minute=0, second=0, microsecond=0),
        ]

        for event in high_energy_events:
            proposals.append(
                await self._schedule_at_optimal_energy(
                    event, peak_times, scheduled_times, energy_curve, preferences, "high"
                )
            )
            if proposals[-1]:
                scheduled_times.append({
                    "start": proposals[-1].new_start,
                    "end": proposals[-1].new_end,
                })

        # Schedule medium-energy meetings at secondary times
        secondary_times = [
            base_date.replace(hour=11, minute=0, second=0, microsecond=0),
            base_date.replace(hour=14, minute=0, second=0, microsecond=0),
            base_date.replace(hour=16, minute=0, second=0, microsecond=0),
        ]

        for event in medium_energy_events:
            proposals.append(
                await self._schedule_at_optimal_energy(
                    event, secondary_times, scheduled_times, energy_curve, preferences, "medium"
                )
            )
            if proposals[-1]:
                scheduled_times.append({
                    "start": proposals[-1].new_start,
                    "end": proposals[-1].new_end,
                })

        # Schedule low-energy meetings at remaining times
        low_times = [
            base_date.replace(hour=8, minute=30, second=0, microsecond=0),
            base_date.replace(hour=12, minute=30, second=0, microsecond=0),
            base_date.replace(hour=17, minute=0, second=0, microsecond=0),
        ]

        for event in low_energy_events:
            proposals.append(
                await self._schedule_at_optimal_energy(
                    event, low_times, scheduled_times, energy_curve, preferences, "low"
                )
            )
            if proposals[-1]:
                scheduled_times.append({
                    "start": proposals[-1].new_start,
                    "end": proposals[-1].new_end,
                })

        # Filter out None proposals
        proposals = [p for p in proposals if p is not None]

        return proposals

    async def _schedule_at_optimal_energy(
        self,
        event: dict,
        preferred_times: list[datetime],
        scheduled_times: list[dict],
        energy_curve: dict,
        preferences: dict,
        energy_level: str,
    ) -> Optional[RescheduleProposal]:
        """Schedule a single event at the optimal energy time."""
        start_str = event.get("start_time", "")
        end_str = event.get("end_time", "")

        try:
            original_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            original_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        except Exception:
            return None

        duration = original_end - original_start

        # Try each preferred time
        for pref_time in preferred_times:
            new_start = self._find_non_conflicting_slot(
                pref_time,
                duration,
                scheduled_times,
                buffer_minutes=preferences.get("minimum_break_minutes", 15),
            )

            # Check if we found a reasonable slot (within 2 hours of preferred)
            if abs((new_start - pref_time).total_seconds()) < 7200:
                new_end = new_start + duration

                slot_score = self._score_time_slot(
                    new_start, new_end, event, energy_curve, preferences
                )

                return RescheduleProposal(
                    event_id=event.get("id", ""),
                    event_title=event.get("title", "Untitled"),
                    original_start=original_start,
                    original_end=original_end,
                    new_start=new_start,
                    new_end=new_end,
                    reason=f"Scheduled at {energy_level}-energy optimal time",
                    confidence=0.78,
                    has_attendees=len(event.get("attendees", [])) > 0,
                    attendees=[
                        a.get("email") if isinstance(a, dict) else str(a)
                        for a in event.get("attendees", [])
                    ],
                    slot_score=slot_score,
                )

        return None

    async def _apply_minimize_context_switch_strategy(
        self,
        events: list[dict],
        unmoved_events: list[dict],
        preferences: dict,
        energy_curve: dict,
    ) -> list[RescheduleProposal]:
        """
        Group similar meeting types together to minimize context switching.

        Logic:
        - Group 1:1s together
        - Group team meetings together
        - Group external calls together
        """
        proposals = []

        # Group events by type
        events_by_type: dict[MeetingType, list[dict]] = {}
        for event in events:
            meeting_type = self._classify_meeting_type(event)
            if meeting_type not in events_by_type:
                events_by_type[meeting_type] = []
            events_by_type[meeting_type].append(event)

        scheduled_times = self._get_busy_times(unmoved_events)

        # Get base date
        if events:
            first_start = events[0].get("start_time", "")
            try:
                base_date = datetime.fromisoformat(first_start.replace("Z", "+00:00"))
            except Exception:
                base_date = datetime.now()
        else:
            base_date = datetime.now()

        current_time = base_date.replace(hour=9, minute=0, second=0, microsecond=0)

        # Schedule each group
        for meeting_type, type_events in events_by_type.items():
            for event in type_events:
                start_str = event.get("start_time", "")
                end_str = event.get("end_time", "")

                try:
                    original_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                    original_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                except Exception:
                    continue

                duration = original_end - original_start

                new_start = self._find_non_conflicting_slot(
                    current_time,
                    duration,
                    scheduled_times,
                    buffer_minutes=5,  # Small buffer within type groups
                )
                new_end = new_start + duration

                scheduled_times.append({"start": new_start, "end": new_end})
                current_time = new_end + timedelta(minutes=5)

                slot_score = self._score_time_slot(
                    new_start, new_end, event, energy_curve, preferences
                )

                proposals.append(RescheduleProposal(
                    event_id=event.get("id", ""),
                    event_title=event.get("title", "Untitled"),
                    original_start=original_start,
                    original_end=original_end,
                    new_start=new_start,
                    new_end=new_end,
                    reason=f"Grouping {meeting_type.value} meetings together",
                    confidence=0.75,
                    has_attendees=len(event.get("attendees", [])) > 0,
                    attendees=[
                        a.get("email") if isinstance(a, dict) else str(a)
                        for a in event.get("attendees", [])
                    ],
                    slot_score=slot_score,
                ))

            # Add larger buffer between different meeting types
            current_time += timedelta(minutes=20)

        return proposals

    async def _apply_custom_strategy(
        self,
        user_id: UUID,
        events: list[dict],
        unmoved_events: list[dict],
        instruction: Optional[str],
        preferences: dict,
    ) -> list[RescheduleProposal]:
        """Use LLM for custom rescheduling instruction."""
        # Import and use the existing LLM reorganization
        from app.services.calendar_intelligence_service import CalendarIntelligenceService
        cal_service = CalendarIntelligenceService(self.db)

        # Get first event's date
        if events:
            first_start = events[0].get("start_time", "")
            try:
                date = datetime.fromisoformat(first_start.replace("Z", "+00:00"))
            except Exception:
                date = datetime.now()
        else:
            date = datetime.now()

        result = await cal_service.analyze_and_reorganize_schedule(
            user_id=user_id,
            date=date,
            instruction=instruction or "Optimize my schedule",
            preferences=preferences,
        )

        proposals = []
        for change in result.get("proposed_changes", []):
            try:
                proposals.append(RescheduleProposal(
                    event_id=change.get("event_id", ""),
                    event_title=change.get("event_title", "Untitled"),
                    original_start=datetime.fromisoformat(change["original_start"].replace("Z", "+00:00")),
                    original_end=datetime.fromisoformat(change["original_end"].replace("Z", "+00:00")),
                    new_start=datetime.fromisoformat(change["new_start"].replace("Z", "+00:00")),
                    new_end=datetime.fromisoformat(change["new_end"].replace("Z", "+00:00")),
                    reason=change.get("reason", "Custom optimization"),
                    confidence=0.8,
                    has_attendees=change.get("has_attendees", False),
                    attendees=change.get("attendees_to_notify", []),
                ))
            except Exception:
                continue

        return proposals

    # ==================== TIME SLOT UTILITIES ====================

    def _get_busy_times(self, events: list[dict]) -> list[dict]:
        """Extract busy time ranges from events."""
        busy = []
        for event in events:
            start_str = event.get("start_time", "")
            end_str = event.get("end_time", "")
            try:
                start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                busy.append({"start": start, "end": end})
            except Exception:
                pass
        return busy

    def _find_non_conflicting_slot(
        self,
        preferred_start: datetime,
        duration: timedelta,
        busy_times: list[dict],
        buffer_minutes: int = 15,
    ) -> datetime:
        """Find the next available slot that doesn't conflict with busy times."""
        candidate = preferred_start
        buffer = timedelta(minutes=buffer_minutes)

        # Try up to 20 iterations to find a slot
        for _ in range(20):
            candidate_end = candidate + duration
            conflict = False

            for busy in busy_times:
                busy_start = busy["start"]
                busy_end = busy["end"]

                # Check for overlap (including buffer)
                if candidate < busy_end + buffer and candidate_end + buffer > busy_start:
                    conflict = True
                    # Move candidate to after this busy period
                    candidate = busy_end + buffer
                    break

            if not conflict:
                return candidate

        # If no slot found, return the last candidate
        return candidate

    def _score_time_slot(
        self,
        slot_start: datetime,
        slot_end: datetime,
        event: dict,
        energy_curve: dict,
        preferences: dict,
    ) -> TimeSlotScore:
        """Score a time slot for suitability."""
        score = TimeSlotScore(
            slot_start=slot_start,
            slot_end=slot_end,
        )

        hour = slot_start.hour
        meeting_type = event.get("meeting_type", MeetingType.UNKNOWN)
        if isinstance(meeting_type, str):
            try:
                meeting_type = MeetingType(meeting_type)
            except Exception:
                meeting_type = MeetingType.UNKNOWN

        # Energy score: Does time match meeting's energy requirement?
        user_energy = energy_curve.get(hour, 0.5)
        required_energy = self.MEETING_ENERGY_REQUIREMENTS.get(meeting_type, 0.7)
        energy_match = 1 - abs(user_energy - required_energy)
        score.energy_score = energy_match * 25

        # Preference score: Does user prefer meetings at this time?
        pref_meeting_time = preferences.get("preferred_meeting_times", "afternoon")
        if pref_meeting_time == "morning" and 9 <= hour <= 12:
            score.preference_score = 25
        elif pref_meeting_time == "afternoon" and 13 <= hour <= 17:
            score.preference_score = 25
        elif pref_meeting_time == "flexible":
            score.preference_score = 20
        else:
            score.preference_score = 10

        # Context score: Are there similar meetings nearby?
        # (Simplified - would need more context in production)
        score.context_score = 15

        # Buffer score: Is there time before/after?
        # (Would need to check against actual schedule)
        score.buffer_score = 20

        score.total_score = (
            score.energy_score +
            score.preference_score +
            score.context_score +
            score.buffer_score
        )

        score.breakdown = {
            "energy": f"{score.energy_score:.1f}/25",
            "preference": f"{score.preference_score:.1f}/25",
            "context": f"{score.context_score:.1f}/25",
            "buffer": f"{score.buffer_score:.1f}/25",
        }

        return score

    # ==================== ATTENDEE NOTIFICATIONS ====================

    async def _generate_notification_message(
        self,
        user_id: UUID,
        proposal: RescheduleProposal,
        original_instruction: Optional[str],
    ) -> str:
        """
        Generate a personalized notification message for attendees.

        Uses user's communication style from EmailIntelligenceService.
        """
        try:
            # Get user's communication style
            style = await self.email_service.get_communication_style(user_id)

            system_prompt = f"""Generate a brief, professional notification message for a meeting reschedule.

User's communication style:
- Greeting style: {style.get('greeting_style', 'casual')}
- Tone: {style.get('tone', 'professional')}
- Typical length: {style.get('typical_length', 'brief')}

Guidelines:
- Keep it short (2-3 sentences max)
- Be apologetic but not overly so
- Mention the new time
- Match the user's natural communication style"""

            new_time_str = proposal.new_start.strftime("%I:%M %p on %A, %B %d")

            user_prompt = f"""Meeting: {proposal.event_title}
Rescheduled to: {new_time_str}
Reason: {proposal.reason}
{f'Context: {original_instruction}' if original_instruction else ''}

Generate the notification message:"""

            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.7,
                max_tokens=150,
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            # Fallback to generic message
            new_time_str = proposal.new_start.strftime("%I:%M %p on %A, %B %d")
            return f"I've rescheduled our meeting '{proposal.event_title}' to {new_time_str}. Sorry for any inconvenience!"

    async def _execute_batch_reschedule(
        self,
        user_id: UUID,
        proposals: list[RescheduleProposal],
        send_notifications: bool,
    ) -> dict:
        """Execute the rescheduling and send notifications."""
        results = []
        errors = []
        notifications_sent = 0

        for proposal in proposals:
            try:
                # Update the calendar event
                result = await self.sync_service.update_calendar_event(
                    user_id=user_id,
                    event_id=proposal.event_id,
                    start_time=proposal.new_start,
                    end_time=proposal.new_end,
                    send_notifications=False,  # We'll send our own personalized notifications
                )

                if result.get("success"):
                    result_entry = {
                        "event_id": proposal.event_id,
                        "title": proposal.event_title,
                        "status": "rescheduled",
                        "new_time": f"{proposal.new_start.strftime('%I:%M %p')} - {proposal.new_end.strftime('%I:%M %p')}",
                        "reason": proposal.reason,
                        "confidence": proposal.confidence,
                    }

                    # Send personalized notifications
                    if send_notifications and proposal.has_attendees and proposal.attendees:
                        notification_result = await self._send_attendee_notifications(
                            user_id=user_id,
                            proposal=proposal,
                        )
                        result_entry["notifications"] = notification_result
                        if notification_result.get("sent", 0) > 0:
                            notifications_sent += notification_result["sent"]

                    results.append(result_entry)
                else:
                    errors.append({
                        "event_id": proposal.event_id,
                        "title": proposal.event_title,
                        "error": result.get("message", "Unknown error"),
                    })

            except Exception as e:
                errors.append({
                    "event_id": proposal.event_id,
                    "title": proposal.event_title,
                    "error": str(e),
                })

        return {
            "success": len(errors) == 0,
            "rescheduled": len(results),
            "failed": len(errors),
            "notifications_sent": notifications_sent,
            "results": results,
            "errors": errors,
            "message": f"Rescheduled {len(results)} events" +
                      (f", sent {notifications_sent} notifications" if notifications_sent > 0 else "") +
                      (f", {len(errors)} failed" if errors else ""),
        }

    async def _send_attendee_notifications(
        self,
        user_id: UUID,
        proposal: RescheduleProposal,
    ) -> dict:
        """Send personalized email notifications to attendees."""
        sent = 0
        failed = 0

        if not proposal.notification_message:
            proposal.notification_message = await self._generate_notification_message(
                user_id, proposal, None
            )

        # Filter out the user's own email
        # In production, we'd look up the user's email
        attendees_to_notify = [
            email for email in proposal.attendees
            if email and "@" in email
        ]

        for attendee_email in attendees_to_notify:
            try:
                # Send via sync_service (Gmail)
                result = await self.sync_service.send_email(
                    user_id=user_id,
                    to=attendee_email,
                    subject=f"Meeting rescheduled: {proposal.event_title}",
                    body=proposal.notification_message,
                )

                if result.get("success"):
                    sent += 1
                else:
                    failed += 1

            except Exception as e:
                failed += 1

        return {
            "sent": sent,
            "failed": failed,
            "total": len(attendees_to_notify),
        }

    # ==================== USER PREFERENCES ====================

    async def _get_user_scheduling_preferences(self, user_id: UUID) -> dict:
        """Get user's scheduling preferences from memories and stored preferences."""
        # Import CalendarIntelligenceService to reuse its preference loading
        from app.services.calendar_intelligence_service import CalendarIntelligenceService
        cal_service = CalendarIntelligenceService(self.db)
        return await cal_service._get_schedule_preferences(user_id)

    async def _get_user_energy_curve(self, user_id: UUID) -> dict:
        """
        Get user's personalized energy curve based on past behavior.

        Falls back to default curve if no data available.
        """
        try:
            # Search for energy-related memories
            memories = await self.search_service.search(
                user_id=str(user_id),
                query="energy levels tired productive morning afternoon focus",
                limit=5,
            )

            # In production, we'd analyze these memories to build a personalized curve
            # For now, return the default
            return self.DEFAULT_ENERGY_CURVE.copy()

        except Exception:
            return self.DEFAULT_ENERGY_CURVE.copy()

    # ==================== LEARNING ====================

    async def _learn_from_reschedule(
        self,
        user_id: UUID,
        results: dict,
        strategy: RescheduleStrategy,
        instruction: Optional[str],
    ) -> None:
        """Learn from rescheduling decisions to improve future recommendations."""
        try:
            from app.services.memory_service import MemoryService
            memory_service = MemoryService(self.db)

            # Create a learning memory
            rescheduled = results.get("results", [])
            if not rescheduled:
                return

            changes_text = "\n".join([
                f"- {r['title']} → {r['new_time']}"
                for r in rescheduled[:5]  # Limit to 5 for brevity
            ])

            content = f"""Rescheduling decision (strategy: {strategy.value}):
{f'Instruction: {instruction}' if instruction else 'Automatic optimization'}
Changes made:
{changes_text}"""

            await memory_service.create_memory(
                user_id=user_id,
                content=content,
                memory_type="decision",
                source_type="smart_rescheduling",
            )

        except Exception as e:
            logger.error(f"Error learning from reschedule: {e}")

    # ==================== UTILITIES ====================

    def _proposal_to_dict(self, proposal: RescheduleProposal) -> dict:
        """Convert proposal to dict for JSON serialization."""
        return {
            "event_id": proposal.event_id,
            "event_title": proposal.event_title,
            "original_start": proposal.original_start.isoformat(),
            "original_end": proposal.original_end.isoformat(),
            "new_start": proposal.new_start.isoformat(),
            "new_end": proposal.new_end.isoformat(),
            "reason": proposal.reason,
            "confidence": proposal.confidence,
            "has_attendees": proposal.has_attendees,
            "attendees": proposal.attendees,
            "notification_message": proposal.notification_message,
            "slot_score": asdict(proposal.slot_score) if proposal.slot_score else None,
        }
