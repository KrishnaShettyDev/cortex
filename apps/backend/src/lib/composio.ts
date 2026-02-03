/**
 * Composio REST API Client
 *
 * Handles OAuth flows, connected accounts, and tool execution for Gmail, Calendar, etc.
 * Base URL: https://backend.composio.dev/api/v3
 *
 * RESILIENCE: All requests have timeouts to prevent hanging
 */

import { fetchWithTimeout, DEFAULT_TIMEOUTS, FetchTimeoutError } from './fetch-with-timeout';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';

/** Timeout for Composio API calls (30s - they can be slow) */
const COMPOSIO_TIMEOUT = DEFAULT_TIMEOUTS.SLOW;

export interface ComposioConfig {
  apiKey: string;
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

  constructor(config: ComposioConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
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
        const error = await response.text();
        throw new Error(`Composio API error: ${response.status} - ${error}`);
      }

      return response.json();
    } catch (error: any) {
      if (error instanceof FetchTimeoutError) {
        console.error(`[Composio] Request to ${endpoint} timed out after ${COMPOSIO_TIMEOUT}ms`);
        throw new Error(`Composio request timed out: ${endpoint}`);
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
    const authConfigId = params.toolkitSlug.toLowerCase().includes('calendar')
      ? 'ac_lYQshFAwUNtb'  // Google Calendar
      : 'ac_dIm9DAf4ud0E';  // Google Super (Gmail)

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
      }
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
export function createComposioServices(apiKey: string) {
  const client = new ComposioClient({ apiKey });
  return {
    client,
    gmail: new GmailService(client),
    calendar: new CalendarService(client),
  };
}
