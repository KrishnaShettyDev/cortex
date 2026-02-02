/**
 * Processing API Endpoints
 *
 * Endpoints for triggering and monitoring document processing.
 */

import { Context } from 'hono';
import {
  createProcessingJob as createJob,
  getProcessingStatus,
  ProcessingPipeline,
} from '../lib/processing/pipeline';
import type { Bindings } from '../types';
import { getTenantScope } from '../lib/multi-tenancy/middleware';
import { verifyResourceOwnership } from '../lib/multi-tenancy/isolation';
import { enqueueProcessingJob } from '../lib/queue/producer';

/**
 * POST /v3/processing/jobs
 * Create a new processing job for a memory
 */
export async function createProcessingJob(c: Context<{ Bindings: Bindings }>) {
  try {
    const scope = getTenantScope(c);
    const body = await c.req.json();
    const { memoryId } = body;

    if (!memoryId) {
      return c.json({ error: 'memoryId is required' }, 400);
    }

    // Verify memory exists and belongs to tenant (strict isolation check)
    const ownership = await verifyResourceOwnership(
      c.env.DB,
      'memory',
      memoryId,
      scope
    );

    if (!ownership.passed) {
      return c.json({ error: 'Memory not found', reason: ownership.reason }, 404);
    }

    // Create processing job in database
    const job = await createJob(
      c.env,
      memoryId,
      scope.userId,
      scope.containerTag
    );

    // Queue-based processing (if available) or fallback to sync
    if (c.env.PROCESSING_QUEUE) {
      // Async: Enqueue for background processing
      await enqueueProcessingJob(
        c.env.PROCESSING_QUEUE,
        job.id,
        memoryId,
        scope.userId,
        scope.containerTag
      );

      return c.json({
        success: true,
        job: {
          id: job.id,
          memoryId: job.memoryId,
          status: job.status,
          currentStep: job.currentStep,
          createdAt: job.createdAt,
        },
        message: 'Processing job queued. Use GET /v3/processing/jobs/:jobId to check status.',
        processingMode: 'async',
      });
    } else {
      // Fallback: Process synchronously in background (waitUntil)
      console.warn('[Processing] Queue not available (requires Workers Paid plan), using waitUntil fallback');

      const ctx = {
        job,
        env: {
          DB: c.env.DB,
          VECTORIZE: c.env.VECTORIZE,
          AI: c.env.AI,
        },
      };

      // Process in background (non-blocking)
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const pipeline = new ProcessingPipeline(ctx);
            await pipeline.execute();
          } catch (error: any) {
            console.error(`[Processing] Pipeline failed for job ${job.id}:`, error);
          }
        })()
      );

      return c.json({
        success: true,
        job: {
          id: job.id,
          memoryId: job.memoryId,
          status: job.status,
          currentStep: job.currentStep,
          createdAt: job.createdAt,
        },
        message: 'Processing started in background. Use GET /v3/processing/jobs/:jobId to check status.',
        processingMode: 'waitUntil',
      });
    }
  } catch (error: any) {
    console.error('[Processing] Job creation failed:', error);
    return c.json(
      {
        error: 'Processing job creation failed',
        message: error.message,
      },
      500
    );
  }
}

/**
 * GET /v3/processing/jobs/:jobId
 * Get status of a processing job
 */
export async function getJobStatus(c: Context<{ Bindings: Bindings }>) {
  try {
    const scope = getTenantScope(c);
    const jobId = c.req.param('jobId');

    const job = await getProcessingStatus(c.env, jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Verify job belongs to tenant (strict isolation)
    if (job.userId !== scope.userId || job.containerTag !== scope.containerTag) {
      return c.json({ error: 'Job not found' }, 404); // Don't reveal existence
    }

    return c.json({
      job: {
        id: job.id,
        memoryId: job.memoryId,
        status: job.status,
        currentStep: job.currentStep,
        steps: job.steps,
        metrics: job.metrics,
        retryCount: job.retryCount,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
    });
  } catch (error: any) {
    console.error('[Processing] Status fetch failed:', error);
    return c.json(
      {
        error: 'Failed to fetch job status',
        message: error.message,
      },
      500
    );
  }
}

/**
 * GET /v3/processing/jobs
 * List processing jobs for user
 */
export async function listProcessingJobs(c: Context<{ Bindings: Bindings }>) {
  try {
    const scope = getTenantScope(c);
    const status = c.req.query('status'); // Optional filter by status
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    // Scoped query: ALWAYS filter by user_id AND container_tag
    let query = 'SELECT * FROM processing_jobs WHERE user_id = ? AND container_tag = ?';
    const params: any[] = [scope.userId, scope.containerTag];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    const jobs = results.results.map((row: any) => ({
      id: row.id,
      memoryId: row.memory_id,
      status: row.status,
      currentStep: row.current_step,
      steps: JSON.parse(row.steps),
      metrics: JSON.parse(row.metrics),
      retryCount: row.retry_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }));

    return c.json({
      jobs,
      total: jobs.length,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Processing] List jobs failed:', error);
    return c.json(
      {
        error: 'Failed to list jobs',
        message: error.message,
      },
      500
    );
  }
}

/**
 * GET /v3/processing/stats
 * Get processing statistics for user
 */
export async function getProcessingStats(c: Context<{ Bindings: Bindings }>) {
  try {
    const scope = getTenantScope(c);

    // Get counts by status (scoped to tenant)
    const stats = await c.env.DB.prepare(
      `SELECT
        status,
        COUNT(*) as count,
        AVG(CAST(json_extract(metrics, '$.totalDurationMs') AS INTEGER)) as avg_duration
       FROM processing_jobs
       WHERE user_id = ? AND container_tag = ?
       GROUP BY status`
    )
      .bind(scope.userId, scope.containerTag)
      .all();

    // Get total metrics (scoped to tenant)
    const totals = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total_jobs,
        SUM(CAST(json_extract(metrics, '$.chunkCount') AS INTEGER)) as total_chunks,
        SUM(CAST(json_extract(metrics, '$.tokenCount') AS INTEGER)) as total_tokens,
        SUM(retry_count) as total_retries
       FROM processing_jobs
       WHERE user_id = ? AND container_tag = ?`
    )
      .bind(scope.userId, scope.containerTag)
      .first();

    return c.json({
      byStatus: stats.results.reduce((acc: any, row: any) => {
        acc[row.status] = {
          count: row.count,
          avgDuration: row.avg_duration,
        };
        return acc;
      }, {}),
      totals: {
        jobs: totals?.total_jobs || 0,
        chunks: totals?.total_chunks || 0,
        tokens: totals?.total_tokens || 0,
        retries: totals?.total_retries || 0,
      },
    });
  } catch (error: any) {
    console.error('[Processing] Stats fetch failed:', error);
    return c.json(
      {
        error: 'Failed to fetch stats',
        message: error.message,
      },
      500
    );
  }
}
