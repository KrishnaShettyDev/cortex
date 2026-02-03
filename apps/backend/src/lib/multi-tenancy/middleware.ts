/**
 * Multi-Tenancy Middleware
 *
 * Hono middleware for automatic tenant scoping.
 * Extracts and validates container_tag from requests.
 */

import { Context, Next } from 'hono';
import type { Bindings } from '../../types';
import { ensureScope, validateContainerTag } from './scoping';
import { KVRateLimiter } from './isolation';

/**
 * KV-based rate limiter for distributed rate limiting
 * Uses Cloudflare KV for persistence across worker instances
 */
const rateLimiter = new KVRateLimiter({
  maxRequestsPerMinute: 60,
  maxRequestsPerHour: 1000,
});

/**
 * Middleware: Extract and validate tenant scope
 */
export async function tenantScopeMiddleware(
  c: Context<{ Bindings: Bindings }>,
  next: Next
) {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Get container_tag from header or query
  // Note: Don't parse body here as it will consume the request stream
  const containerTag =
    c.req.header('X-Container-Tag') ||
    c.req.query('container_tag') ||
    c.req.query('containerTag') ||
    undefined;

  try {
    // Ensure valid scope (defaults to 'default' if not provided)
    const scope = ensureScope(userId, containerTag);

    // Store scope in context for handlers
    c.set('tenantScope', scope);

    await next();
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
}

/**
 * Middleware: Rate limiting per tenant using KV storage
 */
export async function tenantRateLimitMiddleware(
  c: Context<{ Bindings: Bindings }>,
  next: Next
) {
  const scope = c.get('tenantScope');
  if (!scope) {
    // Scope not set, skip rate limiting
    await next();
    return;
  }

  // Use KV-based rate limiting (requires CACHE KV namespace)
  const kv = c.env.CACHE;
  if (!kv) {
    // No KV configured, skip rate limiting but log warning
    console.warn('[RateLimiter] CACHE KV namespace not configured - rate limiting disabled');
    await next();
    return;
  }

  const check = await rateLimiter.checkLimit(kv, scope);
  if (!check.allowed) {
    // Add rate limit headers
    c.header('X-RateLimit-Remaining-Minute', String(check.remaining?.minute ?? 0));
    c.header('X-RateLimit-Remaining-Hour', String(check.remaining?.hour ?? 0));
    c.header('Retry-After', '60');

    return c.json(
      {
        error: 'Rate limit exceeded',
        reason: check.reason,
        retry_after_seconds: 60,
      },
      429
    );
  }

  // Add rate limit headers for successful requests
  if (check.remaining) {
    c.header('X-RateLimit-Remaining-Minute', String(check.remaining.minute));
    c.header('X-RateLimit-Remaining-Hour', String(check.remaining.hour));
  }

  await next();
}

/**
 * Middleware: Log tenant access for audit trail
 */
export async function tenantAuditMiddleware(
  c: Context<{ Bindings: Bindings }>,
  next: Next
) {
  const scope = c.get('tenantScope');
  const method = c.req.method;
  const path = c.req.path;

  if (scope) {
    console.log(
      `[Audit] ${method} ${path} | User: ${scope.userId} | Container: ${scope.containerTag}`
    );
  }

  await next();
}

/**
 * Helper: Get tenant scope from context
 */
export function getTenantScope(c: Context): {
  userId: string;
  containerTag: string;
} {
  const scope = c.get('tenantScope');
  if (!scope) {
    throw new Error('Tenant scope not set. Use tenantScopeMiddleware first.');
  }
  return scope;
}
