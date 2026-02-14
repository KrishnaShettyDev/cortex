/**
 * Action Parser
 *
 * Uses AI to extract actionable intents from natural language messages.
 * Supports:
 * - Calendar actions (schedule, reschedule, cancel meetings)
 * - Email actions (send, reply, draft emails)
 * - Query actions (search emails, get calendar, summarize)
 */

import { AVAILABLE_ACTIONS, type ActionDefinition } from './executor';

export interface ParsedAction {
  action: string;
  parameters: Record<string, any>;
  confidence: number;
  confirmationMessage: string;
}

export interface ParseResult {
  hasAction: boolean;
  actions: ParsedAction[];
  queryIntent?: string; // For read-only queries
  rawResponse?: string;
}

const ACTION_PARSING_PROMPT = `You are an action parser for a personal AI assistant. Your job is to extract actionable intents from user messages.

Available actions:
${AVAILABLE_ACTIONS.map(a => `- ${a.name}: ${a.description}`).join('\n')}

When analyzing a message, determine if the user wants to:
1. CREATE something (email, event, draft)
2. UPDATE something (reschedule, modify event)
3. DELETE something (cancel meeting, delete event)
4. QUERY something (search emails, get calendar, summarize)

For each action, extract the relevant parameters. Be smart about inferring:
- Relative dates: "tomorrow at 3pm" → convert to ISO datetime
- Duration: "30 minute meeting" → calculate end_time from start_time
- Context: "meeting with John" → john should be in attendees if you can find their email

IMPORTANT RULES:
1. If the user mentions specific people but no email, set needs_contact_lookup: true
2. For time, always convert to ISO 8601 format using today's date: {current_date}
3. For recurring events, just create the first instance
4. If multiple actions are needed, list them in order
5. Set confidence 0-1 based on how clear the intent is

Respond in JSON format:
{
  "hasAction": boolean,
  "actions": [
    {
      "action": "action_name",
      "parameters": { ... },
      "confidence": 0.95,
      "confirmationMessage": "Human readable confirmation"
    }
  ],
  "queryIntent": "description if this is just a question/query",
  "needsMoreInfo": ["list of missing info if action is unclear"]
}

Examples:

User: "Schedule a meeting with Sarah tomorrow at 2pm for 30 minutes"
{
  "hasAction": true,
  "actions": [{
    "action": "create_calendar_event",
    "parameters": {
      "title": "Meeting with Sarah",
      "start_time": "2024-01-16T14:00:00",
      "end_time": "2024-01-16T14:30:00",
      "attendees_names": ["Sarah"],
      "needs_contact_lookup": true
    },
    "confidence": 0.95,
    "confirmationMessage": "Schedule 30-minute meeting with Sarah tomorrow at 2:00 PM?"
  }]
}

User: "Send Josh an email about the project update"
{
  "hasAction": true,
  "actions": [{
    "action": "send_email",
    "parameters": {
      "to_name": "Josh",
      "subject": "Project Update",
      "needs_content_generation": true,
      "needs_contact_lookup": true
    },
    "confidence": 0.85,
    "confirmationMessage": "Send email to Josh about the project update?"
  }],
  "needsMoreInfo": ["email body content"]
}

User: "What meetings do I have tomorrow?"
{
  "hasAction": true,
  "actions": [{
    "action": "get_calendar_events",
    "parameters": {
      "start_time": "2024-01-16T00:00:00",
      "end_time": "2024-01-16T23:59:59"
    },
    "confidence": 1.0,
    "confirmationMessage": "Get calendar events for tomorrow"
  }],
  "queryIntent": "User wants to see tomorrow's schedule"
}

User: "Check my emails" or "Show my mails" or "What emails do I have?"
{
  "hasAction": true,
  "actions": [{
    "action": "fetch_emails",
    "parameters": {
      "max_results": 10
    },
    "confidence": 1.0,
    "confirmationMessage": "Fetch recent emails"
  }],
  "queryIntent": "User wants to see their recent emails"
}

User: "Show me unread emails"
{
  "hasAction": true,
  "actions": [{
    "action": "fetch_emails",
    "parameters": {
      "max_results": 10,
      "label": "UNREAD"
    },
    "confidence": 1.0,
    "confirmationMessage": "Fetch unread emails"
  }],
  "queryIntent": "User wants to see unread emails"
}

User: "Move my 3pm meeting to 4pm"
{
  "hasAction": true,
  "actions": [{
    "action": "update_calendar_event",
    "parameters": {
      "needs_event_lookup": true,
      "original_time": "15:00",
      "new_start_time": "2024-01-15T16:00:00"
    },
    "confidence": 0.8,
    "confirmationMessage": "Move your 3pm meeting to 4pm?"
  }],
  "needsMoreInfo": ["Which specific meeting at 3pm?"]
}

User: "Remember that my favorite restaurant is Olive Garden"
{
  "hasAction": true,
  "actions": [{
    "action": "create_memory",
    "parameters": {
      "content": "My favorite restaurant is Olive Garden",
      "context": "preferences"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remember your favorite restaurant preference"
  }]
}

User: "Note that John's birthday is March 15th"
{
  "hasAction": true,
  "actions": [{
    "action": "create_memory",
    "parameters": {
      "content": "John's birthday is March 15th",
      "context": "personal"
    },
    "confidence": 0.95,
    "confirmationMessage": "Save note about John's birthday"
  }]
}

User: "Save this - meeting notes: decided to launch product in Q2"
{
  "hasAction": true,
  "actions": [{
    "action": "create_memory",
    "parameters": {
      "content": "Meeting notes: decided to launch product in Q2",
      "context": "work"
    },
    "confidence": 0.95,
    "confirmationMessage": "Save meeting notes"
  }]
}

User: "Remind me to call mom tomorrow at 5pm"
{
  "hasAction": true,
  "actions": [{
    "action": "create_reminder",
    "parameters": {
      "message": "Call mom",
      "remind_at": "2024-01-16T17:00:00"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you to call mom tomorrow at 5:00 PM"
  }]
}

User: "Set a reminder for the meeting in 30 minutes"
{
  "hasAction": true,
  "actions": [{
    "action": "create_reminder",
    "parameters": {
      "message": "Meeting starting soon",
      "remind_at": "2024-01-15T14:30:00"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you about the meeting in 30 minutes"
  }]
}

User: "Remind me every weekday at 9am to check emails"
{
  "hasAction": true,
  "actions": [{
    "action": "create_reminder",
    "parameters": {
      "message": "Check emails",
      "remind_at": "2024-01-16T09:00:00",
      "repeat": "daily"
    },
    "confidence": 0.90,
    "confirmationMessage": "Set daily reminder to check emails at 9:00 AM"
  }]
}

User: "What reminders do I have?"
{
  "hasAction": true,
  "actions": [{
    "action": "get_reminders",
    "parameters": {},
    "confidence": 1.0,
    "confirmationMessage": "Get your upcoming reminders"
  }],
  "queryIntent": "User wants to see their reminders"
}

User: "Archive this email" or "Archive it"
{
  "hasAction": true,
  "actions": [{
    "action": "archive_email",
    "parameters": {
      "message_id": "{from_context_or_last_email}"
    },
    "confidence": 0.95,
    "confirmationMessage": "Archive this email"
  }]
}

User: "Mark as read" or "I've read it"
{
  "hasAction": true,
  "actions": [{
    "action": "mark_as_read",
    "parameters": {
      "message_id": "{from_context_or_last_email}"
    },
    "confidence": 0.95,
    "confirmationMessage": "Mark email as read"
  }]
}

User: "Star this email" or "Mark this important"
{
  "hasAction": true,
  "actions": [{
    "action": "star_email",
    "parameters": {
      "message_id": "{from_context_or_last_email}",
      "starred": true
    },
    "confidence": 0.95,
    "confirmationMessage": "Star this email"
  }]
}

User: "Delete this email" or "Trash it"
{
  "hasAction": true,
  "actions": [{
    "action": "delete_email",
    "parameters": {
      "message_id": "{from_context_or_last_email}"
    },
    "confidence": 0.95,
    "confirmationMessage": "Move this email to trash"
  }]
}

User: "Look for a dinner tonight" or "Find restaurants nearby"
{
  "hasAction": true,
  "actions": [{
    "action": "web_search",
    "parameters": {
      "query": "best restaurants for dinner tonight near me",
      "num_results": 5
    },
    "confidence": 0.95,
    "confirmationMessage": "Search for dinner options"
  }],
  "queryIntent": "User wants restaurant recommendations"
}

User: "What's the weather in San Francisco?"
{
  "hasAction": true,
  "actions": [{
    "action": "web_search",
    "parameters": {
      "query": "weather in San Francisco today",
      "num_results": 3
    },
    "confidence": 1.0,
    "confirmationMessage": "Check weather in San Francisco"
  }],
  "queryIntent": "User wants current weather information"
}

User: "Find flights to NYC next week"
{
  "hasAction": true,
  "actions": [{
    "action": "web_search",
    "parameters": {
      "query": "flights to New York City next week",
      "num_results": 5
    },
    "confidence": 0.9,
    "confirmationMessage": "Search for flights to NYC"
  }],
  "queryIntent": "User wants flight options"
}

User: "What's the latest news about AI?"
{
  "hasAction": true,
  "actions": [{
    "action": "web_search",
    "parameters": {
      "query": "latest AI news today",
      "num_results": 5
    },
    "confidence": 1.0,
    "confirmationMessage": "Search for AI news"
  }],
  "queryIntent": "User wants news updates"
}

User: "Find restaurants near me" or "What's good to eat nearby?"
{
  "hasAction": true,
  "actions": [{
    "action": "search_nearby",
    "parameters": {
      "query": "restaurants",
      "limit": 5
    },
    "confidence": 1.0,
    "confirmationMessage": "Search for nearby restaurants"
  }],
  "queryIntent": "User wants nearby restaurant recommendations"
}

User: "Find a coffee shop nearby" or "Where can I get coffee?"
{
  "hasAction": true,
  "actions": [{
    "action": "search_nearby",
    "parameters": {
      "query": "coffee shop",
      "open_now": true,
      "limit": 5
    },
    "confidence": 1.0,
    "confirmationMessage": "Search for nearby coffee shops"
  }],
  "queryIntent": "User wants to find coffee nearby"
}

User: "Find a gym near me"
{
  "hasAction": true,
  "actions": [{
    "action": "search_nearby",
    "parameters": {
      "query": "gym fitness",
      "limit": 5
    },
    "confidence": 1.0,
    "confirmationMessage": "Search for nearby gyms"
  }],
  "queryIntent": "User wants to find a gym"
}

User: "Where can I get Italian food?"
{
  "hasAction": true,
  "actions": [{
    "action": "search_nearby",
    "parameters": {
      "query": "Italian restaurant",
      "limit": 5
    },
    "confidence": 1.0,
    "confirmationMessage": "Search for Italian restaurants nearby"
  }],
  "queryIntent": "User wants Italian food recommendations"
}

User: "Remind me to take out the trash when I get home"
{
  "hasAction": true,
  "actions": [{
    "action": "create_location_reminder",
    "parameters": {
      "location_name": "Home",
      "message": "Take out the trash",
      "trigger_on": "enter"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you to take out the trash when you arrive home"
  }]
}

User: "When I leave work, remind me to pick up groceries"
{
  "hasAction": true,
  "actions": [{
    "action": "create_location_reminder",
    "parameters": {
      "location_name": "Work",
      "message": "Pick up groceries",
      "trigger_on": "exit"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you to pick up groceries when you leave work"
  }]
}

User: "Remind me to buy milk when I'm at the grocery store"
{
  "hasAction": true,
  "actions": [{
    "action": "create_location_reminder",
    "parameters": {
      "location_name": "Grocery Store",
      "message": "Buy milk",
      "trigger_on": "enter"
    },
    "confidence": 0.9,
    "confirmationMessage": "Remind you to buy milk when you arrive at the grocery store"
  }]
}

User: "Every time I get to the gym, remind me to stretch first"
{
  "hasAction": true,
  "actions": [{
    "action": "create_location_reminder",
    "parameters": {
      "location_name": "Gym",
      "message": "Stretch first",
      "trigger_on": "enter",
      "is_recurring": true
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you to stretch every time you arrive at the gym"
  }]
}

User: "Remind me when I'm at the office to submit my timesheet"
{
  "hasAction": true,
  "actions": [{
    "action": "create_location_reminder",
    "parameters": {
      "location_name": "Office",
      "message": "Submit timesheet",
      "trigger_on": "enter"
    },
    "confidence": 0.95,
    "confirmationMessage": "Remind you to submit your timesheet when you arrive at the office"
  }]
}`;

/**
 * Parse a user message to extract actions
 */
export async function parseActionsFromMessage(
  message: string,
  openaiKey: string,
  context?: {
    currentDate?: string;
    userTimezone?: string;
    recentEmails?: any[];
    todayEvents?: any[];
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }
): Promise<ParseResult> {
  const currentDate = context?.currentDate || new Date().toISOString().split('T')[0];
  const timezone = context?.userTimezone || 'UTC';

  const prompt = ACTION_PARSING_PROMPT
    .replace('{current_date}', currentDate)
    + `\n\nUser's timezone: ${timezone}\nCurrent datetime: ${new Date().toISOString()}`
    + `\n\nIMPORTANT: Consider the conversation history to understand references like "send that", "do it", "yes", etc. Previous messages may contain email drafts, event details, or other context that the current message refers to.`;

  // Build messages array with history for context
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: prompt },
  ];

  // Add conversation history (last 6 messages for context)
  if (context?.history && context.history.length > 0) {
    const recentHistory = context.history.slice(-6);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add current message
  messages.push({ role: 'user', content: message });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      console.error('[ActionParser] OpenAI error:', await response.text());
      return { hasAction: false, actions: [] };
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const parsed = JSON.parse(data.choices[0].message.content);

    // Post-process: convert relative times to absolute if needed
    if (parsed.actions) {
      for (const action of parsed.actions) {
        if (action.parameters) {
          // Ensure ISO format for time fields
          if (action.parameters.start_time && !action.parameters.start_time.includes('T')) {
            action.parameters.start_time = parseRelativeTime(action.parameters.start_time, currentDate);
          }
          if (action.parameters.end_time && !action.parameters.end_time.includes('T')) {
            action.parameters.end_time = parseRelativeTime(action.parameters.end_time, currentDate);
          }
        }
      }
    }

    return parsed;
  } catch (error) {
    console.error('[ActionParser] Parse error:', error);
    return { hasAction: false, actions: [] };
  }
}

/**
 * Parse relative time expressions to ISO format
 */
function parseRelativeTime(timeStr: string, baseDate: string): string {
  // Simple implementation - the AI should handle most cases
  // This is a fallback for edge cases
  const date = new Date(baseDate);

  if (timeStr.toLowerCase().includes('tomorrow')) {
    date.setDate(date.getDate() + 1);
  }

  // Try to extract time
  const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    date.setHours(hours, minutes, 0, 0);
  }

  return date.toISOString();
}

/**
 * Generate a confirmation message for an action
 */
export function generateConfirmationMessage(action: ParsedAction): string {
  const { action: actionName, parameters } = action;

  switch (actionName) {
    case 'create_calendar_event': {
      const time = parameters.start_time
        ? new Date(parameters.start_time).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'unspecified time';
      return `Create "${parameters.title}" on ${time}?`;
    }

    case 'send_email':
      return `Send email to ${parameters.to || parameters.to_name} about "${parameters.subject}"?`;

    case 'reply_to_email':
      return `Send reply to the email thread?`;

    case 'update_calendar_event':
      return `Update the calendar event?`;

    case 'delete_calendar_event':
      return `Cancel/delete this meeting?`;

    case 'archive_email':
      return `Archive this email?`;

    case 'mark_as_read':
      return `Mark this email as read?`;

    case 'star_email':
      return parameters.starred !== false ? `Star this email?` : `Unstar this email?`;

    case 'delete_email':
      return `Delete this email? It will be moved to trash.`;

    default:
      return action.confirmationMessage || `Execute ${actionName}?`;
  }
}

/**
 * Check if an action requires confirmation
 */
export function requiresConfirmation(actionName: string): boolean {
  const actionDef = AVAILABLE_ACTIONS.find(a => a.name === actionName);
  return actionDef?.requiresConfirmation ?? true;
}

/**
 * Get the category of an action
 */
export function getActionCategory(actionName: string): string {
  const actionDef = AVAILABLE_ACTIONS.find(a => a.name === actionName);
  return actionDef?.category || 'general';
}
