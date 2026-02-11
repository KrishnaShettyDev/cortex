/**
 * Cron Task Definitions
 *
 * All cron tasks are defined here with:
 * - Isolation (one failure doesn't kill others)
 * - Timeouts (prevent runaway tasks)
 * - LLM budget allocation
 * - Priority ordering
 */

import type { CronTask } from './task-runner';
import { flushDueBatches, cleanupStaleBatches, resetDailyCounters } from '../proactive/batcher';
import { processDueTriggers } from '../triggers/executor';
import { processScheduledNotifications, processProactiveNotificationQueue } from '../notifications/scheduler';
import { cleanup as runProactiveCleanup } from '../proactive';
import { cleanupSeenEvents, cleanupClassificationCache } from '../proactive/sync';
import { runIncrementalSync } from '../proactive/incremental-sync';
import { getDueRetries, markRetrying, markResolved, cleanupResolvedEntries } from '../proactive/dlq';
import { ConsolidationPipeline } from '../consolidation/consolidation-pipeline';
import { runActionGeneration } from '../actions/generator';
import { generateProactiveNudges } from '../relationship/nudge-generator';
import { ComposioClient } from '../composio';
import { reconcileTriggers } from '../triggers';
import type { Bindings } from '../../types';

/**
 * 1-Minute Tasks: High frequency, must be fast
 */
export const everyMinuteTasks: CronTask[] = [
  {
    name: 'flush_notification_batches',
    interval: 'every_minute',
    priority: 1, // Highest - user-facing
    timeoutMs: 5000,
    llmBudget: 0,
    handler: async (env) => {
      const results = await flushDueBatches(env.DB);
      if (results.length > 0) {
        console.log(`[Cron] Flushed ${results.length} notification batches`);
      }
    },
  },
  {
    name: 'process_triggers',
    interval: 'every_minute',
    priority: 2,
    timeoutMs: 10000,
    llmBudget: 0,
    handler: async (env) => {
      const results = await processDueTriggers(env.DB);
      if (results.length > 0) {
        const successful = results.filter(r => r.status === 'success').length;
        console.log(`[Cron] Processed ${results.length} triggers (${successful} successful)`);
      }
    },
  },
  {
    name: 'process_notification_queue',
    interval: 'every_minute',
    priority: 3,
    timeoutMs: 10000,
    llmBudget: 0,
    handler: async (env) => {
      const results = await processProactiveNotificationQueue(env.DB);
      if (results.sent > 0 || results.failed > 0) {
        console.log(`[Cron] Notifications: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`);
      }
    },
  },
  {
    name: 'retry_dlq_events',
    interval: 'every_minute',
    priority: 4,
    timeoutMs: 15000,
    llmBudget: 2, // May need LLM for re-classification
    handler: async (env, ctx) => {
      const dueRetries = await getDueRetries(env.DB, 5);
      if (dueRetries.length === 0) return;

      console.log(`[Cron] Retrying ${dueRetries.length} DLQ events`);
      const { handleWebhook } = await import('../proactive');

      for (const entry of dueRetries) {
        await markRetrying(env.DB, entry.id);

        try {
          // Re-process the webhook payload
          const result = await handleWebhook(
            env.DB,
            entry.payload,
            '', // No signature for retry
            '' // No secret check for retry
          );

          if (result.success) {
            await markResolved(env.DB, entry.id);
            console.log(`[Cron] DLQ retry succeeded: ${entry.id}`);
          } else {
            // Will be picked up again with incremented retry count
            console.log(`[Cron] DLQ retry failed: ${entry.id} - ${result.error}`);
          }
        } catch (error) {
          console.error(`[Cron] DLQ retry error: ${entry.id}`, error);
        }
      }
    },
  },
];

/**
 * 5-Minute Tasks: Medium frequency
 */
export const every5MinTasks: CronTask[] = [
  {
    name: 'incremental_sync',
    interval: 'every_5_min',
    priority: 1,
    timeoutMs: 20000,
    llmBudget: 0, // No LLM needed for sync
    handler: async (env) => {
      if (!env.ENCRYPTION_KEY) {
        console.log('[Cron] Skipping incremental sync: ENCRYPTION_KEY not configured');
        return;
      }

      const stats = await runIncrementalSync(
        env.DB,
        env.COMPOSIO_API_KEY,
        env.ENCRYPTION_KEY,
        5 // Max 5 users per run
      );

      if (stats.usersChecked > 0) {
        console.log(`[Cron] Incremental sync: ${stats.usersSynced}/${stats.usersChecked} users, ${stats.totalEvents} events`);
      }
    },
  },
];

/**
 * Hourly Tasks: Low frequency, can be heavier
 */
export const hourlyTasks: CronTask[] = [
  {
    name: 'cleanup_dlq',
    interval: 'every_hour',
    priority: 1,
    timeoutMs: 10000,
    llmBudget: 0,
    handler: async (env) => {
      const cleaned = await cleanupResolvedEntries(env.DB);
      if (cleaned > 0) {
        console.log(`[Cron] Cleaned ${cleaned} resolved DLQ entries`);
      }
    },
  },
];

/**
 * 6-Hourly Tasks: Reconciliation and cleanup
 */
export const every6HourTasks: CronTask[] = [
  {
    name: 'reconcile_triggers',
    interval: 'every_6_hours',
    priority: 1,
    timeoutMs: 30000,
    llmBudget: 0,
    handler: async (env) => {
      if (!env.COMPOSIO_API_KEY) return;

      const client = new ComposioClient({ apiKey: env.COMPOSIO_API_KEY });
      const results = await reconcileTriggers(client, env.DB, env.WEBHOOK_BASE_URL);
      console.log(
        `[Cron] Trigger reconciliation: ${results.checked} checked, ` +
        `${results.created} created, ${results.removed} removed, ` +
        `${results.errors.length} errors`
      );
    },
  },
  {
    name: 'process_scheduled_notifications',
    interval: 'every_6_hours',
    priority: 2,
    timeoutMs: 30000,
    llmBudget: 3,
    handler: async (env) => {
      const results = await processScheduledNotifications(env.DB, env.AI);
      console.log(`[Cron] Scheduled notifications: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`);
    },
  },
  {
    name: 'generate_nudges',
    interval: 'every_6_hours',
    priority: 3,
    timeoutMs: 60000, // Nudge generation can be slow
    llmBudget: 5,
    handler: async (env) => {
      const activeUsers = await env.DB.prepare(`
        SELECT DISTINCT user_id FROM memories
        WHERE created_at >= datetime('now', '-7 days')
        LIMIT 50
      `).all<{ user_id: string }>();

      let nudgesGenerated = 0;
      let notificationsQueued = 0;

      for (const { user_id } of activeUsers.results || []) {
        try {
          const result = await generateProactiveNudges(env.DB, env.AI, user_id, 'default');
          const priorityToInt: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
          const now = new Date().toISOString();

          await env.DB.prepare(`DELETE FROM proactive_nudges WHERE user_id = ? AND dismissed = 0 AND acted = 0`).bind(user_id).run();

          for (const nudge of result.nudges) {
            await env.DB.prepare(`
              INSERT INTO proactive_nudges (id, user_id, nudge_type, title, message, entity_id, priority, suggested_action, dismissed, acted, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
            `).bind(nudge.id, user_id, nudge.nudge_type, nudge.title, nudge.message, nudge.entity_id || null, priorityToInt[nudge.priority] || 2, nudge.suggested_action || null, now).run();
            nudgesGenerated++;

            if (nudge.priority === 'urgent' || nudge.priority === 'high') {
              const tokenResult = await env.DB.prepare(`SELECT push_token FROM users WHERE id = ? AND push_token IS NOT NULL`).bind(user_id).first<{ push_token: string }>();
              if (tokenResult?.push_token) {
                await env.DB.prepare(`
                  INSERT INTO scheduled_notifications (id, user_id, notification_type, title, body, data, channel_id, scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at)
                  VALUES (?, ?, 'nudge', ?, ?, ?, 'nudges', ?, ?, 'UTC', 'pending', ?, ?)
                `).bind(`notif_${nudge.id}`, user_id, nudge.title, nudge.message.slice(0, 200), JSON.stringify({ nudgeId: nudge.id, nudgeType: nudge.nudge_type, entityId: nudge.entity_id, priority: nudge.priority, pushToken: tokenResult.push_token }), now, now, now, now).run();
                notificationsQueued++;
              }
            }
          }
        } catch {
          // Continue with other users
        }
      }

      if (nudgesGenerated > 0) {
        console.log(`[Cron] Nudge generation: ${nudgesGenerated} nudges, ${notificationsQueued} notifications queued`);
      }
    },
  },
  {
    name: 'proactive_cleanup',
    interval: 'every_6_hours',
    priority: 4,
    timeoutMs: 30000,
    llmBudget: 0,
    handler: async (env) => {
      // Clean up old proactive events (>7 days)
      await runProactiveCleanup(env.DB);
      console.log('[Cron] Proactive events cleanup completed');

      const staleBatches = await cleanupStaleBatches(env.DB);
      if (staleBatches > 0) {
        console.log(`[Cron] Cleaned up ${staleBatches} stale notification batches`);
      }

      const seenEventsDeleted = await cleanupSeenEvents(env.DB);
      if (seenEventsDeleted > 0) {
        console.log(`[Cron] Cleaned up ${seenEventsDeleted} seen events`);
      }

      const classificationDeleted = await cleanupClassificationCache(env.DB);
      if (classificationDeleted > 0) {
        console.log(`[Cron] Cleaned up ${classificationDeleted} classification cache entries`);
      }
    },
  },
  {
    name: 'cleanup_old_logs',
    interval: 'every_6_hours',
    priority: 5,
    timeoutMs: 30000,
    llmBudget: 0,
    handler: async (env) => {
      const cleanupQueries = [
        `DELETE FROM action_log WHERE created_at < datetime('now', '-30 days')`,
        `DELETE FROM agent_executions WHERE created_at < datetime('now', '-14 days')`,
        `DELETE FROM mcp_execution_log WHERE created_at < datetime('now', '-7 days')`,
        `DELETE FROM trigger_execution_log WHERE created_at < datetime('now', '-30 days')`,
        `DELETE FROM notification_log WHERE created_at < datetime('now', '-14 days')`,
        `DELETE FROM sync_logs WHERE started_at < datetime('now', '-30 days')`,
        `DELETE FROM pending_actions WHERE expires_at < datetime('now')`,
        `DELETE FROM cron_metrics WHERE created_at < datetime('now', '-7 days')`,
        `DELETE FROM dead_letter_queue WHERE status = 'resolved' AND updated_at < datetime('now', '-7 days')`,
      ];

      let totalCleaned = 0;
      for (const query of cleanupQueries) {
        try {
          const result = await env.DB.prepare(query).run();
          totalCleaned += result.meta?.changes || 0;
        } catch {
          // Table may not exist yet
        }
      }
      if (totalCleaned > 0) {
        console.log(`[Cron] Cleaned up ${totalCleaned} old records`);
      }
    },
  },
  {
    name: 'reset_daily_counters',
    interval: 'every_6_hours',
    priority: 6,
    timeoutMs: 5000,
    llmBudget: 0,
    handler: async (env) => {
      await resetDailyCounters(env.DB);
    },
  },
];

/**
 * Daily Tasks: Weekly consolidation (Sunday 2am)
 */
export const dailyTasks: CronTask[] = [
  {
    name: 'weekly_consolidation',
    interval: 'daily',
    priority: 1,
    timeoutMs: 120000, // 2 minutes for consolidation
    llmBudget: 10,
    handler: async (env) => {
      const usersResult = await env.DB.prepare(`
        SELECT DISTINCT user_id FROM memories
        WHERE created_at >= datetime('now', '-7 days')
        LIMIT 100
      `).all();

      for (const user of usersResult.results as any[]) {
        try {
          const pipeline = new ConsolidationPipeline(
            {
              db: env.DB,
              ai: env.AI,
              vectorize: env.VECTORIZE,
              userId: user.user_id,
              containerTag: 'default',
            },
            {
              userId: user.user_id,
              containerTag: 'default',
              strategy: 'hybrid',
              importanceThreshold: 0.3,
              minAgeDays: 30,
              minClusterSize: 3,
            }
          );

          const result = await pipeline.run();
          console.log(
            `[Cron] Consolidation for user ${user.user_id}: ` +
            `${result.memories_consolidated} memories -> ${result.semantic_facts_created} facts`
          );
        } catch (error) {
          console.error(`[Cron] Consolidation failed for user ${user.user_id}:`, error);
        }
      }
    },
  },
];

/**
 * Action generation tasks (runs 4x daily: 3am, 9am, 3pm, 9pm UTC)
 */
export const actionGenerationTasks: CronTask[] = [
  {
    name: 'generate_actions',
    interval: 'every_6_hours', // Piggybacks on 6-hour cron
    priority: 10, // Low priority - runs after other 6-hour tasks
    timeoutMs: 60000,
    llmBudget: 5,
    handler: async (env) => {
      const hour = new Date().getUTCHours();
      // Only run at 3, 9, 15, 21 UTC
      if (![3, 9, 15, 21].includes(hour)) return;

      const results = await runActionGeneration(env.DB, {
        maxUsersPerRun: 100,
        maxActionsPerUser: 5,
      });

      console.log(
        `[Cron] Action generation: ${results.usersProcessed} users, ` +
        `${results.totalGenerated} actions generated, ` +
        `${results.totalSkipped} skipped, ` +
        `${results.errors.length} errors`
      );
    },
  },
];

/**
 * All tasks combined
 */
export const allCronTasks: CronTask[] = [
  ...everyMinuteTasks,
  ...every5MinTasks,
  ...hourlyTasks,
  ...every6HourTasks,
  ...dailyTasks,
  ...actionGenerationTasks,
];
