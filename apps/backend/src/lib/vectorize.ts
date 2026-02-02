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
 * Generate embedding using Cloudflare AI (with caching)
 */
export async function generateEmbedding(
  env: { AI: any; CACHE: KVNamespace },
  text: string
): Promise<number[]> {
  // Check cache first
  // TEMPORARILY DISABLED FOR BENCHMARKING (KV limit exceeded)
  // const cached = await getCachedEmbedding(env.CACHE, text);
  // if (cached) {
  //   console.log('[Cache] Embedding cache hit');
  //   return cached;
  // }

  // Cache miss - generate embedding
  console.log('[Cache] Embedding cache miss, generating...');
  const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });

  const embedding = response.data[0]; // 768-dimensional vector

  // Cache the result
  // TEMPORARILY DISABLED FOR BENCHMARKING (KV limit exceeded)
  // await cacheEmbedding(env.CACHE, text, embedding);

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
 * Delete all vectors for a user (cleanup)
 */
export async function deleteUserVectors(
  vectorize: Vectorize,
  userId: string
): Promise<void> {
  // Note: Vectorize doesn't support bulk delete by metadata filter yet
  // This would need to be done by querying all user vectors first, then deleting by IDs
  // For now, this is a placeholder
  console.warn('Bulk delete by user not yet implemented in Vectorize');
}
