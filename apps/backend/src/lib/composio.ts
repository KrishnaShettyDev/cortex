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
  /** Auth config ID for Gmail integration (from Composio dashboard) */
  gmailAuthConfigId?: string;
  /** Auth config ID for Google Calendar integration (from Composio dashboard) */
  calendarAuthConfigId?: string;
}

// Default auth config IDs (fallback only - should be set via env vars)
const DEFAULT_GMAIL_AUTH_CONFIG_ID = 'ac_dIm9DAf4ud0E';
const DEFAULT_CALENDAR_AUTH_CONFIG_ID = 'ac_lYQshFAwUNtb';

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
  connectedAccountId?: string;
}

export interface ToolExecutionResult {
  data: any;
  error: string | null;
  logId: string;
  successful: boolean;
}

export class ComposioClient {
  private apiKey: string;
  private gmailAuthConfigId: string;
  private calendarAuthConfigId: string;

  constructor(config: ComposioConfig) {
    this.apiKey = config.apiKey;
    this.gmailAuthConfigId = config.gmailAuthConfigId || DEFAULT_GMAIL_AUTH_CONFIG_ID;
    this.calendarAuthConfigId = config.calendarAuthConfigId || DEFAULT_CALENDAR_AUTH_CONFIG_ID;
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
   */
  async createAuthLink(params: {
    toolkitSlug: string; // 'gmail', 'googlecalendar'
    userId: string; // Our internal user ID
    callbackUrl: string; // Ignored - redirect URL is set in auth_config
  }): Promise<AuthLinkResponse> {
    // v3 API: Create connected account with auth_config_id
    // Redirect URL must be configured in the auth_config in Composio dashboard
    // Auth config IDs should be set via environment variables
    const authConfigId = params.toolkitSlug.toLowerCase().includes('calendar')
      ? this.calendarAuthConfigId
      : this.gmailAuthConfigId;

    const response = await this.request<any>('/connected_accounts', {
      method: 'POST',
      body: JSON.stringify({
        auth_config: {
          id: authConfigId,
        },
        user_id: params.userId,
        connection: {
          state: {
            authScheme: 'OAUTH2',
            val: {
              status: 'INITIALIZING',
            },
          },
        },
      }),
    });

    console.log('[Composio] createAuthLink response:', JSON.stringify(response));

    // v3 API returns redirectUrl in the response
    const redirectUrl = response.redirectUrl || response.redirect_url || response.authUrl || '';

    if (!redirectUrl) {
      throw new Error(`No redirectUrl in Composio response: ${JSON.stringify(response)}`);
    }

    return {
      linkToken: response.id || response.connectionId || '',
      redirectUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
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
    if (params.toolkitSlugs) {
      params.toolkitSlugs.forEach((slug) => query.append('app', slug.toUpperCase()));
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
   * RESILIENCE: Throws ComposioTokenExpiredError on 401 with connection ID
   * so callers can prompt user to reauthorize that specific connection.
   */
  async executeTool<T = any>(params: {
    toolSlug: string; // 'GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_LIST_EVENTS'
    connectedAccountId: string;
    arguments: Record<string, any>;
  }): Promise<ToolExecutionResult<T>> {
    return this.request<ToolExecutionResult<T>>(
      `/actions/${params.toolSlug}/execute`,
      {
        method: 'POST',
        body: JSON.stringify({
          connectionId: params.connectedAccountId,
          input: params.arguments,
        }),
      },
      { connectedAccountId: params.connectedAccountId }
    );
  }

  /**
   * Delete connected account (disconnect)
   */
  async deleteConnectedAccount(id: string): Promise<void> {
    await this.request(`/connections/${id}`, {
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

  async getProfile(connectedAccountId: string) {
    return this.client.executeTool({
      toolSlug: 'GMAIL_GET_PROFILE',
      connectedAccountId,
      arguments: {},
    });
  }

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
      toolSlug: 'GOOGLECALENDAR_LIST_EVENTS',
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
