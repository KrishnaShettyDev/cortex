/**
 * Meeting Prep Job Handler
 *
 * Sends meeting prep notification 30 min before a meeting.
 * Includes attendee context and suggested talking points.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ScheduledJob } from '../scheduler';

export interface MeetingPrepPayload {
  eventId: string;
  title: string;
  startTime: number;
  attendees: string[];
  description?: string;
}

export async function handleMeetingPrep(
  db: D1Database,
  job: ScheduledJob,
  env: { EXPO_ACCESS_TOKEN?: string }
): Promise<void> {
  const payload = JSON.parse(job.payload) as MeetingPrepPayload;

  console.log(`[MeetingPrep] Processing job for event: ${payload.title}`);

  // Get attendee context from memories
  const attendeeContext = await getAttendeeContext(db, job.user_id, payload.attendees);

  // Build the prep message
  const prepMessage = buildPrepMessage(payload, attendeeContext);

  // Store as proactive message for in-app display
  await db.prepare(`
    INSERT INTO proactive_messages (id, user_id, type, title, body, data, created_at)
    VALUES (?, ?, 'meeting_prep', ?, ?, ?, unixepoch())
  `).bind(
    `pm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    job.user_id,
    `Meeting in 30 min: ${payload.title}`,
    prepMessage,
    JSON.stringify(payload)
  ).run();

  // Get user's push token and send notification
  const user = await db.prepare(`
    SELECT push_token FROM users WHERE id = ?
  `).first<{ push_token: string | null }>(job.user_id);

  if (user?.push_token && env.EXPO_ACCESS_TOKEN) {
    await sendPushNotification(env.EXPO_ACCESS_TOKEN, user.push_token, {
      title: `Meeting in 30 min: ${payload.title}`,
      body: prepMessage.slice(0, 100) + (prepMessage.length > 100 ? '...' : ''),
      data: { type: 'meeting_prep', eventId: payload.eventId }
    });
  }

  // Mark calendar event as notified
  await db.prepare(`
    UPDATE calendar_events SET prep_notification_sent = 1 WHERE id = ?
  `).bind(payload.eventId).run();

  console.log(`[MeetingPrep] Completed prep notification for: ${payload.title}`);
}

async function getAttendeeContext(
  db: D1Database,
  userId: string,
  attendees: string[]
): Promise<Map<string, string[]>> {
  const context = new Map<string, string[]>();

  for (const attendee of attendees.slice(0, 5)) { // Limit to 5 attendees
    // Extract name from email
    const name = attendee.split('@')[0].replace(/[._]/g, ' ');

    // Search for memories about this person
    const memories = await db.prepare(`
      SELECT content FROM memories
      WHERE user_id = ?
      AND (content LIKE ? OR content LIKE ?)
      ORDER BY created_at DESC
      LIMIT 3
    `).bind(userId, `%${name}%`, `%${attendee}%`).all<{ content: string }>();

    if (memories.results.length > 0) {
      context.set(attendee, memories.results.map(m => m.content));
    }
  }

  return context;
}

function buildPrepMessage(
  payload: MeetingPrepPayload,
  attendeeContext: Map<string, string[]>
): string {
  const parts: string[] = [];

  // Meeting details
  const startTime = new Date(payload.startTime * 1000);
  parts.push(`Meeting: ${payload.title}`);
  parts.push(`Time: ${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);

  if (payload.attendees.length > 0) {
    parts.push(`With: ${payload.attendees.slice(0, 3).map(a => a.split('@')[0]).join(', ')}`);
  }

  // Add attendee context
  if (attendeeContext.size > 0) {
    parts.push('\nContext:');
    for (const [attendee, memories] of attendeeContext) {
      const name = attendee.split('@')[0].replace(/[._]/g, ' ');
      parts.push(`- ${name}: ${memories[0].slice(0, 100)}`);
    }
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
    console.error('[MeetingPrep] Push notification failed:', error);
  }
}
