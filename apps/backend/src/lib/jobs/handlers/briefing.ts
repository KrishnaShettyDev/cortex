/**
 * Briefing Job Handler
 *
 * Generates and sends morning or evening briefing.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface BriefingPayload {
  type: 'morning' | 'evening';
  timezone?: string;
}

export async function handleBriefing(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string; OPENAI_API_KEY?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as BriefingPayload;

  console.log(`[Briefing] Generating ${payload.type} briefing for user: ${job.user_id}`);

  // Get today's data
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400);
  const dayEnd = dayStart + 86400;

  // Get calendar events for today
  const events = await db.prepare(`
    SELECT title, start_time, end_time, attendees
    FROM calendar_events
    WHERE user_id = ? AND start_time >= ? AND start_time < ?
    ORDER BY start_time ASC
  `).bind(job.user_id, dayStart, dayEnd).all<{
    title: string;
    start_time: number;
    end_time: number;
    attendees: string;
  }>();

  // Get pending commitments
  const commitments = await db.prepare(`
    SELECT title, due_at FROM commitments
    WHERE user_id = ? AND status = 'pending' AND due_at < ?
    ORDER BY due_at ASC
    LIMIT 5
  `).bind(job.user_id, dayEnd).all<{ title: string; due_at: number }>();

  // Get recent proactive messages (emails, alerts)
  const proactiveMessages = await db.prepare(`
    SELECT title, type FROM proactive_messages
    WHERE user_id = ? AND created_at >= ? AND dismissed = 0
    ORDER BY created_at DESC
    LIMIT 3
  `).bind(job.user_id, dayStart).all<{ title: string; type: string }>();

  // Build briefing
  const briefing = buildBriefing(payload.type, {
    events: events.results,
    commitments: commitments.results,
    alerts: proactiveMessages.results
  });

  // Store briefing as proactive message
  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'briefing', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    payload.type === 'morning' ? 'Good Morning' : 'Evening Summary',
    briefing,
    JSON.stringify({ type: payload.type })
  ).run();

  // Send push notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: payload.type === 'morning' ? 'Good Morning' : 'Evening Summary',
      body: briefing.split('\n')[0].slice(0, 100),
      data: { type: 'briefing', briefingType: payload.type }
    });
  }

  console.log(`[Briefing] Completed ${payload.type} briefing`);
}

function buildBriefing(
  type: 'morning' | 'evening',
  data: {
    events: Array<{ title: string; start_time: number; end_time: number; attendees: string }>;
    commitments: Array<{ title: string; due_at: number }>;
    alerts: Array<{ title: string; type: string }>;
  }
): string {
  const parts: string[] = [];

  if (type === 'morning') {
    // Morning: Focus on what's ahead
    if (data.events.length > 0) {
      parts.push(`You have ${data.events.length} meeting${data.events.length > 1 ? 's' : ''} today:`);
      for (const event of data.events.slice(0, 3)) {
        const time = new Date(event.start_time * 1000).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit'
        });
        parts.push(`- ${time}: ${event.title}`);
      }
    } else {
      parts.push('No meetings scheduled for today.');
    }

    if (data.commitments.length > 0) {
      parts.push('');
      parts.push(`${data.commitments.length} thing${data.commitments.length > 1 ? 's' : ''} due:`);
      for (const c of data.commitments.slice(0, 3)) {
        parts.push(`- ${c.title}`);
      }
    }

    if (data.alerts.length > 0) {
      parts.push('');
      parts.push(`${data.alerts.length} alert${data.alerts.length > 1 ? 's' : ''} to review.`);
    }
  } else {
    // Evening: Summarize the day
    parts.push("Here's your day in review:");

    if (data.events.length > 0) {
      parts.push(`- ${data.events.length} meeting${data.events.length > 1 ? 's' : ''} completed`);
    }

    if (data.commitments.length > 0) {
      parts.push(`- ${data.commitments.length} pending task${data.commitments.length > 1 ? 's' : ''}`);
    }

    parts.push('');
    parts.push('Rest well!');
  }

  return parts.join('\n');
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
    console.error('[Briefing] Push notification failed:', error);
  }
}
