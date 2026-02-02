/**
 * Smart Chunker
 *
 * Intelligent content chunking with:
 * - Semantic boundaries (paragraphs, sentences)
 * - Token-aware splitting
 * - Overlap for context preservation
 * - Metadata preservation
 */

import { nanoid } from 'nanoid';
import type { ProcessingContext, ChunkerResult } from '../types';
import { ChunkerError } from '../types';

export interface ChunkerConfig {
  maxTokensPerChunk: number;
  overlapTokens: number;
  minChunkSize: number;
}

export class SmartChunker {
  private config: ChunkerConfig;

  constructor(config?: Partial<ChunkerConfig>) {
    this.config = {
      maxTokensPerChunk: config?.maxTokensPerChunk || 512,
      overlapTokens: config?.overlapTokens || 50,
      minChunkSize: config?.minChunkSize || 100,
    };
  }

  async chunk(ctx: ProcessingContext): Promise<ChunkerResult> {
    const { extractorResult } = ctx;

    if (!extractorResult) {
      throw new ChunkerError('No extractor result found in context', false);
    }

    const { content, contentType, metadata } = extractorResult;

    if (!content || content.trim().length === 0) {
      throw new ChunkerError('Content is empty', false);
    }

    try {
      // Choose chunking strategy based on content type
      const chunks = this.chunkByContentType(content, contentType, metadata);

      // Filter out chunks that are too small
      const validChunks = chunks.filter(
        (chunk) => chunk.tokenCount >= this.config.minChunkSize
      );

      if (validChunks.length === 0) {
        // If all chunks too small, return single chunk
        validChunks.push({
          id: nanoid(),
          content: content,
          position: 0,
          tokenCount: this.estimateTokens(content),
          metadata: {
            source: metadata.sourceUrl,
            title: metadata.title,
          },
        });
      }

      const totalChunks = validChunks.length;
      const averageChunkSize = Math.round(
        validChunks.reduce((sum, c) => sum + c.tokenCount, 0) / totalChunks
      );

      // Update job metrics
      ctx.job.metrics.chunkCount = totalChunks;
      ctx.job.metrics.averageChunkSize = averageChunkSize;

      return {
        chunks: validChunks,
        totalChunks,
        averageChunkSize,
      };
    } catch (error: any) {
      if (error instanceof ChunkerError) {
        throw error;
      }
      throw new ChunkerError(
        `Chunking failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Choose chunking strategy based on content type
   */
  private chunkByContentType(
    content: string,
    contentType: 'text' | 'html' | 'markdown',
    metadata: any
  ) {
    switch (contentType) {
      case 'markdown':
        return this.chunkMarkdown(content, metadata);
      case 'html':
        return this.chunkHTML(content, metadata);
      default:
        return this.chunkText(content, metadata);
    }
  }

  /**
   * Chunk plain text by paragraphs and sentences
   */
  private chunkText(content: string, metadata: any) {
    const chunks: Array<{
      id: string;
      content: string;
      position: number;
      tokenCount: number;
      metadata?: Record<string, any>;
    }> = [];

    // Split by paragraphs first
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

    let currentChunk = '';
    let currentTokens = 0;
    let position = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);

      // If single paragraph exceeds max, split by sentences
      if (paragraphTokens > this.config.maxTokensPerChunk) {
        // Save current chunk if exists
        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk, position++, metadata));
          currentChunk = '';
          currentTokens = 0;
        }

        // Split large paragraph by sentences
        const sentences = this.splitIntoSentences(paragraph);
        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokens(sentence);

          if (currentTokens + sentenceTokens > this.config.maxTokensPerChunk) {
            // Save current chunk
            if (currentChunk) {
              chunks.push(this.createChunk(currentChunk, position++, metadata));
            }

            // Start new chunk with overlap
            currentChunk = this.getOverlapText(currentChunk) + sentence;
            currentTokens = this.estimateTokens(currentChunk);
          } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
            currentTokens += sentenceTokens;
          }
        }
      } else {
        // Normal paragraph fits in chunk limits
        if (currentTokens + paragraphTokens > this.config.maxTokensPerChunk) {
          // Save current chunk
          chunks.push(this.createChunk(currentChunk, position++, metadata));

          // Start new chunk with overlap
          currentChunk = this.getOverlapText(currentChunk) + paragraph;
          currentTokens = this.estimateTokens(currentChunk);
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
          currentTokens += paragraphTokens;
        }
      }
    }

    // Save final chunk
    if (currentChunk.trim()) {
      chunks.push(this.createChunk(currentChunk, position, metadata));
    }

    return chunks;
  }

  /**
   * Chunk markdown by sections
   */
  private chunkMarkdown(content: string, metadata: any) {
    // Split by headers (# ## ###)
    const sections = content.split(/^(#{1,6}\s+.+)$/gm);

    const chunks: Array<{
      id: string;
      content: string;
      position: number;
      tokenCount: number;
      metadata?: Record<string, any>;
    }> = [];

    let currentSection = '';
    let position = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (!section) continue;

      const sectionTokens = this.estimateTokens(section);

      if (sectionTokens > this.config.maxTokensPerChunk) {
        // Section too large, use text chunking
        const textChunks = this.chunkText(section, metadata);
        chunks.push(...textChunks.map((c, idx) => ({ ...c, position: position + idx })));
        position += textChunks.length;
      } else {
        currentSection += (currentSection ? '\n\n' : '') + section;
        const currentTokens = this.estimateTokens(currentSection);

        if (currentTokens > this.config.maxTokensPerChunk) {
          // Save previous section
          const prevSection = currentSection.substring(0, currentSection.lastIndexOf(section));
          if (prevSection.trim()) {
            chunks.push(this.createChunk(prevSection, position++, metadata));
          }
          currentSection = section;
        }
      }
    }

    // Save final section
    if (currentSection.trim()) {
      chunks.push(this.createChunk(currentSection, position, metadata));
    }

    return chunks.length > 0 ? chunks : this.chunkText(content, metadata);
  }

  /**
   * Chunk HTML (fallback to text chunking after stripping tags)
   */
  private chunkHTML(content: string, metadata: any) {
    // Strip HTML tags for chunking
    const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return this.chunkText(textContent, metadata);
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting (can be enhanced with proper NLP)
    return text
      .split(/[.!?]+\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Get overlap text from end of previous chunk
   */
  private getOverlapText(text: string): string {
    if (!text) return '';

    const tokens = text.split(/\s+/);
    const overlapWords = Math.floor(this.config.overlapTokens * 0.75); // Approximate words from tokens

    if (tokens.length <= overlapWords) {
      return text + '\n\n';
    }

    return tokens.slice(-overlapWords).join(' ') + '\n\n';
  }

  /**
   * Create chunk object
   */
  private createChunk(content: string, position: number, metadata: any) {
    return {
      id: nanoid(),
      content: content.trim(),
      position,
      tokenCount: this.estimateTokens(content),
      metadata: {
        source: metadata.sourceUrl,
        title: metadata.title,
        author: metadata.author,
      },
    };
  }

  /**
   * Estimate token count (1 token ≈ 0.75 words)
   */
  private estimateTokens(text: string): number {
    const wordCount = text.trim().split(/\s+/).length;
    return Math.ceil(wordCount * 1.33);
  }
}
