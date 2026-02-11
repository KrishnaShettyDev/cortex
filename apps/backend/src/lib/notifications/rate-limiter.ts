/**
 * Notification Rate Limiter
 *
 * Enforces:
 * 1. Quiet hours (except for critical urgency)
 * 2. Daily notification cap
 * 3. Per-urgency hourly limits
 *
 * Use this before sending ANY notification to respect user preferences.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { log } from '../logger';
import { isWithinQuietHours, getCurrentHourInTimezone } from './timezone';

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  remaining?: {
    daily: number;
    hourly: number;
  };
}

interface UserPreferences {
  timezone: string;
  quiet_hours_enabled: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  max_notifications_per_day: number;
  notifications_sent_today: number;
  last_notification_date: string | null;
}

// Per-urgency hourly limits
const HOURLY_LIMITS: Record<UrgencyLevel, number> = {
  critical: Infinity, // No limit for OTPs, security alerts
  high: 20,
  medium: 10,
  low: 5,
};

const logger = log.notification;

/**
 * Check if a notification can be sent based on user preferences and rate limits
 */
export async function checkNotificationRateLimit(
  db: D1Database,
  userId: string,
  urgency: UrgencyLevel
): Promise<RateLimitCheck> {
  // Get user preferences
  const prefs = await db.prepare(`
    SELECT
      timezone,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
      max_notifications_per_day,
      notifications_sent_today,
      last_notification_date
    FROM notification_preferences
    WHERE user_id = ?
  `).bind(userId).first<UserPreferences>();

  // If no preferences, use defaults
  const timezone = prefs?.timezone || 'UTC';
  const quietHoursEnabled = prefs?.quiet_hours_enabled || 0;
  const quietHoursStart = prefs?.quiet_hours_start || '22:00';
  const quietHoursEnd = prefs?.quiet_hours_end || '07:00';
  const maxPerDay = prefs?.max_notifications_per_day || 25;
  let sentToday = prefs?.notifications_sent_today || 0;
  const lastDate = prefs?.last_notification_date;

  // Reset daily counter if it's a new day
  const today = new Date().toISOString().split('T')[0];
  if (lastDate !== today) {
    sentToday = 0;
  }

  // Check 1: Quiet hours (critical notifications always bypass)
  if (urgency !== 'critical' && quietHoursEnabled) {
    const startHour = parseInt(quietHoursStart.split(':')[0], 10);
    const endHour = parseInt(quietHoursEnd.split(':')[0], 10);

    if (isWithinQuietHours(timezone, quietHoursStart, quietHoursEnd)) {
      logger.info('blocked_quiet_hours', {
        userId,
        urgency,
        timezone,
        quietHoursStart,
        quietHoursEnd,
      });

      return {
        allowed: false,
        reason: `Quiet hours active (${quietHoursStart}-${quietHoursEnd} in ${timezone})`,
      };
    }
  }

  // Check 2: Daily cap (critical notifications always bypass)
  if (urgency !== 'critical' && sentToday >= maxPerDay) {
    logger.info('blocked_daily_cap', {
      userId,
      urgency,
      sentToday,
      maxPerDay,
    });

    return {
      allowed: false,
      reason: `Daily limit reached (${sentToday}/${maxPerDay})`,
      remaining: { daily: 0, hourly: 0 },
    };
  }

  // Check 3: Hourly per-urgency limit
  const hourlyLimit = HOURLY_LIMITS[urgency];
  if (hourlyLimit !== Infinity) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const hourlyCount = await db.prepare(`
      SELECT COUNT(*) as count
      FROM notification_log
      WHERE user_id = ?
        AND created_at > ?
        AND JSON_EXTRACT(data, '$.urgency') = ?
    `).bind(userId, hourAgo, urgency).first<{ count: number }>();

    const sentThisHour = hourlyCount?.count || 0;

    if (sentThisHour >= hourlyLimit) {
      logger.info('blocked_hourly_limit', {
        userId,
        urgency,
        sentThisHour,
        hourlyLimit,
      });

      return {
        allowed: false,
        reason: `Hourly ${urgency} limit reached (${sentThisHour}/${hourlyLimit})`,
        remaining: {
          daily: Math.max(0, maxPerDay - sentToday),
          hourly: 0,
        },
      };
    }

    return {
      allowed: true,
      remaining: {
        daily: Math.max(0, maxPerDay - sentToday - 1),
        hourly: Math.max(0, hourlyLimit - sentThisHour - 1),
      },
    };
  }

  // Critical urgency - always allowed
  return {
    allowed: true,
    remaining: {
      daily: Math.max(0, maxPerDay - sentToday - 1),
      hourly: Infinity,
    },
  };
}

/**
 * Record that a notification was sent (updates daily counter)
 */
export async function recordNotificationSent(
  db: D1Database,
  userId: string,
  urgency: UrgencyLevel
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Update daily counter
  await db.prepare(`
    UPDATE notification_preferences
    SET notifications_sent_today =
        CASE
          WHEN last_notification_date = ? THEN notifications_sent_today + 1
          ELSE 1
        END,
        last_notification_date = ?
    WHERE user_id = ?
  `).bind(today, today, userId).run();

  // Also log to notification_log for hourly tracking
  await db.prepare(`
    INSERT INTO notification_log (id, user_id, notification_type, title, body, data, status, created_at, updated_at)
    VALUES (?, ?, 'rate_tracking', 'Rate tracking entry', '', ?, 'sent', datetime('now'), datetime('now'))
  `).bind(
    `rate_${Date.now()}_${userId}`,
    userId,
    JSON.stringify({ urgency, tracked: true })
  ).run();
}

/**
 * Get current notification quota for a user
 */
export async function getNotificationQuota(
  db: D1Database,
  userId: string
): Promise<{
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  hourlyLimits: Record<UrgencyLevel, { limit: number; used: number; remaining: number }>;
}> {
  const prefs = await db.prepare(`
    SELECT max_notifications_per_day, notifications_sent_today, last_notification_date
    FROM notification_preferences
    WHERE user_id = ?
  `).bind(userId).first<{
    max_notifications_per_day: number;
    notifications_sent_today: number;
    last_notification_date: string | null;
  }>();

  const maxPerDay = prefs?.max_notifications_per_day || 25;
  const today = new Date().toISOString().split('T')[0];
  const sentToday = prefs?.last_notification_date === today
    ? prefs?.notifications_sent_today || 0
    : 0;

  // Get hourly counts per urgency
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const hourlyCounts = await db.prepare(`
    SELECT JSON_EXTRACT(data, '$.urgency') as urgency, COUNT(*) as count
    FROM notification_log
    WHERE user_id = ? AND created_at > ?
    GROUP BY urgency
  `).bind(userId, hourAgo).all<{ urgency: string; count: number }>();

  const hourlyUsage: Record<string, number> = {};
  for (const row of hourlyCounts.results || []) {
    if (row.urgency) {
      hourlyUsage[row.urgency] = row.count;
    }
  }

  const hourlyLimits: Record<UrgencyLevel, { limit: number; used: number; remaining: number }> = {
    critical: { limit: Infinity, used: hourlyUsage.critical || 0, remaining: Infinity },
    high: {
      limit: HOURLY_LIMITS.high,
      used: hourlyUsage.high || 0,
      remaining: Math.max(0, HOURLY_LIMITS.high - (hourlyUsage.high || 0)),
    },
    medium: {
      limit: HOURLY_LIMITS.medium,
      used: hourlyUsage.medium || 0,
      remaining: Math.max(0, HOURLY_LIMITS.medium - (hourlyUsage.medium || 0)),
    },
    low: {
      limit: HOURLY_LIMITS.low,
      used: hourlyUsage.low || 0,
      remaining: Math.max(0, HOURLY_LIMITS.low - (hourlyUsage.low || 0)),
    },
  };

  return {
    dailyLimit: maxPerDay,
    dailyUsed: sentToday,
    dailyRemaining: Math.max(0, maxPerDay - sentToday),
    hourlyLimits,
  };
}
