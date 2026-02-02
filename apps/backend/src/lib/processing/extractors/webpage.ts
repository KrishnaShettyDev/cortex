/**
 * Webpage Extractor
 *
 * Extracts clean content from web pages.
 * Handles HTML parsing, content cleaning, and metadata extraction.
 */

import { BaseExtractor } from './base';
import type { ProcessingContext, ExtractorResult } from '../types';
import { ExtractorError } from '../types';

export class WebpageExtractor extends BaseExtractor {
  supports(contentType: string): boolean {
    return [
      'text/html',
      'application/xhtml+xml',
    ].includes(contentType.toLowerCase());
  }

  async extract(ctx: ProcessingContext): Promise<ExtractorResult> {
    const { job, env } = ctx;

    try {
      // Get memory with URL
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

      const url = memory.source;
      if (!url) {
        throw new ExtractorError(
          'No source URL found for webpage extraction',
          false
        );
      }

      // Fetch webpage
      const html = await this.fetchWebpage(url);

      // Extract clean content
      const extractedContent = this.extractMainContent(html);

      // Extract metadata
      const metadata = this.extractMetadata(html);

      const cleanedContent = this.cleanText(extractedContent);
      const wordCount = this.countWords(cleanedContent);
      const tokenCount = this.countTokens(cleanedContent);

      const result: ExtractorResult = {
        content: cleanedContent,
        contentType: 'text',
        metadata: {
          title: metadata.title,
          author: metadata.author,
          sourceUrl: url,
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
        `Webpage extraction failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Fetch webpage content
   */
  private async fetchWebpage(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CortexBot/1.0 (Memory Assistant)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error: any) {
      throw new ExtractorError(
        `Failed to fetch webpage: ${error.message}`,
        true
      );
    }
  }

  /**
   * Extract main content from HTML
   * Simple content extraction - can be enhanced with proper HTML parser
   */
  private extractMainContent(html: string): string {
    // Remove scripts and styles
    let content = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

    // Try to find main content areas
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    } else {
      const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      if (articleMatch) {
        content = articleMatch[1];
      }
    }

    // Remove all HTML tags
    content = content.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    content = this.decodeHTMLEntities(content);

    // Clean up whitespace
    content = content
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return content;
  }

  /**
   * Extract metadata from HTML
   */
  private extractMetadata(html: string): { title?: string; author?: string } {
    const metadata: { title?: string; author?: string } = {};

    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      metadata.title = this.decodeHTMLEntities(titleMatch[1].trim());
    }

    // Try Open Graph title
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (ogTitleMatch) {
      metadata.title = this.decodeHTMLEntities(ogTitleMatch[1]);
    }

    // Extract author
    const authorMatch = html.match(/<meta\s+name="author"\s+content="([^"]+)"/i);
    if (authorMatch) {
      metadata.author = this.decodeHTMLEntities(authorMatch[1]);
    }

    // Try article:author
    const ogAuthorMatch = html.match(/<meta\s+property="article:author"\s+content="([^"]+)"/i);
    if (ogAuthorMatch) {
      metadata.author = this.decodeHTMLEntities(ogAuthorMatch[1]);
    }

    return metadata;
  }

  /**
   * Decode common HTML entities
   */
  private decodeHTMLEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[a-z]+;|&#\d+;/gi, (match) => {
      return entities[match.toLowerCase()] || match;
    });
  }
}
