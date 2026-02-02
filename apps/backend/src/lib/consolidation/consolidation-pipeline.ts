/**
 * Consolidation Pipeline
 *
 * End-to-end orchestration for memory consolidation:
 * 1. Find consolidation candidates (low-importance episodic memories)
 * 2. Cluster memories by similarity
 * 3. Extract semantic facts from clusters
 * 4. Create semantic memories
 * 5. Archive source episodic memories
 * 6. Update importance scores
 */

import { nanoid } from 'nanoid';
import {  MemoryClusterer, type Memory, type MemoryCluster, type ClusteringContext } from './clustering';
import { SemanticFactExtractor, estimateFactImportance, type SemanticFact } from './semantic-extractor';
import { createMemory, forgetMemory } from '../db/memories';

export interface ConsolidationOptions {
  userId: string;
  containerTag?: string;
  strategy?: 'temporal' | 'entity' | 'semantic' | 'hybrid';
  importanceThreshold?: number; // Default: 0.3
  minAgeDays?: number; // Default: 30
  minClusterSize?: number; // Default: 3
  dryRun?: boolean; // If true, return preview without making changes
}

export interface ConsolidationResult {
  success: boolean;
  memories_analyzed: number;
  clusters_formed: number;
  semantic_facts_created: number;
  memories_consolidated: number;
  memories_archived: number;
  processing_time_ms: number;
  semantic_memories: Array<{
    id: string;
    content: string;
    fact_type: string;
    supporting_memory_ids: string[];
  }>;
  errors: string[];
}

export interface ConsolidationContext {
  db: D1Database;
  ai: any;
  vectorize?: any;
  userId: string;
  containerTag: string;
}

export class ConsolidationPipeline {
  private context: ConsolidationContext;
  private options: Required<ConsolidationOptions>;

  constructor(context: ConsolidationContext, options: ConsolidationOptions) {
    this.context = context;
    this.options = {
      userId: options.userId,
      containerTag: options.containerTag || 'default',
      strategy: options.strategy || 'hybrid',
      importanceThreshold: options.importanceThreshold || 0.3,
      minAgeDays: options.minAgeDays || 30,
      minClusterSize: options.minClusterSize || 3,
      dryRun: options.dryRun || false,
    };
  }

  /**
   * Run the full consolidation pipeline
   */
  async run(): Promise<ConsolidationResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`[Consolidation] Starting for user ${this.options.userId}`);
    console.log(`[Consolidation] Strategy: ${this.options.strategy}, Threshold: ${this.options.importanceThreshold}`);

    try {
      // Step 1: Find consolidation candidates
      const candidates = await this.findCandidates();
      console.log(`[Consolidation] Found ${candidates.length} consolidation candidates`);

      if (candidates.length === 0) {
        return {
          success: true,
          memories_analyzed: 0,
          clusters_formed: 0,
          semantic_facts_created: 0,
          memories_consolidated: 0,
          memories_archived: 0,
          processing_time_ms: Date.now() - startTime,
          semantic_memories: [],
          errors: [],
        };
      }

      // Step 2: Cluster memories
      const clusters = await this.clusterMemories(candidates);
      console.log(`[Consolidation] Formed ${clusters.length} clusters`);

      // Filter clusters by minimum size and coherence
      const validClusters = clusters.filter(
        c => c.cluster_size >= this.options.minClusterSize && c.coherence_score >= 0.6
      );
      console.log(`[Consolidation] ${validClusters.length} clusters meet quality criteria`);

      if (validClusters.length === 0) {
        return {
          success: true,
          memories_analyzed: candidates.length,
          clusters_formed: clusters.length,
          semantic_facts_created: 0,
          memories_consolidated: 0,
          memories_archived: 0,
          processing_time_ms: Date.now() - startTime,
          semantic_memories: [],
          errors: ['No valid clusters formed'],
        };
      }

      // Step 3: Extract semantic facts
      const facts = await this.extractFacts(validClusters);
      console.log(`[Consolidation] Extracted ${facts.length} semantic facts`);

      if (this.options.dryRun) {
        // Dry run: return preview without making changes
        return {
          success: true,
          memories_analyzed: candidates.length,
          clusters_formed: validClusters.length,
          semantic_facts_created: facts.length,
          memories_consolidated: this.countAffectedMemories(validClusters),
          memories_archived: 0,
          processing_time_ms: Date.now() - startTime,
          semantic_memories: facts.map(f => ({
            id: f.id,
            content: f.content,
            fact_type: f.fact_type,
            supporting_memory_ids: f.supporting_memory_ids,
          })),
          errors: [],
        };
      }

      // Step 4: Create semantic memories
      const semanticMemories = await this.createSemanticMemories(facts, validClusters);
      console.log(`[Consolidation] Created ${semanticMemories.length} semantic memories`);

      // Step 5: Archive source memories
      const archivedCount = await this.archiveSourceMemories(validClusters);
      console.log(`[Consolidation] Archived ${archivedCount} episodic memories`);

      // Step 6: Recompute importance (optional, expensive)
      // await this.recomputeImportance();

      return {
        success: true,
        memories_analyzed: candidates.length,
        clusters_formed: validClusters.length,
        semantic_facts_created: facts.length,
        memories_consolidated: this.countAffectedMemories(validClusters),
        memories_archived: archivedCount,
        processing_time_ms: Date.now() - startTime,
        semantic_memories: semanticMemories.map(m => ({
          id: m.id,
          content: m.content,
          fact_type: m.memory_type,
          supporting_memory_ids: m.metadata?.supporting_memory_ids || [],
        })),
        errors,
      };
    } catch (error: any) {
      console.error('[Consolidation] Pipeline failed:', error);
      return {
        success: false,
        memories_analyzed: 0,
        clusters_formed: 0,
        semantic_facts_created: 0,
        memories_consolidated: 0,
        memories_archived: 0,
        processing_time_ms: Date.now() - startTime,
        semantic_memories: [],
        errors: [error.message],
      };
    }
  }

  /**
   * Step 1: Find consolidation candidates
   * Query: episodic, importance < threshold, age > minAgeDays
   */
  private async findCandidates(): Promise<Memory[]> {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - this.options.minAgeDays);

    const result = await this.context.db.prepare(`
      SELECT *
      FROM memories
      WHERE user_id = ?
        AND container_tag = ?
        AND memory_type = 'episodic'
        AND importance_score < ?
        AND created_at < ?
        AND is_forgotten = 0
      ORDER BY created_at DESC
      LIMIT 500
    `).bind(
      this.options.userId,
      this.options.containerTag,
      this.options.importanceThreshold,
      minDate.toISOString()
    ).all();

    return result.results as Memory[];
  }

  /**
   * Step 2: Cluster memories using selected strategy
   */
  private async clusterMemories(memories: Memory[]): Promise<MemoryCluster[]> {
    const clusteringContext: ClusteringContext = {
      db: this.context.db,
      ai: this.context.ai,
      vectorize: this.context.vectorize,
    };

    const clusterer = new MemoryClusterer();
    return await clusterer.cluster(memories, clusteringContext, this.options.strategy);
  }

  /**
   * Step 3: Extract semantic facts from clusters
   */
  private async extractFacts(clusters: MemoryCluster[]): Promise<SemanticFact[]> {
    const extractor = new SemanticFactExtractor({
      ai: this.context.ai,
      db: this.context.db,
      userId: this.options.userId,
      containerTag: this.options.containerTag,
    });

    return await extractor.extractFromClusters(clusters);
  }

  /**
   * Step 4: Create semantic memories from facts
   */
  private async createSemanticMemories(
    facts: SemanticFact[],
    clusters: MemoryCluster[]
  ): Promise<any[]> {
    const memories: any[] = [];

    for (const fact of facts) {
      try {
        // Find cluster this fact came from
        const cluster = clusters.find(c =>
          c.memories.some(m => fact.supporting_memory_ids.includes(m.id))
        );

        // Estimate importance
        const importance = cluster
          ? estimateFactImportance(fact, cluster)
          : fact.importance_estimate;

        // Create semantic memory
        const memory = await createMemory(this.context.db, {
          userId: this.options.userId,
          containerTag: this.options.containerTag,
          content: fact.content,
          source: 'consolidation',
          metadata: {
            fact_type: fact.fact_type,
            supporting_memory_ids: fact.supporting_memory_ids,
            entities: fact.entities_mentioned,
            confidence: fact.confidence,
            cluster_id: cluster?.id,
          },
        });

        // Set as semantic memory with calculated importance
        await this.context.db.prepare(`
          UPDATE memories
          SET memory_type = 'semantic',
              importance_score = ?,
              updated_at = ?
          WHERE id = ?
        `).bind(
          importance,
          new Date().toISOString(),
          memory.id
        ).run();

        memories.push(memory);

        console.log(`[Consolidation] Created semantic memory: "${fact.content.substring(0, 80)}..."`);
      } catch (error) {
        console.error(`[Consolidation] Failed to create semantic memory:`, error);
      }
    }

    return memories;
  }

  /**
   * Step 5: Archive source episodic memories
   * Sets is_forgotten = 1 for all memories in consolidated clusters
   */
  private async archiveSourceMemories(clusters: MemoryCluster[]): Promise<number> {
    let archivedCount = 0;

    for (const cluster of clusters) {
      for (const memory of cluster.memories) {
        try {
          await forgetMemory(this.context.db, memory.id);
          archivedCount++;
        } catch (error) {
          console.error(`[Consolidation] Failed to archive memory ${memory.id}:`, error);
        }
      }
    }

    return archivedCount;
  }

  /**
   * Step 6: Recompute importance scores for all memories
   * (Optional - expensive operation)
   */
  private async recomputeImportance(): Promise<void> {
    // This would recalculate importance for all user memories
    // to reflect the new context after consolidation
    // Skipped for now due to performance cost
    console.log('[Consolidation] Skipping importance recomputation (performance optimization)');
  }

  /**
   * Count total memories affected by consolidation
   */
  private countAffectedMemories(clusters: MemoryCluster[]): number {
    return clusters.reduce((sum, cluster) => sum + cluster.cluster_size, 0);
  }
}

/**
 * Get consolidation statistics (candidates available)
 */
export async function getConsolidationStats(
  db: D1Database,
  userId: string,
  containerTag: string = 'default'
): Promise<{
  total_memories: number;
  episodic_count: number;
  semantic_count: number;
  low_importance_count: number;
  consolidation_candidates: number;
  avg_importance: number;
}> {
  // Total memories
  const totalResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM memories
    WHERE user_id = ? AND container_tag = ? AND is_forgotten = 0
  `).bind(userId, containerTag).first<{ count: number }>();

  // Memory type breakdown
  const episodicResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM memories
    WHERE user_id = ? AND container_tag = ? AND memory_type = 'episodic' AND is_forgotten = 0
  `).bind(userId, containerTag).first<{ count: number }>();

  const semanticResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM memories
    WHERE user_id = ? AND container_tag = ? AND memory_type = 'semantic' AND is_forgotten = 0
  `).bind(userId, containerTag).first<{ count: number }>();

  // Low importance memories
  const lowImportanceResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM memories
    WHERE user_id = ? AND container_tag = ? AND importance_score < 0.3 AND is_forgotten = 0
  `).bind(userId, containerTag).first<{ count: number }>();

  // Consolidation candidates (episodic, low importance, 30+ days old)
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 30);

  const candidatesResult = await db.prepare(`
    SELECT COUNT(*) as count
    FROM memories
    WHERE user_id = ?
      AND container_tag = ?
      AND memory_type = 'episodic'
      AND importance_score < 0.3
      AND created_at < ?
      AND is_forgotten = 0
  `).bind(userId, containerTag, minDate.toISOString()).first<{ count: number }>();

  // Average importance
  const avgImportanceResult = await db.prepare(`
    SELECT AVG(importance_score) as avg
    FROM memories
    WHERE user_id = ? AND container_tag = ? AND is_forgotten = 0
  `).bind(userId, containerTag).first<{ avg: number }>();

  return {
    total_memories: totalResult?.count || 0,
    episodic_count: episodicResult?.count || 0,
    semantic_count: semanticResult?.count || 0,
    low_importance_count: lowImportanceResult?.count || 0,
    consolidation_candidates: candidatesResult?.count || 0,
    avg_importance: avgImportanceResult?.avg || 0,
  };
}
