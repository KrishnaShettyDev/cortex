/**
 * Entity Graph API Handlers
 *
 * RESTful API for querying the knowledge graph:
 * - GET /v3/entities - List entities
 * - GET /v3/entities/:id - Get entity details
 * - GET /v3/entities/:id/relationships - Get entity relationships
 * - GET /v3/entities/:id/memories - Get entity memories
 * - GET /v3/graph/search - Search entities
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import {
  getEntitiesByUser,
  getEntityById,
  getEntityRelationships,
  getEntityMemories,
  getMemoryEntities,
} from '../lib/db/entities';
import { getMemoryById } from '../lib/db/memories';

/**
 * GET /v3/entities
 * List entities for user
 */
export async function listEntities(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('containerTag');
    const entityType = c.req.query('entity_type');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const entities = await getEntitiesByUser(c.env.DB, userId, {
      entity_type: entityType,
      container_tag: containerTag,
      limit,
      offset,
    });

    return c.json({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        entity_type: e.entity_type,
        attributes: e.attributes,
        importance_score: e.importance_score,
        mention_count: e.mention_count,
        last_mentioned: e.last_mentioned,
        created_at: e.created_at,
      })),
      total: entities.length,
      limit,
      offset,
    });
  });
}

/**
 * GET /v3/entities/:id
 * Get entity details with relationships and recent memories
 */
export async function getEntity(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('id');

    // Get entity
    const entity = await getEntityById(c.env.DB, entityId);
    if (!entity || entity.user_id !== userId) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    // Get relationships
    const relationships = await getEntityRelationships(c.env.DB, entityId, {
      direction: 'both',
    });

    // Get related entities
    const relatedEntityIds = new Set<string>();
    relationships.forEach((r) => {
      if (r.source_entity_id !== entityId) {
        relatedEntityIds.add(r.source_entity_id);
      }
      if (r.target_entity_id !== entityId) {
        relatedEntityIds.add(r.target_entity_id);
      }
    });

    const relatedEntities = await Promise.all(
      Array.from(relatedEntityIds).map((id) => getEntityById(c.env.DB, id))
    );

    const relatedEntitiesMap = new Map(
      relatedEntities.filter((e) => e !== null).map((e) => [e!.id, e!])
    );

    // Get recent memories
    const memoryIds = await getEntityMemories(c.env.DB, entityId, 10);
    const memories = await Promise.all(
      memoryIds.map((id) => getMemoryById(c.env.DB, id))
    );

    return c.json({
      entity: {
        id: entity.id,
        name: entity.name,
        entity_type: entity.entity_type,
        attributes: entity.attributes,
        importance_score: entity.importance_score,
        mention_count: entity.mention_count,
        last_mentioned: entity.last_mentioned,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
      },
      relationships: relationships.map((r) => ({
        id: r.id,
        source_entity: relatedEntitiesMap.get(r.source_entity_id) || {
          id: r.source_entity_id,
          name: 'Unknown',
        },
        target_entity: relatedEntitiesMap.get(r.target_entity_id) || {
          id: r.target_entity_id,
          name: 'Unknown',
        },
        relationship_type: r.relationship_type,
        attributes: r.attributes,
        confidence: r.confidence,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
      })),
      recent_memories: memories
        .filter((m) => m !== null)
        .map((m) => ({
          id: m!.id,
          content: m!.content,
          source: m!.source,
          created_at: m!.created_at,
        })),
    });
  });
}

/**
 * GET /v3/entities/:id/relationships
 * Get entity relationships
 */
export async function getEntityRelationshipsHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('id');
    const direction = c.req.query('direction') as
      | 'outgoing'
      | 'incoming'
      | 'both'
      | undefined;
    const relationshipType = c.req.query('relationship_type');
    const validAt = c.req.query('valid_at'); // ISO date

    // Verify entity belongs to user
    const entity = await getEntityById(c.env.DB, entityId);
    if (!entity || entity.user_id !== userId) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    const relationships = await getEntityRelationships(c.env.DB, entityId, {
      direction: direction || 'both',
      relationship_type: relationshipType,
      valid_at: validAt,
    });

    // Fetch related entities
    const relatedEntityIds = new Set<string>();
    relationships.forEach((r) => {
      relatedEntityIds.add(r.source_entity_id);
      relatedEntityIds.add(r.target_entity_id);
    });

    const relatedEntities = await Promise.all(
      Array.from(relatedEntityIds).map((id) => getEntityById(c.env.DB, id))
    );

    const entityMap = new Map(
      relatedEntities.filter((e) => e !== null).map((e) => [e!.id, e!])
    );

    return c.json({
      relationships: relationships.map((r) => ({
        id: r.id,
        source_entity: {
          id: r.source_entity_id,
          name: entityMap.get(r.source_entity_id)?.name || 'Unknown',
          entity_type: entityMap.get(r.source_entity_id)?.entity_type,
        },
        target_entity: {
          id: r.target_entity_id,
          name: entityMap.get(r.target_entity_id)?.name || 'Unknown',
          entity_type: entityMap.get(r.target_entity_id)?.entity_type,
        },
        relationship_type: r.relationship_type,
        attributes: r.attributes,
        confidence: r.confidence,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        source_memory_count: r.source_memory_ids.length,
      })),
      total: relationships.length,
    });
  });
}

/**
 * GET /v3/entities/:id/memories
 * Get memories mentioning this entity
 */
export async function getEntityMemoriesHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '50');

    // Verify entity belongs to user
    const entity = await getEntityById(c.env.DB, entityId);
    if (!entity || entity.user_id !== userId) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    const memoryIds = await getEntityMemories(c.env.DB, entityId, limit);
    const memories = await Promise.all(
      memoryIds.map((id) => getMemoryById(c.env.DB, id))
    );

    return c.json({
      memories: memories
        .filter((m) => m !== null)
        .map((m) => ({
          id: m!.id,
          content: m!.content,
          source: m!.source,
          created_at: m!.created_at,
        })),
      total: memories.length,
    });
  });
}

/**
 * GET /v3/graph/search
 * Search entities by name or attributes
 */
export async function searchEntities(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const query = c.req.query('q');
    const entityType = c.req.query('entity_type');
    const containerTag = c.req.query('containerTag');
    const limit = parseInt(c.req.query('limit') || '20');

    if (!query || query.trim().length === 0) {
      return c.json({ error: 'Query is required' }, 400);
    }

    // Simple search using LIKE
    let sql = `
      SELECT * FROM entities
      WHERE user_id = ?
      AND (name LIKE ? OR canonical_name LIKE ?)
    `;
    const bindings: any[] = [userId, `%${query}%`, `%${query.toLowerCase()}%`];

    if (entityType) {
      sql += ' AND entity_type = ?';
      bindings.push(entityType);
    }

    if (containerTag) {
      sql += ' AND container_tag = ?';
      bindings.push(containerTag);
    }

    sql += ' ORDER BY importance_score DESC, mention_count DESC LIMIT ?';
    bindings.push(limit);

    const result = await c.env.DB.prepare(sql)
      .bind(...bindings)
      .all<any>();

    const entities = (result.results || []).map((e) => ({
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      attributes: JSON.parse(e.attributes || '{}'),
      importance_score: e.importance_score,
      mention_count: e.mention_count,
      last_mentioned: e.last_mentioned,
    }));

    return c.json({
      entities,
      total: entities.length,
      query,
    });
  });
}

/**
 * GET /v3/graph/stats
 * Get knowledge graph statistics
 */
export async function getGraphStats(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('containerTag');

    // Entity counts by type
    let entityCountQuery = `
      SELECT entity_type, COUNT(*) as count
      FROM entities
      WHERE user_id = ?
    `;
    const bindings: any[] = [userId];

    if (containerTag) {
      entityCountQuery += ' AND container_tag = ?';
      bindings.push(containerTag);
    }

    entityCountQuery += ' GROUP BY entity_type';

    const entityCounts = await c.env.DB.prepare(entityCountQuery)
      .bind(...bindings)
      .all<{ entity_type: string; count: number }>();

    // Relationship counts by type
    let relationshipCountQuery = `
      SELECT er.relationship_type, COUNT(*) as count
      FROM entity_relationships er
      JOIN entities e ON er.source_entity_id = e.id
      WHERE e.user_id = ? AND er.valid_to IS NULL
    `;
    const relBindings: any[] = [userId];

    if (containerTag) {
      relationshipCountQuery += ' AND e.container_tag = ?';
      relBindings.push(containerTag);
    }

    relationshipCountQuery += ' GROUP BY er.relationship_type';

    const relationshipCounts = await c.env.DB.prepare(relationshipCountQuery)
      .bind(...relBindings)
      .all<{ relationship_type: string; count: number }>();

    // Total counts
    const totalEntities = (entityCounts.results || []).reduce(
      (sum, e) => sum + e.count,
      0
    );
    const totalRelationships = (relationshipCounts.results || []).reduce(
      (sum, r) => sum + r.count,
      0
    );

    return c.json({
      total_entities: totalEntities,
      total_relationships: totalRelationships,
      entities_by_type: Object.fromEntries(
        (entityCounts.results || []).map((e) => [e.entity_type, e.count])
      ),
      relationships_by_type: Object.fromEntries(
        (relationshipCounts.results || []).map((r) => [
          r.relationship_type,
          r.count,
        ])
      ),
    });
  });
}
