/**
 * Provenance Tracking Service
 *
 * Full chain of custody for memory artifacts:
 * - Logs all extractions (entities, relationships, facts, commitments, temporal)
 * - Links derivations (consolidated memories, inferred relationships, etc.)
 * - Enables audit trails and "where did this come from?" queries
 */

import { nanoid } from 'nanoid';

export type ExtractionType = 'entity' | 'relationship' | 'fact' | 'commitment' | 'temporal';
export type ArtifactType = 'memory' | 'entity' | 'relationship' | 'commitment' | 'fact';
export type DerivationType = 'extracted' | 'consolidated' | 'inferred' | 'superseded' | 'merged';

export interface ExtractionLog {
  id: string;
  extraction_type: ExtractionType;
  source_memory_id: string;
  extracted_entity_id?: string;
  extracted_relationship_id?: string;
  extracted_data: any;
  extractor_version?: string;
  confidence: number;
  created_at: string;
  user_id: string;
  container_tag: string;
}

export interface ProvenanceLink {
  id: string;
  source_id: string;
  source_type: ArtifactType;
  derived_id: string;
  derived_type: ArtifactType;
  derivation_type: DerivationType;
  processing_job_id?: string;
  created_at: string;
  metadata?: any;
  user_id: string;
  container_tag: string;
}

export interface ProvenanceChain {
  root: ArtifactNode;
  nodes: ArtifactNode[];
  edges: ProvenanceLink[];
}

export interface ArtifactNode {
  id: string;
  type: ArtifactType;
  content?: string;
  created_at?: string;
  metadata?: any;
}

export class ProvenanceTracker {
  constructor(
    private db: D1Database,
    private version: string = '1.0.0'
  ) {}

  /**
   * Log an extraction from a memory
   */
  async logExtraction(params: {
    extractionType: ExtractionType;
    sourceMemoryId: string;
    extractedData: any;
    confidence: number;
    userId: string;
    containerTag: string;
    extractedEntityId?: string;
    extractedRelationshipId?: string;
  }): Promise<string> {
    const id = nanoid();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO extraction_log
      (id, extraction_type, source_memory_id, extracted_entity_id, extracted_relationship_id,
       extracted_data, extractor_version, confidence, created_at, user_id, container_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      params.extractionType,
      params.sourceMemoryId,
      params.extractedEntityId || null,
      params.extractedRelationshipId || null,
      JSON.stringify(params.extractedData),
      this.version,
      params.confidence,
      now,
      params.userId,
      params.containerTag
    ).run();

    console.log(`[Provenance] Logged ${params.extractionType} extraction from memory ${params.sourceMemoryId}`);

    return id;
  }

  /**
   * Create a provenance link between artifacts
   */
  async linkProvenance(params: {
    sourceId: string;
    sourceType: ArtifactType;
    derivedId: string;
    derivedType: ArtifactType;
    derivationType: DerivationType;
    userId: string;
    containerTag: string;
    processingJobId?: string;
    metadata?: any;
  }): Promise<string> {
    const id = nanoid();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO provenance_chain
      (id, source_id, source_type, derived_id, derived_type, derivation_type,
       processing_job_id, created_at, metadata, user_id, container_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      params.sourceId,
      params.sourceType,
      params.derivedId,
      params.derivedType,
      params.derivationType,
      params.processingJobId || null,
      now,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.userId,
      params.containerTag
    ).run();

    console.log(`[Provenance] Linked ${params.sourceType}:${params.sourceId} -> ${params.derivedType}:${params.derivedId} (${params.derivationType})`);

    return id;
  }

  /**
   * Get full provenance chain for an artifact
   * direction: 'forward' = what was derived from this
   *           'backward' = what this was derived from
   *           'both' = full graph
   */
  async getProvenanceChain(
    artifactId: string,
    artifactType: ArtifactType,
    direction: 'forward' | 'backward' | 'both' = 'both',
    maxDepth: number = 10
  ): Promise<ProvenanceChain> {
    const visited = new Set<string>();
    const nodes = new Map<string, ArtifactNode>();
    const edges: ProvenanceLink[] = [];

    // BFS traversal
    await this.traverseProvenance(
      artifactId,
      artifactType,
      direction,
      0,
      maxDepth,
      visited,
      nodes,
      edges
    );

    return {
      root: nodes.get(`${artifactType}:${artifactId}`)!,
      nodes: Array.from(nodes.values()),
      edges,
    };
  }

  /**
   * Recursive BFS traversal of provenance graph
   */
  private async traverseProvenance(
    id: string,
    type: ArtifactType,
    direction: 'forward' | 'backward' | 'both',
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    nodes: Map<string, ArtifactNode>,
    edges: ProvenanceLink[]
  ): Promise<void> {
    const key = `${type}:${id}`;

    if (visited.has(key) || depth > maxDepth) return;
    visited.add(key);

    // Fetch artifact details
    const artifact = await this.fetchArtifact(id, type);
    if (artifact) {
      nodes.set(key, artifact);
    }

    // Fetch provenance links
    if (direction === 'forward' || direction === 'both') {
      // What was derived FROM this artifact
      const forwardLinks = await this.getForwardLinks(id, type);
      edges.push(...forwardLinks);

      for (const link of forwardLinks) {
        await this.traverseProvenance(
          link.derived_id,
          link.derived_type,
          direction,
          depth + 1,
          maxDepth,
          visited,
          nodes,
          edges
        );
      }
    }

    if (direction === 'backward' || direction === 'both') {
      // What this artifact was derived FROM
      const backwardLinks = await this.getBackwardLinks(id, type);
      edges.push(...backwardLinks);

      for (const link of backwardLinks) {
        await this.traverseProvenance(
          link.source_id,
          link.source_type,
          direction,
          depth + 1,
          maxDepth,
          visited,
          nodes,
          edges
        );
      }
    }
  }

  /**
   * Get forward provenance links (derivations from this artifact)
   */
  private async getForwardLinks(id: string, type: ArtifactType): Promise<ProvenanceLink[]> {
    const result = await this.db.prepare(`
      SELECT *
      FROM provenance_chain
      WHERE source_id = ? AND source_type = ?
      ORDER BY created_at DESC
    `).bind(id, type).all();

    return (result.results as any[]).map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  }

  /**
   * Get backward provenance links (sources of this artifact)
   */
  private async getBackwardLinks(id: string, type: ArtifactType): Promise<ProvenanceLink[]> {
    const result = await this.db.prepare(`
      SELECT *
      FROM provenance_chain
      WHERE derived_id = ? AND derived_type = ?
      ORDER BY created_at DESC
    `).bind(id, type).all();

    return (result.results as any[]).map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  }

  /**
   * Fetch artifact details from appropriate table
   */
  private async fetchArtifact(id: string, type: ArtifactType): Promise<ArtifactNode | null> {
    try {
      let result: any;

      switch (type) {
        case 'memory':
          result = await this.db.prepare('SELECT id, content, created_at FROM memories WHERE id = ?')
            .bind(id).first();
          break;
        case 'entity':
          result = await this.db.prepare('SELECT id, name as content, created_at FROM entities WHERE id = ?')
            .bind(id).first();
          break;
        case 'relationship':
          result = await this.db.prepare('SELECT id, relationship_type as content, created_at FROM entity_relationships WHERE id = ?')
            .bind(id).first();
          break;
        case 'commitment':
          result = await this.db.prepare('SELECT id, title as content, created_at FROM commitments WHERE id = ?')
            .bind(id).first();
          break;
        default:
          return null;
      }

      if (!result) return null;

      return {
        id: result.id,
        type,
        content: result.content,
        created_at: result.created_at,
      };
    } catch (error) {
      console.error(`[Provenance] Failed to fetch ${type}:${id}:`, error);
      return null;
    }
  }

  /**
   * Get source memories for an entity
   */
  async getSourceMemoriesForEntity(entityId: string): Promise<any[]> {
    // Query extraction_log for entity extractions
    const result = await this.db.prepare(`
      SELECT DISTINCT m.*, el.confidence, el.created_at as extraction_date
      FROM extraction_log el
      JOIN memories m ON m.id = el.source_memory_id
      WHERE el.extracted_entity_id = ?
        AND el.extraction_type = 'entity'
      ORDER BY el.created_at DESC
    `).bind(entityId).all();

    return result.results as any[];
  }

  /**
   * Get all extractions from a memory
   */
  async getExtractionsFromMemory(memoryId: string): Promise<ExtractionLog[]> {
    const result = await this.db.prepare(`
      SELECT *
      FROM extraction_log
      WHERE source_memory_id = ?
      ORDER BY created_at DESC
    `).bind(memoryId).all();

    return (result.results as any[]).map(row => ({
      ...row,
      extracted_data: JSON.parse(row.extracted_data),
    }));
  }

  /**
   * Get entity history (all updates, merges, supersessions)
   */
  async getEntityHistory(entityId: string): Promise<Array<{
    date: string;
    event: string;
    details: any;
  }>> {
    const history: Array<{ date: string; event: string; details: any }> = [];

    // Get extractions (when entity was first discovered)
    const extractions = await this.db.prepare(`
      SELECT created_at, source_memory_id, confidence
      FROM extraction_log
      WHERE extracted_entity_id = ?
        AND extraction_type = 'entity'
      ORDER BY created_at ASC
    `).bind(entityId).all();

    for (const extraction of extractions.results as any[]) {
      history.push({
        date: extraction.created_at,
        event: 'extracted',
        details: {
          source_memory_id: extraction.source_memory_id,
          confidence: extraction.confidence,
        },
      });
    }

    // Get provenance links (merges, updates, etc.)
    const links = await this.db.prepare(`
      SELECT created_at, source_id, derivation_type, metadata
      FROM provenance_chain
      WHERE (derived_id = ? OR source_id = ?) AND derived_type = 'entity'
      ORDER BY created_at ASC
    `).bind(entityId, entityId).all();

    for (const link of links.results as any[]) {
      history.push({
        date: link.created_at,
        event: link.derivation_type,
        details: {
          source_id: link.source_id,
          metadata: link.metadata ? JSON.parse(link.metadata) : null,
        },
      });
    }

    // Sort by date
    return history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Batch log multiple extractions (for performance)
   */
  async logExtractionBatch(extractions: Array<{
    extractionType: ExtractionType;
    sourceMemoryId: string;
    extractedData: any;
    confidence: number;
    userId: string;
    containerTag: string;
    extractedEntityId?: string;
    extractedRelationshipId?: string;
  }>): Promise<string[]> {
    const ids: string[] = [];

    // Use transaction for batch insert
    // Note: D1 doesn't support explicit transactions yet, but batching helps
    for (const extraction of extractions) {
      const id = await this.logExtraction(extraction);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Get provenance statistics for a user
   */
  async getProvenanceStats(userId: string, containerTag: string): Promise<{
    total_extractions: number;
    total_provenance_links: number;
    extractions_by_type: Record<string, number>;
    derivations_by_type: Record<string, number>;
  }> {
    // Total extractions
    const extractionsResult = await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM extraction_log
      WHERE user_id = ? AND container_tag = ?
    `).bind(userId, containerTag).first<{ count: number }>();

    // Total provenance links
    const linksResult = await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM provenance_chain
      WHERE user_id = ? AND container_tag = ?
    `).bind(userId, containerTag).first<{ count: number }>();

    // Extractions by type
    const extractionsByTypeResult = await this.db.prepare(`
      SELECT extraction_type, COUNT(*) as count
      FROM extraction_log
      WHERE user_id = ? AND container_tag = ?
      GROUP BY extraction_type
    `).bind(userId, containerTag).all();

    const extractionsByType: Record<string, number> = {};
    for (const row of extractionsByTypeResult.results as any[]) {
      extractionsByType[row.extraction_type] = row.count;
    }

    // Derivations by type
    const derivationsByTypeResult = await this.db.prepare(`
      SELECT derivation_type, COUNT(*) as count
      FROM provenance_chain
      WHERE user_id = ? AND container_tag = ?
      GROUP BY derivation_type
    `).bind(userId, containerTag).all();

    const derivationsByType: Record<string, number> = {};
    for (const row of derivationsByTypeResult.results as any[]) {
      derivationsByType[row.derivation_type] = row.count;
    }

    return {
      total_extractions: extractionsResult?.count || 0,
      total_provenance_links: linksResult?.count || 0,
      extractions_by_type: extractionsByType,
      derivations_by_type: derivationsByType,
    };
  }
}
