/**
 * Composio Trigger Management
 *
 * Sets up and manages event-driven triggers for Gmail and Calendar.
 * Triggers send webhooks to our endpoint when events occur (new email, calendar changes).
 *
 * Supported triggers:
 * - GMAIL_NEW_GMAIL_MESSAGE: Fires when new email arrives
 * - GOOGLECALENDAR_EVENT_CREATED: Fires when calendar event is created
 * - GOOGLECALENDAR_EVENT_UPDATED: Fires when calendar event is updated
 */

import { ComposioClient, TriggerInstance } from './composio';
import { createLogger } from './logger';

// D1Database type from Cloudflare Workers
type D1Database = import('@cloudflare/workers-types').D1Database;

const logger = createLogger('triggers');

// Webhook endpoint for receiving Composio trigger events
const WEBHOOK_BASE_URL = 'https://askcortex.plutas.in';
const WEBHOOK_PATH = '/webhooks/composio';

// Supported trigger types
export const TRIGGER_TYPES = {
  GMAIL_NEW_MESSAGE: 'GMAIL_NEW_GMAIL_MESSAGE',
  CALENDAR_EVENT_CREATED: 'GOOGLECALENDAR_EVENT_CREATED',
  CALENDAR_EVENT_UPDATED: 'GOOGLECALENDAR_EVENT_UPDATED',
} as const;

export type TriggerType = typeof TRIGGER_TYPES[keyof typeof TRIGGER_TYPES];

/**
 * Set up all triggers for a connected account
 *
 * Call this after a user successfully connects their Gmail or Calendar.
 */
export async function setupTriggersForConnection(
  client: ComposioClient,
  params: {
    connectedAccountId: string;
    toolkitSlug: string; // 'gmail' or 'googlecalendar'
    userId: string;
  }
): Promise<{ success: boolean; triggers: TriggerInstance[]; errors: string[] }> {
  const { connectedAccountId, toolkitSlug, userId } = params;
  const triggers: TriggerInstance[] = [];
  const errors: string[] = [];

  const webhookUrl = `${WEBHOOK_BASE_URL}${WEBHOOK_PATH}`;

  logger.info('Setting up triggers', { connectedAccountId, toolkitSlug, userId });

  // Determine which triggers to set up based on toolkit
  const triggerNames: TriggerType[] = [];

  if (toolkitSlug.toLowerCase().includes('gmail')) {
    triggerNames.push(TRIGGER_TYPES.GMAIL_NEW_MESSAGE);
  }

  if (toolkitSlug.toLowerCase().includes('calendar')) {
    triggerNames.push(TRIGGER_TYPES.CALENDAR_EVENT_CREATED);
    triggerNames.push(TRIGGER_TYPES.CALENDAR_EVENT_UPDATED);
  }

  // Create each trigger
  for (const triggerName of triggerNames) {
    try {
      // Check if trigger already exists
      const existing = await client.listTriggers({
        connectedAccountId,
        triggerNames: [triggerName],
      });

      if (existing.items && existing.items.length > 0) {
        const existingTrigger = existing.items[0];

        // Enable if paused
        if (existingTrigger.status === 'paused') {
          const enabled = await client.enableTrigger(existingTrigger.id);
          triggers.push(enabled);
          logger.info('Enabled existing trigger', { triggerId: enabled.id, triggerName });
        } else {
          triggers.push(existingTrigger);
          logger.debug('Trigger already exists and is active', { triggerId: existingTrigger.id, triggerName });
        }
        continue;
      }

      // Create new trigger
      const trigger = await client.createTrigger({
        triggerName,
        connectedAccountId,
        webhookUrl,
        config: {}, // Default config
      });

      triggers.push(trigger);
      logger.info('Created trigger', { triggerId: trigger.id, triggerName });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Failed to create ${triggerName}: ${message}`);
      logger.error('Failed to create trigger', error as Error, { triggerName, connectedAccountId });
    }
  }

  return {
    success: errors.length === 0,
    triggers,
    errors,
  };
}

/**
 * Remove all triggers for a connected account
 *
 * Call this when a user disconnects their account.
 */
export async function removeTriggersForConnection(
  client: ComposioClient,
  connectedAccountId: string
): Promise<{ success: boolean; removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;

  logger.info('Removing triggers for connection', { connectedAccountId });

  try {
    const triggers = await client.listTriggers({ connectedAccountId });

    for (const trigger of triggers.items || []) {
      try {
        await client.deleteTrigger(trigger.id);
        removed++;
        logger.debug('Deleted trigger', { triggerId: trigger.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to delete trigger ${trigger.id}: ${message}`);
        logger.warn('Failed to delete trigger', { triggerId: trigger.id, error: message });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Failed to list triggers: ${message}`);
    logger.error('Failed to list triggers for removal', error as Error, { connectedAccountId });
  }

  return {
    success: errors.length === 0,
    removed,
    errors,
  };
}

/**
 * Reconcile triggers for all active connections
 *
 * Use this in the 6-hour reconciliation cron to ensure triggers are set up
 * for all active connections and cleaned up for inactive ones.
 */
export async function reconcileTriggers(
  client: ComposioClient,
  db: D1Database
): Promise<{
  checked: number;
  created: number;
  enabled: number;
  removed: number;
  errors: string[];
}> {
  const stats = {
    checked: 0,
    created: 0,
    enabled: 0,
    removed: 0,
    errors: [] as string[],
  };

  logger.info('Starting trigger reconciliation');

  try {
    // Get all active user integrations
    const integrations = await db.prepare(`
      SELECT ui.id, ui.user_id, ui.provider, ui.composio_connection_id, ui.status
      FROM user_integrations ui
      WHERE ui.composio_connection_id IS NOT NULL
    `).all<{
      id: string;
      user_id: string;
      provider: string;
      composio_connection_id: string;
      status: string;
    }>();

    for (const integration of integrations.results || []) {
      stats.checked++;

      // Map provider to toolkit slug
      const toolkitSlug = integration.provider === 'google_gmail' ? 'gmail' : 'googlecalendar';

      if (integration.status === 'connected') {
        // Ensure triggers are set up for active connections
        const result = await setupTriggersForConnection(client, {
          connectedAccountId: integration.composio_connection_id,
          toolkitSlug,
          userId: integration.user_id,
        });

        if (!result.success) {
          stats.errors.push(...result.errors);
        }

        // Count newly created vs enabled
        for (const trigger of result.triggers) {
          // This is a simplification - we can't easily tell if it was just created
          stats.created++;
        }
      } else {
        // Remove triggers for disconnected/expired integrations
        const result = await removeTriggersForConnection(
          client,
          integration.composio_connection_id
        );

        stats.removed += result.removed;
        if (!result.success) {
          stats.errors.push(...result.errors);
        }
      }
    }

    logger.info('Trigger reconciliation complete', {
      checked: stats.checked,
      created: stats.created,
      removed: stats.removed,
      errors: stats.errors.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    stats.errors.push(`Reconciliation failed: ${message}`);
    logger.error('Trigger reconciliation failed', error as Error);
  }

  return stats;
}

/**
 * Check health of triggers for a connection
 */
export async function checkTriggerHealth(
  client: ComposioClient,
  connectedAccountId: string
): Promise<{
  healthy: boolean;
  triggers: { name: string; status: string; id: string }[];
  issues: string[];
}> {
  const issues: string[] = [];

  try {
    const triggers = await client.listTriggers({ connectedAccountId });

    const triggerList = (triggers.items || []).map(t => ({
      name: t.triggerName,
      status: t.status,
      id: t.id,
    }));

    // Check for failed triggers
    for (const trigger of triggerList) {
      if (trigger.status === 'failed') {
        issues.push(`Trigger ${trigger.name} is in failed state`);
      } else if (trigger.status === 'paused') {
        issues.push(`Trigger ${trigger.name} is paused`);
      }
    }

    // Check for missing expected triggers (based on connection type)
    // This would require knowing what type of connection it is

    return {
      healthy: issues.length === 0,
      triggers: triggerList,
      issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      healthy: false,
      triggers: [],
      issues: [`Failed to check triggers: ${message}`],
    };
  }
}
