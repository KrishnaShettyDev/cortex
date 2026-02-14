/**
 * Notification Scheduler
 *
 * Handles scheduled notification delivery based on user timezones.
 * Runs on cron and delivers notifications at the right local time for each user.
 */

import { nanoid } from 'nanoid';
import {
  sendPushNotification,
  isValidExpoPushToken,
} from './push-service';
import {
  getCurrentTimeInTimezone,
  getCurrentDateInTimezone,
  isWithinTimeWindow,
  isWithinQuietHours,
  getGreetingForTimezone,
} from './timezone';
import {
  generateMorningBriefing,
  generateEveningBriefing,
} from './ai-generator';
import type { Bindings } from '../../types';

interface NotificationPrefs {
  user_id: string;
  timezone: string;
  enable_morning_briefing: number;
  enable_evening_briefing: number;
  enable_meeting_prep: number;
  enable_email_alerts: number;
  enable_commitment_reminders: number;
  enable_pattern_warnings: number;
  enable_reconnection_nudges: number;
  enable_memory_insights: number;
  enable_important_dates: number;
  enable_smart_reminders: number;
  morning_briefing_time: string;
  evening_briefing_time: string;
  meeting_prep_minutes_before: number;
  max_notifications_per_day: number;
  quiet_hours_enabled: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  notifications_sent_today: number;
  last_notification_date: string | null;
}

interface PushToken {
  id: string;
  user_id: string;
  push_token: string;
  platform: string;
  device_name: string | null;
  is_active: number;
}

interface SchedulerResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Process scheduled notifications (morning/evening briefings)
 * Called by cron every 6 hours
 *
 * SCALE-OPTIMIZED:
 * - Batches users (BATCH_SIZE per run)
 * - Joins push_tokens to avoid N+1 queries
 * - Only processes users who haven't been notified recently
 * - At 10k users with BATCH_SIZE=200, all users processed in ~50 cycles
 */
export async function processScheduledNotifications(
  db: D1Database,
  ai: any
): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // SCALE: Limit batch size to prevent resource exhaustion
  const BATCH_SIZE = 200;

  console.log('[NotificationScheduler] Starting scheduled notification processing');

  try {
    // SCALE-OPTIMIZED: Single query with JOIN to avoid N+1
    // Only fetch users with active push tokens who haven't been notified in last 4 hours
    const prefsResult = await db.prepare(`
      SELECT DISTINCT
        np.*,
        u.name as user_name,
        pt.push_token,
        pt.platform,
        pt.device_name
      FROM notification_preferences np
      JOIN users u ON u.id = np.user_id
      JOIN push_tokens pt ON pt.user_id = np.user_id AND pt.is_active = 1
      WHERE (np.enable_morning_briefing = 1 OR np.enable_evening_briefing = 1)
        AND (np.last_notification_date IS NULL
             OR np.last_notification_date < date('now', '-4 hours'))
      ORDER BY np.last_notification_date ASC NULLS FIRST
      LIMIT ?
    `).bind(BATCH_SIZE).all<NotificationPrefs & { user_name: string; push_token: string; platform: string; device_name: string | null }>();

    const allPrefs = prefsResult.results || [];
    console.log(`[NotificationScheduler] Processing ${allPrefs.length} users (batch of ${BATCH_SIZE})`);

    // Group by user_id to handle multiple push tokens
    const userPrefsMap = new Map<string, { prefs: NotificationPrefs & { user_name: string }; tokens: PushToken[] }>();
    for (const row of allPrefs) {
      if (!userPrefsMap.has(row.user_id)) {
        userPrefsMap.set(row.user_id, { prefs: row, tokens: [] });
      }
      userPrefsMap.get(row.user_id)!.tokens.push({
        id: '',
        user_id: row.user_id,
        push_token: row.push_token,
        platform: row.platform,
        device_name: row.device_name,
        is_active: 1,
      });
    }

    for (const [userId, { prefs, tokens }] of userPrefsMap) {
      result.processed++;

      try {
        // Tokens already fetched via JOIN - no extra query needed
        if (tokens.length === 0) {
          result.skipped++;
          continue;
        }

        // Check quiet hours
        if (prefs.quiet_hours_enabled && isWithinQuietHours(
          prefs.timezone,
          prefs.quiet_hours_start,
          prefs.quiet_hours_end
        )) {
          result.skipped++;
          continue;
        }

        // Check daily budget
        const today = getCurrentDateInTimezone(prefs.timezone);
        let sentToday = prefs.notifications_sent_today;
        if (prefs.last_notification_date !== today) {
          // New day, reset counter
          sentToday = 0;
        }

        if (sentToday >= prefs.max_notifications_per_day) {
          result.skipped++;
          continue;
        }

        // Check if it's time for morning briefing
        if (prefs.enable_morning_briefing && isWithinTimeWindow(
          prefs.timezone,
          prefs.morning_briefing_time,
          2 // 2-minute window
        )) {
          const sent = await sendMorningBriefing(db, ai, prefs, tokens);
          if (sent) {
            result.sent++;
            sentToday++;
            await updateNotificationCount(db, prefs.user_id, today, sentToday);
          } else {
            result.failed++;
          }
        }

        // Check if it's time for evening briefing
        if (prefs.enable_evening_briefing && isWithinTimeWindow(
          prefs.timezone,
          prefs.evening_briefing_time,
          2
        )) {
          const sent = await sendEveningBriefing(db, ai, prefs, tokens);
          if (sent) {
            result.sent++;
            sentToday++;
            await updateNotificationCount(db, prefs.user_id, today, sentToday);
          } else {
            result.failed++;
          }
        }

      } catch (error: any) {
        result.failed++;
        result.errors.push(`User ${prefs.user_id}: ${error.message}`);
      }
    }

    console.log(`[NotificationScheduler] Complete:`, result);
    return result;

  } catch (error: any) {
    console.error('[NotificationScheduler] Fatal error:', error);
    result.errors.push(`Fatal: ${error.message}`);
    return result;
  }
}

/**
 * Send morning briefing notification
 * Uses AI to generate contextual, personalized notifications
 */
async function sendMorningBriefing(
  db: D1Database,
  ai: any,
  prefs: NotificationPrefs & { user_name: string },
  tokens: PushToken[]
): Promise<boolean> {
  console.log(`[NotificationScheduler] Sending morning briefing to ${prefs.user_id}`);

  try {
    // Generate AI-powered briefing (falls back to template if rate limited or fails)
    const notification = await generateMorningBriefing(
      db,
      ai,
      prefs.user_id,
      prefs.user_name || 'there',
      prefs.timezone
    );

    console.log(`[NotificationScheduler] Generated briefing (AI: ${notification.usedAI}): ${notification.title}`);

    // Send to all active devices
    let success = false;
    for (const token of tokens) {
      if (!isValidExpoPushToken(token.push_token)) continue;

      const result = await sendPushNotification(
        token.push_token,
        notification.title,
        notification.body,
        {
          type: 'briefing',
          briefing_type: 'morning',
          usedAI: notification.usedAI,
        },
        { channelId: 'briefings', priority: 'high' }
      );

      if (result.success) {
        success = true;
        await logNotificationWithAI(
          db,
          prefs.user_id,
          token.id,
          'briefing',
          notification.title,
          notification.body,
          result.ticketId,
          notification.usedAI
        );
      }
    }

    return success;
  } catch (error: any) {
    console.error(`[NotificationScheduler] Morning briefing failed for ${prefs.user_id}:`, error);
    return false;
  }
}

/**
 * Send evening briefing notification
 * Uses AI to generate contextual, personalized notifications
 */
async function sendEveningBriefing(
  db: D1Database,
  ai: any,
  prefs: NotificationPrefs & { user_name: string },
  tokens: PushToken[]
): Promise<boolean> {
  console.log(`[NotificationScheduler] Sending evening briefing to ${prefs.user_id}`);

  try {
    // Generate AI-powered briefing (falls back to template if rate limited or fails)
    const notification = await generateEveningBriefing(
      db,
      ai,
      prefs.user_id,
      prefs.user_name || 'there'
    );

    console.log(`[NotificationScheduler] Generated evening briefing (AI: ${notification.usedAI}): ${notification.title}`);

    // Send to all active devices
    let success = false;
    for (const token of tokens) {
      if (!isValidExpoPushToken(token.push_token)) continue;

      const result = await sendPushNotification(
        token.push_token,
        notification.title,
        notification.body,
        {
          type: 'briefing',
          briefing_type: 'evening',
          usedAI: notification.usedAI,
        },
        { channelId: 'briefings' }
      );

      if (result.success) {
        success = true;
        await logNotificationWithAI(
          db,
          prefs.user_id,
          token.id,
          'briefing',
          notification.title,
          notification.body,
          result.ticketId,
          notification.usedAI
        );
      }
    }

    return success;
  } catch (error: any) {
    console.error(`[NotificationScheduler] Evening briefing failed for ${prefs.user_id}:`, error);
    return false;
  }
}

/**
 * Send nudge notification
 */
export async function sendNudgeNotification(
  db: D1Database,
  userId: string,
  nudge: {
    id: string;
    title: string;
    message: string;
    nudge_type: string;
    priority: string;
    entity_name?: string;
    suggested_action?: string;
  }
): Promise<boolean> {
  try {
    // Get user's preferences and tokens
    const prefs = await db.prepare(`
      SELECT * FROM notification_preferences WHERE user_id = ?
    `).bind(userId).first<NotificationPrefs>();

    if (!prefs) return false;

    // Check quiet hours
    if (prefs.quiet_hours_enabled && isWithinQuietHours(
      prefs.timezone,
      prefs.quiet_hours_start,
      prefs.quiet_hours_end
    )) {
      return false;
    }

    // Check daily budget
    const today = getCurrentDateInTimezone(prefs.timezone);
    if (prefs.last_notification_date === today &&
        prefs.notifications_sent_today >= prefs.max_notifications_per_day) {
      return false;
    }

    // Get tokens
    const tokensResult = await db.prepare(`
      SELECT * FROM push_tokens WHERE user_id = ? AND is_active = 1
    `).bind(userId).all<PushToken>();

    const tokens = tokensResult.results || [];
    if (tokens.length === 0) return false;

    // Determine channel based on nudge type
    let channelId = 'default';
    if (nudge.nudge_type.includes('commitment')) channelId = 'commitments';
    else if (nudge.nudge_type.includes('relationship')) channelId = 'relationships';
    else if (nudge.nudge_type.includes('pattern')) channelId = 'patterns';

    // Send notification
    let success = false;
    for (const token of tokens) {
      if (!isValidExpoPushToken(token.push_token)) continue;

      const result = await sendPushNotification(
        token.push_token,
        nudge.title,
        nudge.message,
        {
          type: nudge.nudge_type,
          nudge_id: nudge.id,
          entity_name: nudge.entity_name,
          suggested_action: nudge.suggested_action,
        },
        {
          channelId,
          priority: nudge.priority === 'urgent' || nudge.priority === 'high' ? 'high' : 'normal',
        }
      );

      if (result.success) {
        success = true;
        await logNotification(db, userId, token.id, nudge.nudge_type, nudge.title, nudge.message, result.ticketId);
      }
    }

    if (success) {
      const sentToday = prefs.last_notification_date === today ? prefs.notifications_sent_today + 1 : 1;
      await updateNotificationCount(db, userId, today, sentToday);
    }

    return success;
  } catch (error: any) {
    console.error(`[NotificationScheduler] Nudge notification failed:`, error);
    return false;
  }
}

/**
 * Update notification count for today
 */
async function updateNotificationCount(
  db: D1Database,
  userId: string,
  date: string,
  count: number
): Promise<void> {
  await db.prepare(`
    UPDATE notification_preferences
    SET notifications_sent_today = ?,
        last_notification_date = ?,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).bind(count, date, userId).run();
}

/**
 * Log notification for tracking
 */
async function logNotification(
  db: D1Database,
  userId: string,
  tokenId: string,
  type: string,
  title: string,
  body: string,
  ticketId?: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO notification_log (
      id, user_id, push_token_id, notification_type,
      title, body, status, expo_ticket_id,
      scheduled_for, sent_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, datetime('now'), datetime('now'), datetime('now'))
  `).bind(
    nanoid(),
    userId,
    tokenId,
    type,
    title,
    body,
    ticketId || null
  ).run();
}

/**
 * Log notification with AI usage tracking
 * Used to enforce AI notification rate limits
 */
async function logNotificationWithAI(
  db: D1Database,
  userId: string,
  tokenId: string,
  type: string,
  title: string,
  body: string,
  ticketId?: string,
  usedAI: boolean = false
): Promise<void> {
  await db.prepare(`
    INSERT INTO notification_log (
      id, user_id, push_token_id, notification_type,
      title, body, status, expo_ticket_id,
      data, scheduled_for, sent_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, datetime('now'), datetime('now'), datetime('now'))
  `).bind(
    nanoid(),
    userId,
    tokenId,
    type,
    title,
    body,
    ticketId || null,
    JSON.stringify({ usedAI: usedAI ? 1 : 0 })
  ).run();
}

/**
 * Process proactive notification queue
 *
 * Sends queued notifications from scheduled_notifications table.
 * Called by 1-minute cron to deliver webhooks → push notifications.
 *
 * SCALE: Processes 50 notifications per run to avoid resource exhaustion.
 */
export async function processProactiveNotificationQueue(
  db: D1Database
): Promise<{ sent: number; skipped: number; failed: number; errors: string[] }> {
  const result = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] };
  const BATCH_SIZE = 50;

  console.log('[NotificationQueue] Processing pending notifications');

  try {
    // Get pending notifications that are due
    const pending = await db.prepare(`
      SELECT id, user_id, notification_type, title, body, data, channel_id
      FROM scheduled_notifications
      WHERE status = 'pending'
        AND scheduled_for_utc <= datetime('now')
      ORDER BY scheduled_for_utc ASC
      LIMIT ?
    `).bind(BATCH_SIZE).all<{
      id: string;
      user_id: string;
      notification_type: string;
      title: string;
      body: string;
      data: string | null;
      channel_id: string | null;
    }>();

    if (!pending.results?.length) {
      return result;
    }

    console.log(`[NotificationQueue] Found ${pending.results.length} pending notifications`);

    // Group by user to batch token lookups
    const userNotifications = new Map<string, typeof pending.results>();
    for (const notif of pending.results) {
      if (!userNotifications.has(notif.user_id)) {
        userNotifications.set(notif.user_id, []);
      }
      userNotifications.get(notif.user_id)!.push(notif);
    }

    // Process each user's notifications
    for (const [userId, notifications] of userNotifications) {
      // Get push tokens for this user
      const tokensResult = await db.prepare(`
        SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1
      `).bind(userId).all<{ push_token: string }>();

      const tokens = tokensResult.results || [];

      if (tokens.length === 0) {
        // No push tokens - mark as skipped but don't block queue
        for (const notif of notifications) {
          await db.prepare(`
            UPDATE scheduled_notifications
            SET status = 'skipped', updated_at = datetime('now')
            WHERE id = ?
          `).bind(notif.id).run();
          result.skipped++;
        }
        continue;
      }

      // Send each notification to all tokens
      for (const notif of notifications) {
        let sent = false;

        for (const { push_token } of tokens) {
          if (!isValidExpoPushToken(push_token)) continue;

          try {
            const data = notif.data ? JSON.parse(notif.data) : {};
            const pushResult = await sendPushNotification(
              push_token,
              notif.title,
              notif.body,
              data,
              {
                channelId: notif.channel_id || 'default',
                priority: 'high',
              }
            );

            if (pushResult.success) {
              sent = true;
            } else {
              result.errors.push(`${notif.id}: ${pushResult.error}`);
            }
          } catch (error: any) {
            result.errors.push(`${notif.id}: ${error.message}`);
          }
        }

        // Update notification status
        if (sent) {
          await db.prepare(`
            UPDATE scheduled_notifications
            SET status = 'sent', updated_at = datetime('now')
            WHERE id = ?
          `).bind(notif.id).run();
          result.sent++;
        } else {
          await db.prepare(`
            UPDATE scheduled_notifications
            SET status = 'failed', updated_at = datetime('now')
            WHERE id = ?
          `).bind(notif.id).run();
          result.failed++;
        }
      }
    }

    console.log(`[NotificationQueue] Complete: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`);
    return result;
  } catch (error: any) {
    console.error('[NotificationQueue] Fatal error:', error);
    result.errors.push(`Fatal: ${error.message}`);
    return result;
  }
}
