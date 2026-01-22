import json
import uuid
from datetime import datetime, timedelta
from typing import AsyncGenerator
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.memory import Memory
from app.services.search_service import SearchService
from app.services.sync_service import SyncService
from app.services.adaptive_learning_service import AdaptiveLearningService
from app.services.reminder_service import ReminderService

settings = get_settings()


# Define tools for function calling
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_calendar_event",
            "description": "Create a new calendar event on the user's Google Calendar. Use this when the user asks to schedule a meeting, add an event, or create a calendar entry.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "The title/name of the event"
                    },
                    "start_time": {
                        "type": "string",
                        "description": "Start time in ISO 8601 format (e.g., 2024-01-15T14:00:00)"
                    },
                    "end_time": {
                        "type": "string",
                        "description": "End time in ISO 8601 format. If not specified, default to 1 hour after start."
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional description or notes for the event"
                    },
                    "location": {
                        "type": "string",
                        "description": "Optional location for the event"
                    },
                    "attendees": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string"},
                                "name": {"type": "string"}
                            },
                            "required": ["email"]
                        },
                        "description": "List of attendees with their email addresses"
                    }
                },
                "required": ["title", "start_time"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Send an email via Gmail. Use this when the user asks to send, compose, or write an email to someone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string"},
                                "name": {"type": "string"}
                            },
                            "required": ["email"]
                        },
                        "description": "List of recipients"
                    },
                    "subject": {
                        "type": "string",
                        "description": "Email subject line"
                    },
                    "body": {
                        "type": "string",
                        "description": "Email body content"
                    },
                    "cc": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string"},
                                "name": {"type": "string"}
                            },
                            "required": ["email"]
                        },
                        "description": "Optional CC recipients"
                    }
                },
                "required": ["to", "subject", "body"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_calendar_event",
            "description": "Update or reschedule an existing calendar event. Use this when the user wants to change the time, title, or details of an existing event.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "The ID of the event to update (from memories)"
                    },
                    "title": {
                        "type": "string",
                        "description": "New title for the event"
                    },
                    "start_time": {
                        "type": "string",
                        "description": "New start time in ISO 8601 format"
                    },
                    "end_time": {
                        "type": "string",
                        "description": "New end time in ISO 8601 format"
                    },
                    "description": {
                        "type": "string",
                        "description": "New description"
                    },
                    "location": {
                        "type": "string",
                        "description": "New location"
                    }
                },
                "required": ["event_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_calendar_event",
            "description": "Delete/cancel a calendar event. Use this when the user wants to remove or cancel an event.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "The ID of the event to delete (from memories)"
                    },
                    "send_notifications": {
                        "type": "boolean",
                        "description": "Whether to send cancellation notifications to attendees",
                        "default": True
                    }
                },
                "required": ["event_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_free_time",
            "description": "Find available time slots in the user's calendar. Use this when the user asks to find time, schedule between meetings, find a free slot, or plan something without conflicts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "The date to search for free time (YYYY-MM-DD format). Defaults to today."
                    },
                    "duration_minutes": {
                        "type": "integer",
                        "description": "Minimum duration needed in minutes. Default is 30 minutes."
                    },
                    "start_hour": {
                        "type": "integer",
                        "description": "Start hour of search range (0-23). Default is 9 (9am)."
                    },
                    "end_hour": {
                        "type": "integer",
                        "description": "End hour of search range (0-23). Default is 18 (6pm)."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "reply_to_email",
            "description": "Reply to an existing email thread. Use this when the user wants to reply to an email, respond to a thread, or continue an email conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The Gmail thread ID to reply to (from email memories)"
                    },
                    "body": {
                        "type": "string",
                        "description": "The reply message body"
                    },
                    "cc": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional CC email addresses to add"
                    }
                },
                "required": ["thread_id", "body"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "reschedule_events",
            "description": "Reschedule one or more calendar events. Use this when the user wants to move meetings, reschedule multiple events, reorganize their day, or shift events to different times.",
            "parameters": {
                "type": "object",
                "properties": {
                    "events": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "event_id": {"type": "string", "description": "Event ID to reschedule"},
                                "new_start_time": {"type": "string", "description": "New start time (ISO 8601)"},
                                "new_end_time": {"type": "string", "description": "New end time (ISO 8601)"}
                            },
                            "required": ["event_id", "new_start_time"]
                        },
                        "description": "List of events to reschedule with their new times"
                    },
                    "notify_attendees": {
                        "type": "boolean",
                        "description": "Whether to notify attendees of changes. Default true."
                    }
                },
                "required": ["events"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_places",
            "description": "Search for places, venues, or locations. Use this when the user wants to find a coffee shop, restaurant, gym, or any other type of place for an activity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (e.g., 'quiet coffee shop', 'Italian restaurant', 'gym near downtown')"
                    },
                    "near_location": {
                        "type": "string",
                        "description": "Optional: location to search near (e.g., 'downtown', 'the office')"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_email_thread",
            "description": "Get the full conversation thread for an email. Use this when the user wants to see the email history, check previous messages in a thread, or understand the context of an email conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The Gmail thread ID (from email memories)"
                    }
                },
                "required": ["thread_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_emails",
            "description": "Search for emails using Gmail search syntax. Use this when the user wants to find specific emails, search for messages from someone, or find emails about a topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Gmail search query (e.g., 'from:john', 'subject:meeting', 'is:unread')"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results. Default is 10."
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "Create a reminder for the user. Use this when the user says 'remind me', 'set a reminder', or wants to be notified about something at a specific time or location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "What to remind about (e.g., 'Call mom', 'Buy groceries')"
                    },
                    "remind_at": {
                        "type": "string",
                        "description": "When to remind (ISO 8601 datetime). Required for time-based reminders."
                    },
                    "reminder_type": {
                        "type": "string",
                        "enum": ["time", "location"],
                        "description": "Type of reminder: 'time' for time-based, 'location' for location-based"
                    },
                    "location_name": {
                        "type": "string",
                        "description": "For location reminders: name of the place (e.g., 'grocery store', 'office')"
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional additional details for the reminder"
                    }
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_reminders",
            "description": "List the user's pending reminders. Use this when the user asks about their reminders, wants to see what's coming up, or asks 'what did I want to remember?'",
            "parameters": {
                "type": "object",
                "properties": {
                    "include_completed": {
                        "type": "boolean",
                        "description": "Whether to include completed reminders. Default false."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_tasks",
            "description": "List the user's tasks and to-dos. Use this when the user asks about their tasks, to-do list, or action items.",
            "parameters": {
                "type": "object",
                "properties": {
                    "include_completed": {
                        "type": "boolean",
                        "description": "Whether to include completed tasks. Default false."
                    }
                }
            }
        }
    }
]


class ChatService:
    """Service for chatting with memories using GPT-4o with function calling."""

    SYSTEM_PROMPT = """You are Cortex, a dry-witted second brain. Think TARS from Interstellar.

You hold the user's memories: thoughts, emails, calendar events, notes.

CRITICAL - Use tools for real-time data:
- Calendar queries ("meetings today", "what's on my schedule") → ALWAYS call find_free_time tool
- Email queries ("any emails", "unread messages") → ALWAYS call search_emails tool
- Place searches ("find a coffee shop") → ALWAYS call search_places tool
- DO NOT answer calendar/email questions from memories alone - memories may be stale

Your personality:
- Dry wit. Matter-of-fact. Occasionally deadpan humor.
- Brief and efficient. No fluff, no enthusiasm.
- Honest, even when inconvenient.
- Helpful but not sycophantic. No "Great question!" nonsense.

How you speak:
- Short sentences. Get to the point.
- Humor setting: 30%. Subtle, never forced.
- State facts, not feelings.
- If you don't know, say so: "Don't have that."

Response style:
- "Done. Calendar's set."
- "Tomorrow's clear. Nothing scheduled."
- "That's not in my memory banks. Want me to note it?"

When taking action:
- Confirm briefly: "Sent." / "Scheduled." / "Done."
- If something fails: "That didn't work. [reason]"
- If unclear, ask directly. One question.

Never:
- Apologize excessively
- Use emojis
- Be overly formal or stiff
- Fabricate information from old memories
- Answer calendar/email queries without using the appropriate tool

Current date/time: {current_datetime}

Their memories follow. Use them for context about people, preferences, and past events - but use TOOLS for current calendar and email data."""

    def __init__(self, search_service: SearchService, db: AsyncSession = None):
        self.search_service = search_service
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        # In-memory conversation storage (use Redis in production)
        self._conversations: dict[str, list[dict]] = {}

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

        elif tool_name == "find_free_time":
            slots = result.get("free_slots", [])
            formatted = result.get("formatted_slots", [])
            if not slots and not formatted:
                return "Your calendar looks fully booked for that time."

            if formatted:
                lines = ["Here are your free slots:\n"]
                for slot in formatted[:5]:
                    lines.append(f"• {slot}")
                return "\n".join(lines)
            else:
                lines = ["Here are your free slots:\n"]
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

        return ""

    def _get_tool_status_message(self, tool_name: str) -> str:
        """Return user-friendly status message for tool execution."""
        messages = {
            "search_places": "Looking up nearby places...",
            "find_free_time": "Checking your calendar availability...",
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
        }
        return messages.get(tool_name, f"Processing {tool_name}...")

    def _get_tool_complete_message(self, tool_name: str, result: dict) -> str:
        """Return completion message based on tool result."""
        if not result.get("success", True):
            return "Couldn't complete that action"

        if tool_name == "search_places":
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
    ) -> AsyncGenerator[dict, None]:
        """
        Chat with memories (streaming via SSE) with function calling support.

        Uses a SINGLE streaming call for performance.

        Args:
            user_id: The user's ID
            message: User's message
            conversation_id: Optional conversation ID for follow-ups

        Yields:
            Dicts with type ('content', 'memories', 'action', 'done', 'error') and data
        """
        conv_id = conversation_id or str(uuid.uuid4())

        try:
            # Status: Searching memories
            yield {"type": "status", "data": {"step": "searching_memories", "message": "Searching your memories..."}}

            # Search for relevant memories using fast search (skips entity loading)
            memories = await self.search_service.search_fast(
                user_id=user_id,
                query=message,
                limit=5,
            )

            # Status: Memories found
            if memories:
                yield {"type": "status", "data": {
                    "step": "memories_found",
                    "message": f"Found {len(memories)} relevant memories",
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

            if user_model_prompt:
                messages.append({"role": "system", "content": user_model_prompt})

            messages.append({"role": "system", "content": f"User's relevant memories:\n{memory_context}"})

            # Add conversation history
            conversation = self._get_conversation(conv_id)
            messages.extend(conversation)
            messages.append({"role": "user", "content": message})

            # Status: Thinking
            yield {"type": "status", "data": {"step": "generating", "message": "Thinking..."}}

            # SINGLE streaming call with tools - much faster!
            stream = await self.client.chat.completions.create(
                model="gpt-4o-mini",  # Faster model for chat
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

            async for chunk in stream:
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
                    "find_free_time",
                    "search_places",
                    "get_email_thread",
                    "search_emails",
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

            # Signal completion
            yield {"type": "done", "data": {"conversation_id": conv_id}}

        except Exception as e:
            yield {"type": "error", "data": str(e)}
