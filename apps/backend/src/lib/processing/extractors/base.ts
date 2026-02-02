/**
 * Base Extractor Interface
 *
 * All extractors implement this interface for consistent pipeline integration.
 */

import type { ProcessingContext, ExtractorResult } from '../types';

export interface IExtractor {
  /**
   * Extract content from source
   */
  extract(ctx: ProcessingContext): Promise<ExtractorResult>;

  /**
   * Check if this extractor supports the given content type
   */
  supports(contentType: string): boolean;
}

/**
 * Base extractor with common utilities
 */
export abstract class BaseExtractor implements IExtractor {
  abstract extract(ctx: ProcessingContext): Promise<ExtractorResult>;
  abstract supports(contentType: string): boolean;

  /**
   * Count tokens (approximation: 1 token ≈ 0.75 words)
   */
  protected countTokens(text: string): number {
    const wordCount = this.countWords(text);
    return Math.ceil(wordCount * 1.33);
  }

  /**
   * Count words
   */
  protected countWords(text: string): number {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Clean and normalize text
   */
  protected cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
      .replace(/[ \t]+/g, ' ') // Normalize spaces
      .trim();
  }

  /**
   * Detect content type from metadata
   */
  protected detectContentType(content: string): 'text' | 'html' | 'markdown' {
    // Simple heuristics
    if (content.includes('<html') || content.includes('<body') || content.includes('<div')) {
      return 'html';
    }
    if (content.includes('```') || /^#{1,6}\s/.test(content) || /\[.*\]\(.*\)/.test(content)) {
      return 'markdown';
    }
    return 'text';
  }
}
