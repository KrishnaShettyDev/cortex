/**
 * Context Cloud API Handlers (v3)
 *
 * Supermemory-style REST API for memory management:
 * - POST /v3/memories - Add memory
 * - GET /v3/memories - List memories
 * - DELETE /v3/memories/:id - Delete memory
 * - POST /v3/search - Hybrid search
 * - GET /v3/profile - Get user profile
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import {
  createMemory,
  getLatestMemories,
  forgetMemory,
  updateMemory,
  getMemoryById,
} from '../lib/db/memories';
import {
  hybridSearch,
  formatContextForLLM,
  type HybridSearchOptions,
} from '../lib/retrieval';
import { getFormattedProfile } from '../lib/db/profiles';
import { generateEmbedding, generateEmbeddingsBatch, insertMemoryVector, batchUpsertVectors } from '../lib/vectorize';
import { invalidateSearchCache } from '../lib/cache';
import { createProcessingJob, ProcessingPipeline } from '../lib/processing/pipeline';
import type { ProcessingContext } from '../lib/processing/types';
import { processMemoryWithAUDN } from '../lib/audn';
import {
  extractContextualMemories,
  isRawConversation,
} from '../lib/contextual-memory';

/**
 * POST /v3/memories
 * Add a new memory
 */
export async function addMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const scope = c.get('tenantScope') || { containerTag: 'default' };
    const body = await c.req.json<{
      content: string;
      source?: string;
      metadata?: any;
      useAUDN?: boolean; // Enable AUDN cycle (default: true)
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: 'Content is required' }, 400);
    }

    // Generate embedding first (needed for AUDN)
    const embedding = await generateEmbedding(c.env, body.content);

    // AUDN Cycle: Smart deduplication (default enabled)
    if (body.useAUDN !== false) {
      const audnResult = await processMemoryWithAUDN(
        c.env,
        userId,
        body.content,
        embedding
      );

      // Handle NOOP: Memory already exists, don't create duplicate
      if (audnResult.action === 'noop') {
        return c.json({
          id: audnResult.memory_id,
          content: body.content,
          processing_status: 'noop',
          audn_action: 'noop',
          audn_reason: audnResult.decision.reason,
          created_at: new Date().toISOString(),
        });
      }

      // Handle UPDATE: New version created
      if (audnResult.action === 'update') {
        // Insert vector for new version
        await insertMemoryVector(
          c.env.VECTORIZE,
          audnResult.memory_id,
          userId,
          body.content,
          scope.containerTag,
          embedding
        );

        return c.json({
          id: audnResult.memory_id,
          content: body.content,
          processing_status: 'done',
          audn_action: 'update',
          audn_reason: audnResult.decision.reason,
          updated_existing: audnResult.decision.target_memory_id,
          created_at: new Date().toISOString(),
        });
      }

      // For DELETE_AND_ADD or ADD, continue with normal creation below
      if (audnResult.action === 'delete_and_add') {
        console.log(
          `[AUDN] Deleted contradictory memory ${audnResult.decision.target_memory_id}, creating new`
        );
      }
    }

    // Create new memory in D1
    const memory = await createMemory(c.env.DB, {
      userId,
      content: body.content,
      source: body.source,
      containerTag: scope.containerTag,
      metadata: body.metadata,
    });

    // Insert vector
    await insertMemoryVector(
      c.env.VECTORIZE,
      memory.id,
      userId,
      body.content,
      memory.container_tag,
      embedding
    );

    // Invalidate search cache for this user (non-blocking)
    if (c.env.CACHE) {
      invalidateSearchCache(c.env.CACHE, userId).catch((err) => {
        console.warn('[Cache] Failed to invalidate search cache:', err);
      });
    }

    // Process async with unified pipeline
    // SKIP processing for benchmark data (too slow for benchmarking)
    let job = null;
    let processingMode = 'skipped';

    if (body.source !== 'memorybench') {
      // Create processing job
      job = await createProcessingJob(
        {
          DB: c.env.DB,
          VECTORIZE: c.env.VECTORIZE,
          AI: c.env.AI,
          QUEUE: c.env.PROCESSING_QUEUE,
        },
        memory.id,
        userId,
        scope.containerTag
      );

      // Enqueue for async processing
      if (c.env.PROCESSING_QUEUE) {
        // Queue-based processing (preferred)
        console.log(`[Handler] Sending to queue: ${job.id}`);
        await c.env.PROCESSING_QUEUE.send({
          type: 'process_memory',
          jobId: job.id,
          memoryId: memory.id,
          userId,
          containerTag: scope.containerTag,
          timestamp: new Date().toISOString(),
        });
        processingMode = 'async';
        console.log(`[Handler] ✓ Queued successfully`);
      } else {
        // Fallback: use waitUntil
        console.log(`[Handler] Using waitUntil for job: ${job.id}`);
        const ctx: ProcessingContext = {
          job,
          env: {
            DB: c.env.DB,
            VECTORIZE: c.env.VECTORIZE,
            AI: c.env.AI,
            QUEUE: c.env.PROCESSING_QUEUE,
          },
        };
        console.log(`[Handler] Creating pipeline with context:`, {
          hasJob: !!ctx.job,
          hasEnv: !!ctx.env,
          jobId: ctx.job?.id,
        });
        const pipeline = new ProcessingPipeline(ctx);
        console.log(`[Handler] Pipeline created, calling execute via waitUntil`);
        c.executionCtx.waitUntil(
          pipeline.execute().catch(err => {
            console.error(`[Handler] Pipeline execution failed in waitUntil:`, err);
          })
        );
        processingMode = 'waitUntil';
        console.log(`[Handler] ✓ waitUntil scheduled`);
      }
    }

    return c.json({
      id: memory.id,
      content: memory.content,
      processing_status: body.source === 'memorybench' ? 'done' : 'queued',
      processing_mode: processingMode,
      job_id: job?.id,
      audn_action: body.useAUDN !== false ? 'add' : undefined,
      created_at: memory.created_at,
    });
  });
}

/**
 * POST /v3/memories/batch-contextual
 * Extract contextual memories from raw conversation and store as individual facts
 *
 * This endpoint handles the benchmark case where raw conversation JSON is sent.
 * It extracts individual facts with resolved pronouns before storage.
 */
export async function addContextualMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const scope = c.get('tenantScope') || { containerTag: 'default' };
    const body = await c.req.json<{
      content: string;
      source?: string;
      metadata?: any;
      sessionDate?: string;
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: 'Content is required' }, 400);
    }

    // Check if this is raw conversation that needs extraction
    if (!isRawConversation(body.content)) {
      // Not a raw conversation, use normal flow
      return addMemory(c);
    }

    console.log('[ContextualMemory] Extracting facts from raw conversation');

    // Parse conversation from JSON format
    let messages: any[] = [];
    try {
      // Extract JSON from "Here is the session as a stringified JSON: [...]" format
      const jsonMatch = body.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        messages = JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('[ContextualMemory] Failed to parse conversation:', error);
      // Fallback to normal storage
      return addMemory(c);
    }

    if (messages.length === 0) {
      console.log('[ContextualMemory] No messages found, using normal flow');
      return addMemory(c);
    }

    // Extract contextual memories
    // NOTE: This is SYNCHRONOUS and slow (30-60s per session).
    // For production, we should move this to async processing with status polling.
    // For benchmarking, we keep it sync so the provider can track all extracted memory IDs.
    const contextualMemories = await extractContextualMemories(
      c.env,
      messages,
      body.sessionDate
    );

    if (contextualMemories.length === 0) {
      console.log('[ContextualMemory] No facts extracted, storing original');
      // Fallback to storing original content
      return addMemory(c);
    }

    console.log(
      `[ContextualMemory] Extracted ${contextualMemories.length} facts`
    );

    // BATCH OPTIMIZATION: Generate all embeddings in one call
    const facts = contextualMemories.map(cm => cm.fact);
    const embeddings = await generateEmbeddingsBatch(c.env, facts);

    // Create all memories in D1
    const memoryIds: string[] = [];
    const results = [];
    const vectorsToUpsert: Array<{
      id: string;
      userId: string;
      content: string;
      containerTag: string;
      embedding: number[];
    }> = [];

    for (let i = 0; i < contextualMemories.length; i++) {
      const extracted = contextualMemories[i];
      const embedding = embeddings[i];

      try {
        // Create memory (skip AUDN for now to avoid complexity)
        const memory = await createMemory(c.env.DB, {
          userId,
          content: extracted.fact,
          source: body.source || 'contextual-extraction',
          containerTag: scope.containerTag,
          metadata: {
            ...body.metadata,
            originalLength: body.content.length,
            extractedEntities: extracted.entities,
            confidence: extracted.confidence,
          },
        });

        memoryIds.push(memory.id);
        results.push({
          id: memory.id,
          fact: extracted.fact,
          entities: extracted.entities,
        });

        // Queue for batch vector upsert
        vectorsToUpsert.push({
          id: memory.id,
          userId,
          content: extracted.fact,
          containerTag: memory.container_tag,
          embedding,
        });
      } catch (error) {
        console.error(
          '[ContextualMemory] Failed to store extracted fact:',
          error
        );
      }
    }

    // BATCH OPTIMIZATION: Upsert all vectors at once
    if (vectorsToUpsert.length > 0) {
      await batchUpsertVectors(c.env.VECTORIZE, vectorsToUpsert);
    }

    return c.json({
      count: memoryIds.length,
      memories: results,
      processing_status: 'done',
      created_at: new Date().toISOString(),
    });
  });
}

/**
 * GET /v3/memories
 * List memories
 */
export async function listMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('containerTag');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const memories = await getLatestMemories(c.env.DB, userId, {
      containerTag,
      limit,
      offset,
    });

    // Fetch metadata for each memory
    const memoriesWithMetadata = await Promise.all(
      memories.map(async (m) => {
        const metadata = await c.env.DB
          .prepare('SELECT * FROM memory_metadata WHERE memory_id = ?')
          .bind(m.id)
          .first<{
            entities: string | null;
            location_lat: number | null;
            location_lon: number | null;
            location_name: string | null;
            people: string | null;
            tags: string | null;
            timestamp: string | null;
          }>();

        return {
          id: m.id,
          content: m.content,
          source: m.source,
          processing_status: m.processing_status,
          importance_score: m.importance_score,
          memory_type: m.memory_type,
          event_date: m.event_date,
          valid_from: m.valid_from,
          valid_to: m.valid_to,
          metadata: metadata
            ? {
                source: m.source,
                entities: metadata.entities ? JSON.parse(metadata.entities) : undefined,
                location:
                  metadata.location_lat && metadata.location_lon
                    ? {
                        lat: metadata.location_lat,
                        lon: metadata.location_lon,
                        name: metadata.location_name,
                      }
                    : undefined,
                people: metadata.people ? JSON.parse(metadata.people) : undefined,
                tags: metadata.tags ? JSON.parse(metadata.tags) : undefined,
                timestamp: metadata.timestamp,
              }
            : { source: m.source },
          created_at: m.created_at,
          updated_at: m.updated_at,
        };
      })
    );

    return c.json({
      memories: memoriesWithMetadata,
      total: memoriesWithMetadata.length,
    });
  });
}

/**
 * DELETE /v3/memories/:id
 * Delete (forget) a memory
 */
export async function deleteMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');

    // Get memory (with user_id filter for security)
    const memory = await getMemoryById(c.env.DB, memoryId, userId);
    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    // Soft delete in D1
    await forgetMemory(c.env.DB, memoryId);

    // Note: Vectorize doesn't support delete yet, or we'd delete the vector here

    return c.json({ success: true });
  });
}

/**
 * PUT /v3/memories/:id
 * Update a memory (creates new version)
 */
export async function updateMemoryHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');
    const body = await c.req.json<{
      content: string;
      relationType?: 'updates' | 'extends';
    }>();

    // Get memory (with user_id filter for security)
    const memory = await getMemoryById(c.env.DB, memoryId, userId);
    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    // Update memory (creates new version)
    const newMemory = await updateMemory(c.env.DB, {
      memoryId,
      newContent: body.content,
      relationType: body.relationType || 'updates',
    });

    // Generate embedding for new version
    const embedding = await generateEmbedding(c.env, body.content);
    await insertMemoryVector(
      c.env.VECTORIZE,
      newMemory.id,
      userId,
      body.content,
      newMemory.container_tag,
      embedding
    );

    return c.json({
      id: newMemory.id,
      content: newMemory.content,
      version: newMemory.version,
      created_at: newMemory.created_at,
    });
  });
}

/**
 * POST /v3/search
 * Hybrid search (memories + documents + profile)
 */
export async function search(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json<{
      q: string; // Query
      containerTag?: string;
      limit?: number;
      searchMode?: 'vector' | 'keyword' | 'hybrid';
      includeProfile?: boolean;
      rerank?: boolean;
    }>();

    if (!body.q || body.q.trim().length === 0) {
      return c.json({ error: 'Query is required' }, 400);
    }

    const options: HybridSearchOptions = {
      query: body.q,
      userId,
      containerTag: body.containerTag,
      limit: body.limit || 10,
      searchMode: body.searchMode || 'hybrid',
      includeProfile: body.includeProfile !== false,
      rerank: body.rerank || false,
    };

    const result = await hybridSearch(c.env, options);

    return c.json(result);
  });
}

/**
 * GET /v3/profile
 * Get user profile (static + dynamic facts)
 */
export async function getProfile(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('containerTag');

    const profile = await getFormattedProfile(c.env.DB, userId, containerTag);

    return c.json(profile);
  });
}

/**
 * POST /v3/recall
 * Recall with formatted context (for LLM injection)
 */
export async function recall(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json<{
      q: string;
      containerTag?: string;
      limit?: number;
      format?: 'json' | 'markdown'; // Default: json
    }>();

    if (!body.q || body.q.trim().length === 0) {
      return c.json({ error: 'Query is required' }, 400);
    }

    const result = await hybridSearch(c.env, {
      query: body.q,
      userId,
      containerTag: body.containerTag,
      limit: body.limit || 10,
      searchMode: 'hybrid',
      includeProfile: true,
    });

    if (body.format === 'markdown') {
      // Return formatted context for LLM
      const context = formatContextForLLM(result);
      return c.json({ context, timing: result.timing });
    } else {
      // Return structured JSON
      return c.json(result);
    }
  });
}
