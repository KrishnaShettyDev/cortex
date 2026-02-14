/**
 * Job Processor
 *
 * Runs every minute via cron.
 * Fetches due jobs and executes them.
 * Handles retries and failure states.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob, JobType } from './scheduler';
import {
  handleMeetingPrep,
  handleCommitmentReminder,
  handleNudge,
  handleBriefing,
  handleEmailDigest,
  handleTrigger
} from './handlers';

interface ProcessorEnv {
  EXPO_ACCESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
}

/**
 * Process all due jobs
 * Called every minute by cron
 */
export async function processDueJobs(
  db: D1Database,
  env: ProcessorEnv
): Promise<{ processed: number; failed: number }> {
  const now = Math.floor(Date.now() / 1000);
  let processed = 0;
  let failed = 0;

  // Fetch due jobs (scheduled_for <= now and status = pending)
  // Limit to 50 jobs per minute to avoid timeout
  const dueJobs = await db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE scheduled_for <= ? AND status = 'pending'
    ORDER BY scheduled_for ASC
    LIMIT 50
  `).bind(now).all<ScheduledJob>();

  if (dueJobs.results.length === 0) {
    return { processed: 0, failed: 0 };
  }

  console.log(`[Processor] Found ${dueJobs.results.length} due jobs`);

  // Process each job
  for (const job of dueJobs.results) {
    try {
      // Mark as processing
      await db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'processing', attempts = attempts + 1
        WHERE id = ?
      `).bind(job.id).run();

      // Execute handler based on job type
      await executeJob(db, job, env);

      // Mark as completed
      await db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'completed', processed_at = unixepoch()
        WHERE id = ?
      `).bind(job.id).run();

      processed++;
      console.log(`[Processor] Completed job ${job.id} (${job.job_type})`);

    } catch (error: any) {
      console.error(`[Processor] Job ${job.id} failed:`, error);

      // Check if we should retry
      const attempts = job.attempts + 1;
      const maxAttempts = job.max_attempts || 3;

      if (attempts < maxAttempts) {
        // Retry with exponential backoff (1 min, 5 min, 15 min)
        const backoffMinutes = Math.pow(3, attempts);
        const retryAt = now + (backoffMinutes * 60);

        await db.prepare(`
          UPDATE scheduled_jobs
          SET status = 'pending', scheduled_for = ?, error = ?
          WHERE id = ?
        `).bind(retryAt, error.message || 'Unknown error', job.id).run();

        console.log(`[Processor] Job ${job.id} scheduled for retry at ${new Date(retryAt * 1000).toISOString()}`);
      } else {
        // Max retries exceeded, mark as failed
        await db.prepare(`
          UPDATE scheduled_jobs
          SET status = 'failed', processed_at = unixepoch(), error = ?
          WHERE id = ?
        `).bind(error.message || 'Unknown error', job.id).run();

        failed++;
      }
    }
  }

  return { processed, failed };
}

/**
 * Execute a job based on its type
 */
async function executeJob(
  db: D1Database,
  job: ScheduledJob,
  env: ProcessorEnv
): Promise<void> {
  switch (job.job_type as JobType) {
    case 'meeting_prep':
      await handleMeetingPrep(db, job, env);
      break;

    case 'commitment_reminder':
      await handleCommitmentReminder(db, job, env);
      break;

    case 'nudge_send':
      await handleNudge(db, job, env);
      break;

    case 'briefing_send':
      await handleBriefing(db, job, env);
      break;

    case 'email_digest':
      await handleEmailDigest(db, job, env);
      break;

    case 'trigger_fire':
      await handleTrigger(db, job, env);
      break;

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

/**
 * Clean up old completed/failed jobs
 * Run daily to prevent table bloat
 */
export async function cleanupOldJobs(db: D1Database): Promise<number> {
  // Delete jobs older than 7 days that are completed, failed, or cancelled
  const cutoff = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);

  const result = await db.prepare(`
    DELETE FROM scheduled_jobs
    WHERE status IN ('completed', 'failed', 'cancelled')
    AND processed_at < ?
  `).bind(cutoff).run();

  if (result.meta.changes > 0) {
    console.log(`[Processor] Cleaned up ${result.meta.changes} old jobs`);
  }

  return result.meta.changes;
}

/**
 * Reset stuck jobs
 * Jobs that have been 'processing' for > 5 minutes are likely stuck
 */
export async function resetStuckJobs(db: D1Database): Promise<number> {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;

  // Find jobs that have been processing for too long
  const result = await db.prepare(`
    UPDATE scheduled_jobs
    SET status = 'pending', error = 'Job timed out, retrying'
    WHERE status = 'processing'
    AND scheduled_for < ?
    AND attempts < max_attempts
  `).bind(fiveMinutesAgo).run();

  if (result.meta.changes > 0) {
    console.log(`[Processor] Reset ${result.meta.changes} stuck jobs`);
  }

  return result.meta.changes;
}
