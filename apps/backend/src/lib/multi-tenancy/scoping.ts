/**
 * Multi-Tenancy Scoping
 *
 * Ensures all queries are scoped by container_tag for project isolation.
 * Prevents data leakage across projects/organizations.
 */

export interface TenantScope {
  userId: string;
  containerTag: string;
}

export interface QueryOptions {
  includeDeleted?: boolean;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

/**
 * Build scoped WHERE clause for queries
 */
export function buildScopeClause(
  scope: TenantScope,
  options?: QueryOptions
): { clause: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  // Always scope by user_id
  conditions.push('user_id = ?');
  params.push(scope.userId);

  // Always scope by container_tag (project isolation)
  conditions.push('container_tag = ?');
  params.push(scope.containerTag);

  // Exclude soft-deleted unless explicitly requested
  if (!options?.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  const clause = conditions.join(' AND ');
  return { clause, params };
}

/**
 * Build complete scoped query with ordering and pagination
 */
export function buildScopedQuery(
  baseQuery: string,
  scope: TenantScope,
  options?: QueryOptions
): { query: string; params: any[] } {
  const { clause, params } = buildScopeClause(scope, options);

  let query = `${baseQuery} WHERE ${clause}`;

  // Add ordering
  if (options?.orderBy) {
    const order = options.order || 'DESC';
    query += ` ORDER BY ${options.orderBy} ${order}`;
  }

  // Add pagination
  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);

    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  return { query, params };
}

/**
 * Validate container_tag format
 */
export function validateContainerTag(tag: string): boolean {
  // Must be lowercase alphanumeric with hyphens/underscores
  // Between 3-64 characters
  const pattern = /^[a-z0-9_-]{3,64}$/;
  return pattern.test(tag);
}

/**
 * Get default container tag for user
 */
export function getDefaultContainerTag(userId: string): string {
  return `default`;
}

/**
 * Build project namespace (for org-level isolation)
 */
export function buildProjectNamespace(
  orgId: string,
  projectId: string
): string {
  return `org_${orgId}:proj_${projectId}`;
}

/**
 * Parse project namespace
 */
export function parseProjectNamespace(namespace: string): {
  orgId: string;
  projectId: string;
} | null {
  const match = namespace.match(/^org_([^:]+):proj_(.+)$/);
  if (!match) return null;

  return {
    orgId: match[1],
    projectId: match[2],
  };
}

/**
 * Scope middleware for Hono routes
 */
export function ensureScope(userId: string, containerTag?: string): TenantScope {
  const tag = containerTag || getDefaultContainerTag(userId);

  if (!validateContainerTag(tag)) {
    throw new Error(`Invalid container_tag: ${tag}`);
  }

  return {
    userId,
    containerTag: tag,
  };
}
