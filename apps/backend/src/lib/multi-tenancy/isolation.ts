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
 * Rate limit per tenant
 */
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

export class TenantRateLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(private config: RateLimitConfig) {}

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
