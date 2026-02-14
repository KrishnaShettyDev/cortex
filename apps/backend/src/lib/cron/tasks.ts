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
import { generateCommitmentReminder, generateNudgeNotification } from '../notifications/ai-generator';
import { cleanup as runProactiveCleanup } from '../proactive';
import { cleanupSeenEvents, cleanupClassificationCache } from '../proactive/sync';
import { runIncrementalSync } from '../proactive/incremental-sync';
import { getDueRetries, markRetrying, markResolved, cleanupResolvedEntries } from '../proactive/dlq';
import { ConsolidationPipeline } from '../consolidation/consolidation-pipeline';
import { runActionGeneration } from '../actions/generator';
import { generateProactiveNudges } from '../relationship/nudge-generator';
import { ComposioClient } from '../composio';
import { reconcileTriggers } from '../triggers';
import { upsertBelief, decayStaleBeliefs } from '../../handlers/beliefs';
import { processMeetingPrepNotifications, syncCalendarEvents, pollNewEmails } from '../context';
import { processDueJobs, cleanupOldJobs, resetStuckJobs } from '../jobs';
import type { Bindings } from '../../types';

/**
 * 1-Minute Tasks: High frequency, must be fast
 */
export const everyMinuteTasks: CronTask[] = [
  {
    name: 'process_scheduled_jobs',
    interval: 'every_minute',
    priority: 0, // Highest - event-driven jobs
    timeoutMs: 30000,
    llmBudget: 3, // Some handlers may use AI
    handler: async (env) => {
      // Reset any stuck jobs first
      await resetStuckJobs(env.DB);

      // Process due jobs
      const results = await processDueJobs(env.DB, {
        EXPO_ACCESS_TOKEN: env.EXPO_ACCESS_TOKEN,
        OPENAI_API_KEY: env.OPENAI_API_KEY,
      });

      if (results.processed > 0 || results.failed > 0) {
        console.log(`[Cron] Jobs: ${results.processed} processed, ${results.failed} failed`);
      }
    },
  },
  {
    name: 'flush_notification_batches',
    interval: 'every_minute',
    priority: 1, // Second highest - user-facing
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
    name: 'process_commitment_reminders',
    interval: 'every_minute',
    priority: 4,
    timeoutMs: 15000, // Increased for AI generation
    llmBudget: 3, // Allow AI calls for reminders
    handler: async (env) => {
      // Find commitments due within next 24 hours that haven't been reminded
      const dueCommitments = await env.DB.prepare(`
        SELECT c.id, c.description, c.to_entity_name, c.due_date, pt.push_token, c.user_id, u.name as user_name
        FROM commitments c
        JOIN push_tokens pt ON c.user_id = pt.user_id AND pt.is_active = 1
        JOIN users u ON c.user_id = u.id
        WHERE c.status = 'pending'
          AND c.due_date <= datetime('now', '+1 day')
          AND c.due_date >= datetime('now', '-1 hour')
          AND (c.reminded = 0 OR c.reminded IS NULL)
        LIMIT 10
      `).all<{
        id: string;
        description: string;
        to_entity_name: string | null;
        due_date: string;
        push_token: string;
        user_id: string;
        user_name: string | null;
      }>();

      if (!dueCommitments.results || dueCommitments.results.length === 0) return;

      let sent = 0;
      let aiUsed = 0;
      for (const commitment of dueCommitments.results) {
        try {
          // Generate AI-powered notification (falls back to template if rate limited)
          const notification = await generateCommitmentReminder(
            env.DB,
            env.AI,
            commitment.user_id,
            commitment.id
          );

          if (notification.usedAI) aiUsed++;

          const now = new Date();

          // Queue notification with AI-generated content
          await env.DB.prepare(`
            INSERT INTO scheduled_notifications (
              id, user_id, notification_type, title, body, data,
              channel_id, scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
            ) VALUES (?, ?, 'commitment', ?, ?, ?, 'reminders', ?, ?, 'UTC', 'pending', ?, ?)
          `).bind(
            `commit_${commitment.id}_${Date.now()}`,
            commitment.user_id,
            notification.title,
            notification.body,
            JSON.stringify({
              commitmentId: commitment.id,
              pushToken: commitment.push_token,
              usedAI: notification.usedAI ? 1 : 0,
            }),
            now.toISOString(),
            now.toISOString(),
            now.toISOString(),
            now.toISOString()
          ).run();

          // Mark as reminded
          await env.DB.prepare(`UPDATE commitments SET reminded = 1 WHERE id = ?`).bind(commitment.id).run();
          sent++;
        } catch (error) {
          console.error(`[Cron] Commitment reminder error for ${commitment.id}:`, error);
        }
      }

      if (sent > 0) {
        console.log(`[Cron] Queued ${sent} commitment reminders (${aiUsed} AI-generated)`);
      }
    },
  },
  {
    name: 'retry_dlq_events',
    interval: 'every_minute',
    priority: 5,
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
  {
    name: 'meeting_prep_notifications',
    interval: 'every_5_min',
    priority: 2,
    timeoutMs: 30000,
    llmBudget: 0, // No LLM needed - uses pre-stored context
    handler: async (env) => {
      try {
        const result = await processMeetingPrepNotifications(env);
        if (result.notificationsSent > 0) {
          console.log(`[Cron] Meeting prep: ${result.notificationsSent} notifications sent (${result.processed} meetings checked)`);
        }
      } catch (error) {
        console.error('[Cron] Meeting prep failed:', error);
      }
    },
  },
  {
    name: 'sync_user_calendars',
    interval: 'every_5_min',
    priority: 3,
    timeoutMs: 45000,
    llmBudget: 0,
    handler: async (env) => {
      // Get users with connected Google accounts who have been active recently
      const activeUsers = await env.DB.prepare(`
        SELECT DISTINCT i.user_id
        FROM integrations i
        JOIN memories m ON m.user_id = i.user_id
        WHERE i.provider = 'googlesuper' AND i.connected = 1
        AND m.created_at > datetime('now', '-7 days')
        LIMIT 10
      `).all<{ user_id: string }>();

      let totalSynced = 0;
      for (const { user_id } of activeUsers.results || []) {
        try {
          const result = await syncCalendarEvents(env, user_id);
          totalSynced += result.synced;
        } catch (error) {
          console.error(`[Cron] Calendar sync failed for ${user_id}:`, error);
        }
      }

      if (totalSynced > 0) {
        console.log(`[Cron] Calendar sync: ${totalSynced} events synced for ${activeUsers.results?.length || 0} users`);
      }
    },
  },
];

/**
 * Hourly Tasks: Low frequency, can be heavier
 */
export const hourlyTasks: CronTask[] = [
  {
    name: 'cleanup_scheduled_jobs',
    interval: 'every_hour',
    priority: 1,
    timeoutMs: 15000,
    llmBudget: 0,
    handler: async (env) => {
      const cleaned = await cleanupOldJobs(env.DB);
      if (cleaned > 0) {
        console.log(`[Cron] Cleaned ${cleaned} old scheduled jobs`);
      }
    },
  },
  {
    name: 'cleanup_dlq',
    interval: 'every_hour',
    priority: 2,
    timeoutMs: 10000,
    llmBudget: 0,
    handler: async (env) => {
      const cleaned = await cleanupResolvedEntries(env.DB);
      if (cleaned > 0) {
        console.log(`[Cron] Cleaned ${cleaned} resolved DLQ entries`);
      }
    },
  },
  {
    name: 'poll_important_emails',
    interval: 'every_hour',
    priority: 2,
    timeoutMs: 60000, // 1 minute for email processing
    llmBudget: 0, // No LLM - uses rule-based classification
    handler: async (env) => {
      // Get users with connected Google accounts
      const usersWithGmail = await env.DB.prepare(`
        SELECT DISTINCT i.user_id
        FROM integrations i
        JOIN notification_preferences np ON np.user_id = i.user_id
        WHERE i.provider = 'googlesuper' AND i.connected = 1
        AND np.push_token IS NOT NULL
        LIMIT 20
      `).all<{ user_id: string }>();

      let totalProcessed = 0;
      for (const { user_id } of usersWithGmail.results || []) {
        try {
          const processed = await pollNewEmails(env, user_id);
          totalProcessed += processed;
        } catch (error) {
          console.error(`[Cron] Email poll failed for ${user_id}:`, error);
        }
      }

      if (totalProcessed > 0) {
        console.log(`[Cron] Email poll: ${totalProcessed} emails processed for ${usersWithGmail.results?.length || 0} users`);
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
    timeoutMs: 90000, // Increased for AI generation
    llmBudget: 10, // Higher budget for AI-powered nudges
    handler: async (env) => {
      const activeUsers = await env.DB.prepare(`
        SELECT DISTINCT user_id FROM memories
        WHERE created_at >= datetime('now', '-7 days')
        LIMIT 50
      `).all<{ user_id: string }>();

      let nudgesGenerated = 0;
      let notificationsQueued = 0;
      let aiNotifications = 0;

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

            // For high-priority nudges, generate AI-powered notification
            if (nudge.priority === 'urgent' || nudge.priority === 'high') {
              const tokenResult = await env.DB.prepare(`SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1 LIMIT 1`).bind(user_id).first<{ push_token: string }>();
              if (tokenResult?.push_token) {
                // Generate AI notification for this nudge
                const notification = await generateNudgeNotification(
                  env.DB,
                  env.AI,
                  user_id,
                  nudge.id
                );

                if (notification.usedAI) aiNotifications++;

                await env.DB.prepare(`
                  INSERT INTO scheduled_notifications (id, user_id, notification_type, title, body, data, channel_id, scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at)
                  VALUES (?, ?, 'nudge', ?, ?, ?, 'nudges', ?, ?, 'UTC', 'pending', ?, ?)
                `).bind(
                  `notif_${nudge.id}`,
                  user_id,
                  notification.title,
                  notification.body.slice(0, 200),
                  JSON.stringify({
                    nudgeId: nudge.id,
                    nudgeType: nudge.nudge_type,
                    entityId: nudge.entity_id,
                    priority: nudge.priority,
                    pushToken: tokenResult.push_token,
                    usedAI: notification.usedAI ? 1 : 0,
                  }),
                  now,
                  now,
                  now,
                  now
                ).run();
                notificationsQueued++;
              }
            }
          }
        } catch {
          // Continue with other users
        }
      }

      if (nudgesGenerated > 0) {
        console.log(`[Cron] Nudge generation: ${nudgesGenerated} nudges, ${notificationsQueued} notifications queued (${aiNotifications} AI-generated)`);
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
  {
    name: 'belief_synthesis',
    interval: 'daily',
    priority: 2,
    timeoutMs: 120000, // 2 minutes
    llmBudget: 15, // Higher budget for AI synthesis
    handler: async (env) => {
      // Run weekly (only on Sundays)
      const dayOfWeek = new Date().getUTCDay();
      if (dayOfWeek !== 0) return;

      // Get active users
      const usersResult = await env.DB.prepare(`
        SELECT DISTINCT user_id FROM memories
        WHERE created_at >= datetime('now', '-7 days')
        LIMIT 50
      `).all<{ user_id: string }>();

      let beliefsCreated = 0;
      let beliefsDecayed = 0;

      for (const { user_id } of usersResult.results || []) {
        try {
          // Get recent high-importance memories for this user
          const memoriesResult = await env.DB.prepare(`
            SELECT id, content, type, importance_score
            FROM memories
            WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
            ORDER BY importance_score DESC
            LIMIT 50
          `).bind(user_id).all<{
            id: string;
            content: string;
            type: string;
            importance_score: number;
          }>();

          const memories = memoriesResult.results || [];
          if (memories.length < 5) continue; // Need enough data for synthesis

          // Use AI to synthesize beliefs from memories
          const memoryTexts = memories.map(m => `[${m.type}] ${m.content}`).join('\n');

          const synthesisPrompt = `Analyze these memories and extract 3-5 core beliefs, values, or patterns about this person.

Memories:
${memoryTexts}

For each belief, provide:
1. The belief statement (one sentence)
2. Category: value | preference | habit | relationship | goal
3. Confidence: 0.5-1.0 based on how many memories support it

Format as JSON array:
[{"belief": "...", "category": "...", "confidence": 0.8}]

Only include beliefs strongly supported by multiple memories.`;

          const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [{ role: 'user', content: synthesisPrompt }],
            max_tokens: 500,
          });

          // Parse AI response
          const responseText = response.response || '';
          const jsonMatch = responseText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) continue;

          const synthesizedBeliefs = JSON.parse(jsonMatch[0]) as Array<{
            belief: string;
            category: string;
            confidence: number;
          }>;

          // Upsert each belief
          for (const belief of synthesizedBeliefs) {
            if (!belief.belief || !belief.category) continue;

            await upsertBelief(
              env.DB,
              user_id,
              belief.belief,
              belief.category,
              Math.min(1.0, Math.max(0.3, belief.confidence || 0.5)),
              memories.slice(0, 5).map(m => m.id) // Link to supporting memories
            );
            beliefsCreated++;
          }
        } catch (error) {
          console.error(`[Cron] Belief synthesis failed for user ${user_id}:`, error);
        }
      }

      // Decay stale beliefs for all users
      try {
        beliefsDecayed = await decayStaleBeliefs(env.DB);
      } catch (error) {
        console.error('[Cron] Belief decay failed:', error);
      }

      if (beliefsCreated > 0 || beliefsDecayed > 0) {
        console.log(`[Cron] Belief synthesis: ${beliefsCreated} created/reinforced, ${beliefsDecayed} decayed`);
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
