/**
 * Image Extractor
 *
 * Extracts text and content from images using Cloudflare AI Vision.
 * Supports OCR and image captioning.
 */

import { BaseExtractor } from './base';
import type { ProcessingContext, ExtractorResult } from '../types';
import { ExtractorError } from '../types';

export class ImageExtractor extends BaseExtractor {
  supports(contentType: string): boolean {
    return [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
    ].includes(contentType.toLowerCase());
  }

  async extract(ctx: ProcessingContext): Promise<ExtractorResult> {
    const { job, env } = ctx;

    try {
      // Get memory with R2 file reference
      const memory = await env.DB.prepare(
        'SELECT content, source, metadata FROM memories WHERE id = ?'
      )
        .bind(job.memoryId)
        .first<{ content: string; source?: string; metadata?: string }>();

      if (!memory) {
        throw new ExtractorError(
          `Memory ${job.memoryId} not found`,
          false
        );
      }

      const parsedMetadata = memory.metadata ? JSON.parse(memory.metadata) : {};
      const r2Key = parsedMetadata.r2_key || parsedMetadata.file_key;

      if (!r2Key) {
        throw new ExtractorError(
          'No R2 key found in memory metadata',
          false
        );
      }

      // Fetch image from R2
      const r2Object = await env.R2.get(r2Key);
      if (!r2Object) {
        throw new ExtractorError(
          `Image file not found in R2: ${r2Key}`,
          false
        );
      }

      const imageBuffer = await r2Object.arrayBuffer();

      // Extract text using Cloudflare AI Vision
      const extractedContent = await this.extractFromImage(imageBuffer, env.AI);

      if (!extractedContent || extractedContent.trim().length === 0) {
        // If no text extracted, generate image description
        const description = await this.generateImageDescription(imageBuffer, env.AI);
        extractedContent = description;
      }

      const cleanedContent = this.cleanText(extractedContent);
      const wordCount = this.countWords(cleanedContent);
      const tokenCount = this.countTokens(cleanedContent);

      const result: ExtractorResult = {
        content: cleanedContent,
        contentType: 'text',
        metadata: {
          title: parsedMetadata.title || parsedMetadata.filename,
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
        `Image extraction failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Extract text from image using OCR
   */
  private async extractFromImage(buffer: ArrayBuffer, ai: any): Promise<string> {
    try {
      // Convert to base64 for Cloudflare AI
      const uint8Array = new Uint8Array(buffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));

      // Use Cloudflare AI Vision model for OCR
      // Model: @cf/unum/uform-gen2-qwen-500m (image-to-text)
      const response = await ai.run('@cf/unum/uform-gen2-qwen-500m', {
        image: Array.from(uint8Array),
        prompt: 'Extract all visible text from this image. If there is no text, describe what you see.',
        max_tokens: 512,
      });

      return response.description || response.text || '';
    } catch (error: any) {
      console.error('[ImageExtractor] OCR failed:', error);
      return '';
    }
  }

  /**
   * Generate description of image content
   */
  private async generateImageDescription(buffer: ArrayBuffer, ai: any): Promise<string> {
    try {
      const uint8Array = new Uint8Array(buffer);

      // Use Cloudflare AI Vision for image captioning
      const response = await ai.run('@cf/unum/uform-gen2-qwen-500m', {
        image: Array.from(uint8Array),
        prompt: 'Describe this image in detail. What objects, text, or content is visible?',
        max_tokens: 256,
      });

      return response.description || 'Image content could not be described.';
    } catch (error: any) {
      console.error('[ImageExtractor] Description failed:', error);
      return 'Image uploaded but content extraction failed.';
    }
  }
}
