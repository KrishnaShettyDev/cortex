/**
 * Cloudflare KV Caching Layer
 *
 * Implements Supermemory-style caching:
 * - Embedding cache (1 hour TTL)
 * - Profile cache (5 min TTL)
 * - Search results cache (5 min TTL) - IDs only, not full content
 */

// TTL constants (in seconds)
const TTL = {
  EMBEDDING: 60 * 60, // 1 hour
  PROFILE: 60 * 5, // 5 minutes
  SEARCH: 60 * 5, // 5 minutes (reduced from 10 for fresher results)
  ENTITY: 60 * 30, // 30 minutes - entities change less frequently
};

/**
 * Cached search result - IDs and scores only (not full content)
 * This keeps cache size small and under KV limits
 */
export interface CachedSearchResult {
  memoryIds: string[];
  memoryScores: number[];
  chunkIds: string[];
  chunkScores: number[];
  total: number;
  cachedAt: number;
}

/**
 * Hash a string to create a cache key using Web Crypto API (Workers compatible)
 */
async function hashStringAsync(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * Sync hash using simple djb2 algorithm (for non-critical cache keys)
 */
function hashString(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
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
 * Cache search results (IDs + scores only, NOT full content)
 * Max 50 results to stay well under KV size limits
 */
export async function cacheSearchResults(
  kv: KVNamespace,
  userId: string,
  query: string,
  containerTag: string,
  searchMode: string,
  memories: Array<{ id: string; score: number }>,
  chunks: Array<{ id: string; score: number }>
): Promise<void> {
  // Use async SHA-256 hash for cache key
  const queryHash = await hashStringAsync(`${query}:${containerTag}:${searchMode}`);
  const key = `search:${userId}:${queryHash}`;

  // Limit to 50 results max (25 memories + 25 chunks)
  const limitedMemories = memories.slice(0, 25);
  const limitedChunks = chunks.slice(0, 25);

  const cached: CachedSearchResult = {
    memoryIds: limitedMemories.map(m => m.id),
    memoryScores: limitedMemories.map(m => m.score),
    chunkIds: limitedChunks.map(c => c.id),
    chunkScores: limitedChunks.map(c => c.score),
    total: limitedMemories.length + limitedChunks.length,
    cachedAt: Date.now(),
  };

  await kv.put(key, JSON.stringify(cached), {
    expirationTtl: TTL.SEARCH,
  });
}

/**
 * Get cached search results (IDs + scores only)
 */
export async function getCachedSearchResults(
  kv: KVNamespace,
  userId: string,
  query: string,
  containerTag: string,
  searchMode: string
): Promise<CachedSearchResult | null> {
  const queryHash = await hashStringAsync(`${query}:${containerTag}:${searchMode}`);
  const key = `search:${userId}:${queryHash}`;
  const cached = await kv.get(key, 'text');

  if (!cached) {
    return null;
  }

  try {
    return JSON.parse(cached) as CachedSearchResult;
  } catch {
    return null;
  }
}

/**
 * Invalidate search cache for a user when new memory is added
 * Uses a generation counter approach since KV doesn't support prefix deletion
 */
export async function invalidateSearchCache(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  // Increment user's cache generation to invalidate all existing search caches
  const genKey = `search_gen:${userId}`;
  const currentGen = await kv.get(genKey, 'text');
  const newGen = currentGen ? parseInt(currentGen) + 1 : 1;
  await kv.put(genKey, String(newGen), { expirationTtl: 86400 }); // 24h expiry
  console.log(`[Cache] Search cache invalidated for user ${userId} (gen ${newGen})`);
}

/**
 * Get current search cache generation for a user
 */
export async function getSearchCacheGeneration(
  kv: KVNamespace,
  userId: string
): Promise<number> {
  const genKey = `search_gen:${userId}`;
  const gen = await kv.get(genKey, 'text');
  return gen ? parseInt(gen) : 0;
}

/**
 * Invalidate all search caches for a user (when profile changes significantly)
 * @deprecated Use invalidateSearchCache instead
 */
export async function invalidateUserSearchCache(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  await invalidateSearchCache(kv, userId);
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
