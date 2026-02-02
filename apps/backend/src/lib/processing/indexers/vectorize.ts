/**
 * Vectorize Indexer
 *
 * Indexes embeddings into Cloudflare Vectorize.
 * Handles batch inserts and metadata storage.
 */

import type { ProcessingContext, IndexingResult } from '../types';
import { IndexingError } from '../types';

export class VectorizeIndexer {
  private readonly BATCH_SIZE = 100; // Vectorize batch limit

  async index(ctx: ProcessingContext): Promise<IndexingResult> {
    const { embeddingResult, chunkerResult, env, job } = ctx;

    if (!embeddingResult) {
      throw new IndexingError('No embedding result found in context', false);
    }

    if (!chunkerResult) {
      throw new IndexingError('No chunker result found in context', false);
    }

    const { chunks: embeddedChunks } = embeddingResult;
    const { chunks: originalChunks } = chunkerResult;

    try {
      const vectorIds: string[] = [];

      // Prepare vectors for insertion
      const vectors = embeddedChunks.map((embeddedChunk, index) => {
        const originalChunk = originalChunks[index];

        // Generate vector ID
        const vectorId = `${job.memoryId}:${embeddedChunk.id}`;

        return {
          id: vectorId,
          values: embeddedChunk.embedding,
          metadata: {
            memory_id: job.memoryId,
            chunk_id: embeddedChunk.id,
            user_id: job.userId,
            container_tag: job.containerTag,
            content: originalChunk.content,
            position: originalChunk.position,
            token_count: originalChunk.tokenCount,
            source: originalChunk.metadata?.source,
            title: originalChunk.metadata?.title,
            created_at: new Date().toISOString(),
          },
        };
      });

      // Insert in batches
      for (let i = 0; i < vectors.length; i += this.BATCH_SIZE) {
        const batch = vectors.slice(i, i + this.BATCH_SIZE);

        try {
          await env.VECTORIZE.upsert(batch);
          vectorIds.push(...batch.map((v) => v.id));
        } catch (error: any) {
          throw new IndexingError(
            `Batch insert failed at position ${i}: ${error.message}`,
            true
          );
        }
      }

      // Store chunk references in D1 for retrieval
      await this.storeChunkReferences(env.DB, job.memoryId, originalChunks, vectorIds);

      const result: IndexingResult = {
        vectorIds,
        indexedCount: vectorIds.length,
        timestamp: new Date().toISOString(),
      };

      return result;
    } catch (error: any) {
      if (error instanceof IndexingError) {
        throw error;
      }
      throw new IndexingError(
        `Indexing failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Store chunk references in D1 for lookup
   */
  private async storeChunkReferences(
    db: D1Database,
    memoryId: string,
    chunks: any[],
    vectorIds: string[]
  ): Promise<void> {
    // Create chunks table if not exists
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS memory_chunks (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          vector_id TEXT NOT NULL,
          content TEXT NOT NULL,
          position INTEGER NOT NULL,
          token_count INTEGER NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL
        )`
      )
      .run();

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vectorId = vectorIds[i];

      await db
        .prepare(
          `INSERT OR REPLACE INTO memory_chunks
           (id, memory_id, vector_id, content, position, token_count, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          chunk.id,
          memoryId,
          vectorId,
          chunk.content,
          chunk.position,
          chunk.tokenCount,
          JSON.stringify(chunk.metadata || {}),
          new Date().toISOString()
        )
        .run();
    }
  }
}
