/**
 * Multi-Tenancy Middleware
 *
 * Hono middleware for automatic tenant scoping.
 * Extracts and validates container_tag from requests.
 */

import { Context, Next } from 'hono';
import type { Bindings } from '../../types';
import { ensureScope, validateContainerTag } from './scoping';
import { TenantRateLimiter } from './isolation';

/**
 * Rate limiter instance (shared across requests)
 */
const rateLimiter = new TenantRateLimiter({
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
 * Middleware: Rate limiting per tenant
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

  const check = rateLimiter.checkLimit(scope);
  if (!check.allowed) {
    return c.json(
      {
        error: 'Rate limit exceeded',
        reason: check.reason,
      },
      429
    );
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
