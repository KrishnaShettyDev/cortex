/**
 * Memory Consolidation & Importance Scoring Handlers
 *
 * Endpoints:
 * - POST /v3/memories/:id/recalculate-importance - Recalculate importance score
 * - POST /v3/memories/decay-cycle - Run decay cycle for user
 * - GET /v3/memories/consolidation-stats - Get consolidation statistics
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { getMemoryById } from '../lib/db/memories';
import { runMemoryDecay, scoreMemoryImportance } from '../lib/consolidation';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * POST /v3/memories/:id/recalculate-importance
 * Manually recalculate importance score for a memory
 */
app.post('/:memoryId/recalculate-importance', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { memoryId } = c.req.param();

  // Get memory (with user_id filter for security)
  const memory = await getMemoryById(c.env.DB, memoryId, userId);
  if (!memory) {
    return c.json({ error: 'Memory not found' }, 404);
  }

  try {
    // Calculate importance score
    const importanceScore = await scoreMemoryImportance(
      c.env.DB,
      c.env.AI,
      memory,
      {
        user_id: memory.user_id,
        current_date: new Date(),
        access_count: memory.access_count || 0,
        last_accessed: memory.last_accessed || undefined,
      }
    );

    // Update in database
    await c.env.DB.prepare(
      'UPDATE memories SET importance_score = ?, updated_at = ? WHERE id = ?'
    )
      .bind(importanceScore.score, new Date().toISOString(), memoryId)
      .run();

    return c.json({
      success: true,
      memory_id: memoryId,
      importance_score: importanceScore,
    });
  } catch (error: any) {
    console.error('[Consolidation] Importance recalculation failed:', error);
    return c.json(
      {
        error: 'Failed to recalculate importance',
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /v3/memories/decay-cycle
 * Run decay cycle for the current user
 */
app.post('/decay-cycle', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    console.log(`[Consolidation] Starting decay cycle for user ${userId}`);

    const stats = await runMemoryDecay(c.env.DB, c.env.AI, userId);

    console.log('[Consolidation] Decay cycle complete:', stats);

    return c.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    console.error('[Consolidation] Decay cycle failed:', error);
    return c.json(
      {
        error: 'Decay cycle failed',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/memories/consolidation-stats
 * Get consolidation statistics for the current user
 */
app.get('/consolidation-stats', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    // Get stats
    const [
      totalMemories,
      episodicMemories,
      semanticMemories,
      lowImportanceMemories,
      consolidationCandidates,
      avgImportance,
    ] = await Promise.all([
      // Total active memories
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND valid_to IS NULL AND is_forgotten = 0'
      )
        .bind(userId)
        .first<{ count: number }>(),

      // Episodic memories
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND memory_type = 'episodic' AND valid_to IS NULL AND is_forgotten = 0"
      )
        .bind(userId)
        .first<{ count: number }>(),

      // Semantic memories
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND memory_type = 'semantic' AND valid_to IS NULL AND is_forgotten = 0"
      )
        .bind(userId)
        .first<{ count: number }>(),

      // Low importance memories
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND importance_score < 0.3 AND valid_to IS NULL AND is_forgotten = 0'
      )
        .bind(userId)
        .first<{ count: number }>(),

      // Consolidation candidates (episodic, low importance, 30+ days old)
      c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM memories
         WHERE user_id = ?
           AND memory_type = 'episodic'
           AND importance_score < 0.3
           AND valid_to IS NULL
           AND is_forgotten = 0
           AND datetime(created_at) < datetime('now', '-30 days')`
      )
        .bind(userId)
        .first<{ count: number }>(),

      // Average importance score
      c.env.DB.prepare(
        'SELECT AVG(importance_score) as avg FROM memories WHERE user_id = ? AND valid_to IS NULL AND is_forgotten = 0'
      )
        .bind(userId)
        .first<{ avg: number }>(),
    ]);

    return c.json({
      total_memories: totalMemories?.count || 0,
      episodic_memories: episodicMemories?.count || 0,
      semantic_memories: semanticMemories?.count || 0,
      low_importance_memories: lowImportanceMemories?.count || 0,
      consolidation_candidates: consolidationCandidates?.count || 0,
      average_importance: avgImportance?.avg || 0,
    });
  } catch (error: any) {
    console.error('[Consolidation] Failed to get stats:', error);
    return c.json(
      {
        error: 'Failed to get consolidation stats',
        message: error.message,
      },
      500
    );
  }
});

export default app;
