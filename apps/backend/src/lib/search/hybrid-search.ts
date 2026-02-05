/**
 * Hybrid Search Engine - Supermemory++ Phase 2
 *
 * Two-stage retrieval:
 * 1. Candidate selection (vector + keyword + time filter)
 * 2. Multi-signal ranking with explainability
 *
 * Features:
 * - Vector similarity via Cloudflare Vectorize
 * - BM25 keyword matching
 * - Temporal filtering and boosting
 * - Profile-driven ranking
 * - Relationship path traversal
 * - Explainable score breakdown
 */

import {
  rankCandidates,
  mergeCandidates,
  computeBM25Score,
  type SearchCandidate,
  type ProfileFact,
  type RankedResult,
  type RankingConfig,
  DEFAULT_RANKING_CONFIG,
} from './ranking';

export interface SearchQuery {
  query: string;
  userId: string;
  containerTag?: string;

  // Filters
  layers?: string[];          // Filter by memory layer
  timeRange?: {
    start?: string;           // ISO date
    end?: string;
  };

  // Retrieval params
  topK?: number;              // Number of results to return
  candidateMultiplier?: number; // How many candidates to fetch before ranking

  // Feature flags
  includeRelationships?: boolean;
  includeTimeline?: boolean;
  useProfiles?: boolean;
}

export interface SearchResponse {
  query: string;
  results: EnrichedResult[];
  totalCandidates: number;
  profilesApplied: ProfileFact[];
  timings: {
    vectorMs: number;
    keywordMs: number;
    rankingMs: number;
    totalMs: number;
  };
}

export interface EnrichedResult extends RankedResult {
  snippet: string;
  relationshipPath?: RelationshipLink[];
  createdAt: string;
  source?: string;
}

export interface RelationshipLink {
  memoryId: string;
  relationType: string;
  confidence: number;
  direction: 'outgoing' | 'incoming';
}

/**
 * Generate embedding for search query
 */
async function embedQuery(ai: any, query: string): Promise<number[]> {
  const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [query],
  });

  if (response.data && response.data.length > 0) {
    return response.data[0];
  }
  throw new Error('Failed to generate query embedding');
}

/**
 * Vector search via Cloudflare Vectorize
 */
async function vectorSearch(
  vectorize: Vectorize,
  embedding: number[],
  options: {
    topK: number;
    filter?: VectorizeVectorMetadataFilter;
  }
): Promise<Array<{ id: string; score: number }>> {
  const results = await vectorize.query(embedding, {
    topK: options.topK,
    filter: options.filter,
    returnMetadata: 'none',
  });

  return results.matches.map(m => ({
    id: m.id,
    score: m.score,
  }));
}

/**
 * Keyword search in D1 (basic implementation)
 */
async function keywordSearch(
  db: D1Database,
  query: string,
  userId: string,
  containerTag: string,
  options: {
    limit: number;
    layers?: string[];
    timeRange?: { start?: string; end?: string };
  }
): Promise<Array<{ memoryId: string; content: string; score: number }>> {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return [];

  // Build WHERE clause
  let whereClause = `user_id = ? AND container_tag = ? AND valid_to IS NULL AND is_forgotten = 0`;
  const params: any[] = [userId, containerTag];

  if (options.layers && options.layers.length > 0) {
    whereClause += ` AND layer IN (${options.layers.map(() => '?').join(',')})`;
    params.push(...options.layers);
  }

  // Basic LIKE search for keywords (not ideal, but works for D1)
  // In production, consider FTS5 or external search service
  const likeConditions = queryTerms.map(() => `content LIKE ?`).join(' OR ');
  whereClause += ` AND (${likeConditions})`;
  params.push(...queryTerms.map(t => `%${t}%`));

  const sql = `
    SELECT id, content, created_at
    FROM memories
    WHERE ${whereClause}
    ORDER BY importance_score DESC, created_at DESC
    LIMIT ?
  `;
  params.push(options.limit);

  const result = await db.prepare(sql).bind(...params).all();

  // Compute BM25-style scores
  return (result.results as any[]).map(row => ({
    memoryId: row.id,
    content: row.content,
    score: computeBM25Score(query, row.content),
  }));
}

/**
 * Fetch memory details for candidates
 */
async function enrichCandidates(
  db: D1Database,
  memoryIds: string[]
): Promise<Map<string, any>> {
  if (memoryIds.length === 0) return new Map();

  const placeholders = memoryIds.map(() => '?').join(',');
  const sql = `
    SELECT
      m.id,
      m.content,
      m.layer,
      m.created_at,
      m.importance_score,
      m.source,
      m.metadata,
      sm.pinned,
      GROUP_CONCAT(me.event_date) as event_dates
    FROM memories m
    LEFT JOIN memory_search_meta sm ON m.id = sm.memory_id
    LEFT JOIN memory_events me ON m.id = me.memory_id
    WHERE m.id IN (${placeholders})
    GROUP BY m.id
  `;

  const result = await db.prepare(sql).bind(...memoryIds).all();

  const map = new Map<string, any>();
  for (const row of result.results as any[]) {
    map.set(row.id, {
      ...row,
      eventDates: row.event_dates ? row.event_dates.split(',') : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      pinned: row.pinned === 1,
    });
  }

  return map;
}

/**
 * Fetch profile facts for user
 */
async function fetchProfiles(
  db: D1Database,
  userId: string,
  containerTag: string
): Promise<ProfileFact[]> {
  const result = await db.prepare(`
    SELECT key, value, confidence, category
    FROM profiles
    WHERE user_id = ? AND container_tag = ?
      AND (valid_to IS NULL OR valid_to > datetime('now'))
    ORDER BY confidence DESC
    LIMIT 20
  `).bind(userId, containerTag).all();

  return (result.results as any[]).map(row => ({
    key: row.key,
    value: JSON.parse(row.value),
    confidence: row.confidence,
    category: row.category,
  }));
}

/**
 * Fetch relationship paths for memories
 */
async function fetchRelationships(
  db: D1Database,
  memoryIds: string[],
  maxDepth: number = 2
): Promise<Map<string, RelationshipLink[]>> {
  if (memoryIds.length === 0) return new Map();

  const placeholders = memoryIds.map(() => '?').join(',');

  // Get direct relationships (1 hop)
  const sql = `
    SELECT
      source_memory as source_id,
      target_memory as target_id,
      relation_type,
      confidence
    FROM memory_relationships
    WHERE source_memory IN (${placeholders}) OR target_memory IN (${placeholders})
  `;

  const result = await db.prepare(sql).bind(...memoryIds, ...memoryIds).all();

  const pathMap = new Map<string, RelationshipLink[]>();
  for (const memoryId of memoryIds) {
    pathMap.set(memoryId, []);
  }

  for (const row of result.results as any[]) {
    // Outgoing relationships
    if (pathMap.has(row.source_id)) {
      pathMap.get(row.source_id)!.push({
        memoryId: row.target_id,
        relationType: row.relation_type,
        confidence: row.confidence,
        direction: 'outgoing',
      });
    }

    // Incoming relationships
    if (pathMap.has(row.target_id)) {
      pathMap.get(row.target_id)!.push({
        memoryId: row.source_id,
        relationType: row.relation_type,
        confidence: row.confidence,
        direction: 'incoming',
      });
    }
  }

  return pathMap;
}

/**
 * Generate snippet from content
 */
function generateSnippet(content: string, query: string, maxLength: number = 200): string {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  // Find the first occurrence of any query term
  const lowerContent = content.toLowerCase();
  let startIdx = 0;

  for (const term of queryTerms) {
    const idx = lowerContent.indexOf(term);
    if (idx !== -1) {
      startIdx = Math.max(0, idx - 50);
      break;
    }
  }

  // Extract snippet around match
  let snippet = content.slice(startIdx, startIdx + maxLength);

  // Clean up snippet edges
  if (startIdx > 0) snippet = '...' + snippet;
  if (startIdx + maxLength < content.length) snippet = snippet + '...';

  return snippet.trim();
}

/**
 * Main hybrid search function
 */
export async function hybridSearch(
  ctx: {
    db: D1Database;
    vectorize: Vectorize;
    ai: any;
  },
  searchQuery: SearchQuery
): Promise<SearchResponse> {
  const startTime = Date.now();

  const {
    query,
    userId,
    containerTag = 'default',
    topK = 10,
    candidateMultiplier = 5,
    layers,
    timeRange,
    includeRelationships = true,
    useProfiles = true,
  } = searchQuery;

  const candidateLimit = topK * candidateMultiplier;

  // Parallel: fetch profiles, vector search, keyword search
  const [profiles, queryEmbedding] = await Promise.all([
    useProfiles ? fetchProfiles(ctx.db, userId, containerTag) : Promise.resolve([]),
    embedQuery(ctx.ai, query),
  ]);

  // Build vector filter
  const vectorFilter: VectorizeVectorMetadataFilter = {
    user_id: userId,
  };
  if (containerTag !== 'default') {
    vectorFilter.container_tag = containerTag;
  }

  // Parallel: vector and keyword search
  const vectorStart = Date.now();
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(ctx.vectorize, queryEmbedding, {
      topK: candidateLimit,
      filter: vectorFilter,
    }),
    keywordSearch(ctx.db, query, userId, containerTag, {
      limit: candidateLimit,
      layers,
      timeRange,
    }),
  ]);
  const vectorMs = Date.now() - vectorStart;
  const keywordMs = vectorMs; // Ran in parallel

  // Collect all candidate IDs
  const candidateIds = new Set<string>();
  for (const r of vectorResults) candidateIds.add(r.id);
  for (const r of keywordResults) candidateIds.add(r.memoryId);

  // Enrich candidates with full data
  const enrichedData = await enrichCandidates(ctx.db, Array.from(candidateIds));

  // Build SearchCandidate objects
  const vectorScoreMap = new Map(vectorResults.map(r => [r.id, r.score]));
  const keywordScoreMap = new Map(keywordResults.map(r => [r.memoryId, r.score]));

  const candidates: SearchCandidate[] = [];
  for (const memoryId of candidateIds) {
    const data = enrichedData.get(memoryId);
    if (!data) continue;

    candidates.push({
      memoryId,
      content: data.content,
      vectorScore: vectorScoreMap.get(memoryId) || 0,
      keywordScore: keywordScoreMap.get(memoryId) || 0,
      eventDates: data.eventDates,
      createdAt: data.created_at,
      layer: data.layer || 'episodic',
      importance: data.importance_score,
      pinned: data.pinned,
      metadata: data.metadata,
    });
  }

  // Rank candidates
  const rankingStart = Date.now();
  const rankedResults = rankCandidates(candidates, {
    profiles,
    timeRange,
    topK,
  });
  const rankingMs = Date.now() - rankingStart;

  // Fetch relationships if requested
  let relationshipMap = new Map<string, RelationshipLink[]>();
  if (includeRelationships) {
    relationshipMap = await fetchRelationships(
      ctx.db,
      rankedResults.map(r => r.memoryId)
    );
  }

  // Build enriched results
  const results: EnrichedResult[] = rankedResults.map(r => {
    const data = enrichedData.get(r.memoryId);
    return {
      ...r,
      snippet: generateSnippet(r.content, query),
      relationshipPath: relationshipMap.get(r.memoryId),
      createdAt: data?.created_at || '',
      source: data?.source,
    };
  });

  const totalMs = Date.now() - startTime;

  return {
    query,
    results,
    totalCandidates: candidateIds.size,
    profilesApplied: profiles,
    timings: {
      vectorMs,
      keywordMs,
      rankingMs,
      totalMs,
    },
  };
}

/**
 * Timeline search - get memories in chronological order
 */
export async function timelineSearch(
  ctx: {
    db: D1Database;
    ai: any;
  },
  options: {
    userId: string;
    containerTag?: string;
    start?: string;
    end?: string;
    entityFilter?: string;
    limit?: number;
  }
): Promise<{
  events: Array<{
    memoryId: string;
    eventDate: string;
    eventType: string | null;
    content: string;
    snippet: string;
  }>;
  summary?: string;
}> {
  const {
    userId,
    containerTag = 'default',
    start,
    end,
    entityFilter,
    limit = 50,
  } = options;

  // Build query
  let whereClause = `m.user_id = ? AND m.container_tag = ?`;
  const params: any[] = [userId, containerTag];

  if (start) {
    whereClause += ` AND me.event_date >= ?`;
    params.push(start);
  }
  if (end) {
    whereClause += ` AND me.event_date <= ?`;
    params.push(end);
  }

  const sql = `
    SELECT
      me.memory_id,
      me.event_date,
      me.event_type,
      m.content
    FROM memory_events me
    JOIN memories m ON me.memory_id = m.id
    WHERE ${whereClause}
    ORDER BY me.event_date ASC
    LIMIT ?
  `;
  params.push(limit);

  const result = await ctx.db.prepare(sql).bind(...params).all();

  const events = (result.results as any[]).map(row => ({
    memoryId: row.memory_id,
    eventDate: row.event_date,
    eventType: row.event_type,
    content: row.content,
    snippet: row.content.slice(0, 200) + (row.content.length > 200 ? '...' : ''),
  }));

  // Generate timeline summary if we have events
  let summary: string | undefined;
  if (events.length > 0 && events.length <= 20) {
    try {
      const eventsList = events.map(e =>
        `- ${e.eventDate}: ${e.snippet}`
      ).join('\n');

      const response = await ctx.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{
          role: 'user',
          content: `Summarize these timeline events in 2-3 sentences:\n\n${eventsList}`,
        }],
        max_tokens: 200,
      });

      summary = response.response;
    } catch {
      // Summary generation is optional
    }
  }

  return { events, summary };
}
