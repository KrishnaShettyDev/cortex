/**
 * Text Extractor
 *
 * Handles plain text, markdown, and simple HTML content.
 * Basic extractor for text-based memories.
 */

import { BaseExtractor } from './base';
import type { ProcessingContext, ExtractorResult } from '../types';
import { ExtractorError } from '../types';

export class TextExtractor extends BaseExtractor {
  supports(contentType: string): boolean {
    return [
      'text/plain',
      'text/markdown',
      'text/html',
      'application/json',
    ].includes(contentType.toLowerCase());
  }

  async extract(ctx: ProcessingContext): Promise<ExtractorResult> {
    const { job, env } = ctx;

    try {
      // Get memory content from database
      const memory = await env.DB.prepare(
        'SELECT content, source FROM memories WHERE id = ?'
      )
        .bind(job.memoryId)
        .first<{ content: string; source?: string }>();

      if (!memory) {
        throw new ExtractorError(
          `Memory ${job.memoryId} not found`,
          false
        );
      }

      const content = memory.content;
      if (!content || content.trim().length === 0) {
        throw new ExtractorError(
          'Memory content is empty',
          false
        );
      }

      // Clean and normalize
      const cleanedContent = this.cleanText(content);

      // Detect content type
      const contentType = this.detectContentType(cleanedContent);

      // Extract metadata
      const wordCount = this.countWords(cleanedContent);
      const tokenCount = this.countTokens(cleanedContent);

      const result: ExtractorResult = {
        content: cleanedContent,
        contentType,
        metadata: {
          sourceUrl: memory.source,
          wordCount,
          tokenCount,
        },
      };

      // Update job metrics
      job.metrics.wordCount = wordCount;
      job.metrics.tokenCount = tokenCount;

      return result;
    } catch (error: any) {
      if (error instanceof ExtractorError) {
        throw error;
      }
      throw new ExtractorError(
        `Text extraction failed: ${error.message}`,
        true
      );
    }
  }
}
