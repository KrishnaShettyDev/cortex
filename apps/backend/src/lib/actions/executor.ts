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

import { createComposioServices, type ToolExecutionResult } from '../composio';
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
    name: 'search_emails',
    description: 'Search through emails',
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
    description: 'Search the web for information',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'num_results', type: 'number', description: 'Number of results', required: false },
    ],
    requiresConfirmation: false,
    category: 'search',
  },
];

export class ActionExecutor {
  private composioApiKey: string;
  private db: D1Database;
  private userId: string;

  constructor(params: {
    composioApiKey: string;
    db: D1Database;
    userId: string;
  }) {
    this.composioApiKey = params.composioApiKey;
    this.db = params.db;
    this.userId = params.userId;
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

    // Filter actions based on connected providers
    return AVAILABLE_ACTIONS.filter((action) => {
      switch (action.category) {
        case 'email':
          return connectedProviders.has('gmail');
        case 'calendar':
          return connectedProviders.has('googlecalendar');
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
   * Execute an action
   */
  async executeAction(request: ActionRequest): Promise<ActionResult> {
    const { action, parameters, confirmed } = request;

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
        return {
          success: false,
          action,
          error: `Missing required parameter: ${param.name}`,
          message: `I need the ${param.name} to ${actionDef.description.toLowerCase()}`,
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
    switch (action) {
      case 'send_email':
        return this.sendEmail(parameters);
      case 'create_draft':
        return this.createDraft(parameters);
      case 'reply_to_email':
        return this.replyToEmail(parameters);
      case 'create_calendar_event':
        return this.createCalendarEvent(parameters);
      case 'update_calendar_event':
        return this.updateCalendarEvent(parameters);
      case 'delete_calendar_event':
        return this.deleteCalendarEvent(parameters);
      case 'search_emails':
        return this.searchEmails(parameters);
      case 'search_contacts':
        return this.searchContacts(parameters);
      case 'get_calendar_events':
        return this.getCalendarEvents(parameters);
      case 'web_search':
        return this.webSearch(parameters);
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
   * Get connected account ID for a provider
   */
  private async getConnectedAccountId(provider: string): Promise<string | null> {
    const integration = await this.db.prepare(`
      SELECT access_token
      FROM integrations
      WHERE user_id = ? AND provider = ? AND connected = 1
    `).bind(this.userId, provider).first<{ access_token: string }>();

    return integration?.access_token || null;
  }

  /**
   * Send email via Gmail
   */
  private async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
    cc?: string[];
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'send_email',
        error: 'Gmail not connected',
        message: 'Please connect your Gmail account first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GMAIL_SEND_EMAIL',
      connectedAccountId,
      arguments: {
        to: params.to,
        subject: params.subject,
        body: params.body,
        cc: params.cc?.join(','),
      },
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
  }

  /**
   * Create email draft
   */
  private async createDraft(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<ActionResult> {
    const connectedAccountId = await this.getConnectedAccountId('gmail');
    if (!connectedAccountId) {
      return {
        success: false,
        action: 'create_draft',
        error: 'Gmail not connected',
        message: 'Please connect your Gmail account first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GMAIL_CREATE_DRAFT',
      connectedAccountId,
      arguments: {
        to: params.to,
        subject: params.subject,
        body: params.body,
      },
    });

    if (result.successful) {
      return {
        success: true,
        action: 'create_draft',
        result: result.data,
        message: `Draft created for ${params.to}`,
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
        message: 'Please connect your Gmail account first.',
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
        message: 'Please connect your Google Calendar first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
      connectedAccountId,
      arguments: {
        summary: params.title,
        start_time: params.start_time,
        end_time: params.end_time,
        description: params.description,
        location: params.location,
        attendees: params.attendees?.map((email) => ({ email })),
      },
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
        message: 'Please connect your Google Calendar first.',
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
        message: 'Please connect your Google Calendar first.',
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
        message: 'Please connect your Gmail account first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.gmail.fetchEmails({
      connectedAccountId,
      query: params.query,
      maxResults: params.max_results || 10,
    });

    if (result.successful) {
      return {
        success: true,
        action: 'search_emails',
        result: result.data,
        message: `Found ${result.data?.length || 0} emails matching "${params.query}"`,
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
        message: 'Please connect your Gmail account first.',
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
        message: 'Please connect your Google Calendar first.',
      };
    }

    const composio = createComposioServices(this.composioApiKey);

    const result = await composio.calendar.listEvents({
      connectedAccountId,
      timeMin: params.start_time,
      timeMax: params.end_time,
    });

    if (result.successful) {
      return {
        success: true,
        action: 'get_calendar_events',
        result: result.data,
        message: `Found ${result.data?.length || 0} events`,
      };
    }

    return {
      success: false,
      action: 'get_calendar_events',
      error: result.error || 'Unknown error',
      message: `Failed to get calendar events: ${result.error}`,
    };
  }

  /**
   * Web search (uses Serper if available)
   */
  private async webSearch(params: {
    query: string;
    num_results?: number;
  }): Promise<ActionResult> {
    // This would use the search service from world-context
    // For now, return a placeholder
    return {
      success: false,
      action: 'web_search',
      error: 'Web search requires Serper API key',
      message: 'Web search is not configured. Please add SERPER_API_KEY to enable.',
    };
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
      default:
        return `Execute ${action}?`;
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
  db: D1Database;
  userId: string;
}): ActionExecutor {
  return new ActionExecutor(params);
}
