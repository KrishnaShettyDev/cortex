/**
 * Relationship Graph Queries
 *
 * Advanced graph algorithms for analyzing the relationship network:
 * - Full graph visualization
 * - Entity neighborhood traversal (BFS)
 * - Shortest path finding (Dijkstra)
 * - Key stakeholder identification (PageRank-inspired)
 * - Community detection (Louvain-inspired clustering)
 */

export interface GraphNode {
  id: string;
  name: string;
  type: string; // entity_type
  importance: number; // importance_score
  health_score?: number; // From relationship health scorer
  metadata: Record<string, any>;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relationship_type: string;
  confidence: number;
  interaction_count: number;
  last_interaction: string;
  is_bidirectional: boolean;
  valid_from: string;
  valid_to: string | null;
}

export interface GraphCluster {
  id: string;
  name: string; // e.g., "Work Team", "Family", "Stanford Alumni"
  entity_ids: string[];
  cohesion_score: number; // 0-1, how interconnected
  avg_importance: number;
  total_members: number;
}

export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: GraphCluster[];
  metadata?: {
    total_nodes: number;
    total_edges: number;
    avg_connections_per_node: number;
    density: number; // edges / possible_edges
    num_clusters?: number;
  };
}

export interface PathFindingResult {
  path: GraphNode[];
  edges: GraphEdge[];
  total_hops: number;
  path_confidence: number; // Average confidence of edges
  exists: boolean;
}

export class RelationshipGraphQueries {
  private db: D1Database;
  private userId: string;
  private containerTag: string;

  constructor(db: D1Database, userId: string, containerTag: string = 'default') {
    this.db = db;
    this.userId = userId;
    this.containerTag = containerTag;
  }

  /**
   * Get full relationship graph for user
   */
  async getFullGraph(options?: {
    includeHealth?: boolean;
    minImportance?: number;
    includeClusters?: boolean;
  }): Promise<RelationshipGraph> {
    const opts = {
      includeHealth: options?.includeHealth ?? false,
      minImportance: options?.minImportance ?? 0,
      includeClusters: options?.includeClusters ?? false,
    };

    console.log(`[GraphQueries] Building full graph for user ${this.userId}`);

    // Get all entities
    const entitiesResult = await this.db.prepare(`
      SELECT id, name, entity_type, importance_score, attributes
      FROM entities
      WHERE user_id = ?
        AND container_tag = ?
        AND importance_score >= ?
      ORDER BY importance_score DESC
    `).bind(this.userId, this.containerTag, opts.minImportance).all();

    const entities = entitiesResult.results as any[];

    // Get all relationships (currently valid)
    const relationshipsResult = await this.db.prepare(`
      SELECT r.*,
             e1.name as source_name,
             e2.name as target_name
      FROM entity_relationships r
      JOIN entities e1 ON e1.id = r.source_entity_id
      JOIN entities e2 ON e2.id = r.target_entity_id
      WHERE r.user_id = ?
        AND r.container_tag = ?
        AND r.valid_to IS NULL
      ORDER BY r.confidence DESC
    `).bind(this.userId, this.containerTag).all();

    const relationships = relationshipsResult.results as any[];

    // Build nodes
    const nodes: GraphNode[] = entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.entity_type,
      importance: e.importance_score,
      metadata: e.attributes ? JSON.parse(e.attributes) : {},
    }));

    // Build edges
    const edges: GraphEdge[] = relationships.map(r => {
      const sourceMemoryIds = r.source_memory_ids ? JSON.parse(r.source_memory_ids) : [];
      return {
        source_id: r.source_entity_id,
        target_id: r.target_entity_id,
        relationship_type: r.relationship_type,
        confidence: r.confidence,
        interaction_count: sourceMemoryIds.length,
        last_interaction: r.updated_at,
        is_bidirectional: r.is_bidirectional === 1,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
      };
    });

    // Calculate graph metadata
    const metadata = {
      total_nodes: nodes.length,
      total_edges: edges.length,
      avg_connections_per_node: nodes.length > 0 ? (edges.length * 2) / nodes.length : 0,
      density: nodes.length > 1 ? edges.length / (nodes.length * (nodes.length - 1) / 2) : 0,
    };

    let clusters: GraphCluster[] | undefined;
    if (opts.includeClusters && nodes.length > 0) {
      clusters = await this.detectCommunities(nodes, edges);
      metadata.num_clusters = clusters.length;
    }

    console.log(`[GraphQueries] Graph built: ${nodes.length} nodes, ${edges.length} edges`);

    return { nodes, edges, clusters, metadata };
  }

  /**
   * Get entity neighborhood (subgraph within N hops)
   */
  async getEntityNeighborhood(entityId: string, depth: number = 2): Promise<RelationshipGraph> {
    console.log(`[GraphQueries] Getting neighborhood for entity ${entityId} (depth=${depth})`);

    const visited = new Set<string>();
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    // BFS traversal
    await this.bfsTraversal(entityId, depth, visited, nodeMap, edgeList);

    const nodes = Array.from(nodeMap.values());
    const metadata = {
      total_nodes: nodes.length,
      total_edges: edgeList.length,
      avg_connections_per_node: nodes.length > 0 ? (edgeList.length * 2) / nodes.length : 0,
      density: nodes.length > 1 ? edgeList.length / (nodes.length * (nodes.length - 1) / 2) : 0,
    };

    return { nodes, edges: edgeList, metadata };
  }

  /**
   * BFS traversal for neighborhood
   */
  private async bfsTraversal(
    startId: string,
    maxDepth: number,
    visited: Set<string>,
    nodeMap: Map<string, GraphNode>,
    edgeList: GraphEdge[],
    currentDepth: number = 0
  ): Promise<void> {
    if (currentDepth > maxDepth || visited.has(startId)) return;

    visited.add(startId);

    // Fetch entity details
    const entity = await this.db.prepare(`
      SELECT id, name, entity_type, importance_score, attributes
      FROM entities
      WHERE id = ? AND user_id = ? AND container_tag = ?
    `).bind(startId, this.userId, this.containerTag).first();

    if (!entity) return;

    nodeMap.set(startId, {
      id: entity.id,
      name: entity.name,
      type: entity.entity_type,
      importance: entity.importance_score,
      metadata: entity.attributes ? JSON.parse(entity.attributes) : {},
    });

    // Get neighbors (outgoing relationships)
    const neighborsResult = await this.db.prepare(`
      SELECT r.*, e.name as target_name
      FROM entity_relationships r
      JOIN entities e ON e.id = r.target_entity_id
      WHERE r.source_entity_id = ?
        AND r.user_id = ?
        AND r.container_tag = ?
        AND r.valid_to IS NULL
    `).bind(startId, this.userId, this.containerTag).all();

    const neighbors = neighborsResult.results as any[];

    for (const neighbor of neighbors) {
      const sourceMemoryIds = neighbor.source_memory_ids ? JSON.parse(neighbor.source_memory_ids) : [];

      // Add edge
      edgeList.push({
        source_id: neighbor.source_entity_id,
        target_id: neighbor.target_entity_id,
        relationship_type: neighbor.relationship_type,
        confidence: neighbor.confidence,
        interaction_count: sourceMemoryIds.length,
        last_interaction: neighbor.updated_at,
        is_bidirectional: neighbor.is_bidirectional === 1,
        valid_from: neighbor.valid_from,
        valid_to: neighbor.valid_to,
      });

      // Recurse to neighbor
      if (currentDepth + 1 <= maxDepth) {
        await this.bfsTraversal(
          neighbor.target_entity_id,
          maxDepth,
          visited,
          nodeMap,
          edgeList,
          currentDepth + 1
        );
      }
    }

    // Also check incoming relationships (if bidirectional)
    const incomingResult = await this.db.prepare(`
      SELECT r.*, e.name as source_name
      FROM entity_relationships r
      JOIN entities e ON e.id = r.source_entity_id
      WHERE r.target_entity_id = ?
        AND r.user_id = ?
        AND r.container_tag = ?
        AND r.valid_to IS NULL
        AND r.is_bidirectional = 1
    `).bind(startId, this.userId, this.containerTag).all();

    const incoming = incomingResult.results as any[];

    for (const rel of incoming) {
      if (!visited.has(rel.source_entity_id)) {
        const sourceMemoryIds = rel.source_memory_ids ? JSON.parse(rel.source_memory_ids) : [];

        edgeList.push({
          source_id: rel.source_entity_id,
          target_id: rel.target_entity_id,
          relationship_type: rel.relationship_type,
          confidence: rel.confidence,
          interaction_count: sourceMemoryIds.length,
          last_interaction: rel.updated_at,
          is_bidirectional: true,
          valid_from: rel.valid_from,
          valid_to: rel.valid_to,
        });

        if (currentDepth + 1 <= maxDepth) {
          await this.bfsTraversal(
            rel.source_entity_id,
            maxDepth,
            visited,
            nodeMap,
            edgeList,
            currentDepth + 1
          );
        }
      }
    }
  }

  /**
   * Find shortest path between two entities (Dijkstra's algorithm)
   */
  async findShortestPath(fromEntityId: string, toEntityId: string): Promise<PathFindingResult> {
    console.log(`[GraphQueries] Finding path from ${fromEntityId} to ${toEntityId}`);

    // Get all relationships for user (as adjacency list)
    const relationshipsResult = await this.db.prepare(`
      SELECT source_entity_id, target_entity_id, relationship_type, confidence, is_bidirectional
      FROM entity_relationships
      WHERE user_id = ?
        AND container_tag = ?
        AND valid_to IS NULL
    `).bind(this.userId, this.containerTag).all();

    const relationships = relationshipsResult.results as any[];

    // Build adjacency list
    const adjList = new Map<string, Array<{ target: string; weight: number; relType: string; confidence: number }>>();

    for (const rel of relationships) {
      // Forward edge
      if (!adjList.has(rel.source_entity_id)) {
        adjList.set(rel.source_entity_id, []);
      }
      adjList.get(rel.source_entity_id)!.push({
        target: rel.target_entity_id,
        weight: 1 / rel.confidence, // Lower confidence = higher weight
        relType: rel.relationship_type,
        confidence: rel.confidence,
      });

      // Bidirectional edge
      if (rel.is_bidirectional === 1) {
        if (!adjList.has(rel.target_entity_id)) {
          adjList.set(rel.target_entity_id, []);
        }
        adjList.get(rel.target_entity_id)!.push({
          target: rel.source_entity_id,
          weight: 1 / rel.confidence,
          relType: rel.relationship_type,
          confidence: rel.confidence,
        });
      }
    }

    // Dijkstra's algorithm
    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const pq: Array<{ id: string; distance: number }> = [];

    distances.set(fromEntityId, 0);
    pq.push({ id: fromEntityId, distance: 0 });

    while (pq.length > 0) {
      // Get node with minimum distance
      pq.sort((a, b) => a.distance - b.distance);
      const current = pq.shift()!;

      if (current.id === toEntityId) {
        // Found target
        break;
      }

      const neighbors = adjList.get(current.id) || [];

      for (const neighbor of neighbors) {
        const newDist = (distances.get(current.id) || Infinity) + neighbor.weight;
        const oldDist = distances.get(neighbor.target) || Infinity;

        if (newDist < oldDist) {
          distances.set(neighbor.target, newDist);
          previous.set(neighbor.target, current.id);
          pq.push({ id: neighbor.target, distance: newDist });
        }
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current: string | null | undefined = toEntityId;

    while (current) {
      path.unshift(current);
      current = previous.get(current);
    }

    // Check if path exists
    if (path.length === 0 || path[0] !== fromEntityId) {
      return {
        path: [],
        edges: [],
        total_hops: 0,
        path_confidence: 0,
        exists: false,
      };
    }

    // Fetch node details
    const nodes: GraphNode[] = [];
    for (const entityId of path) {
      const entity = await this.db.prepare(`
        SELECT id, name, entity_type, importance_score, attributes
        FROM entities
        WHERE id = ?
      `).bind(entityId).first();

      if (entity) {
        nodes.push({
          id: entity.id,
          name: entity.name,
          type: entity.entity_type,
          importance: entity.importance_score,
          metadata: entity.attributes ? JSON.parse(entity.attributes) : {},
        });
      }
    }

    // Build edge list along path
    const edges: GraphEdge[] = [];
    let totalConfidence = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const rel = relationships.find(
        r => (r.source_entity_id === path[i] && r.target_entity_id === path[i + 1]) ||
             (r.is_bidirectional === 1 && r.source_entity_id === path[i + 1] && r.target_entity_id === path[i])
      );

      if (rel) {
        const sourceMemoryIds = rel.source_memory_ids ? JSON.parse(rel.source_memory_ids) : [];
        edges.push({
          source_id: path[i],
          target_id: path[i + 1],
          relationship_type: rel.relationship_type,
          confidence: rel.confidence,
          interaction_count: sourceMemoryIds.length,
          last_interaction: rel.updated_at,
          is_bidirectional: rel.is_bidirectional === 1,
          valid_from: rel.valid_from,
          valid_to: rel.valid_to,
        });
        totalConfidence += rel.confidence;
      }
    }

    const avgConfidence = edges.length > 0 ? totalConfidence / edges.length : 0;

    console.log(`[GraphQueries] Path found: ${path.length} hops, avg confidence ${avgConfidence.toFixed(2)}`);

    return {
      path: nodes,
      edges,
      total_hops: path.length - 1,
      path_confidence: avgConfidence,
      exists: true,
    };
  }

  /**
   * Get key stakeholders (PageRank-inspired importance calculation)
   */
  async getKeyStakeholders(limit: number = 10): Promise<GraphNode[]> {
    console.log(`[GraphQueries] Computing key stakeholders (top ${limit})`);

    // Get full graph
    const graph = await this.getFullGraph({ minImportance: 0.1 });

    // Build adjacency list for PageRank
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    for (const node of graph.nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      outDegree.set(node.id, 0);
    }

    for (const edge of graph.edges) {
      adjList.get(edge.source_id)?.push(edge.target_id);
      outDegree.set(edge.source_id, (outDegree.get(edge.source_id) || 0) + 1);
      inDegree.set(edge.target_id, (inDegree.get(edge.target_id) || 0) + 1);

      // Bidirectional
      if (edge.is_bidirectional) {
        adjList.get(edge.target_id)?.push(edge.source_id);
        outDegree.set(edge.target_id, (outDegree.get(edge.target_id) || 0) + 1);
        inDegree.set(edge.source_id, (inDegree.get(edge.source_id) || 0) + 1);
      }
    }

    // Simplified PageRank (10 iterations)
    const dampingFactor = 0.85;
    const scores = new Map<string, number>();

    // Initialize scores
    for (const node of graph.nodes) {
      scores.set(node.id, 1.0 / graph.nodes.length);
    }

    // Iterate
    for (let i = 0; i < 10; i++) {
      const newScores = new Map<string, number>();

      for (const node of graph.nodes) {
        let sum = 0;

        // Sum contributions from incoming neighbors
        for (const [nodeId, neighbors] of adjList.entries()) {
          if (neighbors.includes(node.id)) {
            const outDeg = outDegree.get(nodeId) || 1;
            sum += (scores.get(nodeId) || 0) / outDeg;
          }
        }

        newScores.set(node.id, (1 - dampingFactor) / graph.nodes.length + dampingFactor * sum);
      }

      scores.clear();
      for (const [id, score] of newScores) {
        scores.set(id, score);
      }
    }

    // Combine PageRank with importance score and health (if available)
    const rankedNodes = graph.nodes.map(node => {
      const pageRank = scores.get(node.id) || 0;
      const importance = node.importance || 0;
      const health = node.health_score || 0.5;

      // Weighted combination: 40% PageRank, 40% importance, 20% health
      const finalScore = pageRank * 0.4 + importance * 0.4 + health * 0.2;

      return {
        ...node,
        metadata: {
          ...node.metadata,
          centrality_score: pageRank,
          composite_score: finalScore,
        },
      };
    });

    // Sort by composite score and return top N
    rankedNodes.sort((a, b) => (b.metadata.composite_score || 0) - (a.metadata.composite_score || 0));

    console.log(`[GraphQueries] Top stakeholder: ${rankedNodes[0]?.name} (score: ${rankedNodes[0]?.metadata.composite_score?.toFixed(3)})`);

    return rankedNodes.slice(0, limit);
  }

  /**
   * Detect communities (Louvain-inspired clustering)
   */
  async detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): Promise<GraphCluster[]> {
    console.log(`[GraphQueries] Detecting communities in graph with ${nodes.length} nodes`);

    // Simple community detection based on connected components and density
    const adjList = new Map<string, Set<string>>();

    // Build adjacency list
    for (const node of nodes) {
      adjList.set(node.id, new Set());
    }

    for (const edge of edges) {
      adjList.get(edge.source_id)?.add(edge.target_id);
      if (edge.is_bidirectional) {
        adjList.get(edge.target_id)?.add(edge.source_id);
      }
    }

    // Find connected components using DFS
    const visited = new Set<string>();
    const components: string[][] = [];

    const dfs = (nodeId: string, component: string[]) => {
      visited.add(nodeId);
      component.push(nodeId);

      const neighbors = adjList.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, component);
        }
      }
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        const component: string[] = [];
        dfs(node.id, component);
        if (component.length >= 2) { // Only keep clusters with 2+ members
          components.push(component);
        }
      }
    }

    // Build clusters
    const clusters: GraphCluster[] = [];

    for (let i = 0; i < components.length; i++) {
      const component = components[i];

      // Calculate cohesion (density within cluster)
      const clusterEdges = edges.filter(
        e => component.includes(e.source_id) && component.includes(e.target_id)
      );

      const maxPossibleEdges = (component.length * (component.length - 1)) / 2;
      const cohesion = maxPossibleEdges > 0 ? clusterEdges.length / maxPossibleEdges : 0;

      // Calculate average importance
      const clusterNodes = nodes.filter(n => component.includes(n.id));
      const avgImportance = clusterNodes.reduce((sum, n) => sum + n.importance, 0) / clusterNodes.length;

      // Generate cluster name (most important entity + count)
      const topEntity = clusterNodes.reduce((max, n) => n.importance > max.importance ? n : max);
      const clusterName = `${topEntity.name}'s Network (${component.length})`;

      clusters.push({
        id: `cluster_${i}`,
        name: clusterName,
        entity_ids: component,
        cohesion_score: cohesion,
        avg_importance: avgImportance,
        total_members: component.length,
      });
    }

    // Sort by cohesion score
    clusters.sort((a, b) => b.cohesion_score - a.cohesion_score);

    console.log(`[GraphQueries] Detected ${clusters.length} communities`);

    return clusters;
  }
}

/**
 * Helper function to get full graph
 */
export async function getRelationshipGraph(
  db: D1Database,
  userId: string,
  containerTag: string = 'default',
  options?: { includeHealth?: boolean; minImportance?: number; includeClusters?: boolean }
): Promise<RelationshipGraph> {
  const queries = new RelationshipGraphQueries(db, userId, containerTag);
  return queries.getFullGraph(options);
}
