/**
 * Hybrid Retrieval Service
 *
 * Implements Supermemory-style context cloud:
 * - Vector search (semantic similarity)
 * - Keyword search (BM25-style text matching)
 * - Profile injection (user context)
 * - Hybrid ranking (combine scores)
 */

import { searchMemories, type Memory } from './db/memories';
import { searchChunks, type DocumentChunk } from './db/documents';
import { getFormattedProfile } from './db/profiles';
import { generateEmbedding, vectorSearch } from './vectorize';
import { getCachedSearchResults, cacheSearchResults } from './cache';
import { rerankResults, type RerankCandidate } from './rerank';

export interface HybridSearchOptions {
  query: string;
  userId: string;
  containerTag?: string;
  limit?: number;
  searchMode?: 'vector' | 'keyword' | 'hybrid'; // Default: hybrid
  includeProfile?: boolean; // Include user profile in results
  rerank?: boolean; // Use LLM to rerank results
}

export interface HybridSearchResult {
  // Results
  memories: Array<{
    id: string;
    content: string;
    score: number;
    source: string;
    created_at: string;
  }>;
  chunks: Array<{
    id: string;
    content: string;
    score: number;
    document_id: string;
    created_at: string;
  }>;

  // Profile
  profile?: {
    static: string[];
    dynamic: string[];
  };

  // Metadata
  timing: number; // ms
  total: number;
}

/**
 * Hybrid search: combines vector + keyword + profile (with caching)
 */
export async function hybridSearch(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any; CACHE: KVNamespace },
  options: HybridSearchOptions
): Promise<HybridSearchResult> {
  const startTime = Date.now();

  // Check cache first (only for hybrid/vector mode)
  // TEMPORARILY DISABLED FOR BENCHMARKING (KV limit exceeded)
  // if (options.searchMode !== 'keyword') {
  //   const cached = await getCachedSearchResults(
  //     env.CACHE,
  //     options.userId,
  //     options.query,
  //     options.containerTag || 'default'
  //   );

  //   if (cached) {
  //     console.log('[Cache] Search results cache hit');
  //     return { ...cached, timing: Date.now() - startTime };
  //   }
  //   console.log('[Cache] Search results cache miss, executing search...');
  // }

  // 1. Get user profile (if requested)
  let profile: { static: string[]; dynamic: string[] } | undefined;
  if (options.includeProfile !== false) {
    profile = await getFormattedProfile(
      env.DB,
      options.userId,
      options.containerTag,
      env.CACHE
    );
  }

  // 2. Vector search
  let vectorResults: Array<{ id: string; score: number; type: 'memory' | 'chunk' }> = [];
  if (options.searchMode !== 'keyword') {
    const queryEmbedding = await generateEmbedding(env, options.query);
    const vectorMatches = await vectorSearch(env.VECTORIZE, queryEmbedding, options.userId, {
      containerTag: options.containerTag,
      topK: options.limit || 10,
      minScore: 0.7,
      type: 'all',
    });

    vectorResults = vectorMatches.map((match) => ({
      id: match.id,
      score: match.score,
      type: match.metadata.type,
    }));
  }

  // 3. Keyword search
  let keywordMemories: Memory[] = [];
  let keywordChunks: DocumentChunk[] = [];
  if (options.searchMode !== 'vector') {
    keywordMemories = await searchMemories(env.DB, options.userId, options.query, {
      containerTag: options.containerTag,
      limit: options.limit || 10,
    });

    keywordChunks = await searchChunks(env.DB, options.userId, options.query, {
      containerTag: options.containerTag,
      limit: options.limit || 10,
    });
  }

  // 4. Merge and rank results
  let { memories, chunks } = mergeResults(
    vectorResults,
    keywordMemories,
    keywordChunks,
    options.limit || 10
  );

  // 5. Reranking (if requested)
  if (options.rerank && (memories.length > 0 || chunks.length > 0)) {
    console.log('[Rerank] Reranking results...');

    // Combine memories and chunks for reranking
    const candidates: RerankCandidate[] = [
      ...memories.map((m) => ({
        id: m.id,
        content: m.content,
        score: m.score,
        type: 'memory' as const,
      })),
      ...chunks.map((c) => ({
        id: c.id,
        content: c.content,
        score: c.score,
        type: 'chunk' as const,
      })),
    ];

    const reranked = await rerankResults(env.AI, {
      query: options.query,
      candidates,
      topK: options.limit || 10,
    });

    // Split back into memories and chunks
    memories = reranked
      .filter((r) => r.type === 'memory')
      .map((r) => ({
        id: r.id,
        content: r.content,
        score: r.final_score,
        source: memories.find((m) => m.id === r.id)?.source || 'unknown',
        created_at: memories.find((m) => m.id === r.id)?.created_at || '',
      }));

    chunks = reranked
      .filter((r) => r.type === 'chunk')
      .map((r) => ({
        id: r.id,
        content: r.content,
        score: r.final_score,
        document_id: chunks.find((c) => c.id === r.id)?.document_id || '',
        created_at: chunks.find((c) => c.id === r.id)?.created_at || '',
      }));
  }

  const timing = Date.now() - startTime;

  const result = {
    memories,
    chunks,
    profile,
    timing,
    total: memories.length + chunks.length,
  };

  // Cache the result (only for hybrid/vector mode)
  // TEMPORARILY DISABLED FOR BENCHMARKING (KV limit exceeded)
  // if (options.searchMode !== 'keyword') {
  //   await cacheSearchResults(
  //     env.CACHE,
  //     options.userId,
  //     options.query,
  //     options.containerTag || 'default',
  //     result
  //   );
  // }

  return result;
}

/**
 * Merge vector and keyword results with hybrid scoring
 */
function mergeResults(
  vectorResults: Array<{ id: string; score: number; type: 'memory' | 'chunk' }>,
  keywordMemories: Memory[],
  keywordChunks: DocumentChunk[],
  limit: number
): {
  memories: HybridSearchResult['memories'];
  chunks: HybridSearchResult['chunks'];
} {
  // Create score maps
  const vectorScores = new Map<string, number>();
  vectorResults.forEach((r) => vectorScores.set(r.id, r.score));

  // Keyword score: decay by position (1.0 for first, 0.5 for last)
  const keywordMemoryScores = new Map<string, number>();
  keywordMemories.forEach((m, idx) => {
    const score = 1.0 - (idx / keywordMemories.length) * 0.5;
    keywordMemoryScores.set(m.id, score);
  });

  const keywordChunkScores = new Map<string, number>();
  keywordChunks.forEach((c, idx) => {
    const score = 1.0 - (idx / keywordChunks.length) * 0.5;
    keywordChunkScores.set(c.id, score);
  });

  // Combine memories
  const memoryMap = new Map<string, Memory>();
  keywordMemories.forEach((m) => memoryMap.set(m.id, m));

  const memoriesWithScores = Array.from(memoryMap.values()).map((m) => {
    const vectorScore = vectorScores.get(m.id) || 0;
    const keywordScore = keywordMemoryScores.get(m.id) || 0;
    // Hybrid score: weighted average (vector 70%, keyword 30%)
    const hybridScore = vectorScore * 0.7 + keywordScore * 0.3;

    return {
      id: m.id,
      content: m.content,
      score: hybridScore,
      source: m.source,
      created_at: m.created_at,
    };
  });

  // Combine chunks
  const chunkMap = new Map<string, DocumentChunk>();
  keywordChunks.forEach((c) => chunkMap.set(c.id, c));

  const chunksWithScores = Array.from(chunkMap.values()).map((c) => {
    const vectorScore = vectorScores.get(c.id) || 0;
    const keywordScore = keywordChunkScores.get(c.id) || 0;
    const hybridScore = vectorScore * 0.7 + keywordScore * 0.3;

    return {
      id: c.id,
      content: c.content,
      score: hybridScore,
      document_id: c.document_id,
      created_at: c.created_at,
    };
  });

  // Sort by score and limit
  memoriesWithScores.sort((a, b) => b.score - a.score);
  chunksWithScores.sort((a, b) => b.score - a.score);

  return {
    memories: memoriesWithScores.slice(0, Math.ceil(limit / 2)),
    chunks: chunksWithScores.slice(0, Math.ceil(limit / 2)),
  };
}

/**
 * Format results for context injection (Claude, GPT, etc.)
 */
export function formatContextForLLM(result: HybridSearchResult): string {
  let context = '';

  // Add profile
  if (result.profile) {
    context += '# User Profile\n\n';

    if (result.profile.static.length > 0) {
      context += '## About the user:\n';
      result.profile.static.forEach((fact) => {
        context += `- ${fact}\n`;
      });
      context += '\n';
    }

    if (result.profile.dynamic.length > 0) {
      context += '## Current context:\n';
      result.profile.dynamic.forEach((fact) => {
        context += `- ${fact}\n`;
      });
      context += '\n';
    }
  }

  // Add memories
  if (result.memories.length > 0) {
    context += '# Relevant Memories\n\n';
    result.memories.forEach((m, idx) => {
      context += `${idx + 1}. ${m.content} (${m.source}, ${new Date(m.created_at).toLocaleDateString()})\n`;
    });
    context += '\n';
  }

  // Add document chunks
  if (result.chunks.length > 0) {
    context += '# Knowledge Base\n\n';
    result.chunks.forEach((c, idx) => {
      context += `${idx + 1}. ${c.content}\n`;
    });
    context += '\n';
  }

  return context;
}
