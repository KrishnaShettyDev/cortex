/**
 * Composio Trigger Management
 *
 * Unified trigger setup for all integrations:
 * - Google Super (Gmail, Calendar, Drive, Docs, Sheets)
 * - Slack (Messages, DMs)
 * - Notion (Pages, Comments)
 */

import { ComposioClient, TriggerInstance } from './composio';
import { createLogger } from './logger';

type D1Database = import('@cloudflare/workers-types').D1Database;

const logger = createLogger('triggers');

const WEBHOOK_BASE_URL = 'https://askcortex.plutas.in';
const WEBHOOK_PATH = '/proactive/webhook';

// Provider configurations with their triggers
export const PROVIDER_CONFIG = {
  googlesuper: {
    name: 'Google',
    toolkit: 'googlesuper',
    triggers: [
      // Gmail - high priority
      'GOOGLESUPER_NEW_MESSAGE',
      // Calendar - high priority
      'GOOGLESUPER_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER',
      'GOOGLESUPER_GOOGLE_CALENDAR_EVENT_UPDATED_TRIGGER',
      'GOOGLESUPER_EVENT_STARTING_SOON_TRIGGER',
      // Drive - medium priority
      'GOOGLESUPER_FILE_SHARED_PERMISSIONS_ADDED',
      'GOOGLESUPER_FILE_CREATED_TRIGGER',
      // Docs - low priority (avoid noise)
      'GOOGLESUPER_COMMENT_ADDED_TRIGGER',
    ],
  },
  slack: {
    name: 'Slack',
    toolkit: 'slack',
    triggers: [
      'SLACK_RECEIVE_DIRECT_MESSAGE',
      'SLACK_RECEIVE_MESSAGE',
      'SLACK_RECEIVE_THREAD_REPLY',
    ],
  },
  notion: {
    name: 'Notion',
    toolkit: 'notion',
    triggers: [
      'NOTION_PAGE_UPDATED_TRIGGER',
      'NOTION_COMMENTS_ADDED_TRIGGER',
      'NOTION_PAGE_ADDED_TO_DATABASE',
    ],
  },
} as const;

export type Provider = keyof typeof PROVIDER_CONFIG;

interface SetupResult {
  success: boolean;
  triggers: TriggerInstance[];
  errors: string[];
}

/**
 * Setup triggers for a connected account
 */
export async function setupTriggersForProvider(
  client: ComposioClient,
  provider: Provider,
  connectedAccountId: string,
  userId: string
): Promise<SetupResult> {
  const config = PROVIDER_CONFIG[provider];
  const triggers: TriggerInstance[] = [];
  const errors: string[] = [];
  const webhookUrl = `${WEBHOOK_BASE_URL}${WEBHOOK_PATH}/${provider}`;

  logger.info('Setting up triggers', { provider, connectedAccountId, userId });

  for (const triggerName of config.triggers) {
    try {
      const existing = await client.listTriggers({
        connectedAccountId,
        triggerNames: [triggerName],
      });

      if (existing.items?.length > 0) {
        const trigger = existing.items[0];
        if (trigger.status === 'paused') {
          const enabled = await client.enableTrigger(trigger.id);
          triggers.push(enabled);
          logger.info('Enabled trigger', { triggerName });
        } else {
          triggers.push(trigger);
        }
        continue;
      }

      const trigger = await client.createTrigger({
        triggerName,
        connectedAccountId,
        webhookUrl,
        config: {},
      });

      triggers.push(trigger);
      logger.info('Created trigger', { triggerName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${triggerName}: ${msg}`);
      logger.error('Trigger setup failed', error as Error, { triggerName });
    }
  }

  return { success: errors.length === 0, triggers, errors };
}

/**
 * Remove triggers for a disconnected account
 */
export async function removeTriggersForAccount(
  client: ComposioClient,
  connectedAccountId: string
): Promise<{ removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;

  try {
    const triggers = await client.listTriggers({ connectedAccountId });

    for (const trigger of triggers.items || []) {
      try {
        await client.deleteTrigger(trigger.id);
        removed++;
      } catch (error) {
        errors.push(`Failed to delete ${trigger.id}`);
      }
    }
  } catch (error) {
    errors.push('Failed to list triggers');
  }

  return { removed, errors };
}

/**
 * Auto-enable proactive settings for user
 */
export async function enableProactiveForUser(
  db: D1Database,
  userId: string,
  provider: Provider
): Promise<void> {
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_settings (id, user_id, enabled, min_urgency, created_at, updated_at)
    VALUES (?, ?, 1, 'medium', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = 1,
      updated_at = excluded.updated_at
  `).bind(
    `ps_${userId.slice(0, 8)}`,
    userId,
    now,
    now
  ).run();

  logger.info('Proactive enabled', { userId, provider });
}

interface ReconcileResult {
  checked: number;
  created: number;
  removed: number;
  errors: string[];
}

/**
 * Reconcile triggers for active connections (cron job)
 *
 * SCALE-OPTIMIZED: Only processes BATCH_SIZE users per run, cycling through
 * all users over time. Uses last_trigger_reconciled_at to track progress.
 * At 10k users with BATCH_SIZE=50, processes all users in ~200 cron cycles (50 days at 6h intervals)
 *
 * This is a FALLBACK mechanism - primary trigger setup happens on user connection.
 * Don't need to reconcile frequently unless there are webhook issues.
 */
export async function reconcileTriggers(
  client: ComposioClient,
  db: D1Database
): Promise<ReconcileResult> {
  const stats: ReconcileResult = { checked: 0, created: 0, removed: 0, errors: [] };

  // SCALE: Only process 50 users per run to avoid resource exhaustion
  const BATCH_SIZE = 50;

  // Get connections that haven't been reconciled in 7+ days, oldest first
  // This ensures all users eventually get reconciled without overwhelming the system
  const connections = await db.prepare(`
    SELECT user_id, provider, access_token as connected_account_id
    FROM integrations
    WHERE connected = 1
      AND access_token IS NOT NULL
      AND (last_trigger_reconciled_at IS NULL
           OR last_trigger_reconciled_at < datetime('now', '-7 days'))
    ORDER BY last_trigger_reconciled_at ASC NULLS FIRST
    LIMIT ?
  `).bind(BATCH_SIZE).all();

  for (const conn of (connections.results || []) as any[]) {
    stats.checked++;

    const provider = conn.provider as Provider;
    if (!PROVIDER_CONFIG[provider]) continue;

    try {
      const result = await setupTriggersForProvider(
        client,
        provider,
        conn.connected_account_id,
        conn.user_id
      );

      stats.created += result.triggers.length;
      stats.errors.push(...result.errors);

      // Mark as reconciled (ignore error if column doesn't exist yet)
      try {
        await db.prepare(`
          UPDATE integrations
          SET last_trigger_reconciled_at = datetime('now')
          WHERE user_id = ? AND provider = ?
        `).bind(conn.user_id, conn.provider).run();
      } catch {
        // Column may not exist yet - that's fine
      }
    } catch (error) {
      stats.errors.push(`User ${conn.user_id}: ${(error as Error).message}`);
    }
  }

  return stats;
}
