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
