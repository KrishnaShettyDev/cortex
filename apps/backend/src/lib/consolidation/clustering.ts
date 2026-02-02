/**
 * Advanced Memory Clustering
 *
 * Multi-strategy clustering for consolidation:
 * 1. Temporal clustering (7-day windows)
 * 2. Entity-based clustering (shared entities)
 * 3. Semantic clustering (embedding similarity)
 * 4. Hybrid clustering (combination of all)
 */

import { nanoid } from 'nanoid';

export interface Memory {
  id: string;
  content: string;
  user_id: string;
  container_tag: string;
  event_date: string | null;
  created_at: string;
  importance_score: number;
  memory_type: 'episodic' | 'semantic';
  metadata?: any;
}

export interface MemoryCluster {
  id: string;
  memories: Memory[];
  centroid_embedding?: Float32Array;
  dominant_entities?: string[];
  time_span?: { start: string; end: string };
  semantic_theme?: string; // LLM-generated theme
  coherence_score: number; // 0-1, how well memories fit together
  cluster_size: number;
}

export interface ClusterStrategy {
  cluster(memories: Memory[], context: ClusteringContext): Promise<MemoryCluster[]>;
}

export interface ClusteringContext {
  db: D1Database;
  ai: any;
  vectorize?: any;
}

/**
 * Strategy 1: Temporal Clustering
 * Groups memories by time windows (default: 7 days)
 */
export class TemporalClusteringStrategy implements ClusterStrategy {
  constructor(private windowDays: number = 7) {}

  async cluster(memories: Memory[]): Promise<MemoryCluster[]> {
    // Sort by event_date (or created_at if no event_date)
    const sorted = memories.sort((a, b) => {
      const dateA = new Date(a.event_date || a.created_at).getTime();
      const dateB = new Date(b.event_date || b.created_at).getTime();
      return dateA - dateB;
    });

    const clusters: MemoryCluster[] = [];
    let currentCluster: Memory[] = [];
    let clusterStartDate: number | null = null;

    for (const memory of sorted) {
      const memoryDate = new Date(memory.event_date || memory.created_at).getTime();

      if (clusterStartDate === null) {
        // Start first cluster
        clusterStartDate = memoryDate;
        currentCluster = [memory];
      } else {
        const daysSinceStart = (memoryDate - clusterStartDate) / (1000 * 60 * 60 * 24);

        if (daysSinceStart <= this.windowDays) {
          // Add to current cluster
          currentCluster.push(memory);
        } else {
          // Finalize current cluster and start new one
          if (currentCluster.length >= 1) {
            clusters.push(this.createCluster(currentCluster));
          }
          clusterStartDate = memoryDate;
          currentCluster = [memory];
        }
      }
    }

    // Add final cluster
    if (currentCluster.length >= 1) {
      clusters.push(this.createCluster(currentCluster));
    }

    return clusters;
  }

  private createCluster(memories: Memory[]): MemoryCluster {
    const dates = memories.map(m => new Date(m.event_date || m.created_at).getTime());
    const startDate = new Date(Math.min(...dates)).toISOString();
    const endDate = new Date(Math.max(...dates)).toISOString();

    return {
      id: nanoid(),
      memories,
      time_span: { start: startDate, end: endDate },
      coherence_score: this.calculateTemporalCoherence(memories),
      cluster_size: memories.length,
    };
  }

  private calculateTemporalCoherence(memories: Memory[]): number {
    if (memories.length <= 1) return 1.0;

    const dates = memories.map(m => new Date(m.event_date || m.created_at).getTime());
    const span = Math.max(...dates) - Math.min(...dates);
    const spanDays = span / (1000 * 60 * 60 * 24);

    // Higher coherence for tighter time spans
    // Perfect score (1.0) for same-day events
    // Decays as span increases
    return Math.max(0.3, 1.0 - (spanDays / (this.windowDays * 2)));
  }
}

/**
 * Strategy 2: Entity-Based Clustering
 * Groups memories that mention the same entities
 */
export class EntityClusteringStrategy implements ClusterStrategy {
  constructor(private minSharedEntities: number = 2) {}

  async cluster(memories: Memory[], context: ClusteringContext): Promise<MemoryCluster[]> {
    // Fetch entities for each memory
    const memoryEntities = await this.fetchMemoryEntities(memories, context.db);

    // Build entity co-occurrence graph
    const entityGraph = this.buildEntityGraph(memoryEntities);

    // Cluster using entity overlap
    const clusters = this.clusterByEntityOverlap(memories, memoryEntities, entityGraph);

    return clusters.map(cluster => ({
      id: nanoid(),
      memories: cluster.memories,
      dominant_entities: cluster.dominantEntities,
      coherence_score: cluster.coherenceScore,
      cluster_size: cluster.memories.length,
    }));
  }

  private async fetchMemoryEntities(memories: Memory[], db: D1Database): Promise<Map<string, string[]>> {
    const memoryIds = memories.map(m => m.id);
    const placeholders = memoryIds.map(() => '?').join(',');

    const result = await db.prepare(`
      SELECT memory_id, entity_id
      FROM memory_entities
      WHERE memory_id IN (${placeholders})
    `).bind(...memoryIds).all();

    const map = new Map<string, string[]>();
    for (const row of result.results as any[]) {
      if (!map.has(row.memory_id)) {
        map.set(row.memory_id, []);
      }
      map.get(row.memory_id)!.push(row.entity_id);
    }

    return map;
  }

  private buildEntityGraph(memoryEntities: Map<string, string[]>): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();

    // For each pair of memories, track shared entities
    const memoryIds = Array.from(memoryEntities.keys());
    for (let i = 0; i < memoryIds.length; i++) {
      for (let j = i + 1; j < memoryIds.length; j++) {
        const mem1 = memoryIds[i];
        const mem2 = memoryIds[j];
        const entities1 = new Set(memoryEntities.get(mem1) || []);
        const entities2 = new Set(memoryEntities.get(mem2) || []);

        const shared = [...entities1].filter(e => entities2.has(e));

        if (shared.length >= this.minSharedEntities) {
          if (!graph.has(mem1)) graph.set(mem1, new Set());
          if (!graph.has(mem2)) graph.set(mem2, new Set());
          graph.get(mem1)!.add(mem2);
          graph.get(mem2)!.add(mem1);
        }
      }
    }

    return graph;
  }

  private clusterByEntityOverlap(
    memories: Memory[],
    memoryEntities: Map<string, string[]>,
    graph: Map<string, Set<string>>
  ): Array<{ memories: Memory[]; dominantEntities: string[]; coherenceScore: number }> {
    const visited = new Set<string>();
    const clusters: Array<{ memories: Memory[]; dominantEntities: string[]; coherenceScore: number }> = [];

    // DFS to find connected components
    for (const memory of memories) {
      if (visited.has(memory.id)) continue;

      const cluster = this.dfsCluster(memory.id, graph, visited);
      const clusterMemories = memories.filter(m => cluster.has(m.id));

      if (clusterMemories.length >= 1) {
        // Find dominant entities (most frequent across cluster)
        const entityCounts = new Map<string, number>();
        for (const memId of cluster) {
          const entities = memoryEntities.get(memId) || [];
          for (const entityId of entities) {
            entityCounts.set(entityId, (entityCounts.get(entityId) || 0) + 1);
          }
        }

        const dominantEntities = Array.from(entityCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([entityId]) => entityId);

        const coherenceScore = this.calculateEntityCoherence(clusterMemories, memoryEntities);

        clusters.push({
          memories: clusterMemories,
          dominantEntities,
          coherenceScore,
        });
      }
    }

    return clusters;
  }

  private dfsCluster(memoryId: string, graph: Map<string, Set<string>>, visited: Set<string>): Set<string> {
    const cluster = new Set<string>();
    const stack = [memoryId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;

      visited.add(current);
      cluster.add(current);

      const neighbors = graph.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }
    }

    return cluster;
  }

  private calculateEntityCoherence(memories: Memory[], memoryEntities: Map<string, string[]>): number {
    if (memories.length <= 1) return 1.0;

    // Calculate average entity overlap between memory pairs
    let totalOverlap = 0;
    let pairCount = 0;

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const entities1 = new Set(memoryEntities.get(memories[i].id) || []);
        const entities2 = new Set(memoryEntities.get(memories[j].id) || []);

        const intersection = [...entities1].filter(e => entities2.has(e)).length;
        const union = new Set([...entities1, ...entities2]).size;

        const jaccard = union > 0 ? intersection / union : 0;
        totalOverlap += jaccard;
        pairCount++;
      }
    }

    return pairCount > 0 ? totalOverlap / pairCount : 0.5;
  }
}

/**
 * Strategy 3: Semantic Clustering
 * Groups memories by embedding similarity (cosine distance)
 */
export class SemanticClusteringStrategy implements ClusterStrategy {
  constructor(
    private similarityThreshold: number = 0.75,
    private minClusterSize: number = 2
  ) {}

  async cluster(memories: Memory[], context: ClusteringContext): Promise<MemoryCluster[]> {
    if (!context.vectorize) {
      console.warn('[Clustering] Vectorize not available, skipping semantic clustering');
      return [];
    }

    // Fetch embeddings for all memories
    const embeddings = await this.fetchEmbeddings(memories, context.vectorize);

    // Build similarity matrix
    const similarityMatrix = this.buildSimilarityMatrix(embeddings);

    // DBSCAN-style clustering
    const clusters = this.dbscanCluster(memories, similarityMatrix);

    return clusters.map(cluster => ({
      id: nanoid(),
      memories: cluster.memories,
      centroid_embedding: this.calculateCentroid(cluster.embeddings),
      coherence_score: cluster.coherenceScore,
      cluster_size: cluster.memories.length,
    }));
  }

  private async fetchEmbeddings(memories: Memory[], vectorize: any): Promise<Map<string, Float32Array>> {
    const embeddings = new Map<string, Float32Array>();

    // Query each memory's embedding
    for (const memory of memories) {
      try {
        const results = await vectorize.query(
          new Array(768).fill(0), // Dummy query
          {
            filter: { memoryId: memory.id },
            topK: 1,
            returnValues: true,
          }
        );

        if (results.matches.length > 0) {
          embeddings.set(memory.id, new Float32Array(results.matches[0].values));
        }
      } catch (error) {
        console.warn(`[Clustering] Failed to fetch embedding for ${memory.id}`);
      }
    }

    return embeddings;
  }

  private buildSimilarityMatrix(embeddings: Map<string, Float32Array>): Map<string, Map<string, number>> {
    const matrix = new Map<string, Map<string, number>>();
    const memoryIds = Array.from(embeddings.keys());

    for (let i = 0; i < memoryIds.length; i++) {
      const id1 = memoryIds[i];
      const emb1 = embeddings.get(id1)!;

      if (!matrix.has(id1)) matrix.set(id1, new Map());

      for (let j = i + 1; j < memoryIds.length; j++) {
        const id2 = memoryIds[j];
        const emb2 = embeddings.get(id2)!;

        const similarity = this.cosineSimilarity(emb1, emb2);

        matrix.get(id1)!.set(id2, similarity);
        if (!matrix.has(id2)) matrix.set(id2, new Map());
        matrix.get(id2)!.set(id1, similarity);
      }
    }

    return matrix;
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private dbscanCluster(
    memories: Memory[],
    similarityMatrix: Map<string, Map<string, number>>
  ): Array<{ memories: Memory[]; embeddings: Float32Array[]; coherenceScore: number }> {
    const visited = new Set<string>();
    const clusters: Array<{ memories: Memory[]; embeddings: Float32Array[]; coherenceScore: number }> = [];

    for (const memory of memories) {
      if (visited.has(memory.id)) continue;

      const cluster = this.expandCluster(memory.id, memories, similarityMatrix, visited);

      if (cluster.length >= this.minClusterSize) {
        const clusterMemories = memories.filter(m => cluster.has(m.id));
        const coherenceScore = this.calculateSemanticCoherence(cluster, similarityMatrix);

        clusters.push({
          memories: clusterMemories,
          embeddings: [], // Will be populated if needed
          coherenceScore,
        });
      }
    }

    return clusters;
  }

  private expandCluster(
    memoryId: string,
    memories: Memory[],
    similarityMatrix: Map<string, Map<string, number>>,
    visited: Set<string>
  ): Set<string> {
    const cluster = new Set<string>();
    const queue = [memoryId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      cluster.add(current);

      // Find neighbors (similar memories)
      const neighbors = similarityMatrix.get(current);
      if (neighbors) {
        for (const [neighborId, similarity] of neighbors.entries()) {
          if (similarity >= this.similarityThreshold && !visited.has(neighborId)) {
            queue.push(neighborId);
          }
        }
      }
    }

    return cluster;
  }

  private calculateSemanticCoherence(
    cluster: Set<string>,
    similarityMatrix: Map<string, Map<string, number>>
  ): number {
    if (cluster.size <= 1) return 1.0;

    let totalSimilarity = 0;
    let pairCount = 0;

    const clusterArray = Array.from(cluster);
    for (let i = 0; i < clusterArray.length; i++) {
      for (let j = i + 1; j < clusterArray.length; j++) {
        const similarity = similarityMatrix.get(clusterArray[i])?.get(clusterArray[j]) || 0;
        totalSimilarity += similarity;
        pairCount++;
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0.5;
  }

  private calculateCentroid(embeddings: Float32Array[]): Float32Array {
    if (embeddings.length === 0) return new Float32Array(768);

    const centroid = new Float32Array(768);
    for (const embedding of embeddings) {
      for (let i = 0; i < 768; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < 768; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }
}

/**
 * Strategy 4: Hybrid Clustering
 * Combines temporal, entity, and semantic signals
 */
export class HybridClusteringStrategy implements ClusterStrategy {
  private temporalWeight = 0.4;
  private entityWeight = 0.3;
  private semanticWeight = 0.3;

  async cluster(memories: Memory[], context: ClusteringContext): Promise<MemoryCluster[]> {
    // Run all three strategies
    const [temporalClusters, entityClusters, semanticClusters] = await Promise.all([
      new TemporalClusteringStrategy(7).cluster(memories, context),
      new EntityClusteringStrategy(2).cluster(memories, context),
      new SemanticClusteringStrategy(0.75, 2).cluster(memories, context),
    ]);

    // Score each memory pair using all three signals
    const pairScores = this.calculateHybridScores(
      memories,
      temporalClusters,
      entityClusters,
      semanticClusters
    );

    // Agglomerative clustering based on hybrid scores
    const clusters = this.agglomerativeClustering(memories, pairScores);

    return clusters;
  }

  private calculateHybridScores(
    memories: Memory[],
    temporalClusters: MemoryCluster[],
    entityClusters: MemoryCluster[],
    semanticClusters: MemoryCluster[]
  ): Map<string, Map<string, number>> {
    const scores = new Map<string, Map<string, number>>();

    for (let i = 0; i < memories.length; i++) {
      const mem1 = memories[i];
      if (!scores.has(mem1.id)) scores.set(mem1.id, new Map());

      for (let j = i + 1; j < memories.length; j++) {
        const mem2 = memories[j];

        // Check if pair is in same cluster for each strategy
        const temporalScore = this.inSameCluster(mem1.id, mem2.id, temporalClusters) ? 1.0 : 0.0;
        const entityScore = this.inSameCluster(mem1.id, mem2.id, entityClusters) ? 1.0 : 0.0;
        const semanticScore = this.inSameCluster(mem1.id, mem2.id, semanticClusters) ? 1.0 : 0.0;

        const hybridScore =
          temporalScore * this.temporalWeight +
          entityScore * this.entityWeight +
          semanticScore * this.semanticWeight;

        scores.get(mem1.id)!.set(mem2.id, hybridScore);
        if (!scores.has(mem2.id)) scores.set(mem2.id, new Map());
        scores.get(mem2.id)!.set(mem1.id, hybridScore);
      }
    }

    return scores;
  }

  private inSameCluster(memId1: string, memId2: string, clusters: MemoryCluster[]): boolean {
    for (const cluster of clusters) {
      const ids = cluster.memories.map(m => m.id);
      if (ids.includes(memId1) && ids.includes(memId2)) {
        return true;
      }
    }
    return false;
  }

  private agglomerativeClustering(
    memories: Memory[],
    pairScores: Map<string, Map<string, number>>,
    threshold: number = 0.5
  ): MemoryCluster[] {
    // Start with each memory in its own cluster
    const clusters = memories.map(m => ({
      id: nanoid(),
      memories: [m],
      coherence_score: 1.0,
      cluster_size: 1,
    }));

    // Merge clusters greedily
    let merged = true;
    while (merged) {
      merged = false;
      let bestScore = threshold;
      let bestPair: [number, number] | null = null;

      // Find best pair to merge
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const score = this.clusterSimilarity(clusters[i], clusters[j], pairScores);
          if (score > bestScore) {
            bestScore = score;
            bestPair = [i, j];
          }
        }
      }

      // Merge best pair
      if (bestPair) {
        const [i, j] = bestPair;
        clusters[i].memories.push(...clusters[j].memories);
        clusters[i].cluster_size = clusters[i].memories.length;
        clusters[i].coherence_score = bestScore;
        clusters.splice(j, 1);
        merged = true;
      }
    }

    return clusters;
  }

  private clusterSimilarity(
    cluster1: MemoryCluster,
    cluster2: MemoryCluster,
    pairScores: Map<string, Map<string, number>>
  ): number {
    let totalScore = 0;
    let count = 0;

    for (const mem1 of cluster1.memories) {
      for (const mem2 of cluster2.memories) {
        const score = pairScores.get(mem1.id)?.get(mem2.id) || 0;
        totalScore += score;
        count++;
      }
    }

    return count > 0 ? totalScore / count : 0;
  }
}

/**
 * Main clustering orchestrator
 * Selects best strategy based on memory characteristics
 */
export class MemoryClusterer {
  async cluster(
    memories: Memory[],
    context: ClusteringContext,
    strategy: 'temporal' | 'entity' | 'semantic' | 'hybrid' = 'hybrid'
  ): Promise<MemoryCluster[]> {
    if (memories.length === 0) return [];

    let clusterStrategy: ClusterStrategy;

    switch (strategy) {
      case 'temporal':
        clusterStrategy = new TemporalClusteringStrategy();
        break;
      case 'entity':
        clusterStrategy = new EntityClusteringStrategy();
        break;
      case 'semantic':
        clusterStrategy = new SemanticClusteringStrategy();
        break;
      case 'hybrid':
      default:
        clusterStrategy = new HybridClusteringStrategy();
        break;
    }

    console.log(`[Clustering] Using ${strategy} strategy for ${memories.length} memories`);
    const clusters = await clusterStrategy.cluster(memories, context);
    console.log(`[Clustering] Created ${clusters.length} clusters`);

    return clusters;
  }
}
