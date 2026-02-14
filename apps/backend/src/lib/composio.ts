/**
 * Composio REST API Client
 *
 * Handles OAuth flows, connected accounts, and tool execution for Gmail, Calendar, etc.
 * Base URL: https://backend.composio.dev/api/v3
 *
 * RESILIENCE: All requests have timeouts to prevent hanging
 * RESILIENCE: 401 errors trigger token expiration handling
 */

import { fetchWithTimeout, DEFAULT_TIMEOUTS, FetchTimeoutError } from './fetch-with-timeout';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const COMPOSIO_API_V2 = 'https://backend.composio.dev/api/v2';

/** Timeout for Composio API calls (30s - they can be slow) */
const COMPOSIO_TIMEOUT = DEFAULT_TIMEOUTS.SLOW;

/**
 * Custom error for OAuth token expiration
 * Callers should catch this and prompt user to reauthorize
 */
export class ComposioTokenExpiredError extends Error {
  public readonly connectedAccountId?: string;

  constructor(message: string, connectedAccountId?: string) {
    super(message);
    this.name = 'ComposioTokenExpiredError';
    this.connectedAccountId = connectedAccountId;
  }
}

/**
 * Custom error for rate limiting
 */
export class ComposioRateLimitError extends Error {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'ComposioRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export interface ComposioConfig {
  apiKey: string;
  /**
   * Auth config ID for Google Super integration (combines Gmail + Calendar)
   * This uses Composio's managed OAuth credentials
   */
  googleSuperAuthConfigId?: string;
}

export interface ConnectedAccount {
  id: string;
  nanoid: string;
  userId: string;
  toolkitSlug: string; // 'gmail', 'googlecalendar'
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED' | 'EXPIRED' | 'INITIALIZING' | 'INITIATED';
  connectionData: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLinkResponse {
  linkToken: string;
  redirectUrl: string;
  expiresAt: string;
  connectedAccountId?: string; // UUID format for v2 API tool execution
  v3Id?: string; // New ca_* format for v3 API
}

export interface ToolExecutionResult<T = any> {
  data: T;
  error: string | null;
  logId: string;
  successful: boolean;
}

export interface TriggerInstance {
  id: string;
  triggerName: string;
  connectionId: string;
  status: 'active' | 'paused' | 'failed';
  webhookUrl: string;
  triggerConfig: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export class ComposioClient {
  private apiKey: string;
  private googleSuperAuthConfigId: string;

  constructor(config: ComposioConfig) {
    this.apiKey = config.apiKey;
    // Use the googlesuper auth config (Composio's managed OAuth)
    this.googleSuperAuthConfigId = config.googleSuperAuthConfigId || 'ac_lt9oHFMw6m0T';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    context?: { connectedAccountId?: string }
  ): Promise<T> {
    const url = `${COMPOSIO_API_BASE}${endpoint}`;
    const headers = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetchWithTimeout(url, {
        ...options,
        headers,
        timeout: COMPOSIO_TIMEOUT,
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Handle 401 - OAuth token expired
        if (response.status === 401) {
          console.error(`[Composio] 401 Unauthorized for ${endpoint} - OAuth token likely expired`);
          throw new ComposioTokenExpiredError(
            `OAuth token expired for connection. User needs to reauthorize.`,
            context?.connectedAccountId
          );
        }

        // Handle 429 - Rate limited
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
          console.error(`[Composio] 429 Rate limited for ${endpoint}, retry after ${retryAfter}s`);
          throw new ComposioRateLimitError(
            `Composio rate limited, retry after ${retryAfter} seconds`,
            retryAfter
          );
        }

        throw new Error(`Composio API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error: any) {
      if (error instanceof FetchTimeoutError) {
        console.error(`[Composio] Request to ${endpoint} timed out after ${COMPOSIO_TIMEOUT}ms`);
        throw new Error(`Composio request timed out: ${endpoint}`);
      }
      // Re-throw our custom errors as-is
      if (error instanceof ComposioTokenExpiredError || error instanceof ComposioRateLimitError) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Create OAuth link for user to connect their account
   *
   * Uses GOOGLESUPER toolkit with Composio's managed OAuth credentials
   * to avoid Google verification requirements.
   */
  async createAuthLink(params: {
    toolkitSlug: string; // 'gmail', 'googlecalendar', 'google'
    userId: string; // Our internal user ID
    callbackUrl: string; // Redirect URL after OAuth
  }): Promise<AuthLinkResponse> {
    // V3 API format from composio SDK source code
    // https://github.com/composiohq/composio/blob/next/python/composio/core/models/connected_accounts.py
    const requestBody = {
      auth_config: {
        id: this.googleSuperAuthConfigId,
      },
      connection: {
        user_id: params.userId,
        callback_url: params.callbackUrl,
        state: {
          authScheme: 'OAUTH2',
          status: 'INITIALIZING',
        },
      },
    };

    console.log('[Composio] Creating connection with GOOGLESUPER:', JSON.stringify(requestBody));

    const response = await this.request<any>('/connected_accounts', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    console.log('[Composio] createAuthLink response:', JSON.stringify(response));

    // v3 API returns redirect_url in the response
    const redirectUrl = response.redirect_url || response.redirectUrl || response.authUrl || '';

    if (!redirectUrl) {
      throw new Error(`No redirectUrl in Composio response: ${JSON.stringify(response)}`);
    }

    // Extract both the v3 ID (ca_*) and the deprecated UUID (for v2 API compatibility)
    const v3Id = response.id || response.connectionId || '';
    const deprecatedUuid = response.deprecated?.uuid || '';

    return {
      linkToken: v3Id,
      redirectUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      // Include both IDs - v2 API tool execution needs the UUID format
      connectedAccountId: deprecatedUuid || v3Id, // Prefer UUID for tool execution
      v3Id, // Store v3 ID for reference
    };
  }

  /**
   * Get connected account by ID
   */
  async getConnectedAccount(id: string): Promise<ConnectedAccount> {
    return this.request<ConnectedAccount>(`/connections/${id}`);
  }

  /**
   * List all connected accounts for a user
   */
  async listConnectedAccounts(params: {
    userId: string;
    toolkitSlugs?: string[];
    statuses?: string[];
  }): Promise<{ items: ConnectedAccount[] }> {
    const query = new URLSearchParams();
    query.append('entityId', params.userId);
    // Always use GOOGLESUPER for Google services
    if (params.toolkitSlugs && params.toolkitSlugs.length > 0) {
      // Map any google-related slugs to GOOGLESUPER
      const hasGoogleSlug = params.toolkitSlugs.some(slug =>
        slug.toLowerCase().includes('google') ||
        slug.toLowerCase().includes('gmail') ||
        slug.toLowerCase().includes('calendar')
      );
      if (hasGoogleSlug) {
        query.append('app', 'GOOGLESUPER');
      } else {
        params.toolkitSlugs.forEach((slug) => query.append('app', slug.toUpperCase()));
      }
    }
    if (params.statuses) {
      params.statuses.forEach((status) => query.append('status', status));
    }

    return this.request<{ items: ConnectedAccount[] }>(
      `/connections?${query.toString()}`
    );
  }

  /**
   * Execute a Composio tool/action
   *
   * Uses v2 API for action execution (v3 doesn't support this endpoint)
   *
   * RESILIENCE: Throws ComposioTokenExpiredError on 401 with connection ID
   * so callers can prompt user to reauthorize that specific connection.
   */
  async executeTool<T = any>(params: {
    toolSlug: string; // 'GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_EVENTS_LIST'
    connectedAccountId: string;
    arguments: Record<string, any>;
  }): Promise<ToolExecutionResult<T>> {
    // Use v2 API for action execution
    const url = `${COMPOSIO_API_V2}/actions/${params.toolSlug}/execute`;
    const headers = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          connectedAccountId: params.connectedAccountId,
          input: params.arguments,
        }),
        timeout: COMPOSIO_TIMEOUT,
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Handle 401 - OAuth token expired
        if (response.status === 401) {
          console.error(`[Composio] 401 Unauthorized for ${params.toolSlug} - OAuth token likely expired`);
          throw new ComposioTokenExpiredError(
            `OAuth token expired for connection. User needs to reauthorize.`,
            params.connectedAccountId
          );
        }

        // Handle 429 - Rate limited
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
          console.error(`[Composio] 429 Rate limited for ${params.toolSlug}, retry after ${retryAfter}s`);
          throw new ComposioRateLimitError(
            `Composio rate limited, retry after ${retryAfter} seconds`,
            retryAfter
          );
        }

        throw new Error(`Composio API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error: any) {
      if (error instanceof FetchTimeoutError) {
        console.error(`[Composio] Request to ${params.toolSlug} timed out after ${COMPOSIO_TIMEOUT}ms`);
        throw new Error(`Composio request timed out: ${params.toolSlug}`);
      }
      // Re-throw our custom errors as-is
      if (error instanceof ComposioTokenExpiredError || error instanceof ComposioRateLimitError) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Execute a tool that doesn't require authentication (like Yelp, Weather, etc.)
   * Uses v3 API with entityId instead of connectedAccountId
   */
  async executePublicTool<T = any>(params: {
    toolSlug: string; // 'YELP_SEARCH_BUSINESSES'
    entityId: string; // User ID for scoping
    arguments: Record<string, any>;
  }): Promise<ToolExecutionResult<T>> {
    // Use v3 API for public tools
    const url = `${COMPOSIO_API_BASE}/tools/${params.toolSlug}/execute`;
    const headers = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entityId: params.entityId,
          input: params.arguments,
        }),
        timeout: COMPOSIO_TIMEOUT,
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Handle 429 - Rate limited
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
          console.error(`[Composio] 429 Rate limited for ${params.toolSlug}, retry after ${retryAfter}s`);
          throw new ComposioRateLimitError(
            `Composio rate limited, retry after ${retryAfter} seconds`,
            retryAfter
          );
        }

        throw new Error(`Composio API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error: any) {
      if (error instanceof FetchTimeoutError) {
        console.error(`[Composio] Request to ${params.toolSlug} timed out after ${COMPOSIO_TIMEOUT}ms`);
        throw new Error(`Composio request timed out: ${params.toolSlug}`);
      }
      if (error instanceof ComposioRateLimitError) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Delete connected account (disconnect)
   */
  async deleteConnectedAccount(id: string): Promise<void> {
    await this.request(`/connections/${id}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Trigger Management (Event-driven webhooks)
  // ===========================================================================

  /**
   * Create a trigger for a connected account
   *
   * @param params.triggerName - Trigger type (e.g., GMAIL_NEW_GMAIL_MESSAGE)
   * @param params.connectedAccountId - Connection to watch
   * @param params.config - Trigger-specific configuration
   * @param params.webhookUrl - URL to receive webhook events
   */
  async createTrigger(params: {
    triggerName: string;
    connectedAccountId: string;
    config?: Record<string, any>;
    webhookUrl: string;
  }): Promise<TriggerInstance> {
    return this.request<TriggerInstance>('/triggers', {
      method: 'POST',
      body: JSON.stringify({
        trigger_name: params.triggerName,
        connection_id: params.connectedAccountId,
        trigger_config: params.config || {},
        webhook_url: params.webhookUrl,
      }),
    });
  }

  /**
   * Get trigger by ID
   */
  async getTrigger(triggerId: string): Promise<TriggerInstance> {
    return this.request<TriggerInstance>(`/triggers/${triggerId}`);
  }

  /**
   * List triggers for a connected account
   */
  async listTriggers(params?: {
    connectedAccountId?: string;
    triggerNames?: string[];
    status?: 'active' | 'paused' | 'failed';
  }): Promise<{ items: TriggerInstance[] }> {
    const query = new URLSearchParams();
    if (params?.connectedAccountId) {
      query.append('connectionId', params.connectedAccountId);
    }
    if (params?.triggerNames) {
      params.triggerNames.forEach(name => query.append('triggerName', name));
    }
    if (params?.status) {
      query.append('status', params.status);
    }

    const queryStr = query.toString();
    return this.request<{ items: TriggerInstance[] }>(
      `/triggers${queryStr ? `?${queryStr}` : ''}`
    );
  }

  /**
   * Enable a trigger
   */
  async enableTrigger(triggerId: string): Promise<TriggerInstance> {
    return this.request<TriggerInstance>(`/triggers/${triggerId}/enable`, {
      method: 'POST',
    });
  }

  /**
   * Disable/pause a trigger
   */
  async disableTrigger(triggerId: string): Promise<TriggerInstance> {
    return this.request<TriggerInstance>(`/triggers/${triggerId}/disable`, {
      method: 'POST',
    });
  }

  /**
   * Delete a trigger
   */
  async deleteTrigger(triggerId: string): Promise<void> {
    await this.request(`/triggers/${triggerId}`, {
      method: 'DELETE',
    });
  }
}

/**
 * Gmail-specific actions
 */
export class GmailService {
  constructor(private client: ComposioClient) {}

  async fetchEmails(params: {
    connectedAccountId: string;
    maxResults?: number;
    query?: string; // Gmail search query
    labelIds?: string[];
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_FETCH_EMAILS',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        max_results: params.maxResults || 50,
        query: params.query,
        label_ids: params.labelIds,
      },
    });
  }

  /**
   * Fetch email by ID
   * Retrieves full email content including body
   */
  async fetchEmailById(params: {
    connectedAccountId: string;
    messageId: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_GET_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
      },
    });
  }

  /**
   * Fetch email history (incremental sync)
   * Uses Gmail's history API to get changes since last sync
   * This is crucial for proactive monitoring
   */
  async fetchHistory(params: {
    connectedAccountId: string;
    startHistoryId: string;
    labelIds?: string[];
    maxResults?: number;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_LIST_HISTORY',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        start_history_id: params.startHistoryId,
        label_id: params.labelIds?.[0], // Gmail API takes single labelId for history
        max_results: params.maxResults || 100,
      },
    });
  }

  /**
   * Get Gmail profile including historyId for sync
   */
  async getProfile(connectedAccountId: string) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_GET_PROFILE',
      connectedAccountId,
      arguments: {},
    });
  }

  /**
   * Search contacts via Google People API
   */
  async searchPeople(params: {
    connectedAccountId: string;
    query: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_SEARCH_PEOPLE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        query: params.query,
      },
    });
  }

  /**
   * Send email
   */
  async sendEmail(params: {
    connectedAccountId: string;
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_SEND_EMAIL',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        recipient_email: params.to,
        subject: params.subject,
        body: params.body,
        cc: params.cc,
        bcc: params.bcc,
      },
    });
  }

  /**
   * Create email draft
   */
  async createDraft(params: {
    connectedAccountId: string;
    to: string;
    subject: string;
    body: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_CREATE_DRAFT',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        recipient_email: params.to,
        subject: params.subject,
        body: params.body,
      },
    });
  }

  /**
   * Reply to email thread
   */
  async replyToThread(params: {
    connectedAccountId: string;
    threadId: string;
    body: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_REPLY_TO_THREAD',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        thread_id: params.threadId,
        body: params.body,
      },
    });
  }

  /**
   * Mark email as read
   */
  async markAsRead(params: {
    connectedAccountId: string;
    messageId: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_MODIFY_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
        remove_label_ids: ['UNREAD'],
      },
    });
  }

  /**
   * Archive email (remove from inbox)
   */
  async archiveEmail(params: {
    connectedAccountId: string;
    messageId: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_MODIFY_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
        remove_label_ids: ['INBOX'],
      },
    });
  }

  /**
   * Star/unstar email
   */
  async toggleStar(params: {
    connectedAccountId: string;
    messageId: string;
    starred: boolean;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_MODIFY_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
        add_label_ids: params.starred ? ['STARRED'] : [],
        remove_label_ids: params.starred ? [] : ['STARRED'],
      },
    });
  }

  /**
   * Move email to trash
   */
  async trashEmail(params: {
    connectedAccountId: string;
    messageId: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_TRASH_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
      },
    });
  }

  /**
   * Unsubscribe from a mailing list (if unsubscribe link available)
   */
  async unsubscribe(params: {
    connectedAccountId: string;
    messageId: string;
  }) {
    // First fetch the email to find unsubscribe headers
    const email = await this.client.executeTool({
      toolSlug: 'GMAIL_GET_MESSAGE',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        message_id: params.messageId,
        format: 'metadata',
        metadata_headers: ['List-Unsubscribe'],
      },
    });

    if (!email.successful) {
      return email;
    }

    // For now, just archive emails that user wants to unsubscribe from
    // Full unsubscribe would require following the List-Unsubscribe header link
    return this.archiveEmail({
      connectedAccountId: params.connectedAccountId,
      messageId: params.messageId,
    });
  }
}

/**
 * Google Calendar-specific actions
 */
export class CalendarService {
  constructor(private client: ComposioClient) {}

  async listEvents(params: {
    connectedAccountId: string;
    timeMin?: string; // ISO timestamp
    timeMax?: string;
    maxResults?: number;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_EVENTS_LIST',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        time_min: params.timeMin,
        time_max: params.timeMax,
        max_results: params.maxResults || 100,
      },
    });
  }

  async syncEvents(params: {
    connectedAccountId: string;
    syncToken?: string; // For incremental sync
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_SYNC_EVENTS',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        sync_token: params.syncToken,
      },
    });
  }

  async findEvent(params: {
    connectedAccountId: string;
    query: string;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_FIND_EVENT',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        q: params.query,
      },
    });
  }

  async listEventsDelta(params: {
    connectedAccountId: string;
    syncToken: string;
    maxResults?: number;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_SYNC_EVENTS',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        sync_token: params.syncToken,
        max_results: params.maxResults || 250,
      },
    });
  }

  async createEvent(params: {
    connectedAccountId: string;
    summary: string;
    description?: string;
    start: { dateTime: string } | { date: string };
    end: { dateTime: string } | { date: string };
    location?: string;
    attendees?: Array<{ email: string }>;
    sendNotifications?: boolean;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        summary: params.summary,
        description: params.description || '',
        start: params.start,
        end: params.end,
        location: params.location || '',
        attendees: params.attendees || [],
        sendUpdates: params.sendNotifications ? 'all' : 'none',
      },
    });
  }

  async updateEvent(params: {
    connectedAccountId: string;
    eventId: string;
    summary?: string;
    description?: string;
    start?: { dateTime: string } | { date: string };
    end?: { dateTime: string } | { date: string };
    location?: string;
    attendees?: Array<{ email: string }>;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_UPDATE_EVENT',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        event_id: params.eventId,
        summary: params.summary,
        description: params.description,
        start: params.start,
        end: params.end,
        location: params.location,
        attendees: params.attendees,
      },
    });
  }

  async deleteEvent(params: {
    connectedAccountId: string;
    eventId: string;
    sendNotifications?: boolean;
  }) {
    return this.client.executeTool({
      toolSlug: 'GOOGLECALENDAR_DELETE_EVENT',
      connectedAccountId: params.connectedAccountId,
      arguments: {
        event_id: params.eventId,
        sendUpdates: params.sendNotifications ? 'all' : 'none',
      },
    });
  }
}

/**
 * Yelp-specific actions (no auth required - uses Composio's managed API key)
 */
export class YelpService {
  constructor(private client: ComposioClient) {}

  /**
   * Search for businesses near a location
   */
  async searchBusinesses(params: {
    entityId: string; // User ID for scoping
    term?: string; // Search keyword (e.g., "restaurants", "coffee")
    location?: string; // Address, city, state, or zip
    latitude?: number;
    longitude?: number;
    radius?: number; // Up to 40,000 meters
    categories?: string; // Comma-separated (e.g., "bars,french")
    price?: string; // 1-4 (e.g., "1,2" for $ and $$)
    sortBy?: 'best_match' | 'rating' | 'review_count' | 'distance';
    limit?: number; // Max 50
  }) {
    return this.client.executePublicTool({
      toolSlug: 'YELP_SEARCH_BUSINESSES',
      entityId: params.entityId,
      arguments: {
        term: params.term,
        location: params.location,
        latitude: params.latitude,
        longitude: params.longitude,
        radius: params.radius,
        categories: params.categories,
        price: params.price,
        sort_by: params.sortBy || 'best_match',
        limit: params.limit || 10,
      },
    });
  }

  /**
   * Get business details by ID
   */
  async getBusinessDetails(params: {
    entityId: string;
    businessId: string;
  }) {
    return this.client.executePublicTool({
      toolSlug: 'YELP_GET_BUSINESS_DETAILS',
      entityId: params.entityId,
      arguments: {
        business_id: params.businessId,
      },
    });
  }

  /**
   * Get business reviews
   */
  async getBusinessReviews(params: {
    entityId: string;
    businessId: string;
    sortBy?: 'yelp_sort' | 'newest' | 'oldest';
  }) {
    return this.client.executePublicTool({
      toolSlug: 'YELP_GET_BUSINESS_REVIEWS',
      entityId: params.entityId,
      arguments: {
        business_id: params.businessId,
        sort_by: params.sortBy || 'yelp_sort',
      },
    });
  }

  /**
   * Natural language search (AI-powered)
   */
  async searchAndChat(params: {
    entityId: string;
    query: string; // Natural language question
    chatId?: string; // For conversation continuity
  }) {
    return this.client.executePublicTool({
      toolSlug: 'YELP_SEARCH_AND_CHAT',
      entityId: params.entityId,
      arguments: {
        query: params.query,
        chat_id: params.chatId,
      },
    });
  }
}

/**
 * Factory function to create Composio services
 */
export function createComposioServices(config: ComposioConfig | string) {
  // Support both string (legacy) and full config
  const fullConfig: ComposioConfig = typeof config === 'string'
    ? { apiKey: config }
    : config;

  const client = new ComposioClient(fullConfig);
  return {
    client,
    gmail: new GmailService(client),
    calendar: new CalendarService(client),
    yelp: new YelpService(client),
  };
}

/**
 * Wrapper for Composio operations that need graceful failure handling.
 *
 * Use this when you want to:
 * - Continue execution even if Composio fails
 * - Log token expiration for later handling
 * - Track rate limit hits
 *
 * @example
 * ```ts
 * const result = await executeComposioSafely(
 *   () => gmail.fetchEmails({ connectedAccountId, maxResults: 50 }),
 *   { onTokenExpired: (accountId) => markConnectionExpired(accountId) }
 * );
 * if (result.success) {
 *   // Use result.data
 * } else {
 *   // Handle gracefully - result.error has details
 * }
 * ```
 */
export async function executeComposioSafely<T>(
  fn: () => Promise<T>,
  options?: {
    onTokenExpired?: (connectedAccountId?: string) => void | Promise<void>;
    onRateLimited?: (retryAfter?: number) => void | Promise<void>;
  }
): Promise<{ success: true; data: T } | { success: false; error: Error; errorType: 'token_expired' | 'rate_limited' | 'other' }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error: any) {
    if (error instanceof ComposioTokenExpiredError) {
      console.error(`[Composio] Token expired for account ${error.connectedAccountId}`);
      if (options?.onTokenExpired) {
        await options.onTokenExpired(error.connectedAccountId);
      }
      return { success: false, error, errorType: 'token_expired' };
    }

    if (error instanceof ComposioRateLimitError) {
      console.error(`[Composio] Rate limited, retry after ${error.retryAfter}s`);
      if (options?.onRateLimited) {
        await options.onRateLimited(error.retryAfter);
      }
      return { success: false, error, errorType: 'rate_limited' };
    }

    return { success: false, error, errorType: 'other' };
  }
}
