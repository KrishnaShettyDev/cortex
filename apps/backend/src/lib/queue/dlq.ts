/**
 * Dead Letter Queue (DLQ) Storage
 *
 * Stores permanently failed jobs for manual review and retry.
 * This provides visibility into failures that exhaust all retries.
 */

import { nanoid } from 'nanoid';

export type JobType = 'processing' | 'sync' | 'webhook' | 'notification' | 'other';
export type FailedJobStatus = 'failed' | 'retrying' | 'resolved' | 'ignored';

export interface FailedJob {
  id: string;
  originalJobId: string;
  jobType: JobType;
  userId: string;
  containerTag: string;
  payload: Record<string, any>;
  errorMessage: string | null;
  errorStack: string | null;
  failureCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  status: FailedJobStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Store a failed job in the DLQ
 */
export async function storeFailedJob(
  db: D1Database,
  params: {
    originalJobId: string;
    jobType: JobType;
    userId: string;
    containerTag?: string;
    payload: Record<string, any>;
    errorMessage?: string;
    errorStack?: string;
  }
): Promise<FailedJob> {
  const id = nanoid();
  const now = new Date().toISOString();

  const job: FailedJob = {
    id,
    originalJobId: params.originalJobId,
    jobType: params.jobType,
    userId: params.userId,
    containerTag: params.containerTag || 'default',
    payload: params.payload,
    errorMessage: params.errorMessage || null,
    errorStack: params.errorStack || null,
    failureCount: 1,
    firstFailedAt: now,
    lastFailedAt: now,
    status: 'failed',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.prepare(`
    INSERT INTO failed_jobs (
      id, original_job_id, job_type, user_id, container_tag,
      payload, error_message, error_stack, failure_count,
      first_failed_at, last_failed_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    job.id,
    job.originalJobId,
    job.jobType,
    job.userId,
    job.containerTag,
    JSON.stringify(job.payload),
    job.errorMessage,
    job.errorStack,
    job.failureCount,
    job.firstFailedAt,
    job.lastFailedAt,
    job.status,
    job.createdAt,
    job.updatedAt
  ).run();

  console.log(`[DLQ] Stored failed job ${id} (type: ${params.jobType}, original: ${params.originalJobId})`);

  return job;
}

/**
 * Increment failure count for existing failed job
 */
export async function incrementFailureCount(
  db: D1Database,
  originalJobId: string,
  errorMessage?: string,
  errorStack?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db.prepare(`
    UPDATE failed_jobs
    SET failure_count = failure_count + 1,
        last_failed_at = ?,
        error_message = COALESCE(?, error_message),
        error_stack = COALESCE(?, error_stack),
        updated_at = ?
    WHERE original_job_id = ? AND status = 'failed'
  `).bind(now, errorMessage, errorStack, now, originalJobId).run();

  return result.meta.changes > 0;
}

/**
 * Get failed jobs for a user
 */
export async function getFailedJobs(
  db: D1Database,
  params: {
    userId?: string;
    jobType?: JobType;
    status?: FailedJobStatus;
    limit?: number;
    offset?: number;
  }
): Promise<{ jobs: FailedJob[]; total: number }> {
  const conditions: string[] = [];
  const bindings: any[] = [];

  if (params.userId) {
    conditions.push('user_id = ?');
    bindings.push(params.userId);
  }

  if (params.jobType) {
    conditions.push('job_type = ?');
    bindings.push(params.jobType);
  }

  if (params.status) {
    conditions.push('status = ?');
    bindings.push(params.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get count
  const countResult = await db.prepare(
    `SELECT COUNT(*) as count FROM failed_jobs ${whereClause}`
  ).bind(...bindings).first<{ count: number }>();

  // Get jobs
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const jobsResult = await db.prepare(
    `SELECT * FROM failed_jobs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all();

  const jobs: FailedJob[] = (jobsResult.results || []).map((row: any) => ({
    id: row.id,
    originalJobId: row.original_job_id,
    jobType: row.job_type,
    userId: row.user_id,
    containerTag: row.container_tag,
    payload: JSON.parse(row.payload),
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    failureCount: row.failure_count,
    firstFailedAt: row.first_failed_at,
    lastFailedAt: row.last_failed_at,
    status: row.status,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return { jobs, total: countResult?.count || 0 };
}

/**
 * Mark a failed job as resolved
 */
export async function resolveFailedJob(
  db: D1Database,
  jobId: string,
  resolvedBy: string,
  notes?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db.prepare(`
    UPDATE failed_jobs
    SET status = 'resolved',
        resolved_at = ?,
        resolved_by = ?,
        resolution_notes = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(now, resolvedBy, notes || null, now, jobId).run();

  return result.meta.changes > 0;
}

/**
 * Mark a failed job as ignored
 */
export async function ignoreFailedJob(
  db: D1Database,
  jobId: string,
  ignoredBy: string,
  reason?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  const result = await db.prepare(`
    UPDATE failed_jobs
    SET status = 'ignored',
        resolved_at = ?,
        resolved_by = ?,
        resolution_notes = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(now, ignoredBy, reason || 'Manually ignored', now, jobId).run();

  return result.meta.changes > 0;
}

/**
 * Retry a failed job by putting it back in the queue
 * Returns the job payload for re-enqueueing
 */
export async function prepareRetry(
  db: D1Database,
  jobId: string
): Promise<{ payload: Record<string, any>; jobType: JobType } | null> {
  const now = new Date().toISOString();

  const job = await db.prepare(
    'SELECT payload, job_type FROM failed_jobs WHERE id = ?'
  ).bind(jobId).first<{ payload: string; job_type: string }>();

  if (!job) {
    return null;
  }

  // Mark as retrying
  await db.prepare(`
    UPDATE failed_jobs
    SET status = 'retrying',
        updated_at = ?
    WHERE id = ?
  `).bind(now, jobId).run();

  return {
    payload: JSON.parse(job.payload),
    jobType: job.job_type as JobType,
  };
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats(
  db: D1Database,
  userId?: string
): Promise<{
  total: number;
  byStatus: Record<FailedJobStatus, number>;
  byType: Record<JobType, number>;
}> {
  const userFilter = userId ? 'WHERE user_id = ?' : '';
  const bindings = userId ? [userId] : [];

  // Status counts
  const statusResult = await db.prepare(
    `SELECT status, COUNT(*) as count FROM failed_jobs ${userFilter} GROUP BY status`
  ).bind(...bindings).all();

  const byStatus: Record<string, number> = { failed: 0, retrying: 0, resolved: 0, ignored: 0 };
  for (const row of statusResult.results || []) {
    byStatus[(row as any).status] = (row as any).count;
  }

  // Type counts
  const typeResult = await db.prepare(
    `SELECT job_type, COUNT(*) as count FROM failed_jobs ${userFilter} GROUP BY job_type`
  ).bind(...bindings).all();

  const byType: Record<string, number> = { processing: 0, sync: 0, webhook: 0, notification: 0, other: 0 };
  for (const row of typeResult.results || []) {
    byType[(row as any).job_type] = (row as any).count;
  }

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return {
    total,
    byStatus: byStatus as Record<FailedJobStatus, number>,
    byType: byType as Record<JobType, number>,
  };
}
