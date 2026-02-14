/**
 * Trigger Job Handler
 *
 * Fires user-defined triggers (custom automations).
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface TriggerPayload {
  triggerId: string;
  triggerName: string;
  action: string;
  params?: Record<string, unknown>;
}

export async function handleTrigger(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as TriggerPayload;

  console.log(`[Trigger] Firing trigger: ${payload.triggerName}`);

  // Get trigger from database
  const trigger = await db.prepare(`
    SELECT id, name, action, enabled FROM user_triggers
    WHERE id = ? AND user_id = ?
  `).first<{ id: string; name: string; action: string; enabled: number }>(
    payload.triggerId,
    job.user_id
  );

  if (!trigger || !trigger.enabled) {
    console.log(`[Trigger] Trigger not found or disabled, skipping`);
    return;
  }

  // Execute the trigger action
  // For now, triggers create proactive messages
  // In the future, this could execute composio actions, send emails, etc.

  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'trigger', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    payload.triggerName,
    payload.action,
    JSON.stringify(payload)
  ).run();

  // Send push notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: payload.triggerName,
      body: payload.action.slice(0, 100),
      data: { type: 'trigger', triggerId: payload.triggerId }
    });
  }

  // Update trigger last_fired
  await db.prepare(`
    UPDATE user_triggers SET last_fired_at = unixepoch() WHERE id = ?
  `).bind(payload.triggerId).run();

  console.log(`[Trigger] Completed trigger: ${payload.triggerName}`);
}

async function sendPushNotification(
  accessToken: string,
  pushToken: string,
  notification: { title: string; body: string; data: Record<string, unknown> }
): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data
      })
    });
  } catch (error) {
    console.error('[Trigger] Push notification failed:', error);
  }
}
