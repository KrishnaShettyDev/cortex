/**
 * Cortex Memory SDK - API Client
 * Type-safe HTTP client for the Cortex API
 */

import type {
  CortexConfig,
  Memory,
  CreateMemoryParams,
  UpdateMemoryParams,
  SearchParams,
  RecallParams,
  SearchResult,
  RecallResult,
  Entity,
  EntityRelationship,
  EntityListParams,
  MemoryListParams,
  GraphStats,
  RelationshipHealth,
  Nudge,
  Learning,
  Belief,
  Commitment,
  ProfileData,
  DailyBriefing,
  SyncConnection,
  SyncStatus,
  TimelineEvent,
  MemoryHistory,
  APIError,
} from './types';

const DEFAULT_BASE_URL = 'https://askcortex.plutas.in';
const DEFAULT_TIMEOUT = 30000;

/**
 * CortexError - Custom error class for API errors
 */
export class CortexError extends Error {
  public readonly code?: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'CortexError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * CortexClient - Main SDK client
 *
 * @example
 * ```typescript
 * const cortex = new CortexClient({ apiKey: 'ctx_...' });
 *
 * // Add a memory
 * const memory = await cortex.memories.create({
 *   content: 'Meeting with John about Q1 goals',
 *   source: 'manual',
 * });
 *
 * // Search memories
 * const results = await cortex.memories.search({ query: 'Q1 goals' });
 *
 * // Recall with context
 * const context = await cortex.recall({
 *   query: 'What are my goals?',
 *   include_profile: true,
 * });
 * ```
 */
export class CortexClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly token?: string;
  private readonly containerTag: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  // Sub-clients for namespaced operations
  public readonly memories: MemoriesClient;
  public readonly entities: EntitiesClient;
  public readonly relationships: RelationshipsClient;
  public readonly learnings: LearningsClient;
  public readonly beliefs: BeliefsClient;
  public readonly commitments: CommitmentsClient;
  public readonly sync: SyncClient;
  public readonly temporal: TemporalClient;

  constructor(config: CortexConfig = {}) {
    if (!config.apiKey && !config.token) {
      throw new Error('CortexClient requires either apiKey or token for authentication');
    }

    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = config.apiKey;
    this.token = config.token;
    this.containerTag = config.containerTag || 'default';
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.fetchFn = config.fetch || fetch;

    // Initialize sub-clients
    this.memories = new MemoriesClient(this);
    this.entities = new EntitiesClient(this);
    this.relationships = new RelationshipsClient(this);
    this.learnings = new LearningsClient(this);
    this.beliefs = new BeliefsClient(this);
    this.commitments = new CommitmentsClient(this);
    this.sync = new SyncClient(this);
    this.temporal = new TemporalClient(this);
  }

  /**
   * Make an authenticated API request
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      params?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Add query parameters
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // Add container tag
    if (!url.searchParams.has('container_tag')) {
      url.searchParams.set('container_tag', this.containerTag);
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle errors
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'Unknown error',
          message: response.statusText,
        })) as APIError;

        throw new CortexError(
          error.message || error.error,
          response.status,
          error.code,
          error.details
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CortexError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new CortexError('Request timeout', 408, 'TIMEOUT');
      }

      throw new CortexError(
        error instanceof Error ? error.message : 'Network error',
        0,
        'NETWORK_ERROR'
      );
    }
  }

  // ============================================================================
  // Top-level convenience methods
  // ============================================================================

  /**
   * Recall memories with context building
   */
  async recall(params: RecallParams): Promise<RecallResult> {
    return this.request('POST', '/v3/recall', { body: params });
  }

  /**
   * Get user profile
   */
  async getProfile(): Promise<ProfileData> {
    return this.request('GET', '/v3/profile');
  }

  /**
   * Get daily briefing
   */
  async getBriefing(options?: {
    location?: { lat: number; lon: number };
    timezone?: string;
  }): Promise<DailyBriefing> {
    return this.request('POST', '/v3/briefing/generate', { body: options || {} });
  }

  /**
   * Get proactive nudges
   */
  async getNudges(limit?: number): Promise<Nudge[]> {
    const result = await this.request<{ nudges: Nudge[] }>('GET', '/v3/nudges', {
      params: { limit },
    });
    return result.nudges;
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/health');
  }
}

// ============================================================================
// Sub-clients for namespaced operations
// ============================================================================

class MemoriesClient {
  constructor(private client: CortexClient) {}

  async create(params: CreateMemoryParams): Promise<Memory> {
    const result = await this.client.request<{ memory: Memory }>('POST', '/v3/memories', {
      body: params,
    });
    return result.memory;
  }

  async get(id: string): Promise<Memory> {
    return this.client.request('GET', `/v3/memories/${id}`);
  }

  async list(params?: MemoryListParams): Promise<{ memories: Memory[]; total: number }> {
    return this.client.request('GET', '/v3/memories', { params: params as any });
  }

  async update(id: string, params: UpdateMemoryParams): Promise<Memory> {
    return this.client.request('PUT', `/v3/memories/${id}`, { body: params });
  }

  async delete(id: string): Promise<void> {
    await this.client.request('DELETE', `/v3/memories/${id}`);
  }

  async search(params: SearchParams): Promise<SearchResult> {
    return this.client.request('POST', '/v3/search', { body: params });
  }
}

class EntitiesClient {
  constructor(private client: CortexClient) {}

  async list(params?: EntityListParams): Promise<{ entities: Entity[]; total: number }> {
    return this.client.request('GET', '/v3/entities', { params: params as any });
  }

  async get(id: string): Promise<Entity> {
    return this.client.request('GET', `/v3/entities/${id}`);
  }

  async getRelationships(id: string): Promise<EntityRelationship[]> {
    const result = await this.client.request<{ relationships: EntityRelationship[] }>(
      'GET',
      `/v3/entities/${id}/relationships`
    );
    return result.relationships;
  }

  async getMemories(id: string, limit?: number): Promise<Memory[]> {
    const result = await this.client.request<{ memories: Memory[] }>(
      'GET',
      `/v3/entities/${id}/memories`,
      { params: { limit } }
    );
    return result.memories;
  }

  async search(query: string, limit?: number): Promise<Entity[]> {
    const result = await this.client.request<{ entities: Entity[] }>(
      'GET',
      '/v3/graph/search',
      { params: { q: query, limit } }
    );
    return result.entities;
  }

  async getStats(): Promise<GraphStats> {
    return this.client.request('GET', '/v3/graph/stats');
  }
}

class RelationshipsClient {
  constructor(private client: CortexClient) {}

  async getHealth(entityId?: string): Promise<RelationshipHealth[]> {
    const result = await this.client.request<{ health_scores: RelationshipHealth[] }>(
      'GET',
      entityId ? `/v3/relationships/health/${entityId}` : '/v3/relationships/health'
    );
    return result.health_scores;
  }

  async getNudges(params?: { priority?: string; limit?: number }): Promise<Nudge[]> {
    const result = await this.client.request<{ nudges: Nudge[] }>(
      'GET',
      '/v3/relationships/nudges',
      { params: params as any }
    );
    return result.nudges;
  }

  async dismissNudge(nudgeId: string): Promise<void> {
    await this.client.request('POST', `/v3/relationships/nudges/${nudgeId}/dismiss`);
  }
}

class LearningsClient {
  constructor(private client: CortexClient) {}

  async list(params?: {
    category?: string;
    status?: string;
    limit?: number;
  }): Promise<{ learnings: Learning[]; total: number }> {
    return this.client.request('GET', '/v3/learnings', { params: params as any });
  }

  async get(id: string): Promise<Learning> {
    return this.client.request('GET', `/v3/learnings/${id}`);
  }

  async getByCategory(): Promise<Record<string, Learning[]>> {
    const result = await this.client.request<{ categories: Record<string, Learning[]> }>(
      'GET',
      '/v3/learnings/by-category'
    );
    return result.categories;
  }
}

class BeliefsClient {
  constructor(private client: CortexClient) {}

  async list(params?: {
    domain?: string;
    type?: string;
    status?: string;
    limit?: number;
  }): Promise<{ beliefs: Belief[]; total: number }> {
    return this.client.request('GET', '/v3/beliefs', { params: params as any });
  }

  async get(id: string): Promise<Belief> {
    return this.client.request('GET', `/v3/beliefs/${id}`);
  }

  async getByDomain(): Promise<Record<string, Belief[]>> {
    const result = await this.client.request<{ domains: Record<string, Belief[]> }>(
      'GET',
      '/v3/beliefs/by-domain'
    );
    return result.domains;
  }

  async getConflicts(): Promise<Array<{ belief_a: Belief; belief_b: Belief; conflict_type: string }>> {
    const result = await this.client.request<{
      conflicts: Array<{ belief_a: Belief; belief_b: Belief; conflict_type: string }>;
    }>('GET', '/v3/beliefs/conflicts');
    return result.conflicts;
  }
}

class CommitmentsClient {
  constructor(private client: CortexClient) {}

  async list(params?: {
    status?: string;
    type?: string;
    limit?: number;
  }): Promise<{ commitments: Commitment[]; total: number }> {
    return this.client.request('GET', '/v3/commitments', { params: params as any });
  }

  async get(id: string): Promise<Commitment> {
    return this.client.request('GET', `/v3/commitments/${id}`);
  }

  async getOverdue(): Promise<Commitment[]> {
    const result = await this.client.request<{ commitments: Commitment[] }>(
      'GET',
      '/v3/commitments/overdue'
    );
    return result.commitments;
  }

  async markComplete(id: string): Promise<Commitment> {
    return this.client.request('POST', `/v3/commitments/${id}/complete`);
  }

  async markCancelled(id: string, reason?: string): Promise<Commitment> {
    return this.client.request('POST', `/v3/commitments/${id}/cancel`, {
      body: { reason },
    });
  }
}

class SyncClient {
  constructor(private client: CortexClient) {}

  async listConnections(): Promise<SyncConnection[]> {
    const result = await this.client.request<{ connections: SyncConnection[] }>(
      'GET',
      '/v3/sync/connections'
    );
    return result.connections;
  }

  async getStatus(): Promise<SyncStatus> {
    return this.client.request('GET', '/v3/sync/status');
  }

  async triggerSync(connectionId: string): Promise<{ job_id: string }> {
    return this.client.request('POST', `/v3/sync/connections/${connectionId}/sync`);
  }
}

class TemporalClient {
  constructor(private client: CortexClient) {}

  async timeTravel(asOfDate: string, query?: string): Promise<Memory[]> {
    const result = await this.client.request<{ memories: Memory[] }>('POST', '/v3/time-travel', {
      body: { as_of_date: asOfDate, query },
    });
    return result.memories;
  }

  async getMemoryHistory(memoryId: string): Promise<MemoryHistory> {
    return this.client.request('GET', `/v3/memories/${memoryId}/history`);
  }

  async getTimeline(params?: {
    start_date?: string;
    end_date?: string;
    entity_id?: string;
  }): Promise<TimelineEvent[]> {
    const result = await this.client.request<{ events: TimelineEvent[] }>(
      'GET',
      '/v3/temporal/timeline',
      { params: params as any }
    );
    return result.events;
  }

  async getEntityTimeline(entityId: string): Promise<TimelineEvent[]> {
    const result = await this.client.request<{ events: TimelineEvent[] }>(
      'GET',
      `/v3/temporal/entity/${entityId}/timeline`
    );
    return result.events;
  }

  async getCurrentMemories(params?: { type?: string; min_importance?: number }): Promise<Memory[]> {
    const result = await this.client.request<{ memories: Memory[] }>(
      'GET',
      '/v3/memories/current',
      { params: params as any }
    );
    return result.memories;
  }

  async getSupersededMemories(params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<Memory[]> {
    const result = await this.client.request<{ memories: Memory[] }>(
      'GET',
      '/v3/memories/superseded',
      { params: params as any }
    );
    return result.memories;
  }
}
