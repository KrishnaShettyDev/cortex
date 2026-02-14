/**
 * Email Digest Job Handler
 *
 * Sends a daily digest of important emails.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface EmailDigestPayload {
  timezone?: string;
}

export async function handleEmailDigest(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as EmailDigestPayload;

  console.log(`[EmailDigest] Generating digest for user: ${job.user_id}`);

  // Get emails from proactive_messages (where we store classified important emails)
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;

  const importantEmails = await db.prepare(`
    SELECT title, body, data FROM proactive_messages
    WHERE user_id = ? AND type = 'email_alert' AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(job.user_id, dayAgo).all<{
    title: string;
    body: string;
    data: string;
  }>();

  if (importantEmails.results.length === 0) {
    console.log(`[EmailDigest] No important emails to digest`);
    return;
  }

  // Build digest
  const parts: string[] = [];
  parts.push(`${importantEmails.results.length} important email${importantEmails.results.length > 1 ? 's' : ''} today:\n`);

  for (const email of importantEmails.results.slice(0, 5)) {
    parts.push(`- ${email.title}`);
    if (email.body) {
      parts.push(`  ${email.body.slice(0, 60)}...`);
    }
  }

  if (importantEmails.results.length > 5) {
    parts.push(`\n+ ${importantEmails.results.length - 5} more`);
  }

  const digest = parts.join('\n');

  // Store digest as proactive message
  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'email_digest', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    'Email Digest',
    digest,
    JSON.stringify({ emailCount: importantEmails.results.length })
  ).run();

  // Send push notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: 'Email Digest',
      body: `${importantEmails.results.length} important email${importantEmails.results.length > 1 ? 's' : ''} today`,
      data: { type: 'email_digest' }
    });
  }

  console.log(`[EmailDigest] Completed digest with ${importantEmails.results.length} emails`);
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
    console.error('[EmailDigest] Push notification failed:', error);
  }
}
