/**
 * Shared types for multi-agent orchestration
 */

import type { AgentType, AgentConfig } from './config';

export interface AgentContext {
  userId: string;
  userName?: string;
  userEmail?: string;
  timezone?: string;
  requestId: string;
  parentExecutionId?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface InteractionResult {
  response: string;
  memoriesUsed: number;
  delegatedGoal?: string;
  executionResult?: ExecutionResult;
  needsUserInput?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  toolCallsMade: string[];
  error?: string;
  needsInput?: boolean;
  question?: string;
}

export interface ProactiveResult {
  title: string;
  body: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  suggestedActions: string[];
  sourceEvent: any;
}

export interface DelegateToExecutionParams {
  goal: string;
  context?: Record<string, any>;
}

// Tool definitions for the agents
export const INTERACTION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_memories',
      description: 'Search the user\'s memories for relevant information about people, events, or topics',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant memories',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of memories to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delegate_to_execution',
      description: 'Delegate a task to the execution agent for sending emails, creating calendar events, searching, etc.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Clear description of what needs to be done, with all necessary context (email addresses, dates, content)',
          },
          context: {
            type: 'object',
            description: 'Additional context like email addresses, dates, names, etc.',
          },
        },
        required: ['goal'],
      },
    },
  },
];

export const EXECUTION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'gmail_send_email',
      description: 'Send an email via Gmail',
      parameters: {
        type: 'object',
        properties: {
          recipient_email: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          cc: { type: 'string', description: 'CC email addresses (comma-separated)' },
        },
        required: ['recipient_email', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_create_draft',
      description: 'Create an email draft for later review',
      parameters: {
        type: 'object',
        properties: {
          recipient_email: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
        },
        required: ['recipient_email', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_search',
      description: 'Search emails in Gmail',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (supports from:, to:, subject:, etc.)' },
          max_results: { type: 'number', description: 'Maximum results to return (default: 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calendar_create_event',
      description: 'Create a Google Calendar event',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time in ISO 8601 format' },
          end_time: { type: 'string', description: 'End time in ISO 8601 format' },
          description: { type: 'string', description: 'Event description' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'List of attendee email addresses' },
          location: { type: 'string', description: 'Event location' },
        },
        required: ['summary', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calendar_list_events',
      description: 'List upcoming calendar events',
      parameters: {
        type: 'object',
        properties: {
          time_min: { type: 'string', description: 'Start of time range (ISO 8601)' },
          time_max: { type: 'string', description: 'End of time range (ISO 8601)' },
          max_results: { type: 'number', description: 'Maximum events to return (default: 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calendar_update_event',
      description: 'Update an existing calendar event',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID to update' },
          summary: { type: 'string', description: 'New event title' },
          start_time: { type: 'string', description: 'New start time' },
          end_time: { type: 'string', description: 'New end time' },
          description: { type: 'string', description: 'New description' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'calendar_delete_event',
      description: 'Delete a calendar event',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'Event ID to delete' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_memories',
      description: 'Search user memories for context about people, relationships, or past interactions',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
        },
        required: ['query'],
      },
    },
  },
];

export const PROACTIVE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_memories',
      description: 'Search memories for context about the sender or topic',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., sender email, topic)' },
          limit: { type: 'number', description: 'Max results (default: 3)' },
        },
        required: ['query'],
      },
    },
  },
];
