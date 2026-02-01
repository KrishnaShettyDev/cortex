/**
 * Async Memory Processor
 *
 * Handles background processing using waitUntil():
 * - Embedding generation
 * - Fact extraction
 * - Relationship detection
 */

import type { Bindings } from '../types';
import { getMemoryById } from './db/memories';
import { generateEmbedding, insertMemoryVector } from './vectorize';
import { processNewMemory } from './extraction';
import { invalidateProfileCache } from './cache';

export async function processMemory(
  env: Bindings,
  memoryId: string,
  userId: string
): Promise<void> {
  console.log(`[Processor] Starting processing for memory ${memoryId}`);

  // Update status to 'embedding'
  await env.DB.prepare(
    'UPDATE memories SET processing_status = ?, updated_at = ? WHERE id = ?'
  )
    .bind('embedding', new Date().toISOString(), memoryId)
    .run();

  try {
    // Get memory
    const memory = await getMemoryById(env.DB, memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    // 1. Generate embedding and insert into Vectorize
    const embedding = await generateEmbedding(env, memory.content);
    await insertMemoryVector(
      env.VECTORIZE,
      memory.id,
      userId,
      memory.content,
      memory.container_tag,
      embedding
    );

    console.log(`[Processor] Embedded memory ${memoryId}`);

    // Update status to 'extracting'
    await env.DB.prepare(
      'UPDATE memories SET processing_status = ?, updated_at = ? WHERE id = ?'
    )
      .bind('extracting', new Date().toISOString(), memoryId)
      .run();

    // 2. Extract facts and detect relationships
    const result = await processNewMemory(env, memory);

    console.log(
      `[Processor] Extracted ${result.factsExtracted} facts, created ${result.relationshipsCreated} relationships for memory ${memoryId}`
    );

    // 3. Invalidate profile cache (new facts extracted)
    if (result.factsExtracted > 0) {
      await invalidateProfileCache(env.CACHE, memory.user_id, memory.container_tag);
      console.log(`[Processor] Profile cache invalidated for user ${memory.user_id}`);
    }

    // Update status to 'done'
    await env.DB.prepare(
      'UPDATE memories SET processing_status = ?, updated_at = ? WHERE id = ?'
    )
      .bind('done', new Date().toISOString(), memoryId)
      .run();

    console.log(`[Processor] Memory ${memoryId} processed successfully`);
  } catch (error) {
    console.error(`[Processor] Memory ${memoryId} processing failed:`, error);

    // Update status to 'failed'
    await env.DB.prepare(
      'UPDATE memories SET processing_status = ?, processing_error = ?, updated_at = ? WHERE id = ?'
    )
      .bind(
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
        new Date().toISOString(),
        memoryId
      )
      .run();
  }
}
