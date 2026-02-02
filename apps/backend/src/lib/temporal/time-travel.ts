/**
 * Time Travel Queries
 *
 * Query memories as they were valid at a specific point in time.
 * Enables "What did I know/think in June?" type queries.
 */

import type { TimeTravelQuery, TimeTravelResult, TemporalMemory } from './types';
import { TemporalError } from './types';

/**
 * Query memories valid at a specific point in time
 */
export async function timeTravelQuery(
  db: D1Database,
  query: TimeTravelQuery
): Promise<TimeTravelResult> {
  try {
    const asOfDate = new Date(query.as_of_date);
    if (isNaN(asOfDate.getTime())) {
      throw new TemporalError('Invalid as_of_date timestamp', false);
    }

    // Build query for memories valid at the specified time
    let sql = `
      SELECT id, user_id, content, valid_from, valid_to, event_date,
             supersedes, superseded_by, memory_type, created_at, updated_at
      FROM memories
      WHERE user_id = ?
        AND valid_from <= ?
        AND (valid_to IS NULL OR valid_to > ?)
        AND is_forgotten = 0
    `;

    const bindings: any[] = [
      query.user_id,
      query.as_of_date,
      query.as_of_date,
    ];

    // Optional filters
    if (query.container_tag) {
      sql += ' AND container_tag = ?';
      bindings.push(query.container_tag);
    }

    if (query.query) {
      sql += ' AND content LIKE ?';
      bindings.push(`%${query.query}%`);
    }

    sql += ' ORDER BY valid_from DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      bindings.push(query.limit);
    } else {
      sql += ' LIMIT 100'; // Default limit
    }

    const result = await db
      .prepare(sql)
      .bind(...bindings)
      .all<TemporalMemory>();

    const memories = result.results || [];

    return {
      memories,
      snapshot_date: query.as_of_date,
      total_valid_at_time: memories.length,
    };
  } catch (error: any) {
    console.error('[TimeTravelQuery] Query failed:', error);
    throw new TemporalError(
      `Time travel query failed: ${error.message}`,
      true,
      { as_of_date: query.as_of_date }
    );
  }
}

/**
 * Get memory history (all versions/supersessions)
 */
export async function getMemoryHistory(
  db: D1Database,
  memoryId: string
): Promise<TemporalMemory[]> {
  try {
    // Get the memory and trace back supersession chain
    const memory = await db
      .prepare(
        `SELECT id, user_id, content, valid_from, valid_to, event_date,
                supersedes, superseded_by, memory_type, created_at, updated_at
         FROM memories
         WHERE id = ?`
      )
      .bind(memoryId)
      .first<TemporalMemory>();

    if (!memory) {
      return [];
    }

    const history: TemporalMemory[] = [memory];

    // Trace back through supersedes chain
    let currentId = memory.supersedes;
    while (currentId) {
      const predecessor = await db
        .prepare(
          `SELECT id, user_id, content, valid_from, valid_to, event_date,
                  supersedes, superseded_by, memory_type, created_at, updated_at
           FROM memories
           WHERE id = ?`
        )
        .bind(currentId)
        .first<TemporalMemory>();

      if (!predecessor) break;

      history.push(predecessor);
      currentId = predecessor.supersedes;

      // Prevent infinite loops
      if (history.length > 50) {
        console.warn('[getMemoryHistory] Supersession chain too long, truncating');
        break;
      }
    }

    // Trace forward through superseded_by chain
    currentId = memory.superseded_by;
    while (currentId) {
      const successor = await db
        .prepare(
          `SELECT id, user_id, content, valid_from, valid_to, event_date,
                  supersedes, superseded_by, memory_type, created_at, updated_at
           FROM memories
           WHERE id = ?`
        )
        .bind(currentId)
        .first<TemporalMemory>();

      if (!successor) break;

      history.unshift(successor); // Add to beginning
      currentId = successor.superseded_by;

      if (history.length > 100) {
        console.warn('[getMemoryHistory] Supersession chain too long, truncating');
        break;
      }
    }

    // Sort by valid_from
    history.sort((a, b) => {
      return new Date(a.valid_from).getTime() - new Date(b.valid_from).getTime();
    });

    return history;
  } catch (error: any) {
    console.error('[getMemoryHistory] Failed:', error);
    throw new TemporalError(
      `Failed to get memory history: ${error.message}`,
      true,
      { memory_id: memoryId }
    );
  }
}

/**
 * Get currently valid memories (convenience function)
 */
export async function getCurrentlyValidMemories(
  db: D1Database,
  userId: string,
  options?: {
    container_tag?: string;
    memory_type?: 'episodic' | 'semantic';
    limit?: number;
  }
): Promise<TemporalMemory[]> {
  let sql = `
    SELECT id, user_id, content, valid_from, valid_to, event_date,
           supersedes, superseded_by, memory_type, created_at, updated_at
    FROM memories
    WHERE user_id = ?
      AND valid_to IS NULL
      AND is_forgotten = 0
  `;

  const bindings: any[] = [userId];

  if (options?.container_tag) {
    sql += ' AND container_tag = ?';
    bindings.push(options.container_tag);
  }

  if (options?.memory_type) {
    sql += ' AND memory_type = ?';
    bindings.push(options.memory_type);
  }

  sql += ' ORDER BY created_at DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    bindings.push(options.limit);
  } else {
    sql += ' LIMIT 100';
  }

  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<TemporalMemory>();

  return result.results || [];
}

/**
 * Get superseded memories (historical facts that are no longer true)
 */
export async function getSupersededMemories(
  db: D1Database,
  userId: string,
  options?: {
    container_tag?: string;
    since?: string; // ISO timestamp
    limit?: number;
  }
): Promise<TemporalMemory[]> {
  let sql = `
    SELECT id, user_id, content, valid_from, valid_to, event_date,
           supersedes, superseded_by, memory_type, created_at, updated_at
    FROM memories
    WHERE user_id = ?
      AND valid_to IS NOT NULL
      AND is_forgotten = 0
  `;

  const bindings: any[] = [userId];

  if (options?.container_tag) {
    sql += ' AND container_tag = ?';
    bindings.push(options.container_tag);
  }

  if (options?.since) {
    sql += ' AND valid_to >= ?';
    bindings.push(options.since);
  }

  sql += ' ORDER BY valid_to DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    bindings.push(options.limit);
  } else {
    sql += ' LIMIT 50';
  }

  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<TemporalMemory>();

  return result.results || [];
}
