/**
 * Smart Notification Batcher
 *
 * Batches notifications by urgency level to reduce notification fatigue:
 * - Critical: Immediate delivery (0ms)
 * - High: 30-second batch window
 * - Medium: 1-minute batch window
 * - Low: Daily digest only
 *
 * Called by:
 * 1. Webhook handler (queue notifications)
 * 2. 1-minute cron (flush due batches)
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import type { UrgencyLevel } from './classifier';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Batch window in milliseconds for each urgency level
const BATCH_WINDOWS: Record<UrgencyLevel, number> = {
  critical: 0,        // Immediate - no batching
  high: 30_000,       // 30 seconds
  medium: 60_000,     // 1 minute
  low: -1,            // Daily digest only (never batch-flush)
};

// Rate limits per urgency per hour
const RATE_LIMITS: Record<UrgencyLevel, number> = {
  critical: Infinity, // No limit for critical (OTPs, security)
  high: 20,           // 20 per hour
  medium: 10,         // 10 per hour
  low: 5,             // 5 per hour (digest)
};

// =============================================================================
// TYPES
// =============================================================================

export interface NotificationPayload {
  eventId: string;
  title: string;
  body: string;
  source: string;
  urgency: UrgencyLevel;
  data?: Record<string, any>;
}

export interface BatchFlushResult {
  batchId: string;
  userId: string;
  urgency: UrgencyLevel;
  eventCount: number;
  notificationsSent: number;
}

// =============================================================================
// QUEUE NOTIFICATION
// =============================================================================

/**
 * Queue a notification for batched delivery
 * Critical notifications are sent immediately
 */
export async function queueNotification(
  db: D1Database,
  userId: string,
  payload: NotificationPayload
): Promise<{ queued: boolean; immediate: boolean; reason?: string }> {
  const { urgency, eventId } = payload;
  const batchWindow = BATCH_WINDOWS[urgency];

  // Check rate limit first
  const rateLimited = await isRateLimited(db, userId, urgency);
  if (rateLimited) {
    console.log(`[Batcher] Rate limited: user=${userId} urgency=${urgency}`);
    return { queued: false, immediate: false, reason: 'rate_limited' };
  }

  // Critical: Send immediately
  if (batchWindow === 0) {
    const sent = await sendImmediateNotification(db, userId, payload);
    await recordNotificationSent(db, userId, urgency);
    return { queued: true, immediate: true };
  }

  // Low: Add to daily digest (not batched)
  if (batchWindow === -1) {
    await addToDigest(db, userId, payload);
    return { queued: true, immediate: false, reason: 'digest' };
  }

  // High/Medium: Add to batch queue
  const flushAt = new Date(Date.now() + batchWindow).toISOString();
  await addToBatch(db, userId, urgency, eventId, flushAt);

  return { queued: true, immediate: false };
}

/**
 * Add event to existing batch or create new batch
 */
async function addToBatch(
  db: D1Database,
  userId: string,
  urgency: UrgencyLevel,
  eventId: string,
  flushAt: string
): Promise<void> {
  const now = new Date().toISOString();

  // Check for existing batch that hasn't been flushed yet
  const existing = await db.prepare(`
    SELECT id, events FROM notification_batch
    WHERE user_id = ? AND urgency = ? AND flush_at > ?
    ORDER BY flush_at ASC
    LIMIT 1
  `).bind(userId, urgency, now).first<{ id: string; events: string }>();

  if (existing) {
    // Append to existing batch
    const events = JSON.parse(existing.events) as string[];
    if (!events.includes(eventId)) {
      events.push(eventId);
      await db.prepare(`
        UPDATE notification_batch SET events = ? WHERE id = ?
      `).bind(JSON.stringify(events), existing.id).run();
    }
  } else {
    // Create new batch
    await db.prepare(`
      INSERT INTO notification_batch (id, user_id, urgency, events, flush_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      userId,
      urgency,
      JSON.stringify([eventId]),
      flushAt,
      now
    ).run();
  }
}

// =============================================================================
// FLUSH BATCHES (called by cron)
// =============================================================================

/**
 * Flush all batches that are due
 * Called by 1-minute cron job
 */
export async function flushDueBatches(db: D1Database): Promise<BatchFlushResult[]> {
  const now = new Date().toISOString();
  const results: BatchFlushResult[] = [];

  // Get all batches that are due
  const dueBatches = await db.prepare(`
    SELECT id, user_id, urgency, events FROM notification_batch
    WHERE flush_at <= ?
    ORDER BY flush_at ASC
    LIMIT 100
  `).bind(now).all<{
    id: string;
    user_id: string;
    urgency: string;
    events: string;
  }>();

  if (!dueBatches.results?.length) {
    return results;
  }

  for (const batch of dueBatches.results) {
    const eventIds = JSON.parse(batch.events) as string[];

    // Check rate limit before sending
    const rateLimited = await isRateLimited(db, batch.user_id, batch.urgency as UrgencyLevel);
    if (rateLimited) {
      // Delete batch but don't send (rate limited)
      await db.prepare('DELETE FROM notification_batch WHERE id = ?').bind(batch.id).run();
      continue;
    }

    // Get events for this batch
    const events = await getEventsForBatch(db, eventIds);

    if (events.length > 0) {
      // Send batched notification
      const sent = await sendBatchedNotification(db, batch.user_id, events, batch.urgency as UrgencyLevel);

      if (sent) {
        await recordNotificationSent(db, batch.user_id, batch.urgency as UrgencyLevel);
      }

      results.push({
        batchId: batch.id,
        userId: batch.user_id,
        urgency: batch.urgency as UrgencyLevel,
        eventCount: events.length,
        notificationsSent: sent ? 1 : 0,
      });
    }

    // Delete processed batch
    await db.prepare('DELETE FROM notification_batch WHERE id = ?').bind(batch.id).run();
  }

  return results;
}

/**
 * Get event details for batched notification
 */
async function getEventsForBatch(
  db: D1Database,
  eventIds: string[]
): Promise<Array<{ id: string; title: string; body: string; source: string }>> {
  if (eventIds.length === 0) return [];

  const placeholders = eventIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT id, title, body, source FROM proactive_events
    WHERE id IN (${placeholders})
  `).bind(...eventIds).all<{
    id: string;
    title: string;
    body: string;
    source: string;
  }>();

  return result.results || [];
}

// =============================================================================
// SEND NOTIFICATIONS
// =============================================================================

/**
 * Send immediate notification (for critical urgency)
 */
async function sendImmediateNotification(
  db: D1Database,
  userId: string,
  payload: NotificationPayload
): Promise<boolean> {
  // Get push tokens
  const tokens = await db.prepare(`
    SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1
  `).bind(userId).all<{ push_token: string }>();

  if (!tokens.results?.length) {
    return false;
  }

  const now = new Date().toISOString();
  const channelId = getChannelId(payload.urgency);

  // Queue to scheduled_notifications for immediate delivery
  for (const { push_token } of tokens.results) {
    await db.prepare(`
      INSERT INTO scheduled_notifications (
        id, user_id, notification_type, title, body, data, channel_id,
        scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
      ) VALUES (?, ?, 'proactive', ?, ?, ?, ?, ?, ?, 'UTC', 'pending', ?, ?)
    `).bind(
      nanoid(),
      userId,
      formatNotificationTitle(payload),
      payload.body?.slice(0, 200) || 'New notification',
      JSON.stringify({
        eventId: payload.eventId,
        source: payload.source,
        urgency: payload.urgency,
        pushToken: push_token,
        ...payload.data,
      }),
      channelId,
      now,
      now,
      now,
      now
    ).run();
  }

  // Create proactive message for chat
  await createProactiveMessage(db, userId, payload);

  // Mark event as notified
  await db.prepare(`
    UPDATE proactive_events SET notified = 1 WHERE id = ?
  `).bind(payload.eventId).run();

  return true;
}

/**
 * Send batched notification (combines multiple events)
 */
async function sendBatchedNotification(
  db: D1Database,
  userId: string,
  events: Array<{ id: string; title: string; body: string; source: string }>,
  urgency: UrgencyLevel
): Promise<boolean> {
  if (events.length === 0) return false;

  // Get push tokens
  const tokens = await db.prepare(`
    SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1
  `).bind(userId).all<{ push_token: string }>();

  if (!tokens.results?.length) {
    return false;
  }

  // Build notification content
  const title = events.length === 1
    ? events[0].title || 'New notification'
    : `${events.length} new notifications`;

  const body = events.length === 1
    ? events[0].body?.slice(0, 200) || ''
    : events.slice(0, 3).map(e => e.title || e.source).join(', ') +
      (events.length > 3 ? ` +${events.length - 3} more` : '');

  const now = new Date().toISOString();
  const channelId = getChannelId(urgency);

  for (const { push_token } of tokens.results) {
    await db.prepare(`
      INSERT INTO scheduled_notifications (
        id, user_id, notification_type, title, body, data, channel_id,
        scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
      ) VALUES (?, ?, 'proactive_batch', ?, ?, ?, ?, ?, ?, 'UTC', 'pending', ?, ?)
    `).bind(
      nanoid(),
      userId,
      title,
      body,
      JSON.stringify({
        eventIds: events.map(e => e.id),
        urgency,
        pushToken: push_token,
      }),
      channelId,
      now,
      now,
      now,
      now
    ).run();
  }

  // Create proactive message for chat (single message for batch)
  await createBatchedProactiveMessage(db, userId, events, urgency);

  // Mark all events as notified
  for (const event of events) {
    await db.prepare(`
      UPDATE proactive_events SET notified = 1 WHERE id = ?
    `).bind(event.id).run();
  }

  return true;
}

// =============================================================================
// PROACTIVE MESSAGES (for chat)
// =============================================================================

async function createProactiveMessage(
  db: D1Database,
  userId: string,
  payload: NotificationPayload
): Promise<void> {
  const content = formatMessageContent(payload);
  const actions = getSuggestedActions(payload);

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, event_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'notification', ?, ?, 0, datetime('now'))
  `).bind(
    nanoid(),
    userId,
    payload.eventId,
    content,
    JSON.stringify(actions)
  ).run();
}

async function createBatchedProactiveMessage(
  db: D1Database,
  userId: string,
  events: Array<{ id: string; title: string; body: string; source: string }>,
  urgency: UrgencyLevel
): Promise<void> {
  const content = events.length === 1
    ? formatSingleEventContent(events[0])
    : formatBatchContent(events);

  const actions = events.length === 1
    ? getSuggestedActionsForEvent(events[0])
    : [{ type: 'view_all', label: 'View all notifications' }];

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, event_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'notification', ?, ?, 0, datetime('now'))
  `).bind(
    nanoid(),
    userId,
    events[0]?.id || null,
    content,
    JSON.stringify(actions)
  ).run();
}

// =============================================================================
// DAILY DIGEST
// =============================================================================

async function addToDigest(
  db: D1Database,
  userId: string,
  payload: NotificationPayload
): Promise<void> {
  // Low-priority events just get stored; digest sends them during morning briefing
  // The proactive_events table already stores them, so we just don't send immediate notification
  // Create a proactive message for chat (will be included in digest)
  await createProactiveMessage(db, userId, payload);
}

// =============================================================================
// RATE LIMITING
// =============================================================================

async function isRateLimited(
  db: D1Database,
  userId: string,
  urgency: UrgencyLevel
): Promise<boolean> {
  const limit = RATE_LIMITS[urgency];
  if (limit === Infinity) return false;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const count = await db.prepare(`
    SELECT COUNT(*) as count FROM notification_log
    WHERE user_id = ? AND created_at > ?
    AND JSON_EXTRACT(data, '$.urgency') = ?
  `).bind(userId, hourAgo, urgency).first<{ count: number }>();

  return (count?.count || 0) >= limit;
}

async function recordNotificationSent(
  db: D1Database,
  userId: string,
  urgency: UrgencyLevel
): Promise<void> {
  // Update daily counter in notification_preferences
  await db.prepare(`
    UPDATE notification_preferences
    SET notifications_sent_today = notifications_sent_today + 1,
        last_notification_date = date('now')
    WHERE user_id = ?
  `).bind(userId).run();
}

// =============================================================================
// HELPERS
// =============================================================================

function getChannelId(urgency: UrgencyLevel): string {
  switch (urgency) {
    case 'critical': return 'urgent_email';
    case 'high': return 'briefings';
    case 'medium': return 'insights';
    case 'low': return 'insights';
    default: return 'default';
  }
}

function formatNotificationTitle(payload: NotificationPayload): string {
  const prefix = payload.urgency === 'critical' ? '\u{1F6A8} ' :
                 payload.urgency === 'high' ? '\u26A1 ' : '';
  return prefix + (payload.title || 'New notification');
}

function formatMessageContent(payload: NotificationPayload): string {
  let content = '';

  if (payload.urgency === 'critical') {
    content += '\u{1F6A8} **Urgent**: ';
  } else if (payload.urgency === 'high') {
    content += '\u26A1 ';
  }

  content += payload.title || 'New notification';

  if (payload.body) {
    content += '\n\n' + payload.body.slice(0, 300);
  }

  return content;
}

function formatSingleEventContent(event: { title: string; body: string; source: string }): string {
  return `${event.title || 'New notification'}${event.body ? '\n\n' + event.body.slice(0, 300) : ''}`;
}

function formatBatchContent(events: Array<{ title: string; source: string }>): string {
  const lines = events.slice(0, 5).map((e, i) => `${i + 1}. ${e.title || e.source}`);
  if (events.length > 5) {
    lines.push(`...and ${events.length - 5} more`);
  }
  return `You have ${events.length} new notifications:\n\n${lines.join('\n')}`;
}

function getSuggestedActions(payload: NotificationPayload): Array<{ type: string; label: string; payload?: any }> {
  return getSuggestedActionsForEvent({
    source: payload.source,
    title: payload.title || '',
    body: payload.body || '',
  });
}

function getSuggestedActionsForEvent(event: { source: string; title?: string; body?: string }): Array<{ type: string; label: string; payload?: any }> {
  const actions: Array<{ type: string; label: string; payload?: any }> = [];

  switch (event.source) {
    case 'email':
      actions.push({ type: 'reply', label: 'Reply' });
      actions.push({ type: 'archive', label: 'Archive' });
      break;
    case 'calendar':
      actions.push({ type: 'view_event', label: 'View event' });
      actions.push({ type: 'snooze', label: 'Snooze' });
      break;
    case 'slack':
      actions.push({ type: 'reply', label: 'Reply' });
      break;
    case 'notion':
      actions.push({ type: 'view_page', label: 'View page' });
      break;
    default:
      actions.push({ type: 'dismiss', label: 'Dismiss' });
  }

  return actions;
}

// =============================================================================
// CLEANUP (called by cron)
// =============================================================================

/**
 * Clean up old batches that were never flushed (safety net)
 */
export async function cleanupStaleBatches(db: D1Database): Promise<number> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await db.prepare(`
    DELETE FROM notification_batch WHERE created_at < ?
  `).bind(dayAgo).run();

  return result.meta?.changes || 0;
}

/**
 * Reset daily notification counter (called at midnight)
 */
export async function resetDailyCounters(db: D1Database): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await db.prepare(`
    UPDATE notification_preferences
    SET notifications_sent_today = 0
    WHERE last_notification_date < ?
  `).bind(today).run();
}
