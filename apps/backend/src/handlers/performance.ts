/**
 * Performance Monitoring API Handlers
 *
 * Endpoints:
 * - GET /v3/performance/stats - Get performance statistics
 * - GET /v3/performance/metrics - Get detailed metrics
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/performance/stats
 * Get performance statistics
 */
app.get('/stats', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const stats = {
      database: await getDatabaseStats(c.env.DB, userId),
      cache: await getCacheStats(c.env.CACHE, userId),
      system: await getSystemStats(c.env.DB),
    };

    return c.json(stats);
  } catch (error: any) {
    console.error('[Performance] Stats failed:', error);
    return c.json(
      {
        error: 'Failed to get performance stats',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/performance/metrics
 * Get detailed performance metrics
 */
app.get('/metrics', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    // Measure query latencies
    const metrics = {
      memory_list: await measureQueryLatency(c.env.DB, async () => {
        return c.env.DB.prepare(
          'SELECT * FROM memories WHERE user_id = ? AND is_latest = 1 AND is_forgotten = 0 LIMIT 50'
        )
          .bind(userId)
          .all();
      }),

      entity_list: await measureQueryLatency(c.env.DB, async () => {
        return c.env.DB.prepare('SELECT * FROM entities WHERE user_id = ? LIMIT 20')
          .bind(userId)
          .all();
      }),

      relationship_health: await measureQueryLatency(c.env.DB, async () => {
        return c.env.DB.prepare('SELECT COUNT(*) as count FROM entities WHERE user_id = ?')
          .bind(userId)
          .first();
      }),

      commitment_list: await measureQueryLatency(c.env.DB, async () => {
        return c.env.DB.prepare('SELECT * FROM commitments WHERE user_id = ? AND status = ? LIMIT 20')
          .bind(userId, 'pending')
          .all();
      }),
    };

    return c.json({
      latencies: metrics,
      target: {
        memory_list: 400,
        entity_list: 300,
        relationship_health: 200,
        commitment_list: 300,
      },
      status: {
        memory_list: metrics.memory_list < 400 ? 'good' : 'needs_optimization',
        entity_list: metrics.entity_list < 300 ? 'good' : 'needs_optimization',
        relationship_health: metrics.relationship_health < 200 ? 'good' : 'needs_optimization',
        commitment_list: metrics.commitment_list < 300 ? 'good' : 'needs_optimization',
      },
    });
  } catch (error: any) {
    console.error('[Performance] Metrics failed:', error);
    return c.json(
      {
        error: 'Failed to get performance metrics',
        message: error.message,
      },
      500
    );
  }
});

/**
 * Helper: Get database statistics
 */
async function getDatabaseStats(db: D1Database, userId: string) {
  const [memories, entities, commitments, relationships] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ?').bind(userId).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM entities WHERE user_id = ?').bind(userId).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM commitments WHERE user_id = ?').bind(userId).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM entity_relationships WHERE user_id = ?').bind(userId).first<{ count: number }>(),
  ]);

  return {
    total_memories: memories?.count || 0,
    total_entities: entities?.count || 0,
    total_commitments: commitments?.count || 0,
    total_relationships: relationships?.count || 0,
  };
}

/**
 * Helper: Get cache statistics (placeholder)
 */
async function getCacheStats(cache: KVNamespace, userId: string) {
  // KV doesn't provide built-in stats, so we estimate
  return {
    estimated_cached_searches: 'N/A',
    cache_hit_rate: 'N/A',
    note: 'Cache stats not available in KV',
  };
}

/**
 * Helper: Get system statistics
 */
async function getSystemStats(db: D1Database) {
  const [tableCount, indexCount] = await Promise.all([
    db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='index'").first<{ count: number }>(),
  ]);

  return {
    total_tables: tableCount?.count || 0,
    total_indexes: indexCount?.count || 0,
  };
}

/**
 * Helper: Measure query latency
 */
async function measureQueryLatency(db: D1Database, query: () => Promise<any>): Promise<number> {
  const start = Date.now();
  await query();
  return Date.now() - start;
}

export default app;
