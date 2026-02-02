/**
 * Decay Manager
 *
 * Implements brain-inspired memory decay and consolidation:
 * - Apply decay to importance scores based on time and access
 * - Consolidate low-importance episodic memories into semantic facts
 * - Archive very low importance memories
 *
 * Inspired by human memory consolidation (sleep → long-term storage)
 */

import type { DecayStats, MemoryCluster, ConsolidationResult } from './types';
import { ConsolidationError } from './types';
import type { Memory } from '../db/memories';
import { ImportanceScorer } from './importance-scorer';
import { generateEmbedding } from '../vectorize';

export class DecayManager {
  private db: D1Database;
  private ai: any;

  // Decay parameters
  private static readonly DECAY_RATE = 0.1; // 10% per month if not accessed
  private static readonly MIN_IMPORTANCE = 0.15; // Below this = candidate for archival
  private static readonly CONSOLIDATION_THRESHOLD = 0.3; // Below this = candidate for consolidation
  private static readonly CONSOLIDATION_MIN_AGE_DAYS = 30; // Must be 30+ days old
  private static readonly MIN_CLUSTER_SIZE = 3; // Need 3+ memories to consolidate

  constructor(db: D1Database, ai: any) {
    this.db = db;
    this.ai = ai;
  }

  /**
   * Run decay cycle for a user
   */
  async runDecayCycle(userId: string): Promise<DecayStats> {
    const startTime = Date.now();

    console.log(`[DecayManager] Starting decay cycle for user ${userId}`);

    try {
      // Step 1: Update importance scores based on time decay
      const scored = await this.applyDecay(userId);

      // Step 2: Consolidate low-importance episodic memories
      const consolidationResult = await this.consolidateMemories(userId);

      // Step 3: Archive very low importance memories
      const archived = await this.archiveMemories(userId);

      const stats: DecayStats = {
        memories_scored: scored,
        memories_consolidated: consolidationResult.consolidated_count,
        memories_archived: archived,
        semantic_facts_created: consolidationResult.semantic_memory_id ? 1 : 0,
        processing_time_ms: Date.now() - startTime,
      };

      console.log(`[DecayManager] Decay cycle complete:`, stats);

      return stats;
    } catch (error: any) {
      console.error('[DecayManager] Decay cycle failed:', error);
      throw new ConsolidationError(
        `Decay cycle failed: ${error.message}`,
        true,
        { user_id: userId }
      );
    }
  }

  /**
   * Apply time-based decay to importance scores
   */
  private async applyDecay(userId: string): Promise<number> {
    // Get all active memories for user
    const memories = await this.db
      .prepare(
        `SELECT id, importance_score, created_at, updated_at
         FROM memories
         WHERE user_id = ?
           AND valid_to IS NULL
           AND is_forgotten = 0
         ORDER BY created_at DESC
         LIMIT 500`
      )
      .bind(userId)
      .all<{
        id: string;
        importance_score: number;
        created_at: string;
        updated_at: string;
      }>();

    if (!memories.results || memories.results.length === 0) {
      return 0;
    }

    let scoredCount = 0;
    const now = new Date();

    for (const memory of memories.results) {
      // Calculate decay based on time since last update
      const lastUpdate = new Date(memory.updated_at);
      const daysSinceUpdate =
        (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
      const monthsSinceUpdate = daysSinceUpdate / 30;

      // Apply exponential decay
      const decayFactor = Math.pow(
        1 - DecayManager.DECAY_RATE,
        monthsSinceUpdate
      );
      const newScore = Math.max(
        DecayManager.MIN_IMPORTANCE,
        (memory.importance_score || 0.5) * decayFactor
      );

      // Update if score changed significantly
      if (Math.abs(newScore - (memory.importance_score || 0.5)) > 0.05) {
        await this.db
          .prepare(
            'UPDATE memories SET importance_score = ?, updated_at = ? WHERE id = ?'
          )
          .bind(newScore, now.toISOString(), memory.id)
          .run();

        scoredCount++;
      }
    }

    return scoredCount;
  }

  /**
   * Consolidate low-importance episodic memories into semantic facts
   */
  private async consolidateMemories(
    userId: string
  ): Promise<ConsolidationResult> {
    // Get consolidation candidates
    const candidates = await this.db
      .prepare(
        `SELECT id, content, event_date, importance_score, created_at
         FROM memories
         WHERE user_id = ?
           AND memory_type = 'episodic'
           AND importance_score < ?
           AND valid_to IS NULL
           AND is_forgotten = 0
           AND datetime(created_at) < datetime('now', '-${DecayManager.CONSOLIDATION_MIN_AGE_DAYS} days')
         ORDER BY event_date
         LIMIT 50`
      )
      .bind(userId, DecayManager.CONSOLIDATION_THRESHOLD)
      .all<Memory>();

    if (
      !candidates.results ||
      candidates.results.length < DecayManager.MIN_CLUSTER_SIZE
    ) {
      return {
        semantic_memory_id: null,
        consolidated_count: 0,
        archived_memory_ids: [],
        semantic_facts: null,
      };
    }

    console.log(
      `[DecayManager] Found ${candidates.results.length} consolidation candidates`
    );

    // Cluster similar memories
    const clusters = await this.clusterMemories(candidates.results);

    // Find best cluster for consolidation
    const bestCluster = clusters.find(
      (c) =>
        c.should_consolidate && c.memories.length >= DecayManager.MIN_CLUSTER_SIZE
    );

    if (!bestCluster) {
      return {
        semantic_memory_id: null,
        consolidated_count: 0,
        archived_memory_ids: [],
        semantic_facts: null,
      };
    }

    // Extract semantic facts from cluster
    const semanticFacts = await this.extractSemanticFacts(bestCluster.memories);

    if (!semanticFacts) {
      return {
        semantic_memory_id: null,
        consolidated_count: 0,
        archived_memory_ids: [],
        semantic_facts: null,
      };
    }

    // Create semantic memory
    const semanticMemoryId = await this.createSemanticMemory(
      userId,
      semanticFacts
    );

    // Archive original episodic memories
    const archivedIds = await this.archiveMemoryCluster(
      bestCluster.memories.map((m) => m.id)
    );

    return {
      semantic_memory_id: semanticMemoryId,
      consolidated_count: archivedIds.length,
      archived_memory_ids: archivedIds,
      semantic_facts: semanticFacts,
    };
  }

  /**
   * Cluster memories by semantic similarity
   */
  private async clusterMemories(
    memories: Memory[]
  ): Promise<MemoryCluster[]> {
    // Simple clustering: group by temporal proximity and semantic similarity
    // For production, use proper clustering (k-means, DBSCAN)

    const clusters: MemoryCluster[] = [];

    // Sort by event date
    const sorted = memories.sort((a, b) => {
      const dateA = a.event_date ? new Date(a.event_date).getTime() : 0;
      const dateB = b.event_date ? new Date(b.event_date).getTime() : 0;
      return dateA - dateB;
    });

    // Group by 7-day windows
    let currentCluster: Memory[] = [];
    let lastDate: Date | null = null;

    for (const memory of sorted) {
      const eventDate = memory.event_date ? new Date(memory.event_date) : null;

      if (!eventDate) {
        // No event date, add to current cluster
        currentCluster.push(memory);
        continue;
      }

      if (!lastDate) {
        currentCluster.push(memory);
        lastDate = eventDate;
        continue;
      }

      const daysDiff =
        (eventDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 7) {
        // Same cluster (within 7 days)
        currentCluster.push(memory);
      } else {
        // New cluster
        if (currentCluster.length >= DecayManager.MIN_CLUSTER_SIZE) {
          clusters.push({
            cluster_id: clusters.length,
            memories: currentCluster.map((m) => ({
              id: m.id,
              content: m.content,
              event_date: m.event_date,
              importance_score: m.importance_score || 0.3,
            })),
            semantic_theme: null, // Will be filled by LLM
            should_consolidate: true,
          });
        }
        currentCluster = [memory];
        lastDate = eventDate;
      }
    }

    // Add last cluster
    if (currentCluster.length >= DecayManager.MIN_CLUSTER_SIZE) {
      clusters.push({
        cluster_id: clusters.length,
        memories: currentCluster.map((m) => ({
          id: m.id,
          content: m.content,
          event_date: m.event_date,
          importance_score: m.importance_score || 0.3,
        })),
        semantic_theme: null,
        should_consolidate: true,
      });
    }

    return clusters;
  }

  /**
   * Extract semantic facts from episodic memory cluster
   */
  private async extractSemanticFacts(
    memories: Array<{ content: string; event_date: string | null }>
  ): Promise<string | null> {
    try {
      const prompt = `These episodic memories are being consolidated into semantic facts.

EPISODIC MEMORIES:
${memories.map((m, i) => `${i + 1}. ${m.content} ${m.event_date ? `(${m.event_date})` : ''}`).join('\n')}

Extract any lasting SEMANTIC facts worth preserving:
- Patterns of behavior (e.g., "User frequently meets Sarah for coffee")
- Preferences that emerged (e.g., "User prefers morning meetings")
- Relationships that developed (e.g., "User works closely with the design team")
- Skills or knowledge acquired (e.g., "User is learning Spanish")

IMPORTANT:
- Return ONLY high-level facts, not specific events
- Focus on patterns and generalizations
- Keep it concise (2-3 sentences max)
- If nothing valuable to preserve, return "null"

Extract semantic facts:`;

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 200,
      });

      const result = response.response.trim();

      // Check if LLM returned null or empty
      if (
        !result ||
        result.toLowerCase() === 'null' ||
        result.toLowerCase() === 'none' ||
        result.length < 10
      ) {
        return null;
      }

      return result;
    } catch (error) {
      console.error('[DecayManager] Semantic extraction failed:', error);
      return null;
    }
  }

  /**
   * Create semantic memory from extracted facts
   */
  private async createSemanticMemory(
    userId: string,
    semanticFacts: string
  ): Promise<string> {
    const id = `semantic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO memories (
          id, user_id, content, source, version, is_latest,
          parent_memory_id, root_memory_id, container_tag,
          processing_status, processing_error, is_forgotten, forget_after,
          valid_from, valid_to, event_date, supersedes, superseded_by,
          memory_type, importance_score, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId,
        semanticFacts,
        'consolidation',
        1,
        1,
        null,
        null,
        'default',
        'done',
        null,
        0,
        null,
        now,
        null,
        null,
        null,
        null,
        'semantic',
        0.6, // Semantic facts have medium importance
        now,
        now
      )
      .run();

    console.log(`[DecayManager] Created semantic memory: ${id}`);

    return id;
  }

  /**
   * Archive memory cluster (soft delete)
   */
  private async archiveMemoryCluster(memoryIds: string[]): Promise<string[]> {
    const archived: string[] = [];

    for (const memoryId of memoryIds) {
      try {
        await this.db
          .prepare(
            'UPDATE memories SET is_forgotten = 1, updated_at = ? WHERE id = ?'
          )
          .bind(new Date().toISOString(), memoryId)
          .run();

        archived.push(memoryId);
      } catch (error) {
        console.error(
          `[DecayManager] Failed to archive memory ${memoryId}:`,
          error
        );
      }
    }

    return archived;
  }

  /**
   * Archive very low importance memories
   */
  private async archiveMemories(userId: string): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE memories
         SET is_forgotten = 1,
             updated_at = ?
         WHERE user_id = ?
           AND importance_score < ?
           AND valid_to IS NULL
           AND is_forgotten = 0
           AND datetime(created_at) < datetime('now', '-90 days')`
      )
      .bind(
        new Date().toISOString(),
        userId,
        DecayManager.MIN_IMPORTANCE
      )
      .run();

    return result.meta?.changes || 0;
  }
}

/**
 * Helper function to run decay cycle
 */
export async function runMemoryDecay(
  db: D1Database,
  ai: any,
  userId: string
): Promise<DecayStats> {
  const manager = new DecayManager(db, ai);
  return manager.runDecayCycle(userId);
}
