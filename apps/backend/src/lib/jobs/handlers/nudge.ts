/**
 * Nudge Job Handler
 *
 * Sends a relationship nudge notification.
 * Reminds user to reach out to someone they haven't contacted in a while.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface NudgePayload {
  relationshipId: string;
  personName: string;
  lastContact?: number;
  suggestedAction?: string;
}

export async function handleNudge(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as NudgePayload;

  console.log(`[Nudge] Processing nudge for: ${payload.personName}`);

  // Get recent context about this person
  const recentMemory = await db.prepare(`
    SELECT content FROM memories
    WHERE user_id = ? AND content LIKE ?
    ORDER BY created_at DESC
    LIMIT 1
  `).first<{ content: string }>(job.user_id, `%${payload.personName}%`);

  // Build nudge message
  let body = `You haven't connected with ${payload.personName} in a while.`;
  if (recentMemory) {
    body += ` Last context: ${recentMemory.content.slice(0, 80)}...`;
  }
  if (payload.suggestedAction) {
    body = payload.suggestedAction;
  }

  // Create proactive message
  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'nudge', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    `Reach out to ${payload.personName}`,
    body,
    JSON.stringify(payload)
  ).run();

  // Send push notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: `Reach out to ${payload.personName}`,
      body: body.slice(0, 100),
      data: { type: 'nudge', relationshipId: payload.relationshipId }
    });
  }

  // Update relationship last_nudged
  await db.prepare(`
    UPDATE relationships SET last_nudged_at = unixepoch() WHERE id = ?
  `).bind(payload.relationshipId).run();

  console.log(`[Nudge] Completed nudge for: ${payload.personName}`);
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
    console.error('[Nudge] Push notification failed:', error);
  }
}
