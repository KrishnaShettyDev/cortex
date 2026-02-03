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
 * Called by cron every 5 minutes
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

  console.log('[NotificationScheduler] Starting scheduled notification processing');

  try {
    // Get all users with notification preferences
    const prefsResult = await db.prepare(`
      SELECT np.*, u.name as user_name
      FROM notification_preferences np
      JOIN users u ON u.id = np.user_id
      WHERE np.enable_morning_briefing = 1 OR np.enable_evening_briefing = 1
    `).all<NotificationPrefs & { user_name: string }>();

    const allPrefs = prefsResult.results || [];
    console.log(`[NotificationScheduler] Processing ${allPrefs.length} users`);

    for (const prefs of allPrefs) {
      result.processed++;

      try {
        // Check if user has active push tokens
        const tokensResult = await db.prepare(`
          SELECT * FROM push_tokens
          WHERE user_id = ? AND is_active = 1
        `).bind(prefs.user_id).all<PushToken>();

        const tokens = tokensResult.results || [];
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
 */
async function sendMorningBriefing(
  db: D1Database,
  ai: any,
  prefs: NotificationPrefs & { user_name: string },
  tokens: PushToken[]
): Promise<boolean> {
  console.log(`[NotificationScheduler] Sending morning briefing to ${prefs.user_id}`);

  try {
    // Get today's data for briefing
    const now = new Date();
    const todayStart = now.toISOString().split('T')[0] + 'T00:00:00Z';
    const todayEnd = now.toISOString().split('T')[0] + 'T23:59:59Z';

    // Get today's commitments
    const commitmentsResult = await db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND status = 'pending'
      AND due_date >= ? AND due_date <= ?
    `).bind(prefs.user_id, todayStart, todayEnd).first<{ count: number }>();

    // Get overdue commitments
    const overdueResult = await db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND (status = 'pending' OR status = 'overdue')
      AND due_date < ?
    `).bind(prefs.user_id, todayStart).first<{ count: number }>();

    // Get pending nudges
    const nudgesResult = await db.prepare(`
      SELECT COUNT(*) as count FROM nudges
      WHERE user_id = ? AND status = 'pending'
      AND (priority = 'high' OR priority = 'urgent')
    `).bind(prefs.user_id).first<{ count: number }>();

    const todayCount = commitmentsResult?.count || 0;
    const overdueCount = overdueResult?.count || 0;
    const nudgesCount = nudgesResult?.count || 0;

    // Build briefing message
    const greeting = getGreetingForTimezone(prefs.timezone, prefs.user_name);
    let body = '';

    if (todayCount > 0 || overdueCount > 0 || nudgesCount > 0) {
      const parts: string[] = [];
      if (todayCount > 0) parts.push(`${todayCount} commitment${todayCount > 1 ? 's' : ''} due today`);
      if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
      if (nudgesCount > 0) parts.push(`${nudgesCount} important nudge${nudgesCount > 1 ? 's' : ''}`);
      body = parts.join(' · ');
    } else {
      body = 'Your day looks clear. What would you like to focus on?';
    }

    // Send to all active devices
    let success = false;
    for (const token of tokens) {
      if (!isValidExpoPushToken(token.push_token)) continue;

      const result = await sendPushNotification(
        token.push_token,
        greeting,
        body,
        {
          type: 'briefing',
          briefing_type: 'morning',
          today_count: todayCount,
          overdue_count: overdueCount,
          nudges_count: nudgesCount,
        },
        { channelId: 'briefings', priority: 'high' }
      );

      if (result.success) {
        success = true;
        await logNotification(db, prefs.user_id, token.id, 'briefing', greeting, body, result.ticketId);
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
 */
async function sendEveningBriefing(
  db: D1Database,
  ai: any,
  prefs: NotificationPrefs & { user_name: string },
  tokens: PushToken[]
): Promise<boolean> {
  console.log(`[NotificationScheduler] Sending evening briefing to ${prefs.user_id}`);

  try {
    // Get today's completed vs pending
    const now = new Date();
    const todayStart = now.toISOString().split('T')[0] + 'T00:00:00Z';
    const todayEnd = now.toISOString().split('T')[0] + 'T23:59:59Z';

    const completedResult = await db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND status = 'completed'
      AND updated_at >= ?
    `).bind(prefs.user_id, todayStart).first<{ count: number }>();

    const pendingResult = await db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND status = 'pending'
      AND due_date <= ?
    `).bind(prefs.user_id, todayEnd).first<{ count: number }>();

    // Get tomorrow's commitments
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStart = tomorrow.toISOString().split('T')[0] + 'T00:00:00Z';
    const tomorrowEnd = tomorrow.toISOString().split('T')[0] + 'T23:59:59Z';

    const tomorrowResult = await db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND status = 'pending'
      AND due_date >= ? AND due_date <= ?
    `).bind(prefs.user_id, tomorrowStart, tomorrowEnd).first<{ count: number }>();

    const completedCount = completedResult?.count || 0;
    const pendingCount = pendingResult?.count || 0;
    const tomorrowCount = tomorrowResult?.count || 0;

    // Build evening message
    const title = `Good evening, ${prefs.user_name || 'there'}`;
    let body = '';

    if (completedCount > 0) {
      body = `You completed ${completedCount} thing${completedCount > 1 ? 's' : ''} today.`;
    }

    if (tomorrowCount > 0) {
      body += body ? ' ' : '';
      body += `${tomorrowCount} coming up tomorrow.`;
    }

    if (!body) {
      body = 'How did your day go? Tap to reflect.';
    }

    // Send to all active devices
    let success = false;
    for (const token of tokens) {
      if (!isValidExpoPushToken(token.push_token)) continue;

      const result = await sendPushNotification(
        token.push_token,
        title,
        body,
        {
          type: 'briefing',
          briefing_type: 'evening',
          completed_count: completedCount,
          pending_count: pendingCount,
          tomorrow_count: tomorrowCount,
        },
        { channelId: 'briefings' }
      );

      if (result.success) {
        success = true;
        await logNotification(db, prefs.user_id, token.id, 'briefing', title, body, result.ticketId);
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
