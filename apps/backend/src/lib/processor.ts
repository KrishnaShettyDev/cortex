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
import { processMemoryEntities } from './entities/processor';
import { extractEventDate } from './temporal';
import { scoreMemoryImportance } from './consolidation';
import { extractAndSaveCommitments } from './commitments';

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
    const memory = await getMemoryById(env.DB, memoryId, userId);
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

    // 2. Extract event date (temporal resolution)
    try {
      const eventDateResult = await extractEventDate(
        env.AI,
        memory.content,
        new Date(memory.created_at)
      );

      if (eventDateResult.event_date && eventDateResult.confidence >= 0.7) {
        await env.DB.prepare(
          'UPDATE memories SET event_date = ?, updated_at = ? WHERE id = ?'
        ).bind(
          eventDateResult.event_date,
          new Date().toISOString(),
          memoryId
        ).run();

        console.log(
          `[Processor] Extracted event date for memory ${memoryId}: ${eventDateResult.event_date} (confidence: ${eventDateResult.confidence})`
        );
      }
    } catch (error) {
      console.error(`[Processor] Event date extraction failed for memory ${memoryId}:`, error);
      // Don't fail processing if event date extraction fails
    }

    // 3. Extract facts and detect relationships
    const result = await processNewMemory(env, memory);

    console.log(
      `[Processor] Extracted ${result.factsExtracted} facts, created ${result.relationshipsCreated} relationships for memory ${memoryId}`
    );

    // 4. Extract entities and build knowledge graph
    try {
      console.log(`[Processor] Starting entity extraction for memory ${memoryId}`);
      const entityResult = await processMemoryEntities(
        env,
        memory.id,
        memory.user_id,
        memory.container_tag,
        memory.content,
        memory.created_at
      );

      console.log(
        `[Processor] Extracted ${entityResult.extraction_metadata.total_entities} entities, ${entityResult.extraction_metadata.total_relationships} relationships for memory ${memoryId}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`[Processor] Entity extraction failed for memory ${memoryId}:`, errorMessage);
      console.error(`[Processor] Error stack:`, errorStack);

      // Log error to database for debugging
      try {
        await env.DB.prepare(
          'UPDATE memories SET processing_error = ? WHERE id = ?'
        ).bind(`Entity extraction failed: ${errorMessage}`, memoryId).run();
      } catch (dbError) {
        console.error('[Processor] Failed to log entity extraction error to DB:', dbError);
      }
    }

    // 5. Calculate importance score
    try {
      console.log(`[Processor] Calculating importance score for memory ${memoryId}`);
      const importanceScore = await scoreMemoryImportance(
        env.DB,
        env.AI,
        memory,
        {
          user_id: memory.user_id,
          current_date: new Date(),
          access_count: 0,
        }
      );

      // Update importance score in database
      await env.DB.prepare(
        'UPDATE memories SET importance_score = ?, updated_at = ? WHERE id = ?'
      ).bind(
        importanceScore.score,
        new Date().toISOString(),
        memoryId
      ).run();

      console.log(
        `[Processor] Importance score calculated for memory ${memoryId}: ${importanceScore.score.toFixed(3)} (content: ${importanceScore.factors.content.toFixed(2)}, recency: ${importanceScore.factors.recency.toFixed(2)}, entities: ${importanceScore.factors.entities.toFixed(2)})`
      );
    } catch (error) {
      console.error(`[Processor] Importance scoring failed for memory ${memoryId}:`, error);
      // Don't fail processing if importance scoring fails
    }

    // 6. Extract commitments (promises, deadlines, follow-ups)
    try {
      console.log(`[Processor] Extracting commitments for memory ${memoryId}`);
      const commitmentResult = await extractAndSaveCommitments(
        env.DB,
        env.AI,
        memory.user_id,
        memory.id,
        memory.content
      );

      if (commitmentResult.extraction_metadata.total_extracted > 0) {
        console.log(
          `[Processor] Extracted ${commitmentResult.extraction_metadata.total_extracted} commitments (${commitmentResult.extraction_metadata.high_confidence_count} high confidence) for memory ${memoryId}`
        );
      }
    } catch (error) {
      console.error(`[Processor] Commitment extraction failed for memory ${memoryId}:`, error);
      // Don't fail processing if commitment extraction fails
    }

    // 7. Invalidate profile cache (new facts extracted)
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
