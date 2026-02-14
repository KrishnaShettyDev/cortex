/**
 * Meeting Prep Notifications
 *
 * Sends contextual notifications before meetings with info about attendees.
 * Runs via cron every 5 minutes to check for upcoming meetings.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';
import { scheduleJob, cancelJobByPayloadField } from '../jobs';

interface UpcomingMeeting {
  id: string;
  userId: string;
  title: string;
  startTime: Date;
  attendees: string[];
  location?: string;
  description?: string;
}

interface AttendeeContext {
  name: string;
  email: string;
  relationship?: string;
  recentMemories: string[];
  lastContactDays?: number;
}

/**
 * Check for meetings starting in the next 30-60 minutes and send prep notifications
 */
export async function processMeetingPrepNotifications(env: Bindings): Promise<{
  processed: number;
  notificationsSent: number;
}> {
  const now = new Date();
  const in30Min = new Date(now.getTime() + 30 * 60 * 1000);
  const in60Min = new Date(now.getTime() + 60 * 60 * 1000);

  // Find calendar events in the 30-60 minute window that haven't been prepped
  const upcomingMeetings = await env.DB.prepare(`
    SELECT
      ce.id,
      ce.user_id,
      ce.title,
      ce.start_time,
      ce.end_time,
      ce.attendees,
      ce.location,
      ce.description,
      ce.prep_notification_sent
    FROM calendar_events ce
    WHERE ce.start_time BETWEEN ? AND ?
    AND ce.prep_notification_sent = 0
    AND ce.attendees IS NOT NULL
    AND ce.attendees != '[]'
  `).bind(in30Min.toISOString(), in60Min.toISOString()).all();

  let notificationsSent = 0;

  for (const meeting of upcomingMeetings.results as any[]) {
    try {
      const attendees = JSON.parse(meeting.attendees || '[]');

      // Skip meetings with no external attendees
      if (attendees.length === 0) continue;

      // Get context about attendees
      const attendeeContexts = await getAttendeesContext(
        env.DB,
        meeting.user_id,
        attendees
      );

      // Skip if we have no context about any attendee
      if (attendeeContexts.length === 0) {
        // Still mark as sent so we don't keep checking
        await markPrepSent(env.DB, meeting.id);
        continue;
      }

      // Generate notification content
      const notification = generateMeetingPrepNotification(
        meeting,
        attendeeContexts
      );

      // Get user's push token
      const pushToken = await env.DB.prepare(`
        SELECT push_token FROM notification_preferences WHERE user_id = ?
      `).bind(meeting.user_id).first<{ push_token: string }>();

      if (pushToken?.push_token) {
        // Send push notification
        await sendMeetingPrepPush(env, {
          pushToken: pushToken.push_token,
          title: notification.title,
          body: notification.body,
          data: {
            type: 'meeting_prep',
            meetingId: meeting.id,
            meetingTitle: meeting.title,
          },
        });

        notificationsSent++;
      }

      // Also create a proactive message for in-app display
      await createMeetingPrepMessage(env.DB, meeting.user_id, meeting, attendeeContexts);

      // Mark as sent
      await markPrepSent(env.DB, meeting.id);
    } catch (error) {
      console.error(`[MeetingPrep] Failed to process meeting ${meeting.id}:`, error);
    }
  }

  return {
    processed: upcomingMeetings.results.length,
    notificationsSent,
  };
}

/**
 * Get context about meeting attendees from memories
 */
async function getAttendeesContext(
  db: D1Database,
  userId: string,
  attendeeEmails: string[]
): Promise<AttendeeContext[]> {
  const contexts: AttendeeContext[] = [];

  for (const email of attendeeEmails) {
    // Skip the user's own email
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
    if (user?.email?.toLowerCase() === email.toLowerCase()) continue;

    // Find entity matching this email
    const entity = await db.prepare(`
      SELECT id, name, metadata FROM entities
      WHERE user_id = ?
      AND (
        LOWER(json_extract(metadata, '$.email')) = LOWER(?)
        OR LOWER(name) LIKE LOWER(?)
      )
      LIMIT 1
    `).bind(userId, email, `%${email.split('@')[0]}%`).first<{
      id: string;
      name: string;
      metadata: string;
    }>();

    if (!entity) {
      // No entity found - just add email
      contexts.push({
        name: extractNameFromEmail(email),
        email,
        recentMemories: [],
      });
      continue;
    }

    const metadata = JSON.parse(entity.metadata || '{}');

    // Get recent memories about this person
    const memories = await db.prepare(`
      SELECT m.content, m.created_at
      FROM memories m
      JOIN entity_mentions em ON em.memory_id = m.id
      WHERE em.entity_id = ?
      ORDER BY m.created_at DESC
      LIMIT 3
    `).bind(entity.id).all();

    // Calculate days since last contact
    const lastContact = memories.results[0] as any;
    let lastContactDays: number | undefined;
    if (lastContact) {
      const lastDate = new Date(lastContact.created_at);
      lastContactDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    contexts.push({
      name: entity.name,
      email,
      relationship: metadata.relationship,
      recentMemories: (memories.results as any[]).map(m => m.content.slice(0, 100)),
      lastContactDays,
    });
  }

  return contexts;
}

/**
 * Generate meeting prep notification content
 */
function generateMeetingPrepNotification(
  meeting: any,
  attendeeContexts: AttendeeContext[]
): { title: string; body: string } {
  const startTime = new Date(meeting.start_time);
  const minutesUntil = Math.round((startTime.getTime() - Date.now()) / (1000 * 60));

  const title = `${meeting.title} in ${minutesUntil}min`;

  // Build body with attendee context
  const bodyParts: string[] = [];

  for (const ctx of attendeeContexts.slice(0, 2)) {
    if (ctx.recentMemories.length > 0) {
      bodyParts.push(`${ctx.name}: ${ctx.recentMemories[0].slice(0, 50)}...`);
    } else if (ctx.relationship) {
      bodyParts.push(`${ctx.name} (${ctx.relationship})`);
    }
  }

  const body = bodyParts.length > 0
    ? bodyParts.join(' | ')
    : `Meeting with ${attendeeContexts.map(a => a.name).join(', ')}`;

  return { title, body: body.slice(0, 150) };
}

/**
 * Send push notification for meeting prep
 */
async function sendMeetingPrepPush(
  env: Bindings,
  params: {
    pushToken: string;
    title: string;
    body: string;
    data: Record<string, any>;
  }
): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.pushToken,
        title: params.title,
        body: params.body,
        data: params.data,
        sound: 'default',
        categoryId: 'MEETING_PREP',
      }),
    });
  } catch (error) {
    console.error('[MeetingPrep] Push notification failed:', error);
  }
}

/**
 * Create a proactive message for in-app display
 */
async function createMeetingPrepMessage(
  db: D1Database,
  userId: string,
  meeting: any,
  attendeeContexts: AttendeeContext[]
): Promise<void> {
  const startTime = new Date(meeting.start_time);
  const minutesUntil = Math.round((startTime.getTime() - Date.now()) / (1000 * 60));

  // Build rich content
  let content = `**${meeting.title}** starting in ${minutesUntil} minutes\n\n`;

  if (meeting.location) {
    content += `Location: ${meeting.location}\n\n`;
  }

  if (attendeeContexts.length > 0) {
    content += '**Attendees:**\n';
    for (const ctx of attendeeContexts) {
      content += `- **${ctx.name}**`;
      if (ctx.relationship) content += ` (${ctx.relationship})`;
      content += '\n';

      if (ctx.recentMemories.length > 0) {
        content += `  Last context: "${ctx.recentMemories[0].slice(0, 80)}..."\n`;
      }

      if (ctx.lastContactDays && ctx.lastContactDays > 30) {
        content += `  Haven't talked in ${ctx.lastContactDays} days\n`;
      }
    }
  }

  const suggestedActions = [
    { type: 'open_calendar', label: 'Open Calendar', payload: { eventId: meeting.id } },
  ];

  if (meeting.location && meeting.location.includes('http')) {
    suggestedActions.push({ type: 'open_link', label: 'Join Meeting', payload: { url: meeting.location } });
  }

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, message_type, content, suggested_actions, created_at
    ) VALUES (?, ?, 'meeting_prep', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    content,
    JSON.stringify(suggestedActions)
  ).run();
}

/**
 * Mark meeting as prep notification sent
 */
async function markPrepSent(db: D1Database, meetingId: string): Promise<void> {
  await db.prepare(`
    UPDATE calendar_events SET prep_notification_sent = 1 WHERE id = ?
  `).bind(meetingId).run();
}

/**
 * Extract a name from an email address
 */
function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  // Convert "john.doe" or "john_doe" to "John Doe"
  return localPart
    .replace(/[._]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Sync calendar events from Composio for a user
 * Called periodically to keep calendar_events table up to date
 */
export async function syncCalendarEvents(
  env: Bindings,
  userId: string
): Promise<{ synced: number }> {
  // Get user's Google connection
  const integration = await env.DB.prepare(`
    SELECT access_token FROM integrations
    WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
  `).bind(userId).first<{ access_token: string }>();

  if (!integration?.access_token) {
    return { synced: 0 };
  }

  try {
    // Fetch upcoming events from Composio
    const response = await fetch(
      'https://backend.composio.dev/api/v2/actions/GOOGLECALENDAR_EVENTS_LIST/execute',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.COMPOSIO_API_KEY,
        },
        body: JSON.stringify({
          connectedAccountId: integration.access_token,
          input: {
            time_min: new Date().toISOString(),
            time_max: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Next 7 days
            max_results: 50,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('[MeetingPrep] Failed to fetch calendar events');
      return { synced: 0 };
    }

    const result = await response.json() as any;
    const events = result.data?.events || result.events || [];

    let synced = 0;

    for (const event of events) {
      // Extract attendees
      const attendees = (event.attendees || [])
        .map((a: any) => a.email)
        .filter((e: string) => e);

      const startTime = event.start?.dateTime || event.start_time;
      const eventTitle = event.summary || event.title || 'Untitled';

      // Upsert event
      await env.DB.prepare(`
        INSERT INTO calendar_events (
          id, user_id, title, start_time, end_time, attendees, location, description, prep_notification_sent, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          attendees = excluded.attendees,
          location = excluded.location,
          description = excluded.description,
          synced_at = datetime('now')
      `).bind(
        event.id,
        userId,
        eventTitle,
        startTime,
        event.end?.dateTime || event.end_time,
        JSON.stringify(attendees),
        event.location || null,
        event.description || null
      ).run();

      // Schedule meeting_prep job 30 minutes before event
      // Only for events with attendees
      if (attendees.length > 0 && startTime) {
        const eventStartTime = new Date(startTime).getTime();
        const prepTime = new Date(eventStartTime - 30 * 60 * 1000); // 30 min before

        // Only schedule if in the future
        if (prepTime.getTime() > Date.now()) {
          await scheduleJob(env.DB, {
            userId,
            type: 'meeting_prep',
            scheduledFor: prepTime,
            payload: {
              eventId: event.id,
              title: eventTitle,
              startTime: Math.floor(eventStartTime / 1000),
              attendees,
              description: event.description || undefined,
            },
          });
        }
      }

      synced++;
    }

    return { synced };
  } catch (error) {
    console.error('[MeetingPrep] Calendar sync failed:', error);
    return { synced: 0 };
  }
}
