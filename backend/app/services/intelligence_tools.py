"""
GOD-LEVEL CHAT TOOLS

These are the tools that make users say "holy shit, how did it know?"

Not basic CRUD. Intelligence-first interactions.
"""

import logging
from uuid import UUID
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.contextual_intelligence_engine import (
    ContextualIntelligenceEngine,
    get_contextual_intelligence_engine,
)
from app.services.sync_service import SyncService

logger = logging.getLogger(__name__)


# =============================================================================
# TOOL DEFINITIONS - Add these to your TOOLS list in chat_service.py
# =============================================================================

INTELLIGENCE_TOOLS = [
    # =========================================================================
    # WHO IS - Full person intelligence
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "who_is",
            "description": """Get complete context about a person. Use when user asks about someone.

            Returns:
            - Relationship type and health
            - Communication history
            - What user owes them / they owe user
            - How to communicate with them
            - Notable facts from memory

            Examples:
            - "Who is Sarah?"
            - "Tell me about Josh"
            - "What do I know about Lauren?"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "person_name": {
                        "type": "string",
                        "description": "Name or email of the person"
                    }
                },
                "required": ["person_name"]
            }
        }
    },

    # =========================================================================
    # INBOX INTELLIGENCE - Not just list, full situation awareness
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "get_inbox_intelligence",
            "description": """Analyze inbox with full relationship and commitment context.

            Returns prioritized briefing:
            - Critical: Emails needing immediate action with WHY
            - High: Important today
            - Relationship context for each sender
            - Open commitments related to emails
            - Suggested actions

            Examples:
            - "Check my emails"
            - "What needs my attention?"
            - "Summarize my inbox"
            - "Any urgent emails?"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "max_emails": {
                        "type": "integer",
                        "description": "Max emails to analyze (default 15)",
                        "default": 15
                    }
                }
            }
        }
    },

    # =========================================================================
    # SMART REPLY - Style-matched, relationship-aware
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "draft_smart_reply",
            "description": """Draft a reply that matches how user writes to this specific person.

            Considers:
            - User's writing style with this person
            - Relationship type and health
            - Open commitments and promises
            - Thread context
            - Appropriate tone

            Examples:
            - "Reply to Josh's email"
            - "Draft a response to Sarah"
            - "Help me reply to this" (after viewing email)
            - "Reply to Josh and buy me time on the proposal"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "email_id": {
                        "type": "string",
                        "description": "ID of email to reply to"
                    },
                    "thread_id": {
                        "type": "string",
                        "description": "Thread ID if email_id not available"
                    },
                    "intent": {
                        "type": "string",
                        "description": "Optional: what user wants to accomplish (e.g., 'buy time', 'confirm', 'decline', 'ask for more info')"
                    },
                    "additional_context": {
                        "type": "string",
                        "description": "Optional: any specific points to include"
                    }
                },
                "required": []
            }
        }
    },

    # =========================================================================
    # FOLLOW UP - Find last communication and draft follow-up
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "follow_up_with",
            "description": """Find last communication with someone and draft appropriate follow-up.

            Does NOT just send generic "following up". Instead:
            - Finds last email/interaction
            - Identifies what was discussed
            - Checks for open commitments
            - Drafts contextual follow-up

            Examples:
            - "Follow up with Josh"
            - "Did Sarah ever respond to my proposal?"
            - "I need to ping Lauren about the project"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "person_name": {
                        "type": "string",
                        "description": "Name of person to follow up with"
                    },
                    "topic": {
                        "type": "string",
                        "description": "Optional: specific topic to follow up about"
                    }
                },
                "required": ["person_name"]
            }
        }
    },

    # =========================================================================
    # MEETING PREP - Full context before meeting
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "prep_for_meeting",
            "description": """Get comprehensive prep for an upcoming meeting.

            Returns:
            - Who's attending (with full context on each)
            - What you discussed last time
            - Promises you made / they made
            - Relationship health with attendees
            - Suggested talking points
            - Things to avoid

            Examples:
            - "Prep me for my 3pm meeting"
            - "What should I know before meeting Sarah?"
            - "Help me prepare for the investor call"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "Calendar event ID (or 'next' for next meeting)"
                    },
                    "meeting_title": {
                        "type": "string",
                        "description": "Meeting title to search for if no event_id"
                    }
                },
                "required": []
            }
        }
    },

    # =========================================================================
    # WHAT DID I PROMISE - Commitment tracking
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "what_did_i_promise",
            "description": """Find commitments and promises to/from a person or in general.

            Searches:
            - Explicit commitments in memories
            - Email promises ("I'll send by Friday")
            - Meeting action items

            Examples:
            - "What did I promise Josh?"
            - "What does Sarah owe me?"
            - "What am I behind on?"
            - "What commitments do I have?"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "person_name": {
                        "type": "string",
                        "description": "Optional: filter to specific person"
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["i_promised", "they_promised", "both"],
                        "description": "Filter by who made the promise",
                        "default": "both"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "overdue", "all"],
                        "description": "Filter by status",
                        "default": "pending"
                    }
                }
            }
        }
    },

    # =========================================================================
    # MORNING BRIEFING - Full daily intelligence
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "get_morning_briefing",
            "description": """Get comprehensive morning briefing with prioritized actions.

            Not just calendar list. Full intelligence:
            - Priority items needing attention (with context)
            - Meetings with prep highlights
            - Emails by urgency (with relationship context)
            - Commitments due
            - Relationship alerts (who to reach out to)
            - Suggested first actions

            Examples:
            - "Good morning"
            - "What's my day look like?"
            - "Brief me"
            - "What should I focus on today?"
            """,
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },

    # =========================================================================
    # RELATIONSHIP CHECK - Who to reach out to
    # =========================================================================
    {
        "type": "function",
        "function": {
            "name": "relationship_check",
            "description": """Check relationship health and get recommendations.

            Analyzes:
            - Who hasn't user contacted in a while
            - Relationships that are cooling
            - People user mentioned wanting to stay close to
            - Important relationships being neglected

            Examples:
            - "Who should I reach out to?"
            - "Am I neglecting anyone?"
            - "Relationship check"
            - "Who haven't I talked to recently?"
            """,
            "parameters": {
                "type": "object",
                "properties": {
                    "relationship_type": {
                        "type": "string",
                        "enum": ["all", "family", "friends", "professional", "investors"],
                        "description": "Filter by relationship type",
                        "default": "all"
                    },
                    "days_threshold": {
                        "type": "integer",
                        "description": "Days without contact to flag (default 14)",
                        "default": 14
                    }
                }
            }
        }
    }
]


# =============================================================================
# TOOL EXECUTION - Handler for intelligence tools
# =============================================================================

async def execute_intelligence_tool(
    tool_name: str,
    arguments: dict,
    user_id: str,
    db: AsyncSession
) -> dict:
    """Execute an intelligence tool and return result."""

    engine = get_contextual_intelligence_engine(db)
    user_uuid = UUID(user_id)

    try:
        if tool_name == "who_is":
            result = await engine.get_who_is(
                user_id=user_uuid,
                name=arguments.get("person_name", "")
            )
            return {"success": True, "response": result}

        elif tool_name == "get_inbox_intelligence":
            # First, fetch emails via SyncService
            sync_service = SyncService(db)
            emails_result = await sync_service.search_emails(
                user_id=user_uuid,
                query="is:unread OR newer_than:3d",
                max_results=arguments.get("max_emails", 15)
            )

            if not emails_result.get("success"):
                return {
                    "success": False,
                    "message": emails_result.get("message", "Could not fetch emails")
                }

            emails = emails_result.get("emails", [])

            if not emails:
                return {
                    "success": True,
                    "response": "Your inbox is clear. No recent unread emails."
                }

            # Analyze with intelligence engine
            result = await engine.get_inbox_intelligence(user_uuid, emails)
            return {"success": True, "response": result.get("briefing", ""), "data": result}

        elif tool_name == "draft_smart_reply":
            email_id = arguments.get("email_id")
            thread_id = arguments.get("thread_id")

            if not email_id and not thread_id:
                return {"success": False, "message": "Need email_id or thread_id to draft reply"}

            # Fetch the email
            sync_service = SyncService(db)

            if thread_id:
                thread_result = await sync_service.get_email_thread(user_uuid, thread_id)
                if thread_result.get("success") and thread_result.get("messages"):
                    email = thread_result["messages"][-1]  # Most recent
                else:
                    return {"success": False, "message": "Could not fetch email thread"}
            else:
                # Search for email by ID
                search_result = await sync_service.search_emails(
                    user_uuid, f"rfc822msgid:{email_id}", max_results=1
                )
                if search_result.get("success") and search_result.get("emails"):
                    email = search_result["emails"][0]
                else:
                    return {"success": False, "message": "Could not find that email"}

            # Generate smart reply
            result = await engine.draft_reply(
                user_id=user_uuid,
                email=email,
                intent=arguments.get("intent")
            )

            response = f"**Draft Reply:**\n\n{result.get('draft', '')}\n\n"
            if result.get("tone_explanation"):
                response += f"_({result['tone_explanation']})_\n\n"
            if result.get("warnings"):
                response += f"Note: {' | '.join(result['warnings'])}\n\n"
            response += "Want me to send this, edit it, or try a different approach?"

            return {"success": True, "response": response, "draft": result}

        elif tool_name == "follow_up_with":
            person_name = arguments.get("person_name", "")
            topic = arguments.get("topic")

            # Get person context
            who_is_result = await engine.get_who_is(user_uuid, person_name)

            # Search for last email with them
            sync_service = SyncService(db)
            search_query = f"from:{person_name} OR to:{person_name}"
            if topic:
                search_query += f" {topic}"

            emails_result = await sync_service.search_emails(
                user_uuid, search_query, max_results=5
            )

            if emails_result.get("success") and emails_result.get("emails"):
                last_email = emails_result["emails"][0]

                # Draft contextual follow-up
                draft_result = await engine.draft_reply(
                    user_id=user_uuid,
                    email=last_email,
                    intent="follow_up"
                )

                response = f"""**Last communication with {person_name}:**
Subject: {last_email.get('subject', 'No subject')}
Date: {last_email.get('date', 'Unknown')}

{who_is_result}

**Draft follow-up:**

{draft_result.get('draft', '')}

Send this?"""
                return {"success": True, "response": response}
            else:
                return {
                    "success": True,
                    "response": f"No recent email thread with {person_name}. Want to start a conversation?\n\n{who_is_result}"
                }

        elif tool_name == "prep_for_meeting":
            event_id = arguments.get("event_id")
            meeting_title = arguments.get("meeting_title")

            # Fetch the event
            sync_service = SyncService(db)

            if event_id == "next" or not event_id:
                # Get next meeting
                from datetime import datetime, timedelta
                events_result = await sync_service.get_calendar_events(
                    user_id=user_uuid,
                    start_date=datetime.now(),
                    end_date=datetime.now() + timedelta(days=1)
                )

                if events_result.get("success") and events_result.get("events"):
                    event = events_result["events"][0]
                else:
                    return {"success": True, "response": "No upcoming meetings found."}
            else:
                # Would need to fetch specific event by ID
                # For now, search by title
                events_result = await sync_service.get_calendar_events(
                    user_id=user_uuid,
                    start_date=datetime.now(),
                    end_date=datetime.now() + timedelta(days=7)
                )

                event = None
                if events_result.get("success"):
                    for e in events_result.get("events", []):
                        if meeting_title and meeting_title.lower() in e.get("title", e.get("summary", "")).lower():
                            event = e
                            break
                        if event_id and e.get("id") == event_id:
                            event = e
                            break

                if not event:
                    return {"success": True, "response": "Could not find that meeting."}

            # Generate meeting prep
            prep = await engine.get_meeting_prep(user_uuid, event)

            # Format response
            response = f"**Meeting Prep: {prep.title}**\n"
            if prep.start_time:
                response += f"*{prep.start_time.strftime('%I:%M %p')}*\n\n"

            if prep.attendees:
                response += "**Attendees:**\n"
                for a in prep.attendees:
                    response += f"- {a.name}"
                    if a.days_since_contact > 14:
                        response += f" ({a.days_since_contact} days since contact)"
                    response += "\n"

            if prep.what_you_promised_last_time:
                response += f"\n**You promised last time:** {', '.join(prep.what_you_promised_last_time)}\n"

            if prep.relationship_alerts:
                response += f"\n**Heads up:** {' | '.join(prep.relationship_alerts)}\n"

            if prep.suggested_talking_points:
                response += "\n**Talking points:**\n"
                for point in prep.suggested_talking_points:
                    response += f"- {point}\n"

            if prep.things_to_avoid:
                response += f"\n**Avoid:** {', '.join(prep.things_to_avoid)}\n"

            return {"success": True, "response": response}

        elif tool_name == "what_did_i_promise":
            result = await engine.get_commitments(
                user_id=user_uuid,
                person_name=arguments.get("person_name"),
                direction=arguments.get("direction", "both"),
                status=arguments.get("status", "pending")
            )

            commitments = result.get("commitments", [])

            if not commitments:
                return {"success": True, "response": "No pending commitments found. You're all caught up."}

            response = "**Pending commitments:**\n\n"
            for c in commitments:
                response += f"- {c.get('action', '')}"
                if c.get("person"):
                    response += f" (to {c['person']})"
                elif c.get("subject"):
                    response += f" (re: {c['subject']})"
                if c.get("is_overdue"):
                    response += " **OVERDUE**"
                elif c.get("days_old", 0) > 3:
                    response += f" *({c['days_old']} days ago)*"
                response += "\n"

            if result.get("overdue_count", 0) > 0:
                response += f"\n{result['overdue_count']} overdue."

            return {"success": True, "response": response}

        elif tool_name == "get_morning_briefing":
            result = await engine.get_daily_intelligence(user_uuid)

            response = "**Good morning. Here's what needs your attention:**\n\n"

            priority_items = result.get("priority_items", [])
            if priority_items:
                for i, item in enumerate(priority_items[:5], 1):
                    urgency_icon = "" if item.get("urgency") == "critical" else ""
                    response += f"{i}. {urgency_icon} {item.get('description', '')}\n"
            else:
                response += "Nothing urgent. Good day to be proactive.\n"

            # Add upcoming dates
            dates = result.get("upcoming_dates", [])
            if dates:
                response += "\n**Coming up:**\n"
                for d in dates[:3]:
                    response += f"- {d.get('person_name')}'s {d.get('date_label')}: {d.get('days_until')} days\n"

            # Add relationship check summary
            rel_check = result.get("relationship_alerts", {})
            neglected = rel_check.get("neglected", [])
            if neglected:
                response += f"\n**Consider reaching out to:** {', '.join([n.get('name', '') for n in neglected[:3]])}"

            return {"success": True, "response": response}

        elif tool_name == "relationship_check":
            result = await engine.get_relationship_check(
                user_id=user_uuid,
                relationship_type=arguments.get("relationship_type", "all"),
                days_threshold=arguments.get("days_threshold", 14)
            )

            if result.get("status") == "healthy":
                return {"success": True, "response": result.get("message", "")}

            neglected = result.get("neglected", [])
            response = f"**People you haven't contacted in {arguments.get('days_threshold', 14)}+ days:**\n\n"

            for r in neglected:
                response += f"- **{r.get('name', '')}** - {r.get('days_since_contact', 0)} days\n"

            response += "\nWant me to draft a quick message to any of them?"

            return {"success": True, "response": response}

        else:
            return {"success": False, "message": f"Unknown intelligence tool: {tool_name}"}

    except Exception as e:
        logger.error(f"Error executing intelligence tool {tool_name}: {e}")
        return {"success": False, "message": f"Error: {str(e)}"}


def is_intelligence_tool(tool_name: str) -> bool:
    """Check if a tool name is an intelligence tool."""
    intelligence_tool_names = {t["function"]["name"] for t in INTELLIGENCE_TOOLS}
    return tool_name in intelligence_tool_names


def get_all_tools_with_intelligence(existing_tools: list) -> list:
    """Merge existing tools with intelligence tools."""
    # Get existing tool names to avoid duplicates
    existing_names = {t["function"]["name"] for t in existing_tools}

    # Add intelligence tools that aren't already present
    merged = list(existing_tools)
    for tool in INTELLIGENCE_TOOLS:
        if tool["function"]["name"] not in existing_names:
            merged.append(tool)

    return merged
