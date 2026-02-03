/**
 * Cloudflare KV Caching Layer
 *
 * Implements Supermemory-style caching:
 * - Embedding cache (1 hour TTL)
 * - Profile cache (5 min TTL)
 * - Search results cache (10 min TTL)
 */

import { createHash } from 'crypto';

// TTL constants (in seconds)
const TTL = {
  EMBEDDING: 60 * 60, // 1 hour
  PROFILE: 60 * 5, // 5 minutes
  SEARCH: 60 * 10, // 10 minutes
  ENTITY: 60 * 30, // 30 minutes - entities change less frequently
};

/**
 * Hash a string to create a cache key
 */
function hashString(text: string): string {
  return createHash('sha256').update(text).digest('hex').substring(0, 16);
}

/**
 * Cache embedding vector
 */
export async function cacheEmbedding(
  kv: KVNamespace,
  text: string,
  embedding: number[]
): Promise<void> {
  const key = `emb:${hashString(text)}`;
  await kv.put(key, JSON.stringify(embedding), {
    expirationTtl: TTL.EMBEDDING,
  });
}

/**
 * Get cached embedding
 */
export async function getCachedEmbedding(
  kv: KVNamespace,
  text: string
): Promise<number[] | null> {
  const key = `emb:${hashString(text)}`;
  const cached = await kv.get(key, 'text');

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached) as number[];
  } catch {
    return null;
  }
}

/**
 * Cache user profile
 */
export async function cacheProfile(
  kv: KVNamespace,
  userId: string,
  containerTag: string,
  profile: { static: string[]; dynamic: string[] }
): Promise<void> {
  const key = `prof:${userId}:${containerTag}`;
  await kv.put(key, JSON.stringify(profile), {
    expirationTtl: TTL.PROFILE,
  });
}

/**
 * Get cached profile
 */
export async function getCachedProfile(
  kv: KVNamespace,
  userId: string,
  containerTag: string
): Promise<{ static: string[]; dynamic: string[] } | null> {
  const key = `prof:${userId}:${containerTag}`;
  const cached = await kv.get(key, 'text');

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

/**
 * Invalidate profile cache (when new memory added)
 */
export async function invalidateProfileCache(
  kv: KVNamespace,
  userId: string,
  containerTag: string
): Promise<void> {
  const key = `prof:${userId}:${containerTag}`;
  await kv.delete(key);
}

/**
 * Cache search results
 */
export async function cacheSearchResults(
  kv: KVNamespace,
  userId: string,
  query: string,
  containerTag: string,
  results: any
): Promise<void> {
  const queryHash = hashString(`${query}:${containerTag}`);
  const key = `search:${userId}:${queryHash}`;

  await kv.put(key, JSON.stringify(results), {
    expirationTtl: TTL.SEARCH,
  });
}

/**
 * Get cached search results
 */
export async function getCachedSearchResults(
  kv: KVNamespace,
  userId: string,
  query: string,
  containerTag: string
): Promise<any | null> {
  const queryHash = hashString(`${query}:${containerTag}`);
  const key = `search:${userId}:${queryHash}`;
  const cached = await kv.get(key, 'text');

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

/**
 * Invalidate all search caches for a user (when profile changes significantly)
 */
export async function invalidateUserSearchCache(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  // Note: KV doesn't support prefix deletion, so we'd need to track keys separately
  // For now, we rely on TTL expiration
  // In production, could maintain a list of active search keys per user
  console.log(`Search cache invalidation requested for user ${userId} (TTL-based)`);
}

// ============================================
// ENTITY CACHE
// ============================================

/**
 * Simplified entity for caching (just what we need for matching)
 */
export interface CachedEntity {
  id: string;
  name: string;
  canonical_name: string;
  entity_type: string;
  attributes: Record<string, any>;
  importance_score: number;
}

/**
 * Get cached entities for a user
 * Returns top entities for quick matching during extraction
 */
export async function getCachedEntities(
  kv: KVNamespace,
  userId: string,
  containerTag: string
): Promise<CachedEntity[] | null> {
  const key = `entities:${userId}:${containerTag}`;
  const cached = await kv.get(key, 'text');

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached) as CachedEntity[];
  } catch {
    return null;
  }
}

/**
 * Cache entities for a user
 * Stores top 100 entities by importance for quick matching
 */
export async function cacheEntities(
  kv: KVNamespace,
  userId: string,
  containerTag: string,
  entities: CachedEntity[]
): Promise<void> {
  const key = `entities:${userId}:${containerTag}`;

  // Sort by importance and take top 100
  const sorted = [...entities]
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 100);

  await kv.put(key, JSON.stringify(sorted), {
    expirationTtl: TTL.ENTITY,
  });
}

/**
 * Update entity cache with new entities
 * Merges new entities into existing cache
 */
export async function updateEntityCache(
  kv: KVNamespace,
  userId: string,
  containerTag: string,
  newEntities: CachedEntity[]
): Promise<void> {
  const existing = await getCachedEntities(kv, userId, containerTag) || [];

  // Build map for deduplication (by canonical_name)
  const entityMap = new Map<string, CachedEntity>();

  // Add existing entities
  for (const e of existing) {
    entityMap.set(e.canonical_name?.toLowerCase() || e.name.toLowerCase(), e);
  }

  // Add/update with new entities
  for (const e of newEntities) {
    const key = e.canonical_name?.toLowerCase() || e.name.toLowerCase();
    const existingEntity = entityMap.get(key);

    if (existingEntity) {
      // Merge: keep higher importance, merge attributes
      entityMap.set(key, {
        ...existingEntity,
        attributes: { ...existingEntity.attributes, ...e.attributes },
        importance_score: Math.max(
          existingEntity.importance_score || 0,
          e.importance_score || 0
        ),
      });
    } else {
      entityMap.set(key, e);
    }
  }

  // Save back to cache
  await cacheEntities(kv, userId, containerTag, Array.from(entityMap.values()));
}

/**
 * Invalidate entity cache (e.g., when entity is deleted or significantly changed)
 */
export async function invalidateEntityCache(
  kv: KVNamespace,
  userId: string,
  containerTag: string
): Promise<void> {
  const key = `entities:${userId}:${containerTag}`;
  await kv.delete(key);
}
