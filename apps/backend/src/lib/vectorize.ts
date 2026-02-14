/**
 * Vectorize Service
 *
 * Handles vector embeddings and similarity search using Cloudflare Vectorize
 */

export interface VectorMetadata {
  id: string;
  user_id: string;
  type: 'memory' | 'chunk'; // memory or document chunk
  content: string;
  container_tag: string;
  created_at: string;
}

export interface VectorSearchResult {
  id: string;
  score: number; // Similarity score (0-1)
  metadata: VectorMetadata;
}

import { getCachedEmbedding, cacheEmbedding } from './cache';

/**
 * Generate embeddings for multiple texts in a single batch call
 *
 * OPTIMIZATION: Cloudflare AI supports batch inputs.
 * Instead of N API calls, we make ceil(N/100) calls.
 * This reduces latency and is more efficient.
 */
export async function generateEmbeddingsBatch(
  env: { AI: any; CACHE?: KVNamespace },
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Cloudflare AI batch limit (conservative)
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // Check cache for each text first
    const cachedResults: (number[] | null)[] = [];
    const uncachedTexts: { index: number; text: string }[] = [];

    if (env.CACHE) {
      for (let j = 0; j < batch.length; j++) {
        try {
          const cached = await getCachedEmbedding(env.CACHE, batch[j]);
          if (cached) {
            cachedResults[j] = cached;
          } else {
            cachedResults[j] = null;
            uncachedTexts.push({ index: j, text: batch[j] });
          }
        } catch {
          cachedResults[j] = null;
          uncachedTexts.push({ index: j, text: batch[j] });
        }
      }
    } else {
      // No cache, all texts need embedding
      batch.forEach((text, j) => {
        cachedResults[j] = null;
        uncachedTexts.push({ index: j, text });
      });
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      console.log(`[Vectorize] Generating ${uncachedTexts.length} embeddings (${batch.length - uncachedTexts.length} cache hits)`);

      const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: uncachedTexts.map(u => u.text),
      });

      // Map results back and cache them
      for (let k = 0; k < uncachedTexts.length; k++) {
        const { index, text } = uncachedTexts[k];
        const embedding = response.data[k];
        cachedResults[index] = embedding;

        // Cache the embedding (non-blocking)
        if (env.CACHE) {
          cacheEmbedding(env.CACHE, text, embedding).catch(() => {});
        }
      }
    }

    // Add all results (cached + newly generated)
    results.push(...(cachedResults as number[][]));
  }

  return results;
}

/**
 * Batch upsert vectors to Vectorize
 */
export async function batchUpsertVectors(
  vectorize: Vectorize,
  vectors: Array<{
    id: string;
    userId: string;
    content: string;
    containerTag: string;
    embedding: number[];
    type?: 'memory' | 'chunk';
  }>
): Promise<void> {
  if (vectors.length === 0) return;

  const vectorData = vectors.map(v => ({
    id: v.id,
    values: v.embedding,
    metadata: {
      id: v.id,
      user_id: v.userId,
      type: v.type || 'memory',
      content: v.content.substring(0, 500),
      container_tag: v.containerTag,
      created_at: new Date().toISOString(),
    } as VectorMetadata,
  }));

  // Vectorize supports up to 1000 vectors per upsert
  const UPSERT_BATCH_SIZE = 100;
  for (let i = 0; i < vectorData.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectorData.slice(i, i + UPSERT_BATCH_SIZE);
    await vectorize.upsert(batch);
  }

  console.log(`[Vectorize] Batch upserted ${vectors.length} vectors`);
}

/**
 * Generate embedding using Cloudflare AI (with caching)
 *
 * OPTIMIZATION: Re-enabled caching with error handling.
 * Cache operations are non-blocking to prevent failures from affecting embedding generation.
 */
export async function generateEmbedding(
  env: { AI: any; CACHE?: KVNamespace },
  text: string
): Promise<number[]> {
  // Check cache first (if CACHE binding exists)
  if (env.CACHE) {
    try {
      const cached = await getCachedEmbedding(env.CACHE, text);
      if (cached) {
        console.log('[Cache] Embedding cache HIT');
        return cached;
      }
    } catch (cacheError) {
      // Non-blocking: cache read failure shouldn't stop embedding generation
      console.warn('[Cache] Cache read failed (non-blocking):', cacheError);
    }
  }

  // Cache miss - generate embedding
  console.log('[Cache] Embedding cache miss, generating...');
  const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });

  const embedding = response.data[0]; // 768-dimensional vector

  // Cache the result (non-blocking, fire-and-forget)
  if (env.CACHE) {
    // Use waitUntil pattern or just fire-and-forget to not block response
    cacheEmbedding(env.CACHE, text, embedding).catch((cacheError) => {
      // Non-blocking: cache write failure shouldn't affect response
      console.warn('[Cache] Cache write failed (non-blocking):', cacheError);
    });
  }

  return embedding;
}

/**
 * Insert memory embedding into Vectorize
 */
export async function insertMemoryVector(
  vectorize: Vectorize,
  memoryId: string,
  userId: string,
  content: string,
  containerTag: string,
  embedding: number[]
): Promise<void> {
  const metadata: VectorMetadata = {
    id: memoryId,
    user_id: userId,
    type: 'memory',
    content: content.substring(0, 500), // Store first 500 chars for preview
    container_tag: containerTag,
    created_at: new Date().toISOString(),
  };

  await vectorize.insert([
    {
      id: memoryId,
      values: embedding,
      metadata,
    },
  ]);
}

/**
 * Insert document chunk embedding into Vectorize
 */
export async function insertChunkVector(
  vectorize: Vectorize,
  chunkId: string,
  userId: string,
  content: string,
  containerTag: string,
  embedding: number[]
): Promise<void> {
  const metadata: VectorMetadata = {
    id: chunkId,
    user_id: userId,
    type: 'chunk',
    content: content.substring(0, 500),
    container_tag: containerTag,
    created_at: new Date().toISOString(),
  };

  await vectorize.insert([
    {
      id: chunkId,
      values: embedding,
      metadata,
    },
  ]);
}

/**
 * Vector similarity search
 */
export async function vectorSearch(
  vectorize: Vectorize,
  queryEmbedding: number[],
  userId: string,
  options?: {
    containerTag?: string;
    topK?: number;
    minScore?: number;
    type?: 'memory' | 'chunk' | 'all';
  }
): Promise<VectorSearchResult[]> {
  // Build filter
  const filter: Record<string, any> = { user_id: userId };

  if (options?.containerTag) {
    filter.container_tag = options.containerTag;
  }

  if (options?.type && options.type !== 'all') {
    filter.type = options.type;
  }

  // Search
  const results = await vectorize.query(queryEmbedding, {
    topK: options?.topK || 10,
    filter,
    returnMetadata: 'all',
  });

  // Filter by minimum score
  const minScore = options?.minScore || 0.7;
  return results.matches
    .filter((match) => match.score >= minScore)
    .map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as VectorMetadata,
    }));
}

/**
 * Delete vector by ID
 */
export async function deleteVector(
  vectorize: Vectorize,
  id: string
): Promise<void> {
  await vectorize.deleteByIds([id]);
}

/**
 * Delete all vectors for a user (GDPR compliance)
 * Note: Vectorize doesn't support bulk delete by metadata filter,
 * so we query and delete in batches.
 *
 * LIMITATION: If user has >10000 vectors, this may need multiple calls.
 * The function returns stats about what was deleted.
 */
export async function deleteUserVectors(
  vectorize: Vectorize,
  userId: string
): Promise<{ deleted: number; batches: number; complete: boolean }> {
  const BATCH_SIZE = 100;
  const MAX_QUERY = 1000; // Query up to 1000 vectors at a time
  let totalDeleted = 0;
  let batchCount = 0;
  let hasMore = true;

  // Dummy vector for querying by metadata filter
  const dummyVector = new Array(768).fill(0);

  while (hasMore) {
    try {
      // Query vectors for this user
      const results = await vectorize.query(dummyVector, {
        topK: MAX_QUERY,
        filter: { user_id: userId },
        returnValues: false,
        returnMetadata: 'none',
      });

      if (results.matches.length === 0) {
        hasMore = false;
        break;
      }

      // Delete in batches
      const ids = results.matches.map(m => m.id);

      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        await vectorize.deleteByIds(batch);
        totalDeleted += batch.length;
        batchCount++;

        console.log(`[Vectorize] Deleted batch ${batchCount}: ${batch.length} vectors for user ${userId}`);
      }

      // If we got less than MAX_QUERY, we're done
      if (results.matches.length < MAX_QUERY) {
        hasMore = false;
      }

      // Safety limit: don't loop forever
      if (batchCount > 100) {
        console.warn(`[Vectorize] Hit safety limit of 100 batches for user ${userId}`);
        break;
      }
    } catch (error) {
      console.error(`[Vectorize] Error deleting vectors for user ${userId}:`, error);
      throw error;
    }
  }

  console.log(`[Vectorize] Completed: deleted ${totalDeleted} vectors for user ${userId} in ${batchCount} batches`);

  return {
    deleted: totalDeleted,
    batches: batchCount,
    complete: !hasMore,
  };
}
