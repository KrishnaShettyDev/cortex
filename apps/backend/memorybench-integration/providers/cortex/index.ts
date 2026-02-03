/**
 * Cortex Provider for MemoryBench
 *
 * Implements the MemoryBench Provider interface to benchmark Cortex's
 * memory infrastructure against industry standards (Supermemory, Mem0, Zep).
 */

import type {
  Provider,
  ProviderConfig,
  IngestOptions,
  IngestResult,
  SearchOptions,
  IndexingProgressCallback,
  UnifiedSession,
} from '../../types';

interface CortexConfig extends ProviderConfig {
  baseUrl?: string;
}

interface CortexMemory {
  id: string;
  content: string;
  user_id: string;
  container_tag: string;
  source: string;
  importance_score: number;
  memory_type: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  metadata?: Record<string, any>;
}

interface ProcessingJob {
  id: string;
  memory_id: string;
  status: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'indexing' |
          'temporal_extraction' | 'entity_extraction' | 'importance_scoring' |
          'commitment_extraction' | 'done' | 'failed';
  created_at: string;
  updated_at: string;
}

export class CortexProvider implements Provider {
  name = 'cortex';
  private apiKey: string = '';
  private baseUrl: string = 'https://askcortex.plutas.in';
  private userId: string = '';

  // Concurrency limits for parallel operations
  concurrency = {
    default: 50,
    ingest: 100,
    awaitIndexing: 200,
  };

  /**
   * Initialize Cortex client with API credentials
   */
  async initialize(config: CortexConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }

    // Extract userId from JWT or use a test userId
    // For benchmarking, we'll use a dedicated test user
    this.userId = 'benchmark-test-user';

    console.log(`[Cortex] Initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Ingest unified sessions into Cortex as memories
   *
   * Each session is converted to memories following the conversation flow.
   * Messages are stored with temporal metadata and linked via session IDs.
   */
  async ingest(
    sessions: UnifiedSession[],
    options: IngestOptions
  ): Promise<IngestResult> {
    const documentIds: string[] = [];
    const { containerTag, metadata: globalMetadata } = options;

    console.log(`[Cortex] Ingesting ${sessions.length} sessions into container: ${containerTag}`);

    for (const session of sessions) {
      try {
        // Convert session to memories (one memory per message or entire session)
        // Strategy: Create one memory for the entire session to preserve context
        const sessionContent = this.formatSessionAsMemory(session);

        const memory = await this.createMemory({
          content: sessionContent,
          containerTag,
          metadata: {
            sessionId: session.sessionId,
            messageCount: session.messages.length,
            sessionMetadata: session.metadata,
            globalMetadata,
          },
        });

        documentIds.push(memory.id);

        // Optional: Create individual memories for each message if needed for granular retrieval
        // This improves search precision but increases storage
        for (const message of session.messages) {
          const messageMemory = await this.createMemory({
            content: `${message.role}: ${message.content}`,
            containerTag,
            metadata: {
              sessionId: session.sessionId,
              messageId: `${session.sessionId}-${message.timestamp || Date.now()}`,
              role: message.role,
              speaker: message.speaker,
              timestamp: message.timestamp,
              parentMemoryId: memory.id,
            },
          });

          documentIds.push(messageMemory.id);
        }

      } catch (error) {
        console.error(`[Cortex] Failed to ingest session ${session.sessionId}:`, error);
        throw error;
      }
    }

    console.log(`[Cortex] Successfully ingested ${documentIds.length} memories`);

    return { documentIds };
  }

  /**
   * Wait for async indexing and processing to complete
   *
   * Cortex has an 8-stage processing pipeline:
   * queued → extracting → chunking → embedding → indexing →
   * temporal_extraction → entity_extraction → importance_scoring →
   * commitment_extraction → done
   */
  async awaitIndexing(
    result: IngestResult,
    containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    const { documentIds } = result;
    const completedIds = new Set<string>();
    const failedIds = new Set<string>();

    console.log(`[Cortex] Awaiting indexing for ${documentIds.length} documents`);

    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s intervals)
    let backoffMs = 1000; // Start with 1s

    while (completedIds.size + failedIds.size < documentIds.length && attempts < maxAttempts) {
      attempts++;

      // Check processing status for each document
      for (const memoryId of documentIds) {
        if (completedIds.has(memoryId) || failedIds.has(memoryId)) {
          continue;
        }

        try {
          const job = await this.getProcessingJob(memoryId);

          if (job.status === 'done') {
            completedIds.add(memoryId);
          } else if (job.status === 'failed') {
            failedIds.add(memoryId);
            console.warn(`[Cortex] Processing failed for memory ${memoryId}`);
          }
        } catch (error) {
          console.warn(`[Cortex] Failed to check status for ${memoryId}:`, error);
        }
      }

      // Report progress
      if (onProgress) {
        onProgress({
          completedIds: Array.from(completedIds),
          failedIds: Array.from(failedIds),
          total: documentIds.length,
        });
      }

      // Check if done
      if (completedIds.size + failedIds.size >= documentIds.length) {
        break;
      }

      // Exponential backoff (capped at 5s)
      await this.sleep(Math.min(backoffMs, 5000));
      backoffMs *= 1.2;
    }

    if (attempts >= maxAttempts) {
      throw new Error(
        `[Cortex] Indexing timeout: ${completedIds.size}/${documentIds.length} completed, ` +
        `${failedIds.size} failed after ${maxAttempts} attempts`
      );
    }

    console.log(
      `[Cortex] Indexing complete: ${completedIds.size} completed, ${failedIds.size} failed`
    );
  }

  /**
   * Search for relevant memories using Cortex's hybrid search
   *
   * Uses vector similarity + keyword search + reranking
   */
  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    const { containerTag, limit = 10, threshold = 0.3 } = options;

    console.log(`[Cortex] Searching in container ${containerTag}: "${query}"`);

    try {
      const response = await fetch(`${this.baseUrl}/v3/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          container_tag: containerTag,
          limit,
          threshold,
        }),
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const results = data.results || [];

      console.log(`[Cortex] Found ${results.length} results for query: "${query}"`);

      return results;
    } catch (error) {
      console.error(`[Cortex] Search error:`, error);
      return [];
    }
  }

  /**
   * Clear all memories in a container
   */
  async clear(containerTag: string): Promise<void> {
    console.log(`[Cortex] Clearing container: ${containerTag}`);

    try {
      // Get all memories in container
      const memories = await this.listMemories(containerTag);

      // Delete each memory
      for (const memory of memories) {
        await this.deleteMemory(memory.id);
      }

      console.log(`[Cortex] Cleared ${memories.length} memories from container ${containerTag}`);
    } catch (error) {
      console.error(`[Cortex] Clear error:`, error);
      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Format session as a single memory content string
   */
  private formatSessionAsMemory(session: UnifiedSession): string {
    const lines: string[] = [];

    // Add session header
    lines.push(`=== Session ${session.sessionId} ===`);
    if (session.metadata) {
      lines.push(`Metadata: ${JSON.stringify(session.metadata)}`);
    }
    lines.push('');

    // Add messages
    for (const message of session.messages) {
      const timestamp = message.timestamp ? `[${message.timestamp}] ` : '';
      const speaker = message.speaker ? `${message.speaker} (${message.role})` : message.role;
      lines.push(`${timestamp}${speaker}: ${message.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Create a memory via Cortex API
   */
  private async createMemory(params: {
    content: string;
    containerTag: string;
    metadata?: Record<string, any>;
  }): Promise<CortexMemory> {
    const response = await fetch(`${this.baseUrl}/v3/memories`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: params.content,
        container_tag: params.containerTag,
        metadata: params.metadata,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create memory: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.memory;
  }

  /**
   * Get processing job status for a memory
   */
  private async getProcessingJob(memoryId: string): Promise<ProcessingJob> {
    const response = await fetch(
      `${this.baseUrl}/v3/processing/jobs?memory_id=${memoryId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get processing job: ${response.status}`);
    }

    const data = await response.json();

    // Return the first (most recent) job for this memory
    if (data.jobs && data.jobs.length > 0) {
      return data.jobs[0];
    }

    throw new Error(`No processing job found for memory ${memoryId}`);
  }

  /**
   * List all memories in a container
   */
  private async listMemories(containerTag: string): Promise<CortexMemory[]> {
    const response = await fetch(
      `${this.baseUrl}/v3/memories?container_tag=${containerTag}&limit=1000`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to list memories: ${response.status}`);
    }

    const data = await response.json();
    return data.memories || [];
  }

  /**
   * Delete a memory by ID
   */
  private async deleteMemory(memoryId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v3/memories/${memoryId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete memory: ${response.status}`);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default CortexProvider;
