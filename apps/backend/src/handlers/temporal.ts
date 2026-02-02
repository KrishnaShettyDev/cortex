/**
 * Temporal Query API Handlers
 *
 * RESTful API for temporal reasoning and time-travel queries:
 * - POST /v3/time-travel - Query memories as of specific date
 * - GET /v3/memories/:id/history - Get memory version history
 * - GET /v3/memories/superseded - Get superseded facts
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import {
  timeTravelQuery,
  getMemoryHistory,
  getCurrentlyValidMemories,
  getSupersededMemories,
} from '../lib/temporal';

/**
 * POST /v3/time-travel
 * Query memories valid at a specific point in time
 */
export async function timeTravelHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json<{
      as_of_date: string; // ISO timestamp
      query?: string;
      container_tag?: string;
      limit?: number;
    }>();

    if (!body.as_of_date) {
      return c.json({ error: 'as_of_date is required' }, 400);
    }

    // Validate date
    const asOfDate = new Date(body.as_of_date);
    if (isNaN(asOfDate.getTime())) {
      return c.json({ error: 'Invalid as_of_date format' }, 400);
    }

    const result = await timeTravelQuery(c.env.DB, {
      user_id: userId,
      as_of_date: body.as_of_date,
      query: body.query,
      container_tag: body.container_tag,
      limit: body.limit,
    });

    return c.json({
      memories: result.memories.map((m) => ({
        id: m.id,
        content: m.content,
        valid_from: m.valid_from,
        valid_to: m.valid_to,
        event_date: m.event_date,
        memory_type: m.memory_type,
        created_at: m.created_at,
      })),
      snapshot_date: result.snapshot_date,
      total: result.total_valid_at_time,
    });
  });
}

/**
 * GET /v3/memories/:id/history
 * Get version history for a memory (supersession chain)
 */
export async function getMemoryHistoryHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');

    const history = await getMemoryHistory(c.env.DB, memoryId);

    // Verify ownership (check first memory in history)
    if (history.length > 0 && history[0].user_id !== userId) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    return c.json({
      history: history.map((m) => ({
        id: m.id,
        content: m.content,
        valid_from: m.valid_from,
        valid_to: m.valid_to,
        event_date: m.event_date,
        supersedes: m.supersedes,
        superseded_by: m.superseded_by,
        memory_type: m.memory_type,
        created_at: m.created_at,
      })),
      total_versions: history.length,
    });
  });
}

/**
 * GET /v3/memories/current
 * Get currently valid memories (convenience endpoint)
 */
export async function getCurrentMemoriesHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('container_tag');
    const memoryType = c.req.query('memory_type') as 'episodic' | 'semantic' | undefined;
    const limit = parseInt(c.req.query('limit') || '100');

    const memories = await getCurrentlyValidMemories(c.env.DB, userId, {
      container_tag: containerTag,
      memory_type: memoryType,
      limit,
    });

    return c.json({
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        valid_from: m.valid_from,
        event_date: m.event_date,
        memory_type: m.memory_type,
        created_at: m.created_at,
      })),
      total: memories.length,
    });
  });
}

/**
 * GET /v3/memories/superseded
 * Get superseded/outdated memories
 */
export async function getSupersededMemoriesHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('container_tag');
    const since = c.req.query('since'); // ISO timestamp
    const limit = parseInt(c.req.query('limit') || '50');

    const memories = await getSupersededMemories(c.env.DB, userId, {
      container_tag: containerTag,
      since,
      limit,
    });

    return c.json({
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        valid_from: m.valid_from,
        valid_to: m.valid_to,
        event_date: m.event_date,
        superseded_by: m.superseded_by,
        memory_type: m.memory_type,
        created_at: m.created_at,
      })),
      total: memories.length,
    });
  });
}

/**
 * GET /v3/temporal/entity/:entityId/timeline
 * Get knowledge evolution timeline for an entity
 */
export async function getEntityTimelineHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const entityId = c.req.param('entityId');

    // Get entity to verify ownership
    const entity = await c.env.DB.prepare(
      'SELECT * FROM entities WHERE id = ? AND user_id = ?'
    ).bind(entityId, userId).first();

    if (!entity) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    // Get all memories mentioning this entity with their validity periods
    const memoriesResult = await c.env.DB.prepare(`
      SELECT m.id, m.content, m.valid_from, m.valid_to, m.event_date,
             m.supersedes, m.superseded_by, m.created_at, me.role
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ? AND m.user_id = ? AND m.is_forgotten = 0
      ORDER BY m.valid_from ASC
    `).bind(entityId, userId).all();

    // Get relationship changes
    const relationshipsResult = await c.env.DB.prepare(`
      SELECT r.*, e1.name as source_name, e2.name as target_name
      FROM entity_relationships r
      JOIN entities e1 ON e1.id = r.source_entity_id
      JOIN entities e2 ON e2.id = r.target_entity_id
      WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
        AND r.user_id = ?
      ORDER BY r.valid_from ASC
    `).bind(entityId, entityId, userId).all();

    // Build timeline events
    const events: Array<{
      date: string;
      type: 'memory_created' | 'memory_updated' | 'memory_superseded' | 'relationship_created' | 'relationship_ended';
      title: string;
      description: string;
      memoryId?: string;
      relationshipId?: string;
    }> = [];

    for (const memory of memoriesResult.results as any[]) {
      events.push({
        date: memory.created_at,
        type: 'memory_created',
        title: `Memory created (${memory.role})`,
        description: memory.content.substring(0, 100) + '...',
        memoryId: memory.id,
      });

      if (memory.supersedes) {
        events.push({
          date: memory.created_at,
          type: 'memory_updated',
          title: 'Knowledge updated',
          description: `Superseded previous knowledge`,
          memoryId: memory.id,
        });
      }

      if (memory.valid_to) {
        events.push({
          date: memory.valid_to,
          type: 'memory_superseded',
          title: 'Knowledge superseded',
          description: 'This information was replaced',
          memoryId: memory.id,
        });
      }
    }

    for (const relationship of relationshipsResult.results as any[]) {
      const isSource = relationship.source_entity_id === entityId;
      const otherEntity = isSource ? relationship.target_name : relationship.source_name;
      const direction = isSource ? 'to' : 'from';

      events.push({
        date: relationship.valid_from,
        type: 'relationship_created',
        title: `Relationship ${direction} ${otherEntity}`,
        description: `${relationship.relationship_type}`,
        relationshipId: relationship.id,
      });

      if (relationship.valid_to) {
        events.push({
          date: relationship.valid_to,
          type: 'relationship_ended',
          title: `Relationship ${direction} ${otherEntity} ended`,
          description: `${relationship.relationship_type}`,
          relationshipId: relationship.id,
        });
      }
    }

    // Sort by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return c.json({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.entity_type,
      },
      timeline: events,
      summary: {
        total_events: events.length,
        memory_changes: events.filter(e => e.type.startsWith('memory')).length,
        relationship_changes: events.filter(e => e.type.startsWith('relationship')).length,
      },
    });
  });
}

/**
 * GET /v3/temporal/timeline
 * Get timeline visualization data for a user
 */
export async function getTimelineHandler(
  c: Context<{ Bindings: Bindings }>
) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    const entityId = c.req.query('entity_id'); // Optional: focus on specific entity
    const containerTag = c.req.query('container_tag');

    let query = `
      SELECT m.id, m.content, m.created_at, m.event_date, m.valid_from, m.valid_to,
             m.memory_type, m.supersedes, m.superseded_by
      FROM memories m
      WHERE m.user_id = ? AND m.is_forgotten = 0
    `;
    const params: any[] = [userId];

    if (containerTag) {
      query += ' AND m.container_tag = ?';
      params.push(containerTag);
    }

    if (startDate) {
      query += ' AND m.created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND m.created_at <= ?';
      params.push(endDate);
    }

    if (entityId) {
      query += ' AND EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id AND me.entity_id = ?)';
      params.push(entityId);
    }

    query += ' ORDER BY m.created_at DESC LIMIT 200';

    const result = await c.env.DB.prepare(query).bind(...params).all();

    // Build timeline events
    const events: Array<{
      date: string;
      type: 'memory_created' | 'memory_updated' | 'memory_superseded' | 'entity_extracted';
      title: string;
      description: string;
      memoryId?: string;
      entityId?: string;
    }> = [];

    for (const memory of result.results as any[]) {
      const date = memory.event_date || memory.created_at;

      events.push({
        date,
        type: 'memory_created',
        title: `${memory.memory_type === 'semantic' ? 'Semantic fact' : 'Memory'} recorded`,
        description: memory.content.substring(0, 100) + '...',
        memoryId: memory.id,
      });

      if (memory.supersedes) {
        events.push({
          date,
          type: 'memory_updated',
          title: 'Knowledge updated',
          description: 'Previous information superseded',
          memoryId: memory.id,
        });
      }
    }

    // Sort by date
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return c.json({
      events,
      summary: {
        total_events: events.length,
        memory_changes: events.filter(e => e.type === 'memory_created').length,
        knowledge_updates: events.filter(e => e.type === 'memory_updated').length,
      },
      time_range: {
        start: startDate || (events[0]?.date || null),
        end: endDate || (events[events.length - 1]?.date || null),
      },
    });
  });
}
