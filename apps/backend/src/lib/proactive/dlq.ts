/**
 * Dead Letter Queue for Failed Operations
 *
 * Stores failed notifications, webhooks, triggers, and sync operations
 * for retry and manual review.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Max retry limit before permanent failure
 * - Manual resolution workflow
 * - Cleanup of old resolved entries
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { log } from '../logger';

export type DLQEntryType = 'notification' | 'webhook' | 'trigger' | 'sync';
export type DLQStatus = 'pending' | 'retrying' | 'resolved' | 'failed';

export interface DLQEntry {
  id: string;
  type: DLQEntryType;
  payload: string; // JSON stringified
  error: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface DLQStats {
  total: number;
  byType: Record<DLQEntryType, number>;
  byStatus: Record<DLQStatus, number>;
  oldestPending: string | null;
}

const logger = log.dlq;

/**
 * Add a failed operation to the dead letter queue
 */
export async function addToDeadLetterQueue(
  db: D1Database,
  type: DLQEntryType,
  payload: any,
  error: string,
  maxAttempts: number = 3
): Promise<string> {
  const id = nanoid();
  // First retry in 5 minutes
  const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO dead_letter_queue (id, type, payload, error, attempts, max_attempts, next_retry_at, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `).bind(
    id,
    type,
    JSON.stringify(payload),
    error,
    maxAttempts,
    nextRetryAt
  ).run();

  logger.info('entry_added', {
    id,
    type,
    error: error.slice(0, 200),
    nextRetryAt,
  });

  return id;
}

/**
 * Get entries that are due for retry
 */
export async function getDueRetries(
  db: D1Database,
  limit: number = 10
): Promise<DLQEntry[]> {
  const now = new Date().toISOString();

  const result = await db.prepare(`
    SELECT id, type, payload, error, attempts, max_attempts as maxAttempts,
           next_retry_at as nextRetryAt, resolved_at as resolvedAt, created_at as createdAt
    FROM dead_letter_queue
    WHERE attempts < max_attempts
      AND next_retry_at <= ?
      AND resolved_at IS NULL
    ORDER BY next_retry_at ASC
    LIMIT ?
  `).bind(now, limit).all<DLQEntry>();

  return result.results || [];
}

/**
 * Mark an entry as being retried (increment attempts, set next retry time)
 */
export async function markRetrying(
  db: D1Database,
  id: string,
  newError?: string
): Promise<void> {
  // Get current attempts
  const entry = await db.prepare(
    'SELECT attempts, max_attempts FROM dead_letter_queue WHERE id = ?'
  ).bind(id).first<{ attempts: number; max_attempts: number }>();

  if (!entry) {
    logger.warn('entry_not_found', { id });
    return;
  }

  const nextAttempt = entry.attempts + 1;

  if (nextAttempt >= entry.max_attempts) {
    // Max attempts reached - mark as permanently failed
    await db.prepare(`
      UPDATE dead_letter_queue
      SET attempts = ?, error = COALESCE(?, error)
      WHERE id = ?
    `).bind(nextAttempt, newError, id).run();

    logger.warn('max_attempts_reached', { id, attempts: nextAttempt });
  } else {
    // Exponential backoff: 5min, 10min, 20min, 40min...
    const backoffMinutes = 5 * Math.pow(2, nextAttempt - 1);
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

    await db.prepare(`
      UPDATE dead_letter_queue
      SET attempts = ?, next_retry_at = ?, error = COALESCE(?, error)
      WHERE id = ?
    `).bind(nextAttempt, nextRetryAt, newError, id).run();

    logger.info('retry_scheduled', {
      id,
      attempts: nextAttempt,
      nextRetryAt,
      backoffMinutes,
    });
  }
}

/**
 * Mark an entry as resolved (successfully processed)
 */
export async function markResolved(
  db: D1Database,
  id: string
): Promise<void> {
  await db.prepare(`
    UPDATE dead_letter_queue
    SET resolved_at = datetime('now'), next_retry_at = NULL
    WHERE id = ?
  `).bind(id).run();

  logger.info('entry_resolved', { id });
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats(db: D1Database): Promise<DLQStats> {
  const [totalResult, byTypeResult, byStatusResult, oldestResult] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue WHERE resolved_at IS NULL').first<{ count: number }>(),

    db.prepare(`
      SELECT type, COUNT(*) as count
      FROM dead_letter_queue
      WHERE resolved_at IS NULL
      GROUP BY type
    `).all<{ type: DLQEntryType; count: number }>(),

    db.prepare(`
      SELECT
        CASE
          WHEN resolved_at IS NOT NULL THEN 'resolved'
          WHEN attempts >= max_attempts THEN 'failed'
          WHEN next_retry_at > datetime('now') THEN 'pending'
          ELSE 'retrying'
        END as status,
        COUNT(*) as count
      FROM dead_letter_queue
      GROUP BY status
    `).all<{ status: DLQStatus; count: number }>(),

    db.prepare(`
      SELECT MIN(created_at) as oldest
      FROM dead_letter_queue
      WHERE resolved_at IS NULL AND attempts < max_attempts
    `).first<{ oldest: string | null }>(),
  ]);

  const byType: Record<DLQEntryType, number> = {
    notification: 0,
    webhook: 0,
    trigger: 0,
    sync: 0,
  };

  for (const row of byTypeResult.results || []) {
    byType[row.type] = row.count;
  }

  const byStatus: Record<DLQStatus, number> = {
    pending: 0,
    retrying: 0,
    resolved: 0,
    failed: 0,
  };

  for (const row of byStatusResult.results || []) {
    byStatus[row.status] = row.count;
  }

  return {
    total: totalResult?.count || 0,
    byType,
    byStatus,
    oldestPending: oldestResult?.oldest || null,
  };
}

/**
 * Cleanup old resolved entries (run in cron)
 */
export async function cleanupResolvedEntries(
  db: D1Database,
  retentionDays: number = 7
): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM dead_letter_queue
    WHERE resolved_at IS NOT NULL
      AND resolved_at < datetime('now', '-' || ? || ' days')
  `).bind(retentionDays).run();

  const deleted = result.meta?.changes || 0;

  if (deleted > 0) {
    logger.info('cleanup_completed', { deleted, retentionDays });
  }

  return deleted;
}

/**
 * Cleanup permanently failed entries older than retention period
 */
export async function cleanupFailedEntries(
  db: D1Database,
  retentionDays: number = 30
): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM dead_letter_queue
    WHERE attempts >= max_attempts
      AND created_at < datetime('now', '-' || ? || ' days')
  `).bind(retentionDays).run();

  const deleted = result.meta?.changes || 0;

  if (deleted > 0) {
    logger.info('failed_cleanup_completed', { deleted, retentionDays });
  }

  return deleted;
}

/**
 * Get entries for manual review (failed + old pending)
 */
export async function getEntriesForReview(
  db: D1Database,
  limit: number = 50
): Promise<DLQEntry[]> {
  const result = await db.prepare(`
    SELECT id, type, payload, error, attempts, max_attempts as maxAttempts,
           next_retry_at as nextRetryAt, resolved_at as resolvedAt, created_at as createdAt
    FROM dead_letter_queue
    WHERE resolved_at IS NULL
      AND (
        attempts >= max_attempts
        OR created_at < datetime('now', '-1 day')
      )
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all<DLQEntry>();

  return result.results || [];
}

/**
 * Manually resolve an entry (mark as handled without retry)
 */
export async function manuallyResolve(
  db: D1Database,
  id: string,
  resolution: string
): Promise<void> {
  await db.prepare(`
    UPDATE dead_letter_queue
    SET resolved_at = datetime('now'),
        next_retry_at = NULL,
        error = error || ' | Resolution: ' || ?
    WHERE id = ?
  `).bind(resolution, id).run();

  logger.info('manually_resolved', { id, resolution });
}

/**
 * Reset an entry for retry (reset attempts, set next retry)
 */
export async function resetForRetry(
  db: D1Database,
  id: string
): Promise<void> {
  const nextRetryAt = new Date(Date.now() + 60 * 1000).toISOString(); // Retry in 1 minute

  await db.prepare(`
    UPDATE dead_letter_queue
    SET attempts = 0,
        next_retry_at = ?,
        resolved_at = NULL
    WHERE id = ?
  `).bind(nextRetryAt, id).run();

  logger.info('reset_for_retry', { id, nextRetryAt });
}
