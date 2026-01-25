import json
import uuid
import asyncio
import time
import logging
from datetime import datetime, timedelta
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from functools import lru_cache

from app.config import get_settings
from app.services.openai_client import get_openai_client, select_model
from app.models.memory import Memory
from app.models.notification_preferences import NotificationPreferences
from app.services.search_service import SearchService
from app.services.sync_service import SyncService
from app.services.adaptive_learning_service import AdaptiveLearningService
from app.services.reminder_service import ReminderService
from app.services.chat_memory_extraction_service import ChatMemoryExtractionService
from app.services.cognitive_retrieval_service import CognitiveRetrievalService
from app.services.relationship_intelligence_service import RelationshipIntelligenceService
from app.services.proactive_intelligence_service import ProactiveIntelligenceService
from app.services.intelligence_tools import (
    execute_intelligence_tool,
    is_intelligence_tool,
    get_all_tools_with_intelligence,
)
from app.services.calendar_tools import (
    CALENDAR_TOOLS,
    execute_calendar_tool,
    is_calendar_tool,
    CALENDAR_TOOL_STATUS,
    CALENDAR_READ_ONLY_TOOLS,
)
from app.database import async_session_maker  # For parallel DB queries

logger = logging.getLogger(__name__)

settings = get_settings()

# Simple TTL cache for user preferences (avoids repeated DB queries)
_user_timezone_cache: dict[str, tuple[str, float]] = {}  # user_id -> (timezone, expiry_time)
_CACHE_TTL = 300  # 5 minutes


def _get_cached_timezone(user_id: str) -> str | None:
    """Get cached timezone if not expired."""
    if user_id in _user_timezone_cache:
        tz, expiry = _user_timezone_cache[user_id]
        if time.time() < expiry:
            return tz
        del _user_timezone_cache[user_id]
    return None


def _set_cached_timezone(user_id: str, timezone: str) -> None:
    """Cache timezone with TTL."""
    _user_timezone_cache[user_id] = (timezone, time.time() + _CACHE_TTL)


# Tool definitions with clear descriptions for better LLM understanding
TOOLS = [
    {"type": "function", "function": {
        "name": "create_calendar_event",
        "description": "Create a new calendar event. Use when user asks to schedule, book, or add something to calendar.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "description": "Event title"},
            "start_time": {"type": "string", "description": "Start time ISO 8601 (e.g., 2024-01-15T14:00:00)"},
            "end_time": {"type": "string", "description": "End time. Defaults to 1 hour after start."},
            "description": {"type": "string"},
            "location": {"type": "string"},
            "attendees": {"type": "array", "items": {"type": "object", "properties": {"email": {"type": "string"}, "name": {"type": "string"}}, "required": ["email"]}}
        }, "required": ["title", "start_time"]}
    }},
    {"type": "function", "function": {
        "name": "send_email",
        "description": "Send an email via Gmail. Use when user asks to email, message, or write to someone.",
        "parameters": {"type": "object", "properties": {
            "to": {"type": "array", "items": {"type": "object", "properties": {"email": {"type": "string"}, "name": {"type": "string"}}, "required": ["email"]}},
            "subject": {"type": "string"},
            "body": {"type": "string"},
            "cc": {"type": "array", "items": {"type": "object", "properties": {"email": {"type": "string"}, "name": {"type": "string"}}, "required": ["email"]}}
        }, "required": ["to", "subject", "body"]}
    }},
    {"type": "function", "function": {
        "name": "update_calendar_event",
        "description": "Update an existing calendar event",
        "parameters": {"type": "object", "properties": {
            "event_id": {"type": "string"},
            "title": {"type": "string"},
            "start_time": {"type": "string"},
            "end_time": {"type": "string"},
            "description": {"type": "string"},
            "location": {"type": "string"}
        }, "required": ["event_id"]}
    }},
    {"type": "function", "function": {
        "name": "delete_calendar_event",
        "description": "Delete a calendar event by ID",
        "parameters": {"type": "object", "properties": {
            "event_id": {"type": "string"},
            "send_notifications": {"type": "boolean", "default": True}
        }, "required": ["event_id"]}
    }},
    {"type": "function", "function": {
        "name": "get_calendar_events",
        "description": "Get calendar events/meetings. Use when user asks: 'what's on today', 'meetings tomorrow', 'my schedule', 'what do I have on [date]'.",
        "parameters": {"type": "object", "properties": {
            "date": {"type": "string", "description": "Date YYYY-MM-DD. Defaults to today."}
        }, "required": []}
    }},
    {"type": "function", "function": {
        "name": "find_free_time",
        "description": "Find when user is FREE/available. Use for: 'am I free at 2pm', 'when can I schedule', 'find time for meeting'.",
        "parameters": {"type": "object", "properties": {
            "date": {"type": "string", "description": "Date YYYY-MM-DD. Defaults to today."},
            "duration_minutes": {"type": "integer", "description": "How long the slot needs to be"},
            "start_hour": {"type": "integer", "description": "Start of search window (default 9)"},
            "end_hour": {"type": "integer", "description": "End of search window (default 18)"}
        }, "required": []}
    }},
    {"type": "function", "function": {
        "name": "reply_to_email",
        "description": "Reply to an existing email thread",
        "parameters": {"type": "object", "properties": {
            "thread_id": {"type": "string"},
            "body": {"type": "string"},
            "cc": {"type": "array", "items": {"type": "string"}}
        }, "required": ["thread_id", "body"]}
    }},
    {"type": "function", "function": {
        "name": "reschedule_events",
        "description": "Reschedule one or more calendar events to new times",
        "parameters": {"type": "object", "properties": {
            "events": {"type": "array", "items": {"type": "object", "properties": {
                "event_id": {"type": "string"},
                "new_start_time": {"type": "string"},
                "new_end_time": {"type": "string"}
            }, "required": ["event_id", "new_start_time"]}},
            "notify_attendees": {"type": "boolean"}
        }, "required": ["events"]}
    }},
    {"type": "function", "function": {
        "name": "search_places",
        "description": "Search for places, restaurants, venues nearby. Use for 'find a coffee shop', 'restaurants near me', etc.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "What to search for"},
            "near_location": {"type": "string", "description": "Location to search near"}
        }, "required": ["query"]}
    }},
    {"type": "function", "function": {
        "name": "get_email_thread",
        "description": "Get full email thread/conversation by ID",
        "parameters": {"type": "object", "properties": {
            "thread_id": {"type": "string"}
        }, "required": ["thread_id"]}
    }},
    {"type": "function", "function": {
        "name": "search_emails",
        "description": "Search emails. Use for 'any emails from X', 'unread messages', 'emails about Y'. ALWAYS use this for email queries.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Gmail search (e.g., 'from:john', 'is:unread', 'subject:meeting')"},
            "max_results": {"type": "integer", "description": "Max emails to return (default 10)"}
        }, "required": ["query"]}
    }},
    {"type": "function", "function": {
        "name": "create_reminder",
        "description": "Create a reminder for the user",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"},
            "remind_at": {"type": "string", "description": "When to remind (ISO 8601)"},
            "reminder_type": {"type": "string", "enum": ["time", "location"]},
            "location_name": {"type": "string"},
            "body": {"type": "string"}
        }, "required": ["title"]}
    }},
    {"type": "function", "function": {
        "name": "list_reminders",
        "description": "List user's reminders",
        "parameters": {"type": "object", "properties": {
            "include_completed": {"type": "boolean"}
        }}
    }},
    {"type": "function", "function": {
        "name": "list_tasks",
        "description": "List user's tasks",
        "parameters": {"type": "object", "properties": {
            "include_completed": {"type": "boolean"}
        }}
    }}
]

# Merge with intelligence tools (who_is, inbox_intelligence, smart_reply, etc.)
TOOLS = get_all_tools_with_intelligence(TOOLS)

# Merge with calendar intelligence tools (reorganize_day, find_free_time, etc.)
TOOLS = TOOLS + CALENDAR_TOOLS


class ChatService:
    """Service for chatting with memories using GPT-4o with function calling."""

    # Full system prompt with personality (restored for better UX)
    SYSTEM_PROMPT = """You are Cortex, a dry-witted second brain. Think TARS from Interstellar.

You hold the user's memories: thoughts, emails, calendar events, notes.

CRITICAL - Use tools for real-time data:
- "What's on my calendar" / "meetings today" → call get_calendar_events
- "Am I free at X" / "find time for" → call find_free_time
- Email queries → call search_emails
- Place searches → call search_places
- DO NOT answer calendar/email from memories alone - they may be stale

INTELLIGENCE TOOLS (use these for relationship-aware responses):
- "Who is X?" / "Tell me about X" → call who_is (full person context with relationship health)
- "Check my inbox" / "What needs attention?" → call get_inbox_intelligence (prioritized with context)
- "Draft reply to X" / "Reply and buy time" → call draft_smart_reply (style-matched)
- "Follow up with X" → call follow_up_with (finds last thread, drafts contextual follow-up)
- "Prep for meeting" → call prep_for_meeting (full context on attendees, promises, alerts)
- "What did I promise?" / "Commitments" → call what_did_i_promise
- "Morning briefing" / "What should I focus on?" → call get_morning_briefing
- "Who should I reach out to?" → call relationship_check

Your personality:
- Dry wit. Matter-of-fact. Occasionally deadpan humor.
- Brief and efficient. No fluff, no enthusiasm.
- Helpful but not sycophantic.
- Proactively useful - connect dots the user might miss.

How you speak:
- Short sentences. Get to the point.
- State facts, not feelings.
- For general knowledge questions, answer normally.
- Only say "I don't have memories about that" for personal questions you genuinely can't answer.

When taking action:
- Confirm briefly: "Sent." / "Scheduled." / "Done."
- If something fails: "That didn't work. [reason]"
- If unclear, ask ONE question.

Follow-up context:
- When user says "your choice", "go ahead", "pick one" - choose the best option from your last response
- Reference previous context naturally

PROACTIVE BEHAVIOR (after answering, add ONE brief note if genuinely relevant):
- Memory connects to topic → "Related: you mentioned [X] on [date]"
- User mentioned something to do → "Reminder: you said you'd [X]"
- Pattern detected → "Noticed you've brought up [X] a few times"
- Helpful suggestion → "Want me to [action]?"
Rules: Max 15 words. Skip if nothing relevant. Don't force it.

Never: apologize excessively, use emojis, fabricate from old memories

Current: {current_datetime} ({user_timezone})

Memories below - use for context, but use TOOLS for current calendar/email."""

    def __init__(self, search_service: SearchService, db: AsyncSession = None):
        self.search_service = search_service
        self.db = db
        # OPTIMIZATION: Use shared OpenAI client with connection pooling
        self.client = get_openai_client()
        # Cognitive retrieval for advanced memory search (FSRS, mood congruence, context)
        self.cognitive_service = CognitiveRetrievalService(db) if db else None
        # Relationship intelligence for people context
        self.relationship_service = RelationshipIntelligenceService(db) if db else None
        # In-memory conversation storage (use Redis in production)
        self._conversations: dict[str, list[dict]] = {}

    async def _get_user_timezone(self, user_id: str) -> str:
        """Get user's timezone from notification preferences, default to UTC."""
        if not self.db:
            return "UTC"
        try:
            from uuid import UUID
            result = await self.db.execute(
                select(NotificationPreferences.timezone)
                .where(NotificationPreferences.user_id == UUID(user_id))
            )
            tz = result.scalar_one_or_none()
            return tz or "UTC"
        except Exception as e:
            logger.warning(f"Could not get user timezone: {e}")
            return "UTC"

    async def _get_relationship_context(self, user_id: str) -> str:
        """Get relationship context (neglected relationships, important dates, promises)."""
        if not self.relationship_service or not self.db:
            return ""
        try:
            from uuid import UUID
            context = await self.relationship_service.get_relationship_context_for_chat(UUID(user_id))
            return context
        except Exception as e:
            logger.warning(f"Could not get relationship context: {e}")
            return ""

    def _format_memories_for_context(self, memories: list[Memory]) -> str:
        """Format memories into a context string for the LLM."""
        if not memories:
            return "No relevant memories found."

        formatted = []
        for i, memory in enumerate(memories, 1):
            date_str = memory.memory_date.strftime("%Y-%m-%d %H:%M")
            memory_text = f"""
Memory {i} ({memory.memory_type}, {date_str}):
{memory.content}
"""
            if memory.source_id:
                memory_text += f"Source ID: {memory.source_id}\n"
            if memory.summary:
                memory_text += f"Summary: {memory.summary}\n"
            formatted.append(memory_text)

        return "\n---\n".join(formatted)

    def _get_conversation(self, conversation_id: str) -> list[dict]:
        """Get or create a conversation history."""
        if conversation_id not in self._conversations:
            self._conversations[conversation_id] = []
        return self._conversations[conversation_id]

    def _add_to_conversation(
        self,
        conversation_id: str,
        role: str,
        content: str,
    ) -> None:
        """Add a message to conversation history."""
        conversation = self._get_conversation(conversation_id)
        conversation.append({"role": role, "content": content})

        # Keep only last 10 exchanges (20 messages) to limit context
        if len(conversation) > 20:
            self._conversations[conversation_id] = conversation[-20:]

    async def _get_user_model_prompt(self, user_id: str) -> str:
        """Get the dynamic user model prompt based on learned preferences."""
        if not self.db:
            return ""

        try:
            adaptive_service = AdaptiveLearningService(self.db)
            return await adaptive_service.get_user_model_prompt(uuid.UUID(user_id))
        except Exception:
            return ""

    async def _execute_tool(self, user_id: str, tool_name: str, arguments: dict) -> dict:
        """Execute a tool and return the result."""
        if not self.db:
            return {"success": False, "message": "Database connection not available"}

        sync_service = SyncService(self.db)

        try:
            if tool_name == "create_calendar_event":
                # Parse times
                start_time = datetime.fromisoformat(arguments["start_time"].replace("Z", "+00:00"))
                end_time_str = arguments.get("end_time")
                if end_time_str:
                    end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))
                else:
                    end_time = start_time + timedelta(hours=1)

                result = await sync_service.create_calendar_event(
                    user_id=uuid.UUID(user_id),
                    title=arguments["title"],
                    start_time=start_time,
                    end_time=end_time,
                    description=arguments.get("description"),
                    location=arguments.get("location"),
                    attendees=arguments.get("attendees"),
                )
                return result

            elif tool_name == "send_email":
                result = await sync_service.send_email(
                    user_id=uuid.UUID(user_id),
                    to=arguments["to"],
                    subject=arguments["subject"],
                    body=arguments["body"],
                    cc=arguments.get("cc"),
                )
                return result

            elif tool_name == "update_calendar_event":
                start_time = None
                end_time = None
                if arguments.get("start_time"):
                    start_time = datetime.fromisoformat(arguments["start_time"].replace("Z", "+00:00"))
                if arguments.get("end_time"):
                    end_time = datetime.fromisoformat(arguments["end_time"].replace("Z", "+00:00"))

                result = await sync_service.update_calendar_event(
                    user_id=uuid.UUID(user_id),
                    event_id=arguments["event_id"],
                    title=arguments.get("title"),
                    start_time=start_time,
                    end_time=end_time,
                    description=arguments.get("description"),
                    location=arguments.get("location"),
                )
                return result

            elif tool_name == "delete_calendar_event":
                result = await sync_service.delete_calendar_event(
                    user_id=uuid.UUID(user_id),
                    event_id=arguments["event_id"],
                    send_notifications=arguments.get("send_notifications", True),
                )
                return result

            elif tool_name == "get_calendar_events":
                # Parse date or use today
                date_str = arguments.get("date")
                if date_str:
                    search_date = datetime.fromisoformat(date_str)
                else:
                    search_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

                # Get events for the whole day
                time_min = search_date.replace(hour=0, minute=0)
                time_max = search_date.replace(hour=23, minute=59)

                result = await sync_service.get_calendar_events(
                    user_id=uuid.UUID(user_id),
                    start_date=time_min,
                    end_date=time_max,
                )

                # Format events nicely
                if result.get("success") and result.get("events"):
                    formatted = []
                    for event in result["events"][:10]:
                        title = event.get("title", event.get("summary", "Untitled"))
                        start = event.get("start")
                        end = event.get("end")

                        # Parse and format times
                        if isinstance(start, str):
                            try:
                                start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                                start_str = start_dt.strftime("%I:%M %p")
                            except Exception:
                                start_str = start
                        elif isinstance(start, datetime):
                            start_str = start.strftime("%I:%M %p")
                        else:
                            start_str = str(start) if start else ""

                        if isinstance(end, str):
                            try:
                                end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                                end_str = end_dt.strftime("%I:%M %p")
                            except Exception:
                                end_str = end
                        elif isinstance(end, datetime):
                            end_str = end.strftime("%I:%M %p")
                        else:
                            end_str = ""

                        if start_str and end_str:
                            formatted.append(f"{start_str} - {end_str}: {title}")
                        elif start_str:
                            formatted.append(f"{start_str}: {title}")
                        else:
                            formatted.append(title)

                    result["formatted_events"] = formatted
                return result

            elif tool_name == "find_free_time":
                # Parse date or use today
                date_str = arguments.get("date")
                if date_str:
                    search_date = datetime.fromisoformat(date_str)
                else:
                    search_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

                start_hour = arguments.get("start_hour", 9)
                end_hour = arguments.get("end_hour", 18)
                duration = arguments.get("duration_minutes", 30)

                time_min = search_date.replace(hour=start_hour, minute=0)
                time_max = search_date.replace(hour=end_hour, minute=0)

                result = await sync_service.find_free_slots(
                    user_id=uuid.UUID(user_id),
                    time_min=time_min,
                    time_max=time_max,
                    duration_minutes=duration,
                )

                # Format for display
                if result["success"] and result["free_slots"]:
                    slots_text = []
                    for slot in result["free_slots"][:5]:  # Limit to 5 slots
                        start = slot["start"]
                        if isinstance(start, datetime):
                            slots_text.append(f"{start.strftime('%I:%M %p')} - {slot['end'].strftime('%I:%M %p')} ({slot['duration_minutes']} min)")
                    result["formatted_slots"] = slots_text
                return result

            elif tool_name == "reply_to_email":
                result = await sync_service.reply_to_thread(
                    user_id=uuid.UUID(user_id),
                    thread_id=arguments["thread_id"],
                    body=arguments["body"],
                    cc=arguments.get("cc"),
                )
                return result

            elif tool_name == "reschedule_events":
                events = arguments.get("events", [])
                notify = arguments.get("notify_attendees", True)

                # Convert string times to datetime if needed
                event_updates = []
                for event in events:
                    update = {"event_id": event["event_id"]}
                    if event.get("new_start_time"):
                        update["new_start_time"] = datetime.fromisoformat(
                            event["new_start_time"].replace("Z", "+00:00")
                        )
                    if event.get("new_end_time"):
                        update["new_end_time"] = datetime.fromisoformat(
                            event["new_end_time"].replace("Z", "+00:00")
                        )
                    event_updates.append(update)

                result = await sync_service.batch_reschedule_events(
                    user_id=uuid.UUID(user_id),
                    event_updates=event_updates,
                    send_notifications=notify,
                )
                return result

            elif tool_name == "search_places":
                result = await sync_service.search_places(
                    user_id=uuid.UUID(user_id),
                    query=arguments["query"],
                )
                return result

            elif tool_name == "get_email_thread":
                result = await sync_service.get_email_thread(
                    user_id=uuid.UUID(user_id),
                    thread_id=arguments["thread_id"],
                )
                return result

            elif tool_name == "search_emails":
                result = await sync_service.search_emails(
                    user_id=uuid.UUID(user_id),
                    query=arguments["query"],
                    max_results=arguments.get("max_results", 10),
                )
                return result

            elif tool_name == "create_reminder":
                reminder_service = ReminderService(self.db)

                # Parse remind_at time if provided
                remind_at = None
                if arguments.get("remind_at"):
                    remind_at = datetime.fromisoformat(
                        arguments["remind_at"].replace("Z", "+00:00")
                    )

                reminder_type = arguments.get("reminder_type", "time")

                reminder = await reminder_service.create_reminder(
                    user_id=uuid.UUID(user_id),
                    title=arguments["title"],
                    remind_at=remind_at,
                    body=arguments.get("body"),
                    reminder_type=reminder_type,
                    location_name=arguments.get("location_name"),
                )

                return {
                    "success": True,
                    "reminder_id": str(reminder.id),
                    "title": reminder.title,
                    "remind_at": reminder.remind_at.isoformat() if reminder.remind_at else None,
                    "reminder_type": reminder.reminder_type,
                    "message": f"Reminder set: {reminder.title}",
                }

            elif tool_name == "list_reminders":
                reminder_service = ReminderService(self.db)

                reminders = await reminder_service.list_reminders(
                    user_id=uuid.UUID(user_id),
                    include_completed=arguments.get("include_completed", False),
                )

                reminder_list = []
                for r in reminders:
                    reminder_list.append({
                        "id": str(r.id),
                        "title": r.title,
                        "remind_at": r.remind_at.isoformat() if r.remind_at else None,
                        "type": r.reminder_type,
                        "status": r.status,
                    })

                return {
                    "success": True,
                    "reminders": reminder_list,
                    "count": len(reminder_list),
                    "message": f"Found {len(reminder_list)} reminders",
                }

            elif tool_name == "list_tasks":
                reminder_service = ReminderService(self.db)

                tasks = await reminder_service.list_tasks(
                    user_id=uuid.UUID(user_id),
                    include_completed=arguments.get("include_completed", False),
                )

                task_list = []
                for t in tasks:
                    task_list.append({
                        "id": str(t.id),
                        "title": t.title,
                        "due_date": t.due_date.isoformat() if t.due_date else None,
                        "priority": t.priority,
                        "completed": t.is_completed,
                    })

                return {
                    "success": True,
                    "tasks": task_list,
                    "count": len(task_list),
                    "message": f"Found {len(task_list)} tasks",
                }

            # Check if it's an intelligence tool (who_is, inbox_intelligence, etc.)
            elif is_intelligence_tool(tool_name):
                result = await execute_intelligence_tool(
                    tool_name=tool_name,
                    arguments=arguments,
                    user_id=user_id,
                    db=self.db
                )
                return result

            # Check if it's a calendar intelligence tool (reorganize_day, etc.)
            elif is_calendar_tool(tool_name):
                result = await execute_calendar_tool(
                    tool_name=tool_name,
                    params=arguments,
                    user_id=user_id,
                    session=self.db,
                    openai_client=self.client
                )
                return {"success": True, "message": result}

            else:
                return {"success": False, "message": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"success": False, "message": f"Error executing {tool_name}: {str(e)}"}

    async def chat(
        self,
        user_id: str,
        message: str,
        conversation_id: str | None = None,
        auto_execute: bool = False,
    ) -> tuple[str, list[Memory], str, list[dict], list[dict]]:
        """
        Chat with memories (non-streaming) with function calling support.

        Args:
            user_id: The user's ID
            message: User's message
            conversation_id: Optional conversation ID for follow-ups
            auto_execute: If True, execute actions automatically. If False, return pending actions.

        Returns:
            Tuple of (response text, memories used, conversation_id, actions_taken, pending_actions)
        """
        # Generate or use existing conversation ID
        conv_id = conversation_id or str(uuid.uuid4())
        actions_taken = []
        pending_actions = []

        # Search for relevant memories
        memories = await self.search_service.search(
            user_id=user_id,
            query=message,
            limit=10,
        )

        # Format memories for context
        memory_context = self._format_memories_for_context(memories)

        # Build system prompt with current time
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        system_prompt = self.SYSTEM_PROMPT.format(current_datetime=current_time)

        # Get learned user model for personalization
        user_model_prompt = await self._get_user_model_prompt(user_id)

        # Build messages
        messages = [
            {"role": "system", "content": system_prompt},
        ]

        # Add user model if available (personalization from adaptive learning)
        if user_model_prompt:
            messages.append({"role": "system", "content": user_model_prompt})

        messages.append({"role": "system", "content": f"User's relevant memories:\n{memory_context}"})

        # Add conversation history
        conversation = self._get_conversation(conv_id)
        messages.extend(conversation)

        # Add current message
        messages.append({"role": "user", "content": message})

        # Call GPT-4o with tools
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.7,
            max_tokens=1000,
        )

        response_message = response.choices[0].message

        # Handle tool calls if any
        if response_message.tool_calls:
            if auto_execute:
                # Original behavior: execute immediately
                messages.append({
                    "role": "assistant",
                    "content": response_message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments
                            }
                        }
                        for tc in response_message.tool_calls
                    ]
                })

                for tool_call in response_message.tool_calls:
                    tool_name = tool_call.function.name
                    arguments = json.loads(tool_call.function.arguments)
                    result = await self._execute_tool(user_id, tool_name, arguments)
                    actions_taken.append({
                        "tool": tool_name,
                        "arguments": arguments,
                        "result": result
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result)
                    })

                final_response = await self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=messages,
                    temperature=0.7,
                    max_tokens=1000,
                )
                assistant_message = final_response.choices[0].message.content
            else:
                # New behavior: return pending actions for user confirmation
                for tool_call in response_message.tool_calls:
                    tool_name = tool_call.function.name
                    arguments = json.loads(tool_call.function.arguments)
                    pending_actions.append({
                        "action_id": tool_call.id,
                        "tool": tool_name,
                        "arguments": arguments
                    })

                # Generate a response that asks for confirmation
                assistant_message = response_message.content or self._generate_confirmation_prompt(pending_actions)
        else:
            assistant_message = response_message.content

        # Update conversation history
        self._add_to_conversation(conv_id, "user", message)
        self._add_to_conversation(conv_id, "assistant", assistant_message)

        # Extract memories from conversation (runs in background, doesn't block)
        try:
            conversation_history = self._get_conversation(conv_id)
            if conversation_history and len(conversation_history) >= 2:
                memory_extractor = ChatMemoryExtractionService(self.db)
                asyncio.create_task(
                    memory_extractor.extract_and_save_memories(
                        user_id=uuid.UUID(user_id),
                        conversation=conversation_history,
                        min_importance=4,
                    )
                )
        except Exception as e:
            # Memory extraction should never break the chat
            logger.warning(f"Memory extraction failed (non-blocking): {e}")

        return assistant_message, memories, conv_id, actions_taken, pending_actions

    def _format_tool_result(self, tool_name: str, result: dict) -> str:
        """Format the result of a read-only tool into human-readable text."""
        if tool_name == "search_places":
            places = result.get("places", [])
            if not places:
                return "I couldn't find any places matching your search."

            lines = ["Here are some options:\n"]
            for i, place in enumerate(places[:5], 1):
                name = place.get("name", "Unknown")
                address = place.get("address", "")
                rating = place.get("rating")
                rating_str = f" • {rating}★" if rating else ""
                lines.append(f"{i}. **{name}**{rating_str}\n   {address}")
            return "\n".join(lines)

        elif tool_name == "get_calendar_events":
            events = result.get("events", [])
            formatted = result.get("formatted_events", [])

            if not events and not formatted:
                return "Nothing on your calendar for that day."

            if formatted:
                lines = ["Your schedule:\n"]
                for event in formatted[:10]:
                    lines.append(f"• {event}")
                return "\n".join(lines)
            else:
                lines = ["Your schedule:\n"]
                for event in events[:10]:
                    title = event.get("title", event.get("summary", "Untitled"))
                    lines.append(f"• {title}")
                return "\n".join(lines)

        elif tool_name == "find_free_time":
            slots = result.get("free_slots", [])
            formatted = result.get("formatted_slots", [])
            if not slots and not formatted:
                return "Your calendar looks fully booked for that time."

            if formatted:
                lines = ["Your free slots:\n"]
                for slot in formatted[:5]:
                    lines.append(f"• {slot}")
                return "\n".join(lines)
            else:
                lines = ["Your free slots:\n"]
                for slot in slots[:5]:
                    start = slot.get("start", "")
                    duration = slot.get("duration_minutes", 0)
                    if hasattr(start, 'strftime'):
                        start_str = start.strftime("%I:%M %p")
                    else:
                        start_str = str(start)
                    lines.append(f"• {start_str} ({duration} min available)")
                return "\n".join(lines)

        elif tool_name == "get_email_thread":
            messages = result.get("messages", [])
            if not messages:
                return "I couldn't find that email thread."

            lines = [f"Thread with {len(messages)} messages:\n"]
            for msg in messages[:5]:
                sender = msg.get("from", "Unknown")
                subject = msg.get("subject", "No subject")
                snippet = msg.get("body", "")[:100]
                lines.append(f"**{sender}**: {subject}\n{snippet}...")
            return "\n".join(lines)

        elif tool_name == "search_emails":
            emails = result.get("emails", [])
            if not emails:
                return "No emails found matching your search."

            lines = [f"Found {len(emails)} emails:\n"]
            for email in emails[:5]:
                sender = email.get("from", "Unknown")
                subject = email.get("subject", "No subject")
                lines.append(f"• **{subject}** from {sender}")
            return "\n".join(lines)

        # Intelligence tools return pre-formatted response
        elif tool_name in {
            "who_is", "get_inbox_intelligence", "draft_smart_reply",
            "follow_up_with", "prep_for_meeting", "what_did_i_promise",
            "get_morning_briefing", "relationship_check"
        }:
            return result.get("response", "")

        return ""

    def _get_tool_status_message(self, tool_name: str) -> str:
        """Return user-friendly status message for tool execution."""
        messages = {
            "get_calendar_events": "Checking your calendar...",
            "search_places": "Looking up nearby places...",
            "find_free_time": "Finding free slots...",
            "search_emails": "Searching your emails...",
            "get_email_thread": "Loading email conversation...",
            "create_calendar_event": "Preparing calendar event...",
            "send_email": "Drafting email...",
            "reschedule_events": "Analyzing your schedule...",
            "update_calendar_event": "Updating calendar event...",
            "delete_calendar_event": "Removing calendar event...",
            "reply_to_email": "Preparing email reply...",
            "create_reminder": "Setting reminder...",
            "list_reminders": "Checking your reminders...",
            "list_tasks": "Loading your tasks...",
            # Intelligence tools
            "who_is": "Looking up who they are...",
            "get_inbox_intelligence": "Analyzing your inbox...",
            "draft_smart_reply": "Drafting contextual reply...",
            "follow_up_with": "Finding last conversation...",
            "prep_for_meeting": "Preparing meeting context...",
            "what_did_i_promise": "Checking your commitments...",
            "get_morning_briefing": "Building your briefing...",
            "relationship_check": "Checking relationship health...",
            # Calendar intelligence tools
            "reorganize_day": "Reorganizing your day...",
            "get_day_overview": "Checking your calendar...",
            "block_time": "Blocking time...",
            "detect_calendar_conflicts": "Checking for conflicts...",
        }
        return messages.get(tool_name, f"Processing {tool_name}...")

    def _get_tool_complete_message(self, tool_name: str, result: dict) -> str:
        """Return completion message based on tool result."""
        if not result.get("success", True):
            return "Couldn't complete that action"

        if tool_name == "get_calendar_events":
            count = len(result.get("events", []))
            if count == 0:
                return "No events found"
            return f"Found {count} events"
        elif tool_name == "search_places":
            count = len(result.get("places", []))
            return f"Found {count} places nearby"
        elif tool_name == "find_free_time":
            count = len(result.get("free_slots", result.get("formatted_slots", [])))
            return f"Found {count} available time slots"
        elif tool_name == "search_emails":
            count = len(result.get("emails", []))
            return f"Found {count} matching emails"
        elif tool_name == "get_email_thread":
            count = len(result.get("messages", []))
            return f"Loaded thread with {count} messages"
        elif tool_name == "create_reminder":
            return "Reminder set"
        elif tool_name == "list_reminders":
            count = result.get("count", 0)
            return f"Found {count} reminders"
        elif tool_name == "list_tasks":
            count = result.get("count", 0)
            return f"Found {count} tasks"
        # Intelligence tools
        elif tool_name == "who_is":
            return "Got their profile"
        elif tool_name == "get_inbox_intelligence":
            return "Inbox analyzed"
        elif tool_name == "draft_smart_reply":
            return "Reply drafted"
        elif tool_name == "follow_up_with":
            return "Found context"
        elif tool_name == "prep_for_meeting":
            return "Meeting prep ready"
        elif tool_name == "what_did_i_promise":
            return "Checked commitments"
        elif tool_name == "get_morning_briefing":
            return "Briefing ready"
        elif tool_name == "relationship_check":
            return "Relationships checked"
        return "Done"

    def _generate_confirmation_prompt(self, pending_actions: list[dict]) -> str:
        """Generate a message asking user to confirm pending actions."""
        if not pending_actions:
            return ""

        parts = []
        for action in pending_actions:
            tool = action["tool"]
            args = action["arguments"]

            if tool == "send_email":
                recipients = ", ".join([r.get("email", "") for r in args.get("to", [])])
                parts.append(f"Send an email to {recipients} with subject \"{args.get('subject', '')}\"")
            elif tool == "create_calendar_event":
                parts.append(f"Create event \"{args.get('title', '')}\" at {args.get('start_time', '')}")
            elif tool == "update_calendar_event":
                parts.append(f"Update event {args.get('event_id', '')}")
            elif tool == "delete_calendar_event":
                parts.append(f"Delete event {args.get('event_id', '')}")

        if len(parts) == 1:
            return f"I've prepared to {parts[0].lower()}. Please review and confirm."
        else:
            actions_list = "\n".join([f"• {p}" for p in parts])
            return f"I've prepared the following actions:\n{actions_list}\n\nPlease review and confirm."

    async def chat_stream(
        self,
        user_id: str,
        message: str,
        conversation_id: str | None = None,
        current_context: dict | None = None,
    ) -> AsyncGenerator[dict, None]:
        """
        Chat with memories (streaming via SSE) with function calling support.

        Uses a SINGLE streaming call for performance.

        Args:
            user_id: The user's ID
            message: User's message
            conversation_id: Optional conversation ID for follow-ups
            current_context: Optional context from frontend for context reinstatement

        Yields:
            Dicts with type ('content', 'memories', 'action', 'done', 'error') and data
        """
        # TIMING: Start total request timer
        t_start = time.perf_counter()
        conv_id = conversation_id or str(uuid.uuid4())

        try:
            # Status: Searching memories
            yield {"type": "status", "data": {"step": "searching_memories", "message": "Checking memory"}}

            # PARALLEL context loading - shielded from cancellation
            from uuid import UUID

            # Results containers with defaults
            memories = []
            memory_context = None
            user_timezone = "UTC"
            user_model_prompt = ""
            relationship_context = ""
            proactive_context = ""

            async def fetch_memories():
                """Fast memory search with formatting."""
                async with async_session_maker() as session:
                    try:
                        search_service = SearchService(session)
                        mems = await search_service.search_fast(
                            user_id=UUID(user_id),
                            query=message,
                            limit=5,
                        )
                        # Format memories into context string for LLM
                        if mems:
                            ctx = "\n\n".join([
                                f"Memory ({m.memory_type}, {m.memory_date.strftime('%Y-%m-%d') if m.memory_date else 'unknown'}):\n{m.content}"
                                for m in mems
                            ])
                            logger.debug(f"[FETCH] Found {len(mems)} memories, context length: {len(ctx)}")
                        else:
                            ctx = None
                            logger.debug("[FETCH] No memories found")
                        return mems, ctx
                    except Exception as e:
                        logger.error(f"[FETCH] Memory search failed: {e}")
                        return [], None

            async def fetch_timezone():
                """Get user timezone with caching."""
                # Check cache first (avoids DB roundtrip)
                cached = _get_cached_timezone(user_id)
                if cached:
                    return cached

                async with async_session_maker() as session:
                    try:
                        result = await session.execute(
                            select(NotificationPreferences.timezone)
                            .where(NotificationPreferences.user_id == UUID(user_id))
                        )
                        tz = result.scalar_one_or_none() or "UTC"
                        _set_cached_timezone(user_id, tz)
                        return tz
                    except Exception:
                        return "UTC"

            async def fetch_user_model():
                """Get user model with its own DB session."""
                async with async_session_maker() as session:
                    try:
                        adaptive_service = AdaptiveLearningService(session)
                        return await adaptive_service.get_user_model_prompt(uuid.UUID(user_id))
                    except Exception:
                        return ""

            async def fetch_relationships():
                """Get relationship context with its own DB session."""
                async with async_session_maker() as session:
                    try:
                        rel_service = RelationshipIntelligenceService(session)
                        return await rel_service.get_relationship_context_for_chat(UUID(user_id))
                    except Exception:
                        return ""

            async def fetch_proactive_context():
                """Get proactive intelligence context (intentions, patterns, upcoming events)."""
                async with async_session_maker() as session:
                    try:
                        proactive_service = ProactiveIntelligenceService(session, self.client)
                        return await proactive_service.build_proactive_context(
                            user_id=UUID(user_id),
                            current_message=message
                        )
                    except Exception as e:
                        logger.warning(f"Proactive context failed: {e}")
                        return ""

            # Shield the parallel block from cancellation to prevent session race conditions
            async def run_parallel():
                return await asyncio.gather(
                    fetch_memories(),
                    fetch_timezone(),
                    fetch_user_model(),
                    fetch_relationships(),
                    fetch_proactive_context(),
                    return_exceptions=True,
                )

            try:
                results = await asyncio.shield(run_parallel())

                # Extract results safely
                if not isinstance(results[0], Exception) and results[0]:
                    memories, memory_context = results[0]
                if not isinstance(results[1], Exception):
                    user_timezone = results[1]
                if not isinstance(results[2], Exception):
                    user_model_prompt = results[2]
                if not isinstance(results[3], Exception):
                    relationship_context = results[3]
                if not isinstance(results[4], Exception):
                    proactive_context = results[4]
            except asyncio.CancelledError:
                # Stream was cancelled, use defaults
                logger.info("Parallel context load cancelled, using defaults")

            # Status: Memories found
            if memories:
                yield {"type": "status", "data": {
                    "step": "memories_found",
                    "message": f"Found {len(memories)} memories",
                    "count": len(memories)
                }}

            # Yield memories first
            memory_data = [
                {
                    "id": str(m.id),
                    "content": m.content[:200],
                    "memory_type": m.memory_type,
                    "memory_date": m.memory_date.isoformat(),
                    "photo_url": m.photo_url,
                    "audio_url": m.audio_url,
                }
                for m in memories
            ]
            yield {"type": "memories", "data": memory_data}

            # Use pre-formatted context if available, otherwise format here
            if not memory_context:
                memory_context = self._format_memories_for_context(memories)

            # Build system prompt with current time and user's timezone
            current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            system_prompt = self.SYSTEM_PROMPT.format(current_datetime=current_time, user_timezone=user_timezone)

            # Build messages
            messages = [
                {"role": "system", "content": system_prompt},
            ]

            if user_model_prompt:
                messages.append({"role": "system", "content": user_model_prompt})

            # Only inject memories if we have actual content
            if memory_context and memory_context.strip():
                messages.append({"role": "system", "content": f"User's relevant memories:\n{memory_context}"})
                logger.debug(f"[CHAT] Injected {len(memory_context)} chars of memory context")
            else:
                logger.debug(f"[CHAT] No memory context to inject (memories found: {len(memories)})")

            # Add relationship context if available (neglected relationships, important dates, promises)
            if relationship_context:
                messages.append({"role": "system", "content": f"Relationship awareness (proactively mention if relevant):{relationship_context}"})

            # Add proactive context if available (intentions, patterns, upcoming events)
            if proactive_context and proactive_context.strip():
                messages.append({"role": "system", "content": proactive_context})
                logger.debug(f"[CHAT] Injected proactive context: {len(proactive_context)} chars")

            # Add conversation history
            conversation = self._get_conversation(conv_id)
            messages.extend(conversation)
            messages.append({"role": "user", "content": message})

            # Status: Thinking
            yield {"type": "status", "data": {"step": "generating", "message": "Thinking..."}}

            # OPTIMIZATION: Smart model selection based on query complexity
            selected_model = select_model(message, has_tools=True)

            # SINGLE streaming call with tools - much faster!
            t_llm_start = time.perf_counter()
            stream = await self.client.chat.completions.create(
                model=selected_model,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.7,
                max_tokens=1000,
                stream=True,
            )

            # Accumulate response and tool calls
            full_response = ""
            tool_calls_data = {}  # id -> {name, arguments_str}
            t_first_token = None

            async for chunk in stream:
                # Track time to first token (TTFT)
                if t_first_token is None:
                    t_first_token = time.perf_counter()
                    ttft = (t_first_token - t_llm_start) * 1000
                    total_to_first_token = (t_first_token - t_start) * 1000
                    logger.info(f"[DIAG] LLM_TTFT: {ttft:.1f}ms | TOTAL_TO_FIRST_TOKEN: {total_to_first_token:.1f}ms")
                delta = chunk.choices[0].delta

                # Handle content streaming
                if delta.content:
                    full_response += delta.content
                    yield {"type": "content", "data": delta.content}

                # Handle tool call streaming
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        tc_id = tc.id or list(tool_calls_data.keys())[-1] if tool_calls_data else None
                        if tc.id:
                            # New tool call
                            tool_calls_data[tc.id] = {
                                "name": tc.function.name if tc.function else "",
                                "arguments": tc.function.arguments if tc.function else ""
                            }
                        elif tc_id and tc.function:
                            # Continuation of existing tool call
                            if tc.function.name:
                                tool_calls_data[tc_id]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_data[tc_id]["arguments"] += tc.function.arguments

            # If we got tool calls, handle them based on type
            if tool_calls_data:
                # Read-only tools that should auto-execute (no user confirmation needed)
                READ_ONLY_TOOLS = {
                    "get_calendar_events",
                    "find_free_time",
                    "search_places",
                    "get_email_thread",
                    "search_emails",
                    # Intelligence tools (all read-only)
                    "who_is",
                    "get_inbox_intelligence",
                    "draft_smart_reply",
                    "follow_up_with",
                    "prep_for_meeting",
                    "what_did_i_promise",
                    "get_morning_briefing",
                    "relationship_check",
                    # Calendar intelligence tools (read-only)
                    "get_day_overview",
                    "detect_calendar_conflicts",
                }

                pending_actions = []
                auto_executed = []

                for tc_id, tc_data in tool_calls_data.items():
                    try:
                        arguments = json.loads(tc_data["arguments"])
                        tool_name = tc_data["name"]

                        if tool_name in READ_ONLY_TOOLS:
                            # Status: Tool calling
                            yield {"type": "status", "data": {
                                "step": "tool_calling",
                                "message": self._get_tool_status_message(tool_name),
                                "tool": tool_name
                            }}

                            # Auto-execute read-only tools
                            result = await self._execute_tool(user_id, tool_name, arguments)

                            # Status: Tool complete
                            yield {"type": "status", "data": {
                                "step": "tool_complete",
                                "message": self._get_tool_complete_message(tool_name, result),
                                "tool": tool_name
                            }}

                            auto_executed.append({
                                "tool": tool_name,
                                "arguments": arguments,
                                "result": result
                            })

                            # Stream the result as content
                            if result.get("success"):
                                result_text = self._format_tool_result(tool_name, result)
                                if result_text and not full_response:
                                    full_response = result_text
                                    yield {"type": "content", "data": result_text}
                            else:
                                # Handle failed tool results (e.g., "Calendar not connected")
                                error_msg = result.get("message", "Couldn't complete that.")
                                if "not connected" in error_msg.lower():
                                    full_response = "Can't check that. Calendar's not connected."
                                else:
                                    full_response = error_msg
                                yield {"type": "content", "data": full_response}
                        else:
                            # Write tools need confirmation
                            pending_actions.append({
                                "action_id": tc_id,
                                "tool": tool_name,
                                "arguments": arguments
                            })
                    except json.JSONDecodeError:
                        continue

                # Yield auto-executed actions as completed
                if auto_executed:
                    yield {"type": "actions_taken", "data": auto_executed}

                # Yield pending actions for confirmation
                if pending_actions:
                    yield {"type": "pending_actions", "data": pending_actions}

                    # Generate confirmation if no content was streamed
                    if not full_response:
                        full_response = self._generate_confirmation_prompt(pending_actions)
                        yield {"type": "content", "data": full_response}

            # Update conversation history
            self._add_to_conversation(conv_id, "user", message)
            self._add_to_conversation(conv_id, "assistant", full_response)

            # Extract memories from conversation (runs in background, doesn't block)
            try:
                conversation_history = self._get_conversation(conv_id)
                if conversation_history and len(conversation_history) >= 2:
                    memory_extractor = ChatMemoryExtractionService(self.db)
                    asyncio.create_task(
                        memory_extractor.extract_and_save_memories(
                            user_id=uuid.UUID(user_id),
                            conversation=conversation_history,
                            min_importance=4,  # Only save moderately important+ memories
                        )
                    )
            except Exception as e:
                # Memory extraction should never break the chat
                logger.warning(f"Memory extraction failed (non-blocking): {e}")

            # Background: Extract intentions from user message and check for completions
            async def background_intention_processing():
                async with async_session_maker() as session:
                    try:
                        proactive_service = ProactiveIntelligenceService(session, self.client)
                        # Extract new intentions from user message
                        await proactive_service.extract_and_store_intentions(
                            user_id=UUID(user_id),
                            message=message
                        )
                        # Check if user's message indicates completion of a pending intention
                        await proactive_service.check_for_completion_signals(
                            user_id=UUID(user_id),
                            message=message
                        )
                    except Exception as e:
                        logger.warning(f"Background intention processing failed: {e}")

            asyncio.create_task(background_intention_processing())

            # TIMING: Log total streaming time
            t_total = time.perf_counter() - t_start
            logger.debug(f"Total chat_stream() took {t_total*1000:.1f}ms")

            # Signal completion
            yield {"type": "done", "data": {"conversation_id": conv_id}}

        except Exception as e:
            yield {"type": "error", "data": str(e)}
