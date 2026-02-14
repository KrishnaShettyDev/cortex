/**
 * Job Scheduler Service
 *
 * Schedule jobs for exact-time execution instead of polling.
 * When an event happens (calendar created, commitment made), schedule a job.
 * The processor runs every minute and only processes DUE jobs.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type JobType =
  | 'meeting_prep'       // 30 min before meeting
  | 'commitment_reminder' // When commitment is due
  | 'nudge_send'         // Send a relationship nudge
  | 'briefing_send'      // Morning/evening briefing
  | 'email_digest'       // Daily email summary
  | 'trigger_fire';      // User-defined trigger

export interface ScheduleJobParams {
  userId: string;
  type: JobType;
  scheduledFor: Date;
  payload: Record<string, unknown>;
}

export interface ScheduledJob {
  id: string;
  user_id: string;
  job_type: JobType;
  scheduled_for: number;
  payload: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  created_at: number;
  processed_at: number | null;
  error: string | null;
}

/**
 * Schedule a job for exact-time execution
 * Returns job ID if scheduled, null if duplicate
 */
export async function scheduleJob(
  db: D1Database,
  params: ScheduleJobParams
): Promise<string | null> {
  const jobId = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const scheduledForUnix = Math.floor(params.scheduledFor.getTime() / 1000);

  // Don't schedule jobs in the past
  if (scheduledForUnix < Math.floor(Date.now() / 1000) - 60) {
    console.log(`[Scheduler] Skipping job in the past: ${params.type} for ${params.userId}`);
    return null;
  }

  try {
    const result = await db.prepare(`
      INSERT INTO scheduled_jobs (id, user_id, job_type, scheduled_for, payload, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).bind(
      jobId,
      params.userId,
      params.type,
      scheduledForUnix,
      JSON.stringify(params.payload)
    ).run();

    if (result.meta.changes === 0) {
      // Duplicate job - unique constraint prevented insert
      return null;
    }

    console.log(`[Scheduler] Scheduled ${params.type} for ${params.userId} at ${params.scheduledFor.toISOString()}`);
    return jobId;
  } catch (error: any) {
    // UNIQUE constraint violation = duplicate, which is fine
    if (error.message?.includes('UNIQUE constraint')) {
      console.log(`[Scheduler] Job already scheduled: ${params.type} for ${params.userId}`);
      return null;
    }
    console.error('[Scheduler] Failed to schedule job:', error);
    throw error;
  }
}

/**
 * Cancel a pending job by type and payload match
 */
export async function cancelJob(
  db: D1Database,
  userId: string,
  type: JobType,
  payloadMatch: Record<string, unknown>
): Promise<number> {
  // Build a WHERE clause that matches the payload
  const payloadJson = JSON.stringify(payloadMatch);

  // For simple cases, we can match the whole payload
  // For complex cases, we'd need to match specific fields
  const result = await db.prepare(`
    UPDATE scheduled_jobs
    SET status = 'cancelled'
    WHERE user_id = ? AND job_type = ? AND status = 'pending'
    AND payload = ?
  `).bind(userId, type, payloadJson).run();

  if (result.meta.changes > 0) {
    console.log(`[Scheduler] Cancelled ${result.meta.changes} jobs: ${type} for ${userId}`);
  }

  return result.meta.changes;
}

/**
 * Cancel a job by matching a specific field in the payload
 */
export async function cancelJobByPayloadField(
  db: D1Database,
  userId: string,
  type: JobType,
  fieldName: string,
  fieldValue: string
): Promise<number> {
  const result = await db.prepare(`
    UPDATE scheduled_jobs
    SET status = 'cancelled'
    WHERE user_id = ? AND job_type = ? AND status = 'pending'
    AND json_extract(payload, '$.' || ?) = ?
  `).bind(userId, type, fieldName, fieldValue).run();

  if (result.meta.changes > 0) {
    console.log(`[Scheduler] Cancelled ${result.meta.changes} jobs: ${type} where ${fieldName}=${fieldValue}`);
  }

  return result.meta.changes;
}

/**
 * Cancel a job by ID
 */
export async function cancelJobById(
  db: D1Database,
  jobId: string
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'
  `).bind(jobId).run();

  return result.meta.changes > 0;
}

/**
 * Get pending jobs for a user
 */
export async function getUserPendingJobs(
  db: D1Database,
  userId: string,
  type?: JobType
): Promise<ScheduledJob[]> {
  let query = `
    SELECT * FROM scheduled_jobs
    WHERE user_id = ? AND status = 'pending'
  `;
  const bindings: any[] = [userId];

  if (type) {
    query += ` AND job_type = ?`;
    bindings.push(type);
  }

  query += ` ORDER BY scheduled_for ASC`;

  const result = await db.prepare(query).bind(...bindings).all<ScheduledJob>();
  return result.results;
}

/**
 * Reschedule a job to a new time
 */
export async function rescheduleJob(
  db: D1Database,
  jobId: string,
  newTime: Date
): Promise<boolean> {
  const newTimeUnix = Math.floor(newTime.getTime() / 1000);

  const result = await db.prepare(`
    UPDATE scheduled_jobs
    SET scheduled_for = ?, attempts = 0
    WHERE id = ? AND status IN ('pending', 'failed')
  `).bind(newTimeUnix, jobId).run();

  return result.meta.changes > 0;
}

/**
 * Get job statistics
 */
export async function getJobStats(
  db: D1Database
): Promise<{
  pending: number;
  processing: number;
  completed_today: number;
  failed_today: number;
}> {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const result = await db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' AND processed_at >= ? THEN 1 ELSE 0 END) as completed_today,
      SUM(CASE WHEN status = 'failed' AND processed_at >= ? THEN 1 ELSE 0 END) as failed_today
    FROM scheduled_jobs
  `).bind(todayStart, todayStart).first<{
    pending: number;
    processing: number;
    completed_today: number;
    failed_today: number;
  }>();

  return result || { pending: 0, processing: 0, completed_today: 0, failed_today: 0 };
}
