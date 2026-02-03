/**
 * Data Isolation Layer
 *
 * Enforces strict data isolation across projects and organizations.
 * Prevents cross-tenant data leakage.
 */

import type { TenantScope } from './scoping';

export interface IsolationCheck {
  passed: boolean;
  reason?: string;
}

/**
 * Verify resource belongs to tenant
 */
export async function verifyResourceOwnership(
  db: D1Database,
  resourceType: 'memory' | 'processing_job' | 'chunk',
  resourceId: string,
  scope: TenantScope
): Promise<IsolationCheck> {
  let query: string;
  let table: string;

  switch (resourceType) {
    case 'memory':
      table = 'memories';
      query = 'SELECT user_id, container_tag FROM memories WHERE id = ?';
      break;
    case 'processing_job':
      table = 'processing_jobs';
      query = 'SELECT user_id, container_tag FROM processing_jobs WHERE id = ?';
      break;
    case 'chunk':
      table = 'memory_chunks';
      query = `
        SELECT m.user_id, m.container_tag
        FROM memory_chunks c
        JOIN memories m ON c.memory_id = m.id
        WHERE c.id = ?
      `;
      break;
    default:
      return { passed: false, reason: 'Unknown resource type' };
  }

  try {
    const result = await db.prepare(query).bind(resourceId).first<{
      user_id: string;
      container_tag: string;
    }>();

    if (!result) {
      return { passed: false, reason: 'Resource not found' };
    }

    // Check user_id matches
    if (result.user_id !== scope.userId) {
      return { passed: false, reason: 'User mismatch' };
    }

    // Check container_tag matches
    if (result.container_tag !== scope.containerTag) {
      return { passed: false, reason: 'Container mismatch' };
    }

    return { passed: true };
  } catch (error: any) {
    return { passed: false, reason: `Verification failed: ${error.message}` };
  }
}

/**
 * Verify vector search results belong to tenant
 */
export function filterVectorResults(
  results: Array<{ metadata: any }>,
  scope: TenantScope
): Array<{ metadata: any }> {
  return results.filter((result) => {
    const metadata = result.metadata;
    return (
      metadata.user_id === scope.userId &&
      metadata.container_tag === scope.containerTag
    );
  });
}

/**
 * Build isolation metadata for vector storage
 */
export function buildIsolationMetadata(scope: TenantScope): {
  user_id: string;
  container_tag: string;
} {
  return {
    user_id: scope.userId,
    container_tag: scope.containerTag,
  };
}

/**
 * Verify batch operations are within same tenant
 */
export function verifyBatchScope(
  items: Array<{ userId: string; containerTag: string }>,
  scope: TenantScope
): IsolationCheck {
  for (const item of items) {
    if (item.userId !== scope.userId) {
      return { passed: false, reason: 'User mismatch in batch' };
    }
    if (item.containerTag !== scope.containerTag) {
      return { passed: false, reason: 'Container mismatch in batch' };
    }
  }

  return { passed: true };
}

/**
 * Sanitize user input to prevent injection
 */
export function sanitizeUserInput(input: string): string {
  // Remove any SQL injection attempts
  return input
    .replace(/[;'"\\]/g, '') // Remove SQL special chars
    .replace(/--/g, '') // Remove SQL comments
    .trim();
}

/**
 * Rate limit per tenant using KV storage
 *
 * IMPORTANT: Uses Cloudflare KV for distributed rate limiting.
 * This works correctly across multiple worker instances.
 */
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

interface RateLimitState {
  minuteCount: number;
  minuteWindowStart: number;
  hourCount: number;
  hourWindowStart: number;
}

/**
 * KV-based rate limiter that works across distributed workers
 */
export class KVRateLimiter {
  constructor(private config: RateLimitConfig) {}

  /**
   * Check if tenant is within rate limits
   * Uses sliding window algorithm with KV storage
   */
  async checkLimit(
    kv: KVNamespace,
    scope: TenantScope
  ): Promise<{ allowed: boolean; reason?: string; remaining?: { minute: number; hour: number } }> {
    const key = `ratelimit:${scope.userId}:${scope.containerTag}`;
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60000); // Current minute
    const hourWindow = Math.floor(now / 3600000); // Current hour

    try {
      // Get current state from KV
      const stateJson = await kv.get(key);
      let state: RateLimitState = stateJson
        ? JSON.parse(stateJson)
        : { minuteCount: 0, minuteWindowStart: minuteWindow, hourCount: 0, hourWindowStart: hourWindow };

      // Reset counters if window has changed
      if (state.minuteWindowStart !== minuteWindow) {
        state.minuteCount = 0;
        state.minuteWindowStart = minuteWindow;
      }

      if (state.hourWindowStart !== hourWindow) {
        state.hourCount = 0;
        state.hourWindowStart = hourWindow;
      }

      // Check limits
      if (state.minuteCount >= this.config.maxRequestsPerMinute) {
        return {
          allowed: false,
          reason: 'Rate limit exceeded (per minute)',
          remaining: { minute: 0, hour: Math.max(0, this.config.maxRequestsPerHour - state.hourCount) },
        };
      }

      if (state.hourCount >= this.config.maxRequestsPerHour) {
        return {
          allowed: false,
          reason: 'Rate limit exceeded (per hour)',
          remaining: { minute: Math.max(0, this.config.maxRequestsPerMinute - state.minuteCount), hour: 0 },
        };
      }

      // Increment counters
      state.minuteCount++;
      state.hourCount++;

      // Store updated state with TTL of 1 hour (the maximum window we track)
      await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });

      return {
        allowed: true,
        remaining: {
          minute: this.config.maxRequestsPerMinute - state.minuteCount,
          hour: this.config.maxRequestsPerHour - state.hourCount,
        },
      };
    } catch (error) {
      // On KV error, allow the request but log it
      console.error('[RateLimiter] KV error:', error);
      return { allowed: true };
    }
  }

  /**
   * Clear rate limit for tenant (for testing)
   */
  async clearLimit(kv: KVNamespace, scope: TenantScope): Promise<void> {
    const key = `ratelimit:${scope.userId}:${scope.containerTag}`;
    await kv.delete(key);
  }
}

/**
 * Legacy in-memory rate limiter
 * @deprecated Use KVRateLimiter for production
 *
 * WARNING: This does NOT work correctly in distributed Cloudflare Workers
 * because each isolate has its own memory. Only use for local development.
 */
export class TenantRateLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(private config: RateLimitConfig) {
    console.warn('[RateLimiter] Using in-memory rate limiter. This is NOT suitable for production!');
  }

  /**
   * Check if tenant is within rate limits
   */
  checkLimit(scope: TenantScope): { allowed: boolean; reason?: string } {
    const key = `${scope.userId}:${scope.containerTag}`;
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // Get request timestamps
    const timestamps = this.requests.get(key) || [];

    // Filter to recent requests
    const recentMinute = timestamps.filter((ts) => ts > oneMinuteAgo);
    const recentHour = timestamps.filter((ts) => ts > oneHourAgo);

    // Check limits
    if (recentMinute.length >= this.config.maxRequestsPerMinute) {
      return { allowed: false, reason: 'Rate limit exceeded (per minute)' };
    }

    if (recentHour.length >= this.config.maxRequestsPerHour) {
      return { allowed: false, reason: 'Rate limit exceeded (per hour)' };
    }

    // Add current request
    timestamps.push(now);
    this.requests.set(key, timestamps.filter((ts) => ts > oneHourAgo)); // Keep only last hour

    return { allowed: true };
  }

  /**
   * Clear rate limit for tenant (for testing)
   */
  clearLimit(scope: TenantScope): void {
    const key = `${scope.userId}:${scope.containerTag}`;
    this.requests.delete(key);
  }
}
