/**
 * Sleep Compute API Handlers
 *
 * Endpoints:
 * - POST /v3/sleep/run - Trigger sleep compute manually
 * - GET /v3/sleep/jobs - Get job history
 * - GET /v3/sleep/jobs/:id - Get specific job details
 * - GET /v3/sleep/context - Get current session context
 * - GET /v3/sleep/stats - Get sleep compute statistics
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { SleepComputeEngine } from '../lib/cognitive/sleep/engine';
import type { SleepComputeConfig, SessionContext } from '../lib/cognitive/sleep/types';

const app = new Hono<{ Bindings: Bindings }>();

// ============================================
// TRIGGER SLEEP COMPUTE
// ============================================

/**
 * POST /v3/sleep/run
 * Trigger sleep compute manually
 */
app.post('/run', async (c) => {
  const userId = c.get('jwtPayload').sub;

  let config: Partial<SleepComputeConfig> = {};
  try {
    const body = await c.req.json();
    config = body.config ?? {};
  } catch {
    // No config, use defaults
  }

  try {
    const engine = new SleepComputeEngine(c.env.DB, c.env.AI, config);
    const result = await engine.run(userId, 'manual');

    console.log('[Sleep] Manual trigger complete', {
      userId,
      jobId: result.jobId,
      status: result.status,
    });

    return c.json(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sleep] Manual trigger failed:', error);
    return c.json(
      {
        error: 'Failed to run sleep compute',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// JOB HISTORY
// ============================================

/**
 * GET /v3/sleep/jobs
 * Get sleep compute job history
 */
app.get('/jobs', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 10;

  try {
    const result = await c.env.DB
      .prepare(
        `
        SELECT
          id, user_id, trigger_type, status,
          total_tasks, completed_tasks, failed_tasks,
          started_at, completed_at, duration_ms,
          error_message, created_at
        FROM sleep_jobs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .bind(userId, limit)
      .all();

    return c.json({ jobs: result.results ?? [] });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sleep] Get jobs failed:', error);
    return c.json(
      {
        error: 'Failed to get job history',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/sleep/jobs/:id
 * Get a specific job with task details
 */
app.get('/jobs/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const jobId = c.req.param('id');

  if (!jobId) {
    return c.json({ error: 'Job ID required' }, 400);
  }

  try {
    const job = await c.env.DB
      .prepare(
        `
        SELECT *
        FROM sleep_jobs
        WHERE id = ? AND user_id = ?
      `
      )
      .bind(jobId, userId)
      .first();

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Parse JSON fields
    const parsedJob = {
      ...job,
      tasks_completed: job.tasks_completed ? JSON.parse(job.tasks_completed as string) : [],
      tasks_failed: job.tasks_failed ? JSON.parse(job.tasks_failed as string) : [],
    };

    return c.json({ job: parsedJob });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sleep] Get job failed:', error);
    return c.json(
      {
        error: 'Failed to get job',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// SESSION CONTEXT
// ============================================

/**
 * GET /v3/sleep/context
 * Get current session context (pre-computed by sleep compute)
 */
app.get('/context', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const result = await c.env.DB
      .prepare(
        `
        SELECT context_data, generated_at, expires_at
        FROM session_contexts
        WHERE user_id = ?
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY generated_at DESC
        LIMIT 1
      `
      )
      .bind(userId)
      .first<{ context_data: string; generated_at: string; expires_at: string | null }>();

    if (!result) {
      return c.json({
        context: null,
        message: 'No session context available. Run sleep compute first.',
      });
    }

    let context: SessionContext;
    try {
      context = JSON.parse(result.context_data);
    } catch {
      return c.json({ context: null, message: 'Session context corrupted' });
    }

    return c.json({
      context,
      generatedAt: result.generated_at,
      expiresAt: result.expires_at,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sleep] Get context failed:', error);
    return c.json(
      {
        error: 'Failed to get session context',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// STATISTICS
// ============================================

/**
 * GET /v3/sleep/stats
 * Get sleep compute statistics
 */
app.get('/stats', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const totalJobs = await c.env.DB
      .prepare(`SELECT COUNT(*) as count FROM sleep_jobs WHERE user_id = ?`)
      .bind(userId)
      .first<{ count: number }>();

    const recentJobs = await c.env.DB
      .prepare(
        `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(duration_ms) as avg_duration,
          MAX(completed_at) as last_completed
        FROM sleep_jobs
        WHERE user_id = ? AND created_at > datetime('now', '-30 days')
      `
      )
      .bind(userId)
      .first<{
        total: number;
        completed: number;
        failed: number;
        avg_duration: number;
        last_completed: string | null;
      }>();

    // Get task breakdown from recent jobs
    const taskBreakdown = await c.env.DB
      .prepare(
        `
        SELECT tasks_completed
        FROM sleep_jobs
        WHERE user_id = ?
          AND status = 'completed'
          AND created_at > datetime('now', '-7 days')
        ORDER BY created_at DESC
        LIMIT 10
      `
      )
      .bind(userId)
      .all<{ tasks_completed: string }>();

    // Aggregate task stats
    const taskStats: Record<string, { runs: number; totalDuration: number }> = {};
    for (const job of taskBreakdown.results ?? []) {
      if (job.tasks_completed) {
        try {
          const tasks = JSON.parse(job.tasks_completed);
          for (const task of tasks) {
            if (!taskStats[task.taskType]) {
              taskStats[task.taskType] = { runs: 0, totalDuration: 0 };
            }
            taskStats[task.taskType].runs++;
            taskStats[task.taskType].totalDuration += task.durationMs || 0;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return c.json({
      totalJobs: totalJobs?.count ?? 0,
      last30Days: {
        total: recentJobs?.total ?? 0,
        completed: recentJobs?.completed ?? 0,
        failed: recentJobs?.failed ?? 0,
        avgDurationMs: Math.round(recentJobs?.avg_duration ?? 0),
        lastCompleted: recentJobs?.last_completed,
      },
      taskStats: Object.entries(taskStats).map(([type, stats]) => ({
        taskType: type,
        runs: stats.runs,
        avgDurationMs: Math.round(stats.totalDuration / stats.runs),
      })),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sleep] Get stats failed:', error);
    return c.json(
      {
        error: 'Failed to get sleep compute statistics',
        message: errorMessage,
      },
      500
    );
  }
});

export default app;
