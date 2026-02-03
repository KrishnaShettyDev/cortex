/**
 * Cron Trigger for Sleep-Time Compute
 *
 * Handles Cloudflare Workers scheduled events.
 * Runs sleep compute for all active users.
 */

import type { D1Database, Ai } from '@cloudflare/workers-types';

import { SleepComputeEngine } from './engine';
import type { SleepComputeResult } from './types';

// ============================================
// TYPES
// ============================================

interface CronEnv {
  DB: D1Database;
  AI: Ai;
}

// ============================================
// CRON HANDLER
// ============================================

/**
 * Handle scheduled cron event for sleep compute
 * Runs sleep compute for all users with recent activity
 */
export async function handleSleepComputeCron(env: CronEnv): Promise<void> {
  const startTime = Date.now();

  console.log('[SleepCron] Starting sleep compute cycle');

  // Get users with recent activity (last 7 days)
  const recentUsers = await env.DB
    .prepare(
      `
      SELECT DISTINCT user_id
      FROM memories
      WHERE created_at > datetime('now', '-7 days')
      LIMIT 50
    `
    )
    .all<{ user_id: string }>();

  const userIds = (recentUsers.results ?? []).map((r) => r.user_id);

  if (userIds.length === 0) {
    console.log('[SleepCron] No active users, skipping');
    return;
  }

  console.log(`[SleepCron] Processing ${userIds.length} users`);

  const results: SleepComputeResult[] = [];

  for (const userId of userIds) {
    try {
      const engine = new SleepComputeEngine(env.DB, env.AI);
      const result = await engine.run(userId, 'scheduled');
      results.push(result);
    } catch (error) {
      console.error(`[SleepCron] Failed for user ${userId}:`, error);
    }
  }

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter((r) => r.status === 'completed').length;

  console.log('[SleepCron] Cycle complete', {
    totalUsers: userIds.length,
    successful: successCount,
    failed: userIds.length - successCount,
    totalDurationMs: totalDuration,
  });
}
