/**
 * Push Notification Handlers
 *
 * Endpoints for managing push tokens, notification preferences,
 * and sending notifications.
 */

import { Context } from 'hono';
import { nanoid } from 'nanoid';
import type { Bindings } from '../types';
import { isValidExpoPushToken, sendPushNotification } from '../lib/notifications/push-service';
import { isValidAPNsToken, createAPNsConfig, sendAPNsNotification } from '../lib/notifications/apns-service';
import { isValidTimezone, getCurrentTimeInTimezone } from '../lib/notifications/timezone';
import { createLogger } from '../lib/logger';
import { badRequest, internalError } from '../utils/errors';

const logger = createLogger('notifications');

/**
 * POST /notifications/register
 * Register a device push token (supports both APNs and Expo tokens)
 */
export async function registerPushToken(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json<{
    push_token: string;
    platform: 'ios' | 'android' | 'web';
    device_name?: string;
    token_type?: 'apns' | 'expo';
  }>();

  if (!body.push_token) {
    return badRequest(c, 'push_token is required');
  }

  if (!['ios', 'android', 'web'].includes(body.platform)) {
    return badRequest(c, 'platform must be ios, android, or web');
  }

  // Detect token type based on format or explicit parameter
  let tokenType: 'apns' | 'expo' = body.token_type || 'expo';

  // Auto-detect if not specified
  if (!body.token_type) {
    if (isValidAPNsToken(body.push_token)) {
      tokenType = 'apns';
    } else if (isValidExpoPushToken(body.push_token)) {
      tokenType = 'expo';
    } else {
      return badRequest(c, 'Invalid push token format. Expected APNs (64 hex chars) or Expo token.');
    }
  }

  // Validate token format matches type
  if (tokenType === 'apns' && !isValidAPNsToken(body.push_token)) {
    return badRequest(c, 'Invalid APNs token format. Expected 64 hex characters.');
  }
  if (tokenType === 'expo' && !isValidExpoPushToken(body.push_token)) {
    return badRequest(c, 'Invalid Expo push token format.');
  }

  try {
    const now = new Date().toISOString();
    const id = nanoid();

    // Upsert token with token_type
    await c.env.DB.prepare(`
      INSERT INTO push_tokens (id, user_id, push_token, platform, device_name, token_type, is_active, created_at, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(push_token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        device_name = excluded.device_name,
        token_type = excluded.token_type,
        is_active = 1,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at
    `).bind(
      id,
      userId,
      body.push_token,
      body.platform,
      body.device_name || null,
      tokenType,
      now,
      now,
      now
    ).run();

    // Ensure notification preferences exist
    await ensureNotificationPreferences(c.env.DB, userId);

    logger.info('Push token registered', { userId, tokenType, platform: body.platform });

    return c.json({
      success: true,
      message: 'Push token registered',
      token_type: tokenType,
    });
  } catch (error) {
    logger.error('Failed to register token', error as Error, { userId });
    return internalError(c, 'Failed to register push token');
  }
}

/**
 * POST /notifications/unregister
 * Unregister a device push token
 */
export async function unregisterPushToken(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json<{ push_token: string }>();

  if (!body.push_token) {
    return c.json({ error: 'push_token is required' }, 400);
  }

  try {
    // Soft delete - set inactive instead of deleting
    await c.env.DB.prepare(`
      UPDATE push_tokens
      SET is_active = 0, updated_at = datetime('now')
      WHERE push_token = ? AND user_id = ?
    `).bind(body.push_token, userId).run();

    console.log(`[Notifications] Unregistered token for user ${userId}`);

    return c.json({
      success: true,
      message: 'Push token unregistered',
    });
  } catch (error: any) {
    console.error('[Notifications] Failed to unregister token:', error);
    return c.json({ error: 'Failed to unregister push token', message: error.message }, 500);
  }
}

/**
 * GET /notifications/preferences
 * Get notification preferences
 */
export async function getNotificationPreferences(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  try {
    // Ensure preferences exist
    await ensureNotificationPreferences(c.env.DB, userId);

    const prefs = await c.env.DB.prepare(`
      SELECT * FROM notification_preferences WHERE user_id = ?
    `).bind(userId).first();

    if (!prefs) {
      return c.json({ error: 'Preferences not found' }, 404);
    }

    return c.json({
      timezone: prefs.timezone,
      enable_morning_briefing: !!prefs.enable_morning_briefing,
      enable_evening_briefing: !!prefs.enable_evening_briefing,
      enable_meeting_prep: !!prefs.enable_meeting_prep,
      enable_email_alerts: !!prefs.enable_email_alerts,
      enable_commitment_reminders: !!prefs.enable_commitment_reminders,
      enable_pattern_warnings: !!prefs.enable_pattern_warnings,
      enable_reconnection_nudges: !!prefs.enable_reconnection_nudges,
      enable_memory_insights: !!prefs.enable_memory_insights,
      enable_important_dates: !!prefs.enable_important_dates,
      enable_smart_reminders: !!prefs.enable_smart_reminders,
      morning_briefing_time: prefs.morning_briefing_time,
      evening_briefing_time: prefs.evening_briefing_time,
      meeting_prep_minutes_before: prefs.meeting_prep_minutes_before,
      max_notifications_per_day: prefs.max_notifications_per_day,
      quiet_hours_enabled: !!prefs.quiet_hours_enabled,
      quiet_hours_start: prefs.quiet_hours_start,
      quiet_hours_end: prefs.quiet_hours_end,
      notifications_sent_today: prefs.notifications_sent_today,
      current_local_time: getCurrentTimeInTimezone(prefs.timezone as string),
    });
  } catch (error: any) {
    console.error('[Notifications] Failed to get preferences:', error);
    return c.json({ error: 'Failed to get preferences', message: error.message }, 500);
  }
}

/**
 * PUT /notifications/preferences
 * Update notification preferences
 */
export async function updateNotificationPreferences(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json();

  try {
    // Ensure preferences exist first
    await ensureNotificationPreferences(c.env.DB, userId);

    // Validate timezone if provided
    if (body.timezone && !isValidTimezone(body.timezone)) {
      return c.json({ error: 'Invalid timezone. Use IANA format like America/New_York or Asia/Kolkata' }, 400);
    }

    // Validate time formats (HH:MM)
    const timeFields = ['morning_briefing_time', 'evening_briefing_time', 'quiet_hours_start', 'quiet_hours_end'];
    for (const field of timeFields) {
      if (body[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body[field])) {
        return c.json({ error: `Invalid time format for ${field}. Use HH:MM format.` }, 400);
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    const booleanFields = [
      'enable_morning_briefing', 'enable_evening_briefing', 'enable_meeting_prep',
      'enable_email_alerts', 'enable_commitment_reminders', 'enable_pattern_warnings',
      'enable_reconnection_nudges', 'enable_memory_insights', 'enable_important_dates',
      'enable_smart_reminders', 'quiet_hours_enabled'
    ];

    const stringFields = [
      'timezone', 'morning_briefing_time', 'evening_briefing_time',
      'quiet_hours_start', 'quiet_hours_end'
    ];

    const numberFields = ['max_notifications_per_day', 'meeting_prep_minutes_before'];

    for (const field of booleanFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field] ? 1 : 0);
      }
    }

    for (const field of stringFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    for (const field of numberFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(body[field]);
      }
    }

    if (updates.length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }

    updates.push("updated_at = datetime('now')");
    values.push(userId);

    await c.env.DB.prepare(`
      UPDATE notification_preferences
      SET ${updates.join(', ')}
      WHERE user_id = ?
    `).bind(...values).run();

    console.log(`[Notifications] Updated preferences for user ${userId}`);

    return c.json({
      success: true,
      message: 'Preferences updated',
    });
  } catch (error: any) {
    console.error('[Notifications] Failed to update preferences:', error);
    return c.json({ error: 'Failed to update preferences', message: error.message }, 500);
  }
}

/**
 * POST /notifications/test
 * Send a test notification to verify setup
 */
export async function sendTestNotification(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  try {
    // Get user's active tokens
    const tokensResult = await c.env.DB.prepare(`
      SELECT push_token, platform, token_type FROM push_tokens
      WHERE user_id = ? AND is_active = 1
    `).bind(userId).all<{ push_token: string; platform: string; token_type: string }>();

    const tokens = tokensResult.results || [];

    if (tokens.length === 0) {
      return badRequest(c, 'No active push tokens found. Make sure notifications are enabled.');
    }

    // Get user's timezone
    const prefs = await c.env.DB.prepare(`
      SELECT timezone FROM notification_preferences WHERE user_id = ?
    `).bind(userId).first<{ timezone: string }>();

    const timezone = prefs?.timezone || 'UTC';
    const localTime = getCurrentTimeInTimezone(timezone);

    // Send test notification to all devices
    const results: { token: string; tokenType: string; success: boolean; error?: string }[] = [];

    for (const token of tokens) {
      const tokenType = token.token_type || 'expo';

      if (tokenType === 'apns') {
        // Send via APNs
        const apnsConfig = createAPNsConfig(c.env);
        if (!apnsConfig) {
          results.push({
            token: token.push_token.slice(0, 16) + '...',
            tokenType: 'apns',
            success: false,
            error: 'APNs not configured',
          });
          continue;
        }

        const result = await sendAPNsNotification(apnsConfig, {
          deviceToken: token.push_token,
          title: 'Cortex Test Notification',
          body: `Your local time: ${localTime} (${timezone}). Push notifications are working!`,
          data: { type: 'test', timestamp: Date.now() },
        });

        results.push({
          token: token.push_token.slice(0, 16) + '...',
          tokenType: 'apns',
          success: result.success,
          error: result.error,
        });
      } else {
        // Send via Expo
        const result = await sendPushNotification(
          token.push_token,
          'Cortex Test Notification',
          `Your local time: ${localTime} (${timezone}). Push notifications are working!`,
          { type: 'test', timestamp: Date.now() },
          { channelId: 'default', priority: 'high' }
        );

        results.push({
          token: token.push_token.slice(0, 30) + '...',
          tokenType: 'expo',
          success: result.success,
          error: result.error,
        });
      }
    }

    const allSuccess = results.every(r => r.success);

    return c.json({
      success: allSuccess,
      message: allSuccess ? 'Test notification sent to all devices' : 'Some notifications failed',
      devices_sent: results.filter(r => r.success).length,
      devices_failed: results.filter(r => !r.success).length,
      timezone,
      local_time: localTime,
      results,
    });
  } catch (error) {
    logger.error('Test notification failed', error as Error, { userId });
    return internalError(c, 'Failed to send test notification');
  }
}

/**
 * GET /notifications/status
 * Get notification system status for user
 */
export async function getNotificationStatus(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  try {
    // Get tokens
    const tokensResult = await c.env.DB.prepare(`
      SELECT id, platform, device_name, is_active, created_at, last_used_at
      FROM push_tokens
      WHERE user_id = ?
      ORDER BY last_used_at DESC
    `).bind(userId).all();

    // Get preferences
    const prefs = await c.env.DB.prepare(`
      SELECT timezone, notifications_sent_today, last_notification_date,
             max_notifications_per_day, enable_morning_briefing, enable_evening_briefing,
             morning_briefing_time, evening_briefing_time
      FROM notification_preferences
      WHERE user_id = ?
    `).bind(userId).first();

    // Get recent notifications
    const recentResult = await c.env.DB.prepare(`
      SELECT notification_type, title, status, sent_at
      FROM notification_log
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(userId).all();

    const timezone = (prefs?.timezone as string) || 'UTC';

    return c.json({
      devices: {
        total: tokensResult.results?.length || 0,
        active: tokensResult.results?.filter((t: any) => t.is_active).length || 0,
        list: tokensResult.results || [],
      },
      preferences: prefs ? {
        timezone,
        current_local_time: getCurrentTimeInTimezone(timezone),
        morning_briefing: prefs.enable_morning_briefing ? prefs.morning_briefing_time : 'disabled',
        evening_briefing: prefs.enable_evening_briefing ? prefs.evening_briefing_time : 'disabled',
      } : null,
      budget: prefs ? {
        sent_today: prefs.notifications_sent_today,
        max_per_day: prefs.max_notifications_per_day,
        remaining: Math.max(0, (prefs.max_notifications_per_day as number) - (prefs.notifications_sent_today as number)),
      } : null,
      recent_notifications: recentResult.results || [],
    });
  } catch (error: any) {
    console.error('[Notifications] Failed to get status:', error);
    return c.json({ error: 'Failed to get notification status', message: error.message }, 500);
  }
}

/**
 * Ensure notification preferences exist for user
 */
async function ensureNotificationPreferences(db: D1Database, userId: string): Promise<void> {
  const exists = await db.prepare(`
    SELECT 1 FROM notification_preferences WHERE user_id = ?
  `).bind(userId).first();

  if (!exists) {
    // Try to detect timezone from user's location or default to UTC
    // We'll use UTC as default and let the mobile app update it
    await db.prepare(`
      INSERT INTO notification_preferences (id, user_id, timezone, created_at, updated_at)
      VALUES (?, ?, 'UTC', datetime('now'), datetime('now'))
    `).bind(nanoid(), userId).run();
  }
}

// Export all handlers
export const notificationHandlers = {
  registerPushToken,
  unregisterPushToken,
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  getNotificationStatus,
};
