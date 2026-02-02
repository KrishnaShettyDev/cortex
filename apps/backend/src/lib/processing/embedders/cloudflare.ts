/**
 * Cloudflare Embedder
 *
 * Generates embeddings using Cloudflare Workers AI.
 * Model: @cf/baai/bge-base-en-v1.5 (768 dimensions)
 */

import type { ProcessingContext, EmbeddingResult } from '../types';
import { EmbeddingError } from '../types';

export class CloudflareEmbedder {
  private readonly MODEL = '@cf/baai/bge-base-en-v1.5';
  private readonly BATCH_SIZE = 10; // Process embeddings in batches
  private readonly MAX_INPUT_LENGTH = 512; // Max tokens per input

  async embed(ctx: ProcessingContext): Promise<EmbeddingResult> {
    const { chunkerResult, env, job } = ctx;

    if (!chunkerResult) {
      throw new EmbeddingError('No chunker result found in context', false);
    }

    const { chunks } = chunkerResult;

    if (!chunks || chunks.length === 0) {
      throw new EmbeddingError('No chunks to embed', false);
    }

    try {
      const embeddedChunks: Array<{
        id: string;
        embedding: number[];
        model: string;
        tokenCount: number;
      }> = [];

      let totalTokensUsed = 0;

      // Process chunks in batches
      for (let i = 0; i < chunks.length; i += this.BATCH_SIZE) {
        const batch = chunks.slice(i, i + this.BATCH_SIZE);

        // Generate embeddings for batch
        const batchResults = await Promise.all(
          batch.map(async (chunk) => {
            // Truncate content if too long
            const content = this.truncateContent(chunk.content);
            const tokenCount = chunk.tokenCount;

            // Generate embedding
            const embedding = await this.generateEmbedding(env.AI, content);

            totalTokensUsed += tokenCount;

            return {
              id: chunk.id,
              embedding,
              model: this.MODEL,
              tokenCount,
            };
          })
        );

        embeddedChunks.push(...batchResults);

        // Update metrics
        job.metrics.apiCallCount += batch.length;
      }

      // Update job metrics
      job.metrics.embeddingTokensUsed = totalTokensUsed;

      return {
        chunks: embeddedChunks,
        totalTokensUsed,
        model: this.MODEL,
      };
    } catch (error: any) {
      if (error instanceof EmbeddingError) {
        throw error;
      }
      throw new EmbeddingError(
        `Embedding generation failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Generate embedding for single text
   */
  private async generateEmbedding(ai: any, text: string): Promise<number[]> {
    try {
      const response = await ai.run(this.MODEL, {
        text: [text], // Cloudflare AI expects array
      });

      // Extract embedding vector
      if (response.data && response.data.length > 0) {
        return response.data[0]; // First embedding
      }

      if (response.result && response.result.data) {
        return response.result.data[0];
      }

      // Fallback structure
      if (Array.isArray(response) && response.length > 0) {
        return response[0];
      }

      throw new Error('Invalid embedding response structure');
    } catch (error: any) {
      throw new EmbeddingError(
        `AI embedding failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Truncate content to max input length
   */
  private truncateContent(content: string): string {
    const words = content.split(/\s+/);
    const maxWords = Math.floor(this.MAX_INPUT_LENGTH * 0.75); // Approximate

    if (words.length <= maxWords) {
      return content;
    }

    return words.slice(0, maxWords).join(' ');
  }
}
