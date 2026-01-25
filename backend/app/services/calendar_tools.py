"""
Calendar Intelligence Tools

Tool definitions and execution for Iris-level calendar operations.

Commands these enable:
- "Reorganize my day for a slow start"
- "Move all afternoon meetings to tomorrow"
- "Find me 30 minutes free"
- "Reschedule my 3pm and let them know I'm running behind"
- "What's my day look like?"
- "Block 2-4pm for focus time"

Integration:
    1. Import: from app.services.calendar_tools import CALENDAR_TOOLS, execute_calendar_tool
    2. Merge: TOOLS = TOOLS + CALENDAR_TOOLS
    3. Add handler in _execute_tool() for calendar tools
"""

import re
import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.services.calendar_intelligence_service import CalendarIntelligenceService

logger = logging.getLogger(__name__)


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

CALENDAR_TOOLS = [
    # =========================================================================
    # REORGANIZE DAY
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "reorganize_day",
            "description": """Intelligently reorganize the day's schedule based on a goal.

Examples:
- "Reorganize my day for a slow start" → Move early meetings later
- "Give me focus time in the morning" → Batch meetings in afternoon
- "Help me finish early today" → Compress and move earlier
- "Add breaks between my meetings" → Create breathing room

Automatically analyzes and moves events to achieve the goal.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {
                        "type": "string",
                        "description": "Natural language instruction: 'slow start', 'focus morning', 'early finish', 'more breaks'"
                    },
                    "date": {
                        "type": "string",
                        "description": "Date to reorganize (YYYY-MM-DD), defaults to today"
                    },
                    "notify_attendees": {
                        "type": "boolean",
                        "default": True,
                        "description": "Send updates for moved meetings"
                    }
                },
                "required": ["instruction"]
            }
        }
    },

    # =========================================================================
    # FIND FREE TIME
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "find_free_time",
            "description": """Find available time slots in the calendar.

Examples:
- "Find me 30 minutes free today"
- "When am I free this afternoon?"
- "Find an hour for deep work"
- "What's my availability tomorrow?"

Returns list of free slots sorted by size.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "duration_minutes": {
                        "type": "integer",
                        "default": 30,
                        "description": "Minimum slot duration needed"
                    },
                    "time_preference": {
                        "type": "string",
                        "enum": ["morning", "afternoon", "any"],
                        "description": "Preferred time of day"
                    },
                    "date": {
                        "type": "string",
                        "description": "Date to search (YYYY-MM-DD), defaults to today"
                    }
                }
            }
        }
    },

    # =========================================================================
    # DAY OVERVIEW
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "get_day_overview",
            "description": """Get intelligent overview of the day's calendar with insights.

Examples:
- "What's my day look like?"
- "How busy am I today?"
- "What meetings do I have?"
- "Am I free this afternoon?"

Returns events, free time, insights, and optimization suggestions.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date (YYYY-MM-DD), defaults to today"
                    },
                    "include_suggestions": {
                        "type": "boolean",
                        "default": True,
                        "description": "Include optimization suggestions"
                    }
                }
            }
        }
    },

    # =========================================================================
    # BLOCK TIME
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "block_time",
            "description": """Block time on the calendar for focus or personal time.

Examples:
- "Block 2-4pm for focus time"
- "Add a lunch break at noon"
- "Block my morning for deep work"
- "Reserve 3pm-5pm for project work"

Creates a calendar event to protect the time.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "What to call the block (Focus Time, Lunch, Deep Work, etc.)"
                    },
                    "start_time": {
                        "type": "string",
                        "description": "Start time ('2pm', '14:00')"
                    },
                    "duration_minutes": {
                        "type": "integer",
                        "default": 60,
                        "description": "Duration in minutes"
                    },
                    "date": {
                        "type": "string",
                        "description": "Date (YYYY-MM-DD), defaults to today"
                    }
                },
                "required": ["title", "start_time"]
            }
        }
    },

    # =========================================================================
    # DETECT CONFLICTS
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "detect_calendar_conflicts",
            "description": """Detect and suggest resolutions for scheduling conflicts.

Examples:
- "Do I have any conflicts this week?"
- "Check for overlapping meetings"
- "Any scheduling issues?"

Returns conflicts with resolution suggestions.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start of range (YYYY-MM-DD), defaults to today"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End of range (YYYY-MM-DD), defaults to 7 days from start"
                    }
                }
            }
        }
    }
]


# =============================================================================
# TOOL EXECUTION
# =============================================================================

async def execute_calendar_tool(
    tool_name: str,
    params: dict,
    user_id: str,
    session: AsyncSession,
    openai_client: AsyncOpenAI = None
) -> str:
    """
    Execute a calendar intelligence tool and return formatted response.

    Called from chat_service.py _execute_tool() method.
    """
    service = CalendarIntelligenceService(session)
    user_uuid = UUID(user_id)

    # Parse date parameter if present
    date = None
    if params.get("date"):
        try:
            date = datetime.fromisoformat(params["date"])
        except Exception:
            date = datetime.now()
    else:
        date = datetime.now()

    # =========================================================================
    # REORGANIZE DAY
    # =========================================================================
    if tool_name == "reorganize_day":
        instruction = params.get("instruction", "slow start")
        notify = params.get("notify_attendees", True)

        # Analyze and get proposed changes
        result = await service.analyze_and_reorganize_schedule(
            user_id=user_uuid,
            date=date,
            instruction=instruction
        )

        if not result.get("success"):
            return result.get("message", "Failed to analyze schedule")

        proposed_changes = result.get("proposed_changes", [])

        if not proposed_changes:
            return result.get("message", "No changes needed - your schedule already fits that goal.")

        # Execute the changes
        execute_result = await service.execute_reschedule(
            user_id=user_uuid,
            changes=proposed_changes,
            send_notifications=notify
        )

        # Format response
        if execute_result.get("success"):
            lines = [f"✅ Reorganized! {result.get('reasoning', '')}"]
            lines.append("")

            for r in execute_result.get("results", [])[:5]:
                lines.append(f"• {r['title']}: → {r['new_time']}")

            if execute_result.get("rescheduled", 0) > 5:
                lines.append(f"...and {execute_result['rescheduled'] - 5} more changes")

            return "\n".join(lines)
        else:
            errors = execute_result.get("errors", [])
            error_msgs = [e.get("error", "Unknown error") for e in errors[:3]]
            return f"❌ Some changes failed:\n" + "\n".join(error_msgs)

    # =========================================================================
    # FIND FREE TIME
    # =========================================================================
    elif tool_name == "find_free_time":
        duration = params.get("duration_minutes", 30)
        preference = params.get("time_preference", "any")

        result = await service.find_focus_time_slots(
            user_id=user_uuid,
            date=date,
            min_duration_minutes=duration,
            preferred_time=preference if preference != "any" else None
        )

        if not result.get("success"):
            return result.get("message", "Failed to find free time")

        slots = result.get("slots", [])

        if not slots:
            return f"No {duration}-minute slots available on {date.strftime('%A, %B %d')}. Want me to check tomorrow?"

        lines = [f"**Available {duration}+ minute slots on {date.strftime('%A, %B %d')}:**\n"]

        for slot in slots[:5]:
            start = slot.get("start", "")
            end = slot.get("end", "")
            duration_mins = slot.get("duration_minutes", 0)

            if isinstance(start, str) and "T" in start:
                try:
                    start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    start = start_dt.strftime("%I:%M %p")
                except Exception:
                    pass

            if isinstance(end, str) and "T" in end:
                try:
                    end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                    end = end_dt.strftime("%I:%M %p")
                except Exception:
                    pass

            duration_str = f"{duration_mins // 60}h {duration_mins % 60}m" if duration_mins >= 60 else f"{duration_mins}m"
            lines.append(f"• **{start} - {end}** ({duration_str})")

        if len(slots) > 5:
            lines.append(f"\n...and {len(slots) - 5} more")

        lines.append("\nWant me to block one of these?")

        return "\n".join(lines)

    # =========================================================================
    # DAY OVERVIEW
    # =========================================================================
    elif tool_name == "get_day_overview":
        include_suggestions = params.get("include_suggestions", True)

        result = await service.get_day_summary(
            user_id=user_uuid,
            date=date
        )

        if not result.get("success"):
            return result.get("message", "Failed to get day overview")

        summary = result.get("summary", {})
        lines = [f"**{date.strftime('%A, %B %d')}**\n"]

        # Events count
        total_events = summary.get("total_events", 0)
        total_meetings = summary.get("meetings_count", 0)

        if total_events == 0:
            lines.append("Your calendar is clear! 🎉")
            return "\n".join(lines)

        # Events list
        events = summary.get("events", [])
        for event in events[:8]:
            title = event.get("title", "Untitled")
            start = event.get("start", "")
            attendees = event.get("attendee_count", 0)

            if isinstance(start, str) and "T" in start:
                try:
                    start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    start = start_dt.strftime("%I:%M %p")
                except Exception:
                    pass

            icon = "👥" if attendees > 0 else "📅"
            lines.append(f"{icon} **{start}** - {title}")

        if total_events > 8:
            lines.append(f"...and {total_events - 8} more events")

        # Summary stats
        lines.append(f"\n📊 {total_events} events, {total_meetings} meetings")

        # Free time
        free_minutes = summary.get("free_time_minutes", 0)
        if free_minutes > 0:
            free_str = f"{free_minutes // 60}h {free_minutes % 60}m" if free_minutes >= 60 else f"{free_minutes}m"
            lines.append(f"⏱️ {free_str} of free time")

        # Insights/Suggestions
        if include_suggestions:
            insights = summary.get("insights", [])
            if insights:
                lines.append("\n💡 **Insights:**")
                for insight in insights[:3]:
                    lines.append(f"• {insight}")

        return "\n".join(lines)

    # =========================================================================
    # BLOCK TIME
    # =========================================================================
    elif tool_name == "block_time":
        title = params.get("title", "Blocked Time")
        start_time_str = params.get("start_time", "")
        duration = params.get("duration_minutes", 60)

        if not start_time_str:
            return "❌ Please specify a start time (e.g., '2pm', '14:00')"

        # Parse start time
        try:
            start_time = _parse_time_string(start_time_str)
            start = datetime.combine(date.date(), start_time)
        except Exception as e:
            return f"❌ Couldn't understand time '{start_time_str}'. Try '2pm' or '14:00'."

        result = await service.block_focus_time(
            user_id=user_uuid,
            date=date,
            start_time=start,
            duration_minutes=duration,
            title=title
        )

        if result.get("success"):
            end = start + timedelta(minutes=duration)
            return (
                f"✅ Blocked **{title}**\n"
                f"{start.strftime('%I:%M %p')} - {end.strftime('%I:%M %p')} ({duration} min)"
            )
        else:
            return f"❌ {result.get('message', 'Failed to create block')}"

    # =========================================================================
    # DETECT CONFLICTS
    # =========================================================================
    elif tool_name == "detect_calendar_conflicts":
        start_date = date
        end_date_str = params.get("end_date")

        if end_date_str:
            try:
                end_date = datetime.fromisoformat(end_date_str)
            except Exception:
                end_date = start_date + timedelta(days=7)
        else:
            end_date = start_date + timedelta(days=7)

        result = await service.detect_conflicts(
            user_id=user_uuid,
            start_date=start_date,
            end_date=end_date
        )

        if not result.get("success"):
            return result.get("message", "Failed to check for conflicts")

        conflicts = result.get("conflicts", [])

        if not conflicts:
            return f"✅ No scheduling conflicts found between {start_date.strftime('%b %d')} and {end_date.strftime('%b %d')}."

        lines = [f"⚠️ Found {len(conflicts)} conflicts:\n"]

        for conflict in conflicts[:5]:
            event1 = conflict.get("event1", {})
            event2 = conflict.get("event2", {})
            overlap = conflict.get("overlap_minutes", 0)

            lines.append(f"• **{event1.get('title', 'Event 1')}** overlaps with **{event2.get('title', 'Event 2')}**")
            lines.append(f"  ({overlap} minutes overlap)")

            suggestions = conflict.get("suggestions", [])
            if suggestions:
                lines.append(f"  💡 {suggestions[0]}")
            lines.append("")

        if len(conflicts) > 5:
            lines.append(f"...and {len(conflicts) - 5} more conflicts")

        lines.append("\nWant me to help resolve these?")

        return "\n".join(lines)

    return "Unknown calendar tool"


# =============================================================================
# HELPERS
# =============================================================================

def _parse_time_string(time_str: str) -> datetime.time:
    """Parse time string like '2pm', '14:00', '3:30pm' into time object."""
    from datetime import time as dt_time

    time_str = time_str.lower().strip()

    # Handle "2pm", "3:30pm" format
    pm_match = re.match(r'(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)?', time_str)
    if pm_match:
        hour = int(pm_match.group(1))
        minute = int(pm_match.group(2) or 0)
        ampm = pm_match.group(3)

        if ampm == 'pm' and hour != 12:
            hour += 12
        elif ampm == 'am' and hour == 12:
            hour = 0

        return dt_time(hour, minute)

    # Handle "14:00" format
    if ":" in time_str:
        parts = time_str.split(":")
        return dt_time(int(parts[0]), int(parts[1]))

    # Just hour
    return dt_time(int(time_str), 0)


# =============================================================================
# TOOL NAMES FOR ROUTING
# =============================================================================

CALENDAR_TOOL_NAMES = {
    "reorganize_day",
    "find_free_time",
    "get_day_overview",
    "block_time",
    "detect_calendar_conflicts"
}


def is_calendar_tool(tool_name: str) -> bool:
    """Check if a tool is a calendar intelligence tool."""
    return tool_name in CALENDAR_TOOL_NAMES


# =============================================================================
# STATUS MESSAGES
# =============================================================================

CALENDAR_TOOL_STATUS = {
    "reorganize_day": "Reorganizing your day...",
    "find_free_time": "Finding available time...",
    "get_day_overview": "Checking your calendar...",
    "block_time": "Blocking time...",
    "detect_calendar_conflicts": "Checking for conflicts..."
}


# =============================================================================
# READ-ONLY TOOLS (auto-execute without confirmation)
# =============================================================================

CALENDAR_READ_ONLY_TOOLS = {
    "find_free_time",
    "get_day_overview",
    "detect_calendar_conflicts"
}
