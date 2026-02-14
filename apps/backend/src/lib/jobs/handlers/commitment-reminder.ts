/**
 * Commitment Reminder Job Handler
 *
 * Sends a reminder when a commitment is due.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface CommitmentReminderPayload {
  commitmentId: string;
  title: string;
  description?: string;
  dueAt: number;
}

export async function handleCommitmentReminder(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as CommitmentReminderPayload;

  console.log(`[CommitmentReminder] Processing: ${payload.title}`);

  // Check if commitment still exists and is not completed
  const commitment = await db.prepare(`
    SELECT id, status FROM commitments WHERE id = ? AND user_id = ?
  `).first<{ id: string; status: string }>(payload.commitmentId, job.user_id);

  if (!commitment) {
    console.log(`[CommitmentReminder] Commitment not found, skipping`);
    return;
  }

  if (commitment.status === 'completed') {
    console.log(`[CommitmentReminder] Already completed, skipping`);
    return;
  }

  // Create proactive message
  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'commitment_reminder', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    `Reminder: ${payload.title}`,
    payload.description || `You committed to: ${payload.title}`,
    JSON.stringify(payload)
  ).run();

  // Send push notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: `Reminder: ${payload.title}`,
      body: payload.description || `This commitment is now due`,
      data: { type: 'commitment_reminder', commitmentId: payload.commitmentId }
    });
  }

  // Update commitment to mark as reminded
  await db.prepare(`
    UPDATE commitments SET reminded_at = unixepoch() WHERE id = ?
  `).bind(payload.commitmentId).run();

  console.log(`[CommitmentReminder] Completed reminder for: ${payload.title}`);
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
    console.error('[CommitmentReminder] Push notification failed:', error);
  }
}
