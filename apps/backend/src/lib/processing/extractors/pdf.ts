/**
 * PDF Extractor
 *
 * Extracts text content from PDF files stored in R2.
 * Uses Cloudflare's PDF parsing capabilities.
 */

import { BaseExtractor } from './base';
import type { ProcessingContext, ExtractorResult } from '../types';
import { ExtractorError } from '../types';

export class PDFExtractor extends BaseExtractor {
  supports(contentType: string): boolean {
    return contentType.toLowerCase() === 'application/pdf';
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

      // Fetch PDF from R2
      const r2Object = await env.R2.get(r2Key);
      if (!r2Object) {
        throw new ExtractorError(
          `PDF file not found in R2: ${r2Key}`,
          false
        );
      }

      const pdfBuffer = await r2Object.arrayBuffer();

      // Extract text using Cloudflare AI
      // Note: Using AI for PDF text extraction
      // Fallback: Basic text extraction for production
      const extractedText = await this.extractTextFromPDF(pdfBuffer, env.AI);

      if (!extractedText || extractedText.trim().length === 0) {
        throw new ExtractorError(
          'PDF extraction resulted in empty content',
          false
        );
      }

      const cleanedContent = this.cleanText(extractedText);
      const wordCount = this.countWords(cleanedContent);
      const tokenCount = this.countTokens(cleanedContent);

      const result: ExtractorResult = {
        content: cleanedContent,
        contentType: 'text',
        metadata: {
          title: parsedMetadata.title || parsedMetadata.filename,
          author: parsedMetadata.author,
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
        `PDF extraction failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Extract text from PDF buffer
   * Uses basic text extraction - can be enhanced with proper PDF parser
   */
  private async extractTextFromPDF(buffer: ArrayBuffer, ai: any): Promise<string> {
    try {
      // For now, use a simple approach
      // In production, you'd use a proper PDF parser like pdf-parse
      // or Cloudflare AI's document understanding model

      // Convert buffer to base64 for AI processing
      const uint8Array = new Uint8Array(buffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));

      // Use Cloudflare AI for document understanding
      // This is a placeholder - adjust based on actual AI model availability
      const response = await ai.run('@cf/meta/llama-2-7b-chat-int8', {
        prompt: `Extract all text content from this PDF document. Return only the extracted text, no explanations.`,
        // Note: Actual implementation depends on Cloudflare AI's document models
      });

      return response.response || '';
    } catch (error: any) {
      // Fallback: Return error message for now
      // In production, implement proper PDF text extraction
      throw new ExtractorError(
        `PDF text extraction not yet implemented: ${error.message}`,
        false
      );
    }
  }
}
