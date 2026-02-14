/**
 * Action Executor
 *
 * Executes actions on behalf of the user through Composio.
 * Supports:
 * - Sending emails
 * - Creating calendar events
 * - Updating calendar events
 * - Searching contacts
 * - Web search
 */

import {
  createComposioServices,
  executeComposioSafely,
  ComposioTokenExpiredError,
  ComposioRateLimitError,
  type ToolExecutionResult,
} from '../composio';
import type { D1Database } from '@cloudflare/workers-types';

export interface ActionDefinition {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required: boolean;
  }[];
  requiresConfirmation: boolean;
  category: 'email' | 'calendar' | 'search' | 'memory' | 'general';
}

export interface ActionRequest {
  action: string;
  parameters: Record<string, any>;
  confirmed?: boolean;
}

export interface ActionResult {
  success: boolean;
  action: string;
  result?: any;
  error?: string;
  message: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

// Available actions
export const AVAILABLE_ACTIONS: ActionDefinition[] = [
  {
    name: 'send_email',
    description: 'Send an email to a recipient',
    parameters: [
      { name: 'to', type: 'string', description: 'Recipient email address', required: true },
      { name: 'subject', type: 'string', description: 'Email subject', required: true },
      { name: 'body', type: 'string', description: 'Email body content', required: true },
      { name: 'cc', type: 'array', description: 'CC recipients', required: false },
    ],
    requiresConfirmation: true,
    category: 'email',
  },
  {
    name: 'create_draft',
    description: 'Create an email draft (not sent)',
    parameters: [
      { name: 'to', type: 'string', description: 'Recipient email address', required: true },
      { name: 'subject', type: 'string', description: 'Email subject', required: true },
      { name: 'body', type: 'string', description: 'Email body content', required: true },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'reply_to_email',
    description: 'Reply to an existing email thread',
    parameters: [
      { name: 'thread_id', type: 'string', description: 'Thread ID to reply to', required: true },
      { name: 'body', type: 'string', description: 'Reply content', required: true },
    ],
    requiresConfirmation: true,
    category: 'email',
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event',
    parameters: [
      { name: 'title', type: 'string', description: 'Event title', required: true },
      { name: 'start_time', type: 'string', description: 'Start time (ISO format)', required: true },
      { name: 'end_time', type: 'string', description: 'End time (ISO format)', required: true },
      { name: 'description', type: 'string', description: 'Event description', required: false },
      { name: 'location', type: 'string', description: 'Event location', required: false },
      { name: 'attendees', type: 'array', description: 'Attendee email addresses', required: false },
    ],
    requiresConfirmation: true,
    category: 'calendar',
  },
  {
    name: 'update_calendar_event',
    description: 'Update an existing calendar event',
    parameters: [
      { name: 'event_id', type: 'string', description: 'Event ID to update', required: true },
      { name: 'title', type: 'string', description: 'New title', required: false },
      { name: 'start_time', type: 'string', description: 'New start time', required: false },
      { name: 'end_time', type: 'string', description: 'New end time', required: false },
      { name: 'description', type: 'string', description: 'New description', required: false },
    ],
    requiresConfirmation: true,
    category: 'calendar',
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete a calendar event',
    parameters: [
      { name: 'event_id', type: 'string', description: 'Event ID to delete', required: true },
    ],
    requiresConfirmation: true,
    category: 'calendar',
  },
  {
    name: 'fetch_emails',
    description: 'Fetch recent emails from inbox (use when user wants to check/see their emails)',
    parameters: [
      { name: 'max_results', type: 'number', description: 'Maximum results (default 10)', required: false },
      { name: 'label', type: 'string', description: 'Label filter like INBOX, UNREAD, STARRED', required: false },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'search_emails',
    description: 'Search through emails with a specific query',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'max_results', type: 'number', description: 'Maximum results', required: false },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts',
    parameters: [
      { name: 'query', type: 'string', description: 'Contact name or email to search', required: true },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'archive_email',
    description: 'Archive an email (remove from inbox)',
    parameters: [
      { name: 'message_id', type: 'string', description: 'Email message ID to archive', required: true },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'mark_as_read',
    description: 'Mark an email as read',
    parameters: [
      { name: 'message_id', type: 'string', description: 'Email message ID to mark as read', required: true },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'star_email',
    description: 'Star or unstar an email',
    parameters: [
      { name: 'message_id', type: 'string', description: 'Email message ID to star', required: true },
      { name: 'starred', type: 'boolean', description: 'True to star, false to unstar', required: false },
    ],
    requiresConfirmation: false,
    category: 'email',
  },
  {
    name: 'delete_email',
    description: 'Move an email to trash',
    parameters: [
      { name: 'message_id', type: 'string', description: 'Email message ID to delete', required: true },
    ],
    requiresConfirmation: true,
    category: 'email',
  },
  {
    name: 'get_calendar_events',
    description: 'Get calendar events for a time range',
    parameters: [
      { name: 'start_time', type: 'string', description: 'Start of range (ISO format)', required: true },
      { name: 'end_time', type: 'string', description: 'End of range (ISO format)', required: true },
    ],
    requiresConfirmation: false,
    category: 'calendar',
  },
  {
    name: 'web_search',
    description: 'Search the web for information (restaurants, weather, news, facts, etc.)',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'num_results', type: 'number', description: 'Number of results (default 5)', required: false },
    ],
    requiresConfirmation: false,
    category: 'search',
  },
  {
    name: 'create_memory',
    description: 'Save information to memory for future recall (use when user says "remember", "note that", "save this", etc.)',
    parameters: [
      { name: 'content', type: 'string', description: 'The information to remember', required: true },
      { name: 'context', type: 'string', description: 'Additional context or category', required: false },
    ],
    requiresConfirmation: false,
    category: 'memory',
  },
  {
    name: 'create_reminder',
    description: 'Set a reminder for a specific time (use when user says "remind me", "set a reminder", "alert me", etc.)',
    parameters: [
      { name: 'message', type: 'string', description: 'The reminder message', required: true },
      { name: 'remind_at', type: 'string', description: 'When to remind (ISO format)', required: true },
      { name: 'repeat', type: 'string', description: 'Repeat pattern: daily, weekly, monthly, or none', required: false },
    ],
    requiresConfirmation: false,
    category: 'general',
  },
  {
    name: 'get_reminders',
    description: 'Get upcoming reminders',
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum number of reminders to return', required: false },
    ],
    requiresConfirmation: false,
    category: 'general',
  },
  {
    name: 'delete_reminder',
    description: 'Delete a reminder',
    parameters: [
      { name: 'reminder_id', type: 'string', description: 'ID of the reminder to delete', required: true },
    ],
    requiresConfirmation: true,
    category: 'general',
  },
  {
    name: 'search_nearby',
    description: 'Search for nearby places like restaurants, cafes, gyms, etc. using user location',
    parameters: [
      { name: 'query', type: 'string', description: 'What to search for (e.g., "italian restaurant", "coffee shop", "gym")', required: true },
      { name: 'latitude', type: 'number', description: 'User latitude', required: false },
      { name: 'longitude', type: 'number', description: 'User longitude', required: false },
      { name: 'radius', type: 'number', description: 'Search radius in meters (default 5000)', required: false },
      { name: 'open_now', type: 'boolean', description: 'Only show places open now', required: false },
      { name: 'limit', type: 'number', description: 'Number of results (default 5)', required: false },
    ],
    requiresConfirmation: false,
    category: 'search',
  },
  {
    name: 'create_location_reminder',
    description: 'Create a reminder that triggers when user arrives at or leaves a location (geofencing)',
    parameters: [
      { name: 'location_name', type: 'string', description: 'Name of the location (e.g., "Home", "Work", "Gym", "Grocery Store")', required: true },
      { name: 'message', type: 'string', description: 'What to remind the user about', required: true },
      { name: 'trigger_on', type: 'string', description: 'When to trigger: "enter" (arrive), "exit" (leave), or "both"', required: false },
      { name: 'latitude', type: 'number', description: 'Location latitude (if known)', required: false },
      { name: 'longitude', type: 'number', description: 'Location longitude (if known)', required: false },
      { name: 'is_recurring', type: 'boolean', description: 'Remind every time (true) or just once (false)', required: false },
    ],
    requiresConfirmation: false,
    category: 'general',
  },
];

export class ActionExecutor {
  private composioApiKey: string;
  private openaiKey: string;
  private tavilyApiKey?: string;
  private composio: ReturnType<typeof createComposioServices>;
  private db: D1Database;
  private userId: string;
  private userName?: string;

  constructor(params: {
    composioApiKey: string;
    openaiKey: string;
    tavilyApiKey?: string;
    db: D1Database;
    userId: string;
    userName?: string;
  }) {
    this.composioApiKey = params.composioApiKey;
    this.openaiKey = params.openaiKey;
    this.tavilyApiKey = params.tavilyApiKey;
    this.composio = createComposioServices(params.composioApiKey);
    this.db = params.db;
    this.userId = params.userId;
    this.userName = params.userName;
  }

  /**
   * Get available actions for the user
   */
  async getAvailableActions(): Promise<ActionDefinition[]> {
    // Check which integrations the user has connected
    const integrations = await this.db.prepare(`
      SELECT provider, connected
      FROM integrations
      WHERE user_id = ? AND connected = 1
    `).bind(this.userId).all();

    const connectedProviders = new Set(
      (integrations.results as any[]).map((i) => i.provider)
    );

    // Google Super provides email + calendar access
    const hasGoogleSuper = connectedProviders.has('googlesuper');

    // Filter actions based on connected providers
    return AVAILABLE_ACTIONS.filter((action) => {
      switch (action.category) {
        case 'email':
          // Gmail is part of Google Super
          return hasGoogleSuper || connectedProviders.has('gmail');
        case 'calendar':
          // Calendar is part of Google Super
          return hasGoogleSuper || connectedProviders.has('googlecalendar');
        case 'search':
        case 'general':
        case 'memory':
          return true; // Always available
        default:
          return false;
      }
    });
  }

  /**
   * Normalize parameters to handle AI parser variations
   * The parser might use alternative field names that we need to map
   */
  private normalizeParameters(action: string, params: Record<string, any>): Record<string, any> {
    const normalized = { ...params };

    if (action === 'send_email' || action === 'create_draft') {
      // If 'to' is missing but 'to_name' contains an email, use it
      if (!normalized.to && normalized.to_name) {
        // Check if to_name looks like an email
        if (normalized.to_name.includes('@')) {
          normalized.to = normalized.to_name;
        }
      }
      // If 'to' is missing but 'recipient' exists, use it
      if (!normalized.to && normalized.recipient) {
        normalized.to = normalized.recipient;
      }
      // If 'body' is missing but 'message' or 'content' exists, use it
      if (!normalized.body && normalized.message) {
        normalized.body = normalized.message;
      }
      if (!normalized.body && normalized.content) {
        normalized.body = normalized.content;
      }
    }

    if (action === 'create_calendar_event') {
      // Map 'summary' to 'title' if needed
      if (!normalized.title && normalized.summary) {
        normalized.title = normalized.summary;
      }
      // Map 'name' to 'title' if needed
      if (!normalized.title && normalized.name) {
        normalized.title = normalized.name;
      }
    }

    return normalized;
  }

  /**
   * Look up a contact's email by name
   * Searches entities table and Google contacts
   */
  private async lookupContactEmail(name: string): Promise<string | null> {
    // First, search local entities for the person
    const entity = await this.db.prepare(`
      SELECT name, email, metadata
      FROM entities
      WHERE user_id = ? AND type = 'person'
        AND (LOWER(name) LIKE ? OR LOWER(name) LIKE ?)
      ORDER BY
        CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END,
        interaction_count DESC
      LIMIT 1
    `).bind(
      this.userId,
      `%${name.toLowerCase()}%`,
      `${name.toLowerCase()}%`,
      name.toLowerCase()
    ).first<{ name: string; email: string | null; metadata: string | null }>();

    if (entity?.email) {
      console.log(`[ActionExecutor] Found contact ${name} -> ${entity.email} from entities`);
      return entity.email;
    }

    // Try to extract email from metadata
    if (entity?.metadata) {
      try {
        const meta = JSON.parse(entity.metadata);
        if (meta.email) {
          console.log(`[ActionExecutor] Found contact ${name} -> ${meta.email} from metadata`);
          return meta.email;
        }
      } catch (error) {
        console.warn(`[ActionExecutor] Failed to parse entity metadata for ${name}:`, error);
      }
    }

    // Search Google contacts via Composio
    try {
      const connectedAccountId = await this.getConnectedAccountId('gmail');
      if (connectedAccountId) {
        const composio = createComposioServices(this.composioApiKey);
        const result = await composio.gmail.searchPeople({
          connectedAccountId,
          query: name,
        });

        if (result.successful && result.data?.length > 0) {
          const contact = result.data[0];
          const email = contact.emailAddresses?.[0]?.value || contact.email;
          if (email) {
            console.log(`[ActionExecutor] Found contact ${name} -> ${email} from Google`);
            return email;
          }
        }
      }
    } catch (error) {
      console.warn(`[ActionExecutor] Google contact lookup failed:`, error);
    }

    console.log(`[ActionExecutor] No email found for contact: ${name}`);
    return null;
  }

  /**
   * Generate email content using AI
   */
  private async generateEmailContent(params: {
    to: string;
    toName?: string;
    subject: string;
    context?: string;
    tone?: 'formal' | 'casual' | 'professional';
  }): Promise<string> {
    const { to, toName, subject, context, tone = 'professional' } = params;

    const systemPrompt = `You are a helpful assistant that drafts emails. Write concise, ${tone} emails.
The email should be ready to send - include a proper greeting and sign-off.
Sign the email with "${this.userName || 'the sender'}" - never use placeholders like [Your Name].
Keep emails brief and to the point unless the context requires more detail.`;

    const userPrompt = `Draft an email:
To: ${toName || to}
Subject: ${subject}
${context ? `Context/Notes: ${context}` : ''}

Write the email body only (no subject line needed).`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('[ActionExecutor] Content generation failed:', error);
      throw new Error('Failed to generate email content');
    }
  }

  /**
   * Pre-process action parameters to resolve lookups and generate content
   */
  private async preprocessActionParams(
    action: string,
    params: Record<string, any>
  ): Promise<{ params: Record<string, any>; error?: string }> {
    const processed = { ...params };

    // Handle contact lookup for email actions
    if ((action === 'send_email' || action === 'create_draft') && params.needs_contact_lookup) {
      const name = params.to_name || params.attendees_names?.[0];
      if (name && !params.to) {
        const email = await this.lookupContactEmail(name);
        if (email) {
          processed.to = email;
          processed._resolved_contact = { name, email };
        } else {
          return {
            params: processed,
            error: `I couldn't find an email address for "${name}". Can you provide their email?`,
          };
        }
      }
    }

    // Handle contact lookup for calendar events
    if (action === 'create_calendar_event' && params.needs_contact_lookup) {
      const names = params.attendees_names || [];
      const resolvedAttendees: string[] = [];
      const unresolved: string[] = [];

      for (const name of names) {
        const email = await this.lookupContactEmail(name);
        if (email) {
          resolvedAttendees.push(email);
        } else {
          unresolved.push(name);
        }
      }

      if (resolvedAttendees.length > 0) {
        processed.attendees = resolvedAttendees;
      }

      if (unresolved.length > 0) {
        console.warn(`[ActionExecutor] Could not resolve attendees: ${unresolved.join(', ')}`);
        // Continue anyway, just log the warning
      }
    }

    // Handle content generation for emails
    if ((action === 'send_email' || action === 'create_draft') && params.needs_content_generation) {
      if (!processed.body) {
        try {
          const body = await this.generateEmailContent({
            to: processed.to,
            toName: params.to_name,
            subject: processed.subject,
            context: params.context || params.topic,
            tone: params.tone,
          });
          processed.body = body;
          processed._generated_content = true;
        } catch (error) {
          return {
            params: processed,
            error: 'I could not generate the email content. Please provide the message you want to send.',
          };
        }
      }
    }

    return { params: processed };
  }

  /**
   * Execute an action
   */
  async executeAction(request: ActionRequest): Promise<ActionResult> {
    const { action, confirmed } = request;
    // Normalize parameters to handle AI parser variations
    let parameters = this.normalizeParameters(action, request.parameters);

    console.log(`[ActionExecutor] Executing ${action}:`, {
      originalParams: request.parameters,
      normalizedParams: parameters,
      confirmed,
    });

    // Find action definition
    const actionDef = AVAILABLE_ACTIONS.find((a) => a.name === action);
    if (!actionDef) {
      return {
        success: false,
        action,
        error: `Unknown action: ${action}`,
        message: `I don't know how to perform "${action}". Available actions: ${AVAILABLE_ACTIONS.map((a) => a.name).join(', ')}`,
      };
    }

    // Pre-process: resolve contact lookups and generate content
    const preprocessResult = await this.preprocessActionParams(action, parameters);
    if (preprocessResult.error) {
      return {
        success: false,
        action,
        error: preprocessResult.error,
        message: preprocessResult.error,
      };
    }
    parameters = preprocessResult.params;

    // Check if confirmation is required but not provided
    if (actionDef.requiresConfirmation && !confirmed) {
      return {
        success: false,
        action,
        requiresConfirmation: true,
        confirmationMessage: this.generateConfirmationMessage(action, parameters),
        message: `This action requires your confirmation before proceeding.`,
      };
    }

    // Validate required parameters
    for (const param of actionDef.parameters) {
      if (param.required && !(param.name in parameters)) {
        // Generate more human-readable error messages
        let message: string;
        switch (param.name) {
          case 'to':
            message = 'I need an email address to send the email to.';
            break;
          case 'subject':
            message = 'I need a subject for the email.';
            break;
          case 'body':
            message = 'I need the message content for the email.';
            break;
          case 'title':
            message = 'I need a title for the calendar event.';
            break;
          case 'start_time':
            message = 'I need to know when the event should start.';
            break;
          case 'end_time':
            message = 'I need to know when the event should end.';
            break;
          default:
            message = `I need the ${param.description.toLowerCase()} to proceed.`;
        }
        return {
          success: false,
          action,
          error: `Missing required parameter: ${param.name}`,
          message,
        };
      }
    }

    // Execute the action
    try {
      const result = await this.dispatchAction(action, parameters);
      return result;
    } catch (error: any) {
      console.error(`[ActionExecutor] ${action} failed:`, error);
      return {
        success: false,
        action,
        error: error.message,
        message: `Failed to ${actionDef.description.toLowerCase()}: ${error.message}`,
      };
    }
  }

  /**
   * Dispatch action to appropriate handler
   */
  private async dispatchAction(
    action: string,
    parameters: Record<string, any>
  ): Promise<ActionResult> {
    // Type assertions are safe here because we validate parameters in executeAction
    switch (action) {
      case 'send_email':
        return this.sendEmail(parameters as any);
      case 'create_draft':
        return this.createDraft(parameters as any);
      case 'reply_to_email':
        return this.replyToEmail(parameters as any);
      case 'create_calendar_event':
        return this.createCalendarEvent(parameters as any);
      case 'update_calendar_event':
        return this.updateCalendarEvent(parameters as any);
      case 'delete_calendar_event':
        return this.deleteCalendarEvent(parameters as any);
      case 'fetch_emails':
        return this.fetchEmails(parameters as any);
      case 'search_emails':
        return this.searchEmails(parameters as any);
      case 'search_contacts':
        return this.searchContacts(parameters as any);
      case 'archive_email':
        return this.archiveEmail(parameters as any);
      case 'mark_as_read':
        return this.markAsRead(parameters as any);
      case 'star_email':
        return this.starEmail(parameters as any);
      case 'delete_email':
        return this.deleteEmail(parameters as any);
      case 'get_calendar_events':
        return this.getCalendarEvents(parameters as any);
      case 'web_search':
        return this.webSearch(parameters as { query: string; num_results?: number });
      case 'create_memory':
        return this.createMemory(parameters as any);
      case 'create_reminder':
        return this.createReminder(parameters as any);
      case 'get_reminders':
        return this.getReminders(parameters as any);
      case 'delete_reminder':
        return this.deleteReminder(parameters as any);
      case 'search_nearby':
        return this.searchNearby(parameters as any);
      case 'create_location_reminder':
        return this.createLocationReminder(parameters as any);
      default:
        return {
          success: false,
          action,
          error: 'Action not implemented',
          message: `The action "${action}" is not yet implemented.`,
        };
    }
  }

  /**
   * Mark a connection as needing reauthorization
   * Called when we get a token expired error from Composio
   */
  private async markConnectionExpired(provider: string): Promise<void> {
    try {
      // Update the connection status to indicate it needs reauth
      await this.db.prepare(`
        UPDATE integrations
        SET connected = 0, metadata = json_set(COALESCE(metadata, '{}'), '$.needs_reauth', true, '$.expired_at', ?)
        WHERE user_id = ? AND (provider = ? OR provider = 'googlesuper')
      `).bind(
        new Date().toISOString(),
        this.userId,
        provider
      ).run();
      console.log(`[ActionExecutor] Marked ${provider} connection as expired for user ${this.userId}`);
    } catch (error) {
      console.error('[ActionExecutor] Failed to mark connection expired:', error);
    }
  }

  /**
   * Execute a Composio operation safely with error handling
   * Automatically handles token expiration and rate limiting
   */
  private async executeComposioOperation<T>(
    provider: string,
    operation: () => Promise<ToolExecutionResult<T>>
  ): Promise<ActionResult> {
    const result = await executeComposioSafely(
      operation,
      {
        onTokenExpired: async () => {
          await this.markConnectionExpired(provider);
        },
      }
    );

    if (!result.success) {
      if (result.errorType === 'token_expired') {
        return {
          success: false,
          action: 'composio_operation',
          error: 'Token expired',
          message: `Your ${provider} connection has expired. Please reconnect in Settings to continue.`,
        };
      }
      if (result.errorType === 'rate_limited') {
        return {
          success: false,
          action: 'composio_operation',
          error: 'Rate limited',
          message: 'Too many requests. Please try again in a few moments.',
        };
      }
      return {
        success: false,
        action: 'composio_operation',
        error: result.error.message,
        message: `Operation failed: ${result.error.message}`,
      };
    }

    // Check if the Composio result itself indicates failure
    if (!result.data.successful) {
      return {
        success: false,
        action: 'composio_operation',
        error: result.data.error || 'Unknown error',
        message: result.data.error || 'The operation failed.',
      };
    }

    return {
      success: true,
      action: 'composio_operation',
      result: result.data.data,
      message: 'Operation completed successfully',
    };
  }

  /**
   * Get connected account ID for a provider
   * Google Super is preferred over individual Gmail/Calendar providers
   * Returns null if not connected or if the connection ID is invalid
   */
  private async getConnectedAccountId(provider: string): Promise<string | null> {
    let accessToken: string | null = null;

    // For email/calendar, try Google Super first
    if (provider === 'gmail' || provider === 'googlecalendar') {
      const googleSuper = await this.db.prepare(`
        SELECT access_token
        FROM integrations
        WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
      `).bind(this.userId).first<{ access_token: string }>();

      if (googleSuper?.access_token) {
        accessToken = googleSuper.access_token;
      }
    }

    // Fall back to specific provider if Google Super not found
    if (!accessToken) {
      const integration = await this.db.prepare(`
        SELECT access_token
        FROM integrations
        WHERE user_id = ? AND provider = ? AND connected = 1
      `).bind(this.userId, provider).first<{ access_token: string }>();

      accessToken = integration?.access_token || null;
    }

    // Validate the token is a valid Composio connection ID
    // Composio uses format like "ca_XXXXXXXXX" (not UUIDs)
    if (accessToken) {
      const composioIdRegex = /^ca_[A-Za-z0-9_-]+$/;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (!composioIdRegex.test(accessToken) && !uuidRegex.test(accessToken)) {
        console.error(`[ActionExecutor] Invalid Composio connection ID for ${provider}:`, accessToken);
        // Return null to trigger "not connected" flow - user needs to reconnect
        return null;
      }
    }

    return accessToken;
  }

  /**
   * Send email via Gmail
   */
  private async sendEmail(params: {
    to?: string;
    to_name?: string;
    subject: string;
    body: string;
    cc?: string[];
  }): Promise<ActionResult> {
    // Handle missing 'to' - might have 'to_name' from parser needing contact lookup
    const recipientEmail = params.to;
    if (!recipientEmail) {
      if (params.to_name) {
        return {
          success: false,
          action: 'send_email',
          error: 'Missing email address',
          message: `I need an email address for ${params.to_name}. Can you provide their email?`,
        };
      }
      return {
        success: false,
        action: 'send_email',
        error: 'Missing recipient',
        message: 'I need an email address to send the email to.',
      };
    }

    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'send_email',
        error: 'Gmail not connected',
        message: 'Please connect your Gmail account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.gmail.sendEmail({
        connectedAccountId,
        to: recipientEmail,
        subject: params.subject,
        body: params.body,
        cc: params.cc?.join(','),
      });

      if (result.successful) {
        // Log the action
        await this.logAction('send_email', params, result);

        return {
          success: true,
          action: 'send_email',
          result: result.data,
          message: `Email sent to ${params.to} with subject "${params.subject}"`,
        };
      }

      return {
        success: false,
        action: 'send_email',
        error: result.error || 'Unknown error',
        message: `Failed to send email: ${result.error}`,
      };
    } catch (error: any) {
      // Handle token expiration
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'send_email',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings to continue.',
        };
      }
      // Handle rate limiting
      if (error instanceof ComposioRateLimitError) {
        return {
          success: false,
          action: 'send_email',
          error: 'Rate limited',
          message: 'Too many requests to Gmail. Please try again in a few moments.',
        };
      }
      throw error;
    }
  }

  /**
   * Create email draft
   */
  private async createDraft(params: {
    to?: string;
    to_name?: string;
    subject: string;
    body: string;
  }): Promise<ActionResult> {
    const recipientEmail = params.to;
    if (!recipientEmail) {
      if (params.to_name) {
        return {
          success: false,
          action: 'create_draft',
          error: 'Missing email address',
          message: `I need an email address for ${params.to_name}. Can you provide their email?`,
        };
      }
      return {
        success: false,
        action: 'create_draft',
        error: 'Missing recipient',
        message: 'I need an email address for the draft.',
      };
    }

    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'create_draft',
        error: 'Gmail not connected',
        message: 'Please connect your Gmail account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GMAIL_CREATE_DRAFT',
      connectedAccountId,
      arguments: {
        recipient_email: recipientEmail, // Composio expects 'recipient_email' not 'to'
        subject: params.subject,
        body: params.body,
      },
    });

    if (result.successful) {
      return {
        success: true,
        action: 'create_draft',
        result: result.data,
        message: `Draft created for ${recipientEmail}`,
      };
    }

    return {
      success: false,
      action: 'create_draft',
      error: result.error || 'Unknown error',
      message: `Failed to create draft: ${result.error}`,
    };
  }

  /**
   * Reply to email thread
   */
  private async replyToEmail(params: {
    thread_id: string;
    body: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'reply_to_email',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GMAIL_REPLY_TO_THREAD',
      connectedAccountId,
      arguments: {
        thread_id: params.thread_id,
        body: params.body,
      },
    });

    if (result.successful) {
      await this.logAction('reply_to_email', params, result);

      return {
        success: true,
        action: 'reply_to_email',
        result: result.data,
        message: 'Reply sent successfully',
      };
    }

    return {
      success: false,
      action: 'reply_to_email',
      error: result.error || 'Unknown error',
      message: `Failed to send reply: ${result.error}`,
    };
  }

  /**
   * Create calendar event
   */
  private async createCalendarEvent(params: {
    title: string;
    start_time: string;
    end_time: string;
    description?: string;
    location?: string;
    attendees?: string[];
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('googlecalendar');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'create_calendar_event',
        error: 'Calendar not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.calendar.createEvent({
        connectedAccountId,
        summary: params.title,
        description: params.description,
        start: { dateTime: params.start_time },
        end: { dateTime: params.end_time },
        location: params.location,
        attendees: params.attendees?.map((email) => ({ email })),
      });

      if (result.successful) {
        await this.logAction('create_calendar_event', params, result);

        return {
          success: true,
          action: 'create_calendar_event',
          result: result.data,
          message: `Event "${params.title}" created for ${new Date(params.start_time).toLocaleString()}`,
        };
      }

      return {
        success: false,
        action: 'create_calendar_event',
        error: result.error || 'Unknown error',
        message: `Failed to create event: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('googlecalendar');
        return {
          success: false,
          action: 'create_calendar_event',
          error: 'Token expired',
          message: 'Your Google Calendar connection has expired. Please reconnect in Settings.',
        };
      }
      if (error instanceof ComposioRateLimitError) {
        return {
          success: false,
          action: 'create_calendar_event',
          error: 'Rate limited',
          message: 'Too many requests. Please try again in a moment.',
        };
      }
      throw error;
    }
  }

  /**
   * Update calendar event
   */
  private async updateCalendarEvent(params: {
    event_id: string;
    title?: string;
    start_time?: string;
    end_time?: string;
    description?: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('googlecalendar');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'update_calendar_event',
        error: 'Calendar not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const updateArgs: any = { event_id: params.event_id };
    if (params.title) updateArgs.summary = params.title;
    if (params.start_time) updateArgs.start_time = params.start_time;
    if (params.end_time) updateArgs.end_time = params.end_time;
    if (params.description) updateArgs.description = params.description;

    const result = await composio.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_UPDATE_EVENT',
      connectedAccountId,
      arguments: updateArgs,
    });

    if (result.successful) {
      await this.logAction('update_calendar_event', params, result);

      return {
        success: true,
        action: 'update_calendar_event',
        result: result.data,
        message: 'Event updated successfully',
      };
    }

    return {
      success: false,
      action: 'update_calendar_event',
      error: result.error || 'Unknown error',
      message: `Failed to update event: ${result.error}`,
    };
  }

  /**
   * Delete calendar event
   */
  private async deleteCalendarEvent(params: {
    event_id: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('googlecalendar');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'delete_calendar_event',
        error: 'Calendar not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_DELETE_EVENT',
      connectedAccountId,
      arguments: { event_id: params.event_id },
    });

    if (result.successful) {
      await this.logAction('delete_calendar_event', params, result);

      return {
        success: true,
        action: 'delete_calendar_event',
        result: result.data,
        message: 'Event deleted successfully',
      };
    }

    return {
      success: false,
      action: 'delete_calendar_event',
      error: result.error || 'Unknown error',
      message: `Failed to delete event: ${result.error}`,
    };
  }

  /**
   * Fetch recent emails (no query required)
   */
  private async fetchEmails(params: {
    max_results?: number;
    label?: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'fetch_emails',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    // Use label filter if provided, otherwise fetch from INBOX
    const query = params.label ? `label:${params.label}` : 'in:inbox';

    try {
      const result = await composio.gmail.fetchEmails({
        connectedAccountId,
        query,
        maxResults: params.max_results || 10,
      });

      if (result.successful) {
        // Transform emails for rich card display on frontend
        const rawEmails = result.data || [];
        const transformedEmails = rawEmails.map((email: any) => ({
          id: email.id || email.messageId || '',
          thread_id: email.threadId || email.thread_id || '',
          subject: email.subject || '(no subject)',
          from: email.from || email.sender || '',
          date: email.date || email.internalDate || new Date().toISOString(),
          snippet: email.snippet || email.bodyPreview || '',
          is_unread: email.labelIds?.includes('UNREAD') || !email.isRead,
          is_starred: email.labelIds?.includes('STARRED') || email.isStarred,
          is_important: email.labelIds?.includes('IMPORTANT'),
          labels: email.labelIds || [],
          attachment_count: email.attachments?.length || 0,
        }));

        return {
          success: true,
          action: 'fetch_emails',
          result: {
            emails: transformedEmails,
            count: transformedEmails.length,
            _tool: 'fetch_emails', // Marker for rich content detection
          },
          message: `Found ${transformedEmails.length} recent emails`,
        };
      }

      return {
        success: false,
        action: 'fetch_emails',
        error: result.error || 'Unknown error',
        message: `Failed to fetch emails: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'fetch_emails',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings.',
        };
      }
      if (error instanceof ComposioRateLimitError) {
        return {
          success: false,
          action: 'fetch_emails',
          error: 'Rate limited',
          message: 'Too many requests. Please try again in a moment.',
        };
      }
      throw error;
    }
  }

  /**
   * Search emails
   */
  private async searchEmails(params: {
    query: string;
    max_results?: number;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'search_emails',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.gmail.fetchEmails({
      connectedAccountId,
      query: params.query,
      maxResults: params.max_results || 10,
    });

    if (result.successful) {
      // Transform emails for rich card display on frontend
      const rawEmails = result.data || [];
      const transformedEmails = rawEmails.map((email: any) => ({
        id: email.id || email.messageId || '',
        thread_id: email.threadId || email.thread_id || '',
        subject: email.subject || '(no subject)',
        from: email.from || email.sender || '',
        date: email.date || email.internalDate || new Date().toISOString(),
        snippet: email.snippet || email.bodyPreview || '',
        is_unread: email.labelIds?.includes('UNREAD') || !email.isRead,
        is_starred: email.labelIds?.includes('STARRED') || email.isStarred,
        is_important: email.labelIds?.includes('IMPORTANT'),
        labels: email.labelIds || [],
        attachment_count: email.attachments?.length || 0,
      }));

      return {
        success: true,
        action: 'search_emails',
        result: {
          emails: transformedEmails,
          count: transformedEmails.length,
          _tool: 'search_emails', // Marker for rich content detection
        },
        message: `Found ${transformedEmails.length} emails matching "${params.query}"`,
      };
    }

    return {
      success: false,
      action: 'search_emails',
      error: result.error || 'Unknown error',
      message: `Failed to search emails: ${result.error}`,
    };
  }

  /**
   * Search contacts
   */
  private async searchContacts(params: {
    query: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'search_contacts',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.gmail.searchPeople({
      connectedAccountId,
      query: params.query,
    });

    if (result.successful) {
      return {
        success: true,
        action: 'search_contacts',
        result: result.data,
        message: `Found contacts matching "${params.query}"`,
      };
    }

    return {
      success: false,
      action: 'search_contacts',
      error: result.error || 'Unknown error',
      message: `Failed to search contacts: ${result.error}`,
    };
  }

  /**
   * Archive email (remove from inbox)
   */
  private async archiveEmail(params: {
    message_id: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'archive_email',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.gmail.archiveEmail({
        connectedAccountId,
        messageId: params.message_id,
      });

      if (result.successful) {
        await this.logAction('archive_email', params, result);
        return {
          success: true,
          action: 'archive_email',
          result: result.data,
          message: 'Email archived successfully',
        };
      }

      return {
        success: false,
        action: 'archive_email',
        error: result.error || 'Unknown error',
        message: `Failed to archive email: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'archive_email',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings.',
        };
      }
      throw error;
    }
  }

  /**
   * Mark email as read
   */
  private async markAsRead(params: {
    message_id: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'mark_as_read',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.gmail.markAsRead({
        connectedAccountId,
        messageId: params.message_id,
      });

      if (result.successful) {
        await this.logAction('mark_as_read', params, result);
        return {
          success: true,
          action: 'mark_as_read',
          result: result.data,
          message: 'Email marked as read',
        };
      }

      return {
        success: false,
        action: 'mark_as_read',
        error: result.error || 'Unknown error',
        message: `Failed to mark email as read: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'mark_as_read',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings.',
        };
      }
      throw error;
    }
  }

  /**
   * Star or unstar email
   */
  private async starEmail(params: {
    message_id: string;
    starred?: boolean;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'star_email',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);
    const starred = params.starred !== false; // Default to true

    try {
      const result = await composio.gmail.toggleStar({
        connectedAccountId,
        messageId: params.message_id,
        starred,
      });

      if (result.successful) {
        await this.logAction('star_email', params, result);
        return {
          success: true,
          action: 'star_email',
          result: result.data,
          message: starred ? 'Email starred' : 'Email unstarred',
        };
      }

      return {
        success: false,
        action: 'star_email',
        error: result.error || 'Unknown error',
        message: `Failed to star email: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'star_email',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings.',
        };
      }
      throw error;
    }
  }

  /**
   * Delete email (move to trash)
   */
  private async deleteEmail(params: {
    message_id: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'delete_email',
        error: 'Gmail not connected',
        message: 'Please connect your Google account in Settings first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.gmail.trashEmail({
        connectedAccountId,
        messageId: params.message_id,
      });

      if (result.successful) {
        await this.logAction('delete_email', params, result);
        return {
          success: true,
          action: 'delete_email',
          result: result.data,
          message: 'Email moved to trash',
        };
      }

      return {
        success: false,
        action: 'delete_email',
        error: result.error || 'Unknown error',
        message: `Failed to delete email: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('gmail');
        return {
          success: false,
          action: 'delete_email',
          error: 'Token expired',
          message: 'Your Gmail connection has expired. Please reconnect in Settings.',
        };
      }
      throw error;
    }
  }

  /**
   * Get calendar events
   */
  private async getCalendarEvents(params: {
    start_time: string;
    end_time: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('googlecalendar');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'get_calendar_events',
        error: 'Calendar not connected',
        message: 'Please connect your Google account in Settings first, or reconnect if already connected.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    try {
      const result = await composio.calendar.listEvents({
        connectedAccountId,
        timeMin: params.start_time,
        timeMax: params.end_time,
      });

      if (result.successful) {
        // Transform events for rich card display on frontend
        const rawEvents = result.data || [];
        const transformedEvents = Array.isArray(rawEvents)
          ? rawEvents.map((event: any) => ({
              id: event.id || '',
              title: event.summary || event.title || '(No title)',
              start: event.start?.dateTime || event.start?.date || '',
              end: event.end?.dateTime || event.end?.date || '',
              location: event.location || '',
              description: event.description || '',
              attendees: event.attendees?.map((a: any) => a.email) || [],
              is_all_day: !event.start?.dateTime,
              status: event.status || 'confirmed',
            }))
          : [];

        return {
          success: true,
          action: 'get_calendar_events',
          result: {
            events: transformedEvents,
            count: transformedEvents.length,
            _tool: 'get_calendar_events', // Marker for rich content detection
          },
          message: `Found ${transformedEvents.length} events`,
        };
      }

      return {
        success: false,
        action: 'get_calendar_events',
        error: result.error || 'Unknown error',
        message: `Failed to get calendar events: ${result.error}`,
      };
    } catch (error: any) {
      if (error instanceof ComposioTokenExpiredError) {
        await this.markConnectionExpired('googlecalendar');
        return {
          success: false,
          action: 'get_calendar_events',
          error: 'Token expired',
          message: 'Your Google Calendar connection has expired. Please reconnect in Settings.',
        };
      }
      if (error instanceof ComposioRateLimitError) {
        return {
          success: false,
          action: 'get_calendar_events',
          error: 'Rate limited',
          message: 'Too many requests. Please try again in a moment.',
        };
      }
      throw error;
    }
  }

  /**
   * Web search using Tavily API (designed for AI applications)
   * Returns clean, structured search results
   */
  private async webSearch(params: {
    query: string;
    num_results?: number;
  }): Promise<ActionResult> {
    if (!this.tavilyApiKey) {
      return {
        success: false,
        action: 'web_search',
        error: 'Web search not configured',
        message: 'Web search is not configured. Please add TAVILY_API_KEY to enable this feature.',
      };
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.tavilyApiKey,
          query: params.query,
          max_results: params.num_results || 5,
          include_answer: true,
          include_raw_content: false,
          search_depth: 'basic',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ActionExecutor] Tavily API error:', response.status, errorText);
        return {
          success: false,
          action: 'web_search',
          error: `Search API error: ${response.status}`,
          message: 'Web search temporarily unavailable. Please try again later.',
        };
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{
          title: string;
          url: string;
          content: string;
          score: number;
        }>;
        query: string;
      };

      // Format results for the AI to use
      const results = {
        answer: data.answer,
        organic_results: (data.results || []).map(r => ({
          title: r.title,
          link: r.url,
          snippet: r.content,
          score: r.score,
        })),
        query: params.query,
        _tool: 'web_search',
      };

      const resultCount = results.organic_results.length;
      let message = `Found ${resultCount} result${resultCount !== 1 ? 's' : ''} for "${params.query}"`;

      // If Tavily provided a direct answer, include it
      if (data.answer) {
        message = `${data.answer}\n\n${message}`;
      }

      await this.logAction('web_search', params, { resultCount });

      return {
        success: true,
        action: 'web_search',
        result: results,
        message,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Web search failed:', error);
      return {
        success: false,
        action: 'web_search',
        error: error.message,
        message: `Search failed: ${error.message}`,
      };
    }
  }

  /**
   * Search for nearby places using Yelp API
   * Supports restaurants, cafes, gyms, and any business type
   */
  private async searchNearby(params: {
    query: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    open_now?: boolean;
    limit?: number;
  }): Promise<ActionResult> {
    // Get user's last known location if not provided
    let latitude = params.latitude;
    let longitude = params.longitude;

    if (!latitude || !longitude) {
      // Try to get user's stored location
      const userLocation = await this.db.prepare(`
        SELECT latitude, longitude FROM users WHERE id = ?
      `).bind(this.userId).first<{ latitude: number; longitude: number }>();

      if (userLocation?.latitude && userLocation?.longitude) {
        latitude = userLocation.latitude;
        longitude = userLocation.longitude;
      } else {
        return {
          success: false,
          action: 'search_nearby',
          error: 'Location required',
          message: 'I need your location to search for nearby places. Please enable location access in the app.',
        };
      }
    }

    try {
      // Use Composio's Yelp service (no API key needed - Composio manages it)
      const result = await this.composio.yelp.searchBusinesses({
        entityId: this.userId,
        term: params.query,
        latitude,
        longitude,
        radius: params.radius || 5000,
        limit: params.limit || 5,
        sortBy: 'best_match',
      });

      if (!result.successful) {
        return {
          success: false,
          action: 'search_nearby',
          error: result.error || 'Search failed',
          message: `Places search failed: ${result.error || 'Unknown error'}`,
        };
      }

      const businesses = result.data?.businesses || [];

      if (businesses.length === 0) {
        return {
          success: true,
          action: 'search_nearby',
          result: { places: [], count: 0, _tool: 'search_nearby' },
          message: `No ${params.query} found nearby. Try expanding your search or trying a different category.`,
        };
      }

      // Format places for response (Yelp API format)
      const places = businesses.map((biz: any) => ({
        id: biz.id,
        name: biz.name,
        category: biz.categories?.[0]?.title || 'Business',
        rating: biz.rating,
        review_count: biz.review_count,
        price: biz.price,
        address: biz.location?.display_address?.join(', ') || '',
        phone: biz.display_phone,
        distance_meters: biz.distance,
        is_open: !biz.is_closed,
        url: biz.url,
        image_url: biz.image_url,
      }));

      await this.logAction('search_nearby', params, { count: places.length });

      // Build a nice message with top results
      const topPlaces = places.slice(0, 3).map((p: any, i: number) =>
        `${i + 1}. ${p.name} (${p.rating}★) - ${p.address}${p.price ? ` - ${p.price}` : ''}`
      ).join('\n');

      return {
        success: true,
        action: 'search_nearby',
        result: {
          places,
          count: places.length,
          query: params.query,
          location: { latitude, longitude },
          _tool: 'search_nearby',
        },
        message: `Found ${places.length} ${params.query} nearby:\n\n${topPlaces}`,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Nearby search failed:', error);
      return {
        success: false,
        action: 'search_nearby',
        error: error.message,
        message: `Places search failed: ${error.message}`,
      };
    }
  }

  /**
   * Create a location-based reminder (geofencing)
   * Stores in database, mobile app syncs and registers with OS
   */
  private async createLocationReminder(params: {
    location_name: string;
    message: string;
    trigger_on?: 'enter' | 'exit' | 'both';
    latitude?: number;
    longitude?: number;
    is_recurring?: boolean;
  }): Promise<ActionResult> {
    // Check if we have coordinates, or need to look up the location
    let latitude = params.latitude;
    let longitude = params.longitude;

    // If no coordinates provided, try to look up from known locations
    if (!latitude || !longitude) {
      const knownLocation = await this.db.prepare(`
        SELECT latitude, longitude FROM known_locations
        WHERE user_id = ? AND LOWER(name) = LOWER(?)
      `).bind(this.userId, params.location_name).first<{ latitude: number; longitude: number }>();

      if (knownLocation) {
        latitude = knownLocation.latitude;
        longitude = knownLocation.longitude;
      } else {
        // Check if it's a standard location like "home" or "work" from user profile
        const userLocation = await this.db.prepare(`
          SELECT latitude, longitude FROM users WHERE id = ?
        `).bind(this.userId).first<{ latitude: number; longitude: number }>();

        // For now, return error asking for location
        // In future, could use geocoding API to look up address
        return {
          success: false,
          action: 'create_location_reminder',
          error: 'Location not found',
          message: `I don't have coordinates for "${params.location_name}". Can you save this location first in the app, or provide the address?`,
        };
      }
    }

    // Check reminder count (iOS limit is 20)
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as count FROM location_reminders
      WHERE user_id = ? AND status = 'active'
    `).bind(this.userId).first<{ count: number }>();

    if (countResult && countResult.count >= 20) {
      return {
        success: false,
        action: 'create_location_reminder',
        error: 'Limit reached',
        message: 'You already have 20 location reminders (the maximum). Delete some old ones to add new ones.',
      };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const triggerOn = params.trigger_on || 'enter';

    try {
      await this.db.prepare(`
        INSERT INTO location_reminders (
          id, user_id, name, latitude, longitude, radius_meters,
          message, trigger_on, is_recurring, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?, 'active', ?, ?)
      `).bind(
        id,
        this.userId,
        params.location_name,
        latitude,
        longitude,
        params.message,
        triggerOn,
        params.is_recurring ? 1 : 0,
        now,
        now
      ).run();

      await this.logAction('create_location_reminder', params, { id });

      const triggerText = triggerOn === 'exit'
        ? `leave ${params.location_name}`
        : triggerOn === 'both'
          ? `arrive at or leave ${params.location_name}`
          : `arrive at ${params.location_name}`;

      return {
        success: true,
        action: 'create_location_reminder',
        result: {
          id,
          location: params.location_name,
          message: params.message,
          triggerOn,
          isRecurring: !!params.is_recurring,
          _tool: 'create_location_reminder',
        },
        message: `Got it! I'll remind you "${params.message}" when you ${triggerText}.${params.is_recurring ? ' (This will remind you every time.)' : ''}`,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Create location reminder failed:', error);
      return {
        success: false,
        action: 'create_location_reminder',
        error: error.message,
        message: `Failed to create location reminder: ${error.message}`,
      };
    }
  }

  /**
   * Generate confirmation message
   */
  private generateConfirmationMessage(
    action: string,
    parameters: Record<string, any>
  ): string {
    switch (action) {
      case 'send_email':
        return `Send email to ${parameters.to} with subject "${parameters.subject}"?`;
      case 'reply_to_email':
        return `Reply to the email thread?`;
      case 'create_calendar_event':
        return `Create event "${parameters.title}" on ${new Date(parameters.start_time).toLocaleString()}?`;
      case 'update_calendar_event':
        return `Update the calendar event?`;
      case 'delete_calendar_event':
        return `Delete the calendar event? This cannot be undone.`;
      case 'delete_email':
        return `Delete this email? It will be moved to trash.`;
      default:
        return `Execute ${action}?`;
    }
  }

  /**
   * Create a memory (save information for future recall)
   */
  private async createMemory(params: {
    content: string;
    context?: string;
  }): Promise<ActionResult> {
    const memoryId = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      // Store the memory in the database
      await this.db.prepare(`
        INSERT INTO memories (id, user_id, content, context, importance_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0.7, ?, ?)
      `).bind(
        memoryId,
        this.userId,
        params.content,
        params.context || 'chat',
        now,
        now
      ).run();

      // Log the action
      await this.logAction('create_memory', params, { memoryId });

      return {
        success: true,
        action: 'create_memory',
        result: { memoryId },
        message: `Got it! I'll remember: "${params.content.slice(0, 100)}${params.content.length > 100 ? '...' : ''}"`,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Create memory failed:', error);
      return {
        success: false,
        action: 'create_memory',
        error: error.message,
        message: `Failed to save memory: ${error.message}`,
      };
    }
  }

  /**
   * Create a reminder for a specific time
   * Stores in proactive_events table for the cron to process
   */
  private async createReminder(params: {
    message: string;
    remind_at: string;
    repeat?: string;
  }): Promise<ActionResult> {
    const reminderId = crypto.randomUUID();
    const now = new Date().toISOString();
    const remindAt = new Date(params.remind_at);

    // Validate remind_at is in the future
    if (remindAt <= new Date()) {
      return {
        success: false,
        action: 'create_reminder',
        error: 'Invalid time',
        message: 'The reminder time must be in the future.',
      };
    }

    try {
      // Store the reminder in proactive_events table
      // This will be picked up by the proactive system's cron job
      await this.db.prepare(`
        INSERT INTO proactive_events (
          id, user_id, source, event_type, priority, title, summary,
          raw_data, status, scheduled_at, created_at
        )
        VALUES (?, ?, 'reminder', 'reminder', 'high', ?, ?, ?, 'pending', ?, ?)
      `).bind(
        reminderId,
        this.userId,
        `Reminder: ${params.message.slice(0, 50)}`,
        params.message,
        JSON.stringify({
          message: params.message,
          repeat: params.repeat || 'none',
          created_at: now,
        }),
        params.remind_at,
        now
      ).run();

      // Log the action
      await this.logAction('create_reminder', params, { reminderId });

      // Format the time nicely for the response
      const formattedTime = remindAt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      return {
        success: true,
        action: 'create_reminder',
        result: { reminderId, remind_at: params.remind_at },
        message: `Got it! I'll remind you "${params.message}" on ${formattedTime}.`,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Create reminder failed:', error);
      return {
        success: false,
        action: 'create_reminder',
        error: error.message,
        message: `Failed to create reminder: ${error.message}`,
      };
    }
  }

  /**
   * Get upcoming reminders for the user
   */
  private async getReminders(params: {
    limit?: number;
  }): Promise<ActionResult> {
    try {
      const limit = params.limit || 10;
      const now = new Date().toISOString();

      const result = await this.db.prepare(`
        SELECT id, title, summary, scheduled_at, raw_data, status
        FROM proactive_events
        WHERE user_id = ? AND source = 'reminder' AND status = 'pending'
          AND scheduled_at > ?
        ORDER BY scheduled_at ASC
        LIMIT ?
      `).bind(this.userId, now, limit).all();

      const reminders = (result.results as any[]).map((r) => {
        let repeat = 'none';
        try {
          const rawData = JSON.parse(r.raw_data || '{}');
          repeat = rawData.repeat || 'none';
        } catch (error) {
          // Use default 'none' if parsing fails
          console.warn(`[ActionExecutor] Failed to parse reminder raw_data for ${r.id}:`, error);
        }

        return {
          id: r.id,
          message: r.summary || r.title,
          remind_at: r.scheduled_at,
          repeat,
          status: r.status,
        };
      });

      return {
        success: true,
        action: 'get_reminders',
        result: {
          reminders,
          count: reminders.length,
          _tool: 'get_reminders',
        },
        message: reminders.length > 0
          ? `You have ${reminders.length} upcoming reminder${reminders.length > 1 ? 's' : ''}.`
          : 'You have no upcoming reminders.',
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Get reminders failed:', error);
      return {
        success: false,
        action: 'get_reminders',
        error: error.message,
        message: `Failed to get reminders: ${error.message}`,
      };
    }
  }

  /**
   * Delete a reminder
   */
  private async deleteReminder(params: {
    reminder_id: string;
  }): Promise<ActionResult> {
    try {
      // First verify the reminder belongs to this user
      const existing = await this.db.prepare(`
        SELECT id, summary FROM proactive_events
        WHERE id = ? AND user_id = ? AND source = 'reminder'
      `).bind(params.reminder_id, this.userId).first<{ id: string; summary: string }>();

      if (!existing) {
        return {
          success: false,
          action: 'delete_reminder',
          error: 'Not found',
          message: 'Reminder not found or already deleted.',
        };
      }

      // Delete the reminder
      await this.db.prepare(`
        DELETE FROM proactive_events
        WHERE id = ? AND user_id = ?
      `).bind(params.reminder_id, this.userId).run();

      // Log the action
      await this.logAction('delete_reminder', params, { deleted: true });

      return {
        success: true,
        action: 'delete_reminder',
        result: { deleted: true },
        message: `Reminder "${existing.summary?.slice(0, 50)}" has been deleted.`,
      };
    } catch (error: any) {
      console.error('[ActionExecutor] Delete reminder failed:', error);
      return {
        success: false,
        action: 'delete_reminder',
        error: error.message,
        message: `Failed to delete reminder: ${error.message}`,
      };
    }
  }

  /**
   * Log action for audit trail
   */
  private async logAction(
    action: string,
    parameters: Record<string, any>,
    result: any
  ): Promise<void> {
    try {
      await this.db.prepare(`
        INSERT INTO action_log (id, user_id, action, parameters, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        this.userId,
        action,
        JSON.stringify(parameters),
        JSON.stringify(result),
        new Date().toISOString()
      ).run();
    } catch (error) {
      console.warn('[ActionExecutor] Failed to log action:', error);
    }
  }
}

/**
 * Factory function
 */
export function createActionExecutor(params: {
  composioApiKey: string;
  openaiKey: string;
  tavilyApiKey?: string;
  db: D1Database;
  userId: string;
  userName?: string;
}): ActionExecutor {
  return new ActionExecutor(params);
}
