/**
 * Learning API Handlers
 *
 * Endpoints:
 * - GET /v3/learnings - List learnings
 * - GET /v3/learnings/profile - Get user's cognitive profile
 * - GET /v3/learnings/:id - Get learning details with evidence
 * - POST /v3/learnings/:id/validate - Validate/invalidate a learning
 * - POST /v3/learnings/:id/invalidate - Mark learning as invalid
 * - GET /v3/learnings/categories - Get learnings by category
 * - POST /v3/learnings/backfill - Start learning extraction backfill
 * - GET /v3/learnings/backfill - Get backfill progress
 * - POST /v3/learnings/backfill/pause - Pause backfill
 * - DELETE /v3/learnings/backfill - Reset backfill
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { LearningRepository } from '../lib/cognitive/learning/repository';
import {
  runLearningBackfill,
  pauseBackfill,
  getBackfillProgress,
  resetBackfill,
} from '../lib/cognitive/learning/backfill';
import type {
  Learning,
  LearningCategory,
  LearningStatus,
  LearningStrength,
  ValidateLearningBody,
} from '../lib/cognitive/types';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/learnings/profile
 * Get user's cognitive profile (aggregated learnings)
 */
app.get('/profile', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const repository = new LearningRepository(c.env.DB);
    const profile = await repository.getUserProfile(userId);

    return c.json({
      profile,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Profile failed:', error);
    return c.json(
      {
        error: 'Failed to get cognitive profile',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/learnings/categories
 * Get learnings grouped by category
 */
app.get('/categories', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const repository = new LearningRepository(c.env.DB);

    const categories: LearningCategory[] = [
      'preference', 'habit', 'relationship', 'work_pattern',
      'health', 'interest', 'routine', 'communication',
      'decision_style', 'value', 'goal', 'skill', 'other',
    ];

    const result: Record<string, Learning[]> = {};

    for (const category of categories) {
      const { learnings } = await repository.listLearnings(userId, {
        category,
        status: 'active',
        limit: 10,
      });
      if (learnings.length > 0) {
        result[category] = learnings;
      }
    }

    return c.json({
      categories: result,
      total_categories: Object.keys(result).length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Categories failed:', error);
    return c.json(
      {
        error: 'Failed to get learnings by category',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/learnings/backfill
 * Start learning extraction backfill job
 */
app.post('/backfill', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json<{
    batchSize?: number;
    delayMs?: number;
    maxMemories?: number;
    startDate?: string;
    endDate?: string;
  }>().catch(() => ({}));

  try {
    const config = {
      batchSize: body.batchSize || 50,
      delayBetweenBatches: body.delayMs || 1000, // 1 second default
      maxMemories: body.maxMemories,
      startFromDate: body.startDate,
      endAtDate: body.endDate,
      userId, // Only process memories for this user
    };

    // Start backfill (async - returns immediately with progress)
    const backfillId = `backfill_${userId}`;

    // Check if already running
    const existingProgress = await getBackfillProgress(c.env.DB, backfillId);
    if (existingProgress && existingProgress.status === 'running') {
      return c.json({
        error: 'Backfill already running',
        progress: existingProgress,
      }, 409);
    }

    // Run in background using waitUntil
    c.executionCtx.waitUntil(
      runLearningBackfill(c.env.DB, c.env.AI, config, backfillId)
        .catch(err => console.error('[Backfill] Background job failed:', err))
    );

    // Return immediately with initial progress
    const progress = await getBackfillProgress(c.env.DB, backfillId);

    return c.json({
      message: 'Backfill started',
      backfillId,
      progress,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Backfill start failed:', error);
    return c.json(
      {
        error: 'Failed to start backfill',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/learnings/backfill
 * Get backfill progress
 */
app.get('/backfill', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const backfillId = `backfill_${userId}`;

  try {
    const progress = await getBackfillProgress(c.env.DB, backfillId);

    if (!progress) {
      return c.json({
        message: 'No backfill job found',
        progress: null,
      });
    }

    return c.json({
      progress,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Backfill progress failed:', error);
    return c.json(
      {
        error: 'Failed to get backfill progress',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/learnings/backfill/pause
 * Pause running backfill job
 */
app.post('/backfill/pause', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const backfillId = `backfill_${userId}`;

  try {
    const progress = await pauseBackfill(c.env.DB, backfillId);

    if (!progress) {
      return c.json({ error: 'No backfill job found' }, 404);
    }

    return c.json({
      message: 'Backfill paused',
      progress,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Backfill pause failed:', error);
    return c.json(
      {
        error: 'Failed to pause backfill',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * DELETE /v3/learnings/backfill
 * Reset backfill job (start over)
 */
app.delete('/backfill', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const backfillId = `backfill_${userId}`;

  try {
    await resetBackfill(c.env.DB, backfillId);

    return c.json({
      message: 'Backfill reset',
      backfillId,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Backfill reset failed:', error);
    return c.json(
      {
        error: 'Failed to reset backfill',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/learnings
 * List learnings for the current user
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const category = c.req.query('category') as LearningCategory | undefined;
  const status = (c.req.query('status') || 'active') as LearningStatus;
  const strength = c.req.query('strength') as LearningStrength | undefined;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const repository = new LearningRepository(c.env.DB);
    const { learnings, total } = await repository.listLearnings(userId, {
      category,
      status,
      strength,
      limit,
      offset,
    });

    return c.json({
      learnings,
      total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] List failed:', error);
    return c.json(
      {
        error: 'Failed to list learnings',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/learnings/:id
 * Get learning details with evidence
 */
app.get('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const repository = new LearningRepository(c.env.DB);

    const learning = await repository.getLearning(id);
    if (!learning) {
      return c.json({ error: 'Learning not found' }, 404);
    }

    // Verify ownership
    if (learning.user_id !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Get evidence
    const evidence = await repository.getEvidence(id);

    // Get related learnings (same category)
    const { learnings: related } = await repository.listLearnings(userId, {
      category: learning.category as LearningCategory,
      status: 'active',
      limit: 5,
    });

    // Filter out current learning from related
    const relatedLearnings = related.filter(l => l.id !== id);

    return c.json({
      learning,
      evidence,
      related_learnings: relatedLearnings,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Get failed:', error);
    return c.json(
      {
        error: 'Failed to get learning',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/learnings/:id/validate
 * Validate or correct a learning (user feedback)
 */
app.post('/:id/validate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<ValidateLearningBody>();

  try {
    const repository = new LearningRepository(c.env.DB);

    const learning = await repository.getLearning(id);
    if (!learning) {
      return c.json({ error: 'Learning not found' }, 404);
    }

    // Verify ownership
    if (learning.user_id !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    if (body.is_valid) {
      // User confirms learning is valid - boost confidence
      const now = new Date().toISOString();
      await c.env.DB.prepare(
        `UPDATE learnings SET
          confidence = MIN(1.0, confidence + 0.1),
          strength = CASE
            WHEN confidence >= 0.8 THEN 'definitive'
            WHEN confidence >= 0.6 THEN 'strong'
            WHEN confidence >= 0.3 THEN 'moderate'
            ELSE 'weak'
          END,
          last_reinforced = ?,
          updated_at = ?
        WHERE id = ?`
      )
        .bind(now, now, id)
        .run();

      return c.json({
        success: true,
        message: 'Learning validated',
        learning_id: id,
      });
    } else {
      // User says learning is wrong - invalidate
      await repository.invalidateLearning(id, undefined, body.notes);

      // If correction provided, could create new learning
      // (leaving this for future enhancement)

      return c.json({
        success: true,
        message: 'Learning invalidated',
        learning_id: id,
        correction_received: !!body.correction,
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Validate failed:', error);
    return c.json(
      {
        error: 'Failed to validate learning',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/learnings/:id/invalidate
 * Explicitly invalidate a learning
 */
app.post('/:id/invalidate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const repository = new LearningRepository(c.env.DB);

    const learning = await repository.getLearning(id);
    if (!learning) {
      return c.json({ error: 'Learning not found' }, 404);
    }

    // Verify ownership
    if (learning.user_id !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    await repository.invalidateLearning(id);

    return c.json({
      success: true,
      message: 'Learning invalidated',
      learning_id: id,
      invalidated_at: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Invalidate failed:', error);
    return c.json(
      {
        error: 'Failed to invalidate learning',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * DELETE /v3/learnings/:id
 * Archive a learning (soft delete)
 */
app.delete('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const repository = new LearningRepository(c.env.DB);

    const learning = await repository.getLearning(id);
    if (!learning) {
      return c.json({ error: 'Learning not found' }, 404);
    }

    // Verify ownership
    if (learning.user_id !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Archive instead of hard delete
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE learnings SET status = 'archived', updated_at = ? WHERE id = ?`
    )
      .bind(now, id)
      .run();

    return c.json({
      success: true,
      message: 'Learning archived',
      learning_id: id,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Learnings] Delete failed:', error);
    return c.json(
      {
        error: 'Failed to delete learning',
        message: errorMessage,
      },
      500
    );
  }
});

export default app;
