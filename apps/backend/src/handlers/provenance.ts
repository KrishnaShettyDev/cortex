/**
 * Provenance API Handlers
 *
 * RESTful API for provenance tracking and chain of custody:
 * - GET /v3/provenance/:artifactType/:artifactId - Get full provenance chain
 * - GET /v3/provenance/entity/:entityId/sources - Get source memories for entity
 * - GET /v3/provenance/memory/:memoryId/extractions - Get all extractions from memory
 * - GET /v3/provenance/entity/:entityId/history - Audit trail for entity changes
 * - GET /v3/provenance/stats - Get provenance statistics
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import { ProvenanceTracker } from '../lib/provenance/tracker';

/**
 * GET /v3/provenance/:artifactType/:artifactId
 * Get full provenance chain for an artifact (forward + backward)
 */
export async function getProvenanceChainHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const artifactType = c.req.param('artifactType') as 'memory' | 'entity' | 'relationship' | 'commitment';
    const artifactId = c.req.param('artifactId');
    const direction = (c.req.query('direction') || 'both') as 'forward' | 'backward' | 'both';
    const maxDepth = parseInt(c.req.query('maxDepth') || '10');

    // Validate artifact type
    const validTypes = ['memory', 'entity', 'relationship', 'commitment'];
    if (!validTypes.includes(artifactType)) {
      return c.json({ error: `Invalid artifact type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    // Verify ownership
    const ownership = await verifyArtifactOwnership(c.env.DB, artifactType, artifactId, userId);
    if (!ownership.owned) {
      return c.json({ error: 'Artifact not found or access denied' }, 404);
    }

    // Get provenance chain
    const tracker = new ProvenanceTracker(c.env.DB);
    const chain = await tracker.getProvenanceChain(artifactId, artifactType, direction, maxDepth);

    return c.json({
      root: chain.root,
      nodes: chain.nodes,
      edges: chain.edges,
      metadata: {
        total_nodes: chain.nodes.length,
        total_edges: chain.edges.length,
        max_depth: maxDepth,
        direction,
      },
    });
  });
}

/**
 * GET /v3/provenance/entity/:entityId/sources
 * Get source memories that mentioned this entity
 */
export async function getEntitySourcesHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('entityId');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    // Verify entity ownership
    const entity = await c.env.DB.prepare(
      'SELECT * FROM entities WHERE id = ? AND user_id = ?'
    ).bind(entityId, userId).first();

    if (!entity) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    // Get source memories via provenance tracker
    const tracker = new ProvenanceTracker(c.env.DB);
    const sourceMemories = await tracker.getSourceMemoriesForEntity(entityId);

    // Apply pagination
    const paginatedMemories = sourceMemories.slice(offset, offset + limit);

    return c.json({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.entity_type,
      },
      source_memories: paginatedMemories.map(m => ({
        memory_id: m.id,
        content: m.content.substring(0, 200) + (m.content.length > 200 ? '...' : ''),
        confidence: m.confidence,
        extraction_date: m.extraction_date,
        created_at: m.created_at,
      })),
      pagination: {
        total: sourceMemories.length,
        limit,
        offset,
        has_more: offset + limit < sourceMemories.length,
      },
    });
  });
}

/**
 * GET /v3/provenance/memory/:memoryId/extractions
 * Get all extractions from a memory (entities, relationships, facts, commitments)
 */
export async function getMemoryExtractionsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('memoryId');

    // Verify memory ownership
    const memory = await c.env.DB.prepare(
      'SELECT * FROM memories WHERE id = ? AND user_id = ?'
    ).bind(memoryId, userId).first();

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    // Get all extractions from memory
    const tracker = new ProvenanceTracker(c.env.DB);
    const extractions = await tracker.getExtractionsFromMemory(memoryId);

    // Group by extraction type
    const extractionsByType: Record<string, any[]> = {
      entity: [],
      relationship: [],
      fact: [],
      commitment: [],
      temporal: [],
    };

    for (const extraction of extractions) {
      extractionsByType[extraction.extraction_type].push({
        extraction_id: extraction.id,
        extracted_data: extraction.extracted_data,
        extracted_entity_id: extraction.extracted_entity_id,
        extracted_relationship_id: extraction.extracted_relationship_id,
        confidence: extraction.confidence,
        extractor_version: extraction.extractor_version,
        created_at: extraction.created_at,
      });
    }

    return c.json({
      memory: {
        id: memory.id,
        content: memory.content,
        created_at: memory.created_at,
      },
      extractions: extractionsByType,
      summary: {
        total_extractions: extractions.length,
        entities_extracted: extractionsByType.entity.length,
        relationships_extracted: extractionsByType.relationship.length,
        facts_extracted: extractionsByType.fact.length,
        commitments_extracted: extractionsByType.commitment.length,
        temporal_extracted: extractionsByType.temporal.length,
      },
    });
  });
}

/**
 * GET /v3/provenance/entity/:entityId/history
 * Audit trail for entity (all updates, merges, supersessions)
 */
export async function getEntityHistoryHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('entityId');

    // Verify entity ownership
    const entity = await c.env.DB.prepare(
      'SELECT * FROM entities WHERE id = ? AND user_id = ?'
    ).bind(entityId, userId).first();

    if (!entity) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    // Get entity history
    const tracker = new ProvenanceTracker(c.env.DB);
    const history = await tracker.getEntityHistory(entityId);

    return c.json({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.entity_type,
        created_at: entity.created_at,
      },
      history: history.map(event => ({
        date: event.date,
        event_type: event.event,
        details: event.details,
      })),
      summary: {
        total_events: history.length,
        first_event: history[0]?.date,
        last_event: history[history.length - 1]?.date,
        event_types: Array.from(new Set(history.map(e => e.event))),
      },
    });
  });
}

/**
 * GET /v3/provenance/stats
 * Get provenance statistics for user
 */
export async function getProvenanceStatsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('container_tag') || 'default';

    // Get provenance stats
    const tracker = new ProvenanceTracker(c.env.DB);
    const stats = await tracker.getProvenanceStats(userId, containerTag);

    return c.json({
      user_id: userId,
      container_tag: containerTag,
      total_extractions: stats.total_extractions,
      total_provenance_links: stats.total_provenance_links,
      extractions_by_type: stats.extractions_by_type,
      derivations_by_type: stats.derivations_by_type,
      calculated_at: new Date().toISOString(),
    });
  });
}

/**
 * GET /v3/provenance/memory/:memoryId/chain
 * Get what was derived from a specific memory (forward chain only)
 */
export async function getMemoryDerivationsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('memoryId');

    // Verify memory ownership
    const memory = await c.env.DB.prepare(
      'SELECT * FROM memories WHERE id = ? AND user_id = ?'
    ).bind(memoryId, userId).first();

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    // Get forward chain (what was derived from this memory)
    const tracker = new ProvenanceTracker(c.env.DB);
    const chain = await tracker.getProvenanceChain(memoryId, 'memory', 'forward', 5);

    return c.json({
      memory: {
        id: memory.id,
        content: memory.content.substring(0, 200) + (memory.content.length > 200 ? '...' : ''),
        created_at: memory.created_at,
      },
      derivations: {
        nodes: chain.nodes.filter(n => n.id !== memoryId), // Exclude root
        edges: chain.edges,
      },
      summary: {
        total_derivations: chain.nodes.length - 1,
        entities_derived: chain.nodes.filter(n => n.type === 'entity').length,
        relationships_derived: chain.nodes.filter(n => n.type === 'relationship').length,
        facts_derived: chain.nodes.filter(n => n.type === 'fact').length,
        commitments_derived: chain.nodes.filter(n => n.type === 'commitment').length,
      },
    });
  });
}

/**
 * GET /v3/provenance/relationship/:relationshipId/sources
 * Get source memories for a relationship
 */
export async function getRelationshipSourcesHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const relationshipId = c.req.param('relationshipId');

    // Verify relationship ownership
    const relationship = await c.env.DB.prepare(
      'SELECT * FROM entity_relationships WHERE id = ? AND user_id = ?'
    ).bind(relationshipId, userId).first();

    if (!relationship) {
      return c.json({ error: 'Relationship not found' }, 404);
    }

    // Get source memories from source_memory_ids
    const sourceMemoryIds = relationship.source_memory_ids
      ? JSON.parse(relationship.source_memory_ids)
      : [];

    if (sourceMemoryIds.length === 0) {
      return c.json({
        relationship: {
          id: relationship.id,
          relationship_type: relationship.relationship_type,
        },
        source_memories: [],
        total: 0,
      });
    }

    // Fetch memories
    const placeholders = sourceMemoryIds.map(() => '?').join(',');
    const memoriesResult = await c.env.DB.prepare(`
      SELECT id, content, created_at
      FROM memories
      WHERE id IN (${placeholders})
        AND user_id = ?
      ORDER BY created_at DESC
    `).bind(...sourceMemoryIds, userId).all();

    const memories = memoriesResult.results as any[];

    return c.json({
      relationship: {
        id: relationship.id,
        relationship_type: relationship.relationship_type,
        source_entity: relationship.source_entity_id,
        target_entity: relationship.target_entity_id,
        confidence: relationship.confidence,
      },
      source_memories: memories.map(m => ({
        memory_id: m.id,
        content: m.content.substring(0, 200) + (m.content.length > 200 ? '...' : ''),
        created_at: m.created_at,
      })),
      total: memories.length,
    });
  });
}

/**
 * Helper: Verify artifact ownership
 */
async function verifyArtifactOwnership(
  db: D1Database,
  artifactType: string,
  artifactId: string,
  userId: string
): Promise<{ owned: boolean; artifact?: any }> {
  let query: string;
  let table: string;

  switch (artifactType) {
    case 'memory':
      table = 'memories';
      break;
    case 'entity':
      table = 'entities';
      break;
    case 'relationship':
      table = 'entity_relationships';
      break;
    case 'commitment':
      table = 'commitments';
      break;
    default:
      return { owned: false };
  }

  query = `SELECT * FROM ${table} WHERE id = ? AND user_id = ?`;
  const result = await db.prepare(query).bind(artifactId, userId).first();

  return {
    owned: result !== null,
    artifact: result || undefined,
  };
}
