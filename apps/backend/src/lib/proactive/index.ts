/**
 * Proactive Monitoring - Lean Implementation
 *
 * Webhook → Classify → Notify. That's it.
 *
 * Supports: Google Super (Gmail, Calendar, Drive, Docs), Slack, Notion
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { sanitizeForPrompt } from '../sanitize';

// =============================================================================
// TYPES
// =============================================================================

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';
export type EventSource = 'email' | 'calendar' | 'drive' | 'docs' | 'slack' | 'notion';

export interface ProactiveEvent {
  id: string;
  userId: string;
  source: EventSource;
  title?: string;
  body?: string;
  sender?: string;
  urgency: UrgencyLevel;
  notified: boolean;
  createdAt: string;
}

// =============================================================================
// CONFIG
// =============================================================================

const URGENCY_RULES: Array<{
  pattern: RegExp;
  fields: ('title' | 'body' | 'sender')[];
  urgency: UrgencyLevel;
}> = [
  // Critical - OTPs, verification codes
  { pattern: /\b\d{4,8}\b.*(?:code|otp|verification|verify)/i, fields: ['title', 'body'], urgency: 'critical' },
  { pattern: /(?:code|otp|verification).*\b\d{4,8}\b/i, fields: ['title', 'body'], urgency: 'critical' },
  { pattern: /one.time.password/i, fields: ['title', 'body'], urgency: 'critical' },

  // High - Security, urgent
  { pattern: /password reset/i, fields: ['title', 'body'], urgency: 'high' },
  { pattern: /\burgent\b/i, fields: ['title'], urgency: 'high' },
  { pattern: /\basap\b/i, fields: ['title'], urgency: 'high' },
  { pattern: /action required/i, fields: ['title'], urgency: 'high' },
  { pattern: /payment (?:due|failed)/i, fields: ['title', 'body'], urgency: 'high' },

  // Low - Marketing, automated
  { pattern: /newsletter/i, fields: ['title', 'body'], urgency: 'low' },
  { pattern: /unsubscribe/i, fields: ['body'], urgency: 'low' },
  { pattern: /% off/i, fields: ['title', 'body'], urgency: 'low' },
  { pattern: /noreply@/i, fields: ['sender'], urgency: 'low' },
  { pattern: /no-reply@/i, fields: ['sender'], urgency: 'low' },

  // Slack - high priority for DMs
  { pattern: /^DM:/i, fields: ['title'], urgency: 'high' },

  // Notion - comments are usually high priority
  { pattern: /commented/i, fields: ['title'], urgency: 'high' },
];

// =============================================================================
// EVENT PARSER
// =============================================================================

interface ParsedEvent {
  source: EventSource;
  title?: string;
  body?: string;
  sender?: string;
}

function parseEvent(eventType: string, data: any): ParsedEvent | null {
  // Google Super - Gmail
  if (eventType === 'GOOGLESUPER_NEW_MESSAGE' || eventType === 'GMAIL_NEW_GMAIL_MESSAGE') {
    return {
      source: 'email',
      title: data.subject,
      body: data.snippet || data.body,
      sender: data.from || data.sender,
    };
  }

  // Google Super - Calendar
  if (eventType.includes('CALENDAR') || eventType.includes('EVENT')) {
    return {
      source: 'calendar',
      title: data.summary || data.title,
      body: data.description,
      sender: data.organizer?.email,
    };
  }

  // Google Super - Drive
  if (eventType.includes('FILE_') || eventType.includes('DRIVE')) {
    return {
      source: 'drive',
      title: `File: ${data.name || data.title || 'Untitled'}`,
      body: data.description || `Shared by ${data.sharingUser?.displayName || 'someone'}`,
      sender: data.sharingUser?.emailAddress || data.owners?.[0]?.emailAddress,
    };
  }

  // Google Super - Docs (comments)
  if (eventType.includes('COMMENT')) {
    return {
      source: 'docs',
      title: `Comment on ${data.documentTitle || 'document'}`,
      body: data.content || data.quotedText,
      sender: data.author?.displayName || data.author?.emailAddress,
    };
  }

  // Slack
  if (eventType.startsWith('SLACK_')) {
    const isDM = eventType.includes('DIRECT_MESSAGE');
    return {
      source: 'slack',
      title: isDM ? `DM: ${data.user || 'Someone'}` : `#${data.channel || 'channel'}`,
      body: data.text || data.message?.text,
      sender: data.user || data.user_name,
    };
  }

  // Notion
  if (eventType.startsWith('NOTION_')) {
    const isComment = eventType.includes('COMMENT');
    return {
      source: 'notion',
      title: isComment
        ? `Comment on ${data.page?.title || 'page'}`
        : data.page?.title || data.title || 'Notion update',
      body: data.content || data.rich_text?.[0]?.plain_text,
      sender: data.created_by?.name || data.last_edited_by?.name,
    };
  }

  return null;
}

// =============================================================================
// CLASSIFY
// =============================================================================

function classify(title?: string, body?: string, sender?: string): UrgencyLevel {
  const fields = { title: title || '', body: body || '', sender: sender || '' };

  for (const rule of URGENCY_RULES) {
    for (const field of rule.fields) {
      if (rule.pattern.test(fields[field])) {
        return rule.urgency;
      }
    }
  }

  return 'medium'; // default
}

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

export async function handleWebhook(
  db: D1Database,
  rawBody: string,
  signature: string,
  secret: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  // Verify signature
  if (signature && secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expected = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (signature !== expected && signature !== `sha256=${expected}`) {
      return { success: false, error: 'invalid_signature' };
    }
  }

  // Parse
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { success: false, error: 'invalid_json' };
  }

  // Get user from connection (Composio sends connectedAccountId as connectionId)
  // Also check client_id which is our user ID for trigger webhooks
  const connectionId = payload.connectionId || payload.connection_id;
  const clientId = payload.client_id; // For trigger webhooks, this is our user_id

  let userId: string | null = null;

  // First try: direct user ID from client_id (trigger webhooks)
  if (clientId) {
    const user = await db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).bind(clientId).first<{ id: string }>();
    if (user) {
      userId = user.id;
    }
  }

  // Second try: lookup by connection ID in integrations table
  if (!userId && connectionId) {
    const conn = await db.prepare(`
      SELECT user_id FROM integrations WHERE access_token = ? AND connected = 1
    `).bind(connectionId).first<{ user_id: string }>();
    if (conn) {
      userId = conn.user_id;
    }
  }

  // Third try: legacy sync_connections table (fallback)
  if (!userId && connectionId) {
    const syncConn = await db.prepare(`
      SELECT user_id FROM sync_connections WHERE composio_account_id = ?
    `).bind(connectionId).first<{ user_id: string }>();
    if (syncConn) {
      userId = syncConn.user_id;
    }
  }

  if (!userId) {
    console.error('[Proactive] Unknown connection:', { connectionId, clientId });
    return { success: false, error: 'unknown_connection' };
  }

  // Check if user has proactive enabled
  const prefs = await db.prepare(`
    SELECT enabled, min_urgency FROM proactive_settings WHERE user_id = ?
  `).bind(userId).first<{ enabled: number; min_urgency: string }>();

  if (!prefs?.enabled) {
    return { success: true }; // silently ignore
  }

  // Parse event based on type
  const eventType = payload.type || payload.triggerName || '';
  const parsed = parseEvent(eventType, payload.data || payload.payload || {});

  if (!parsed) {
    return { success: true }; // unknown event type, ignore
  }

  // Sanitize all text fields from webhook to prevent prompt injection
  const source = parsed.source;
  const title = parsed.title ? sanitizeForPrompt(parsed.title, 500) : undefined;
  const body = parsed.body ? sanitizeForPrompt(parsed.body, 2000) : undefined;
  const sender = parsed.sender ? sanitizeForPrompt(parsed.sender, 200) : undefined;

  // Classify
  const urgency = classify(title, body, sender);

  // Check if meets threshold
  const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  const minUrgency = (prefs.min_urgency || 'high') as UrgencyLevel;

  if (urgencyOrder[urgency] < urgencyOrder[minUrgency]) {
    return { success: true }; // below threshold
  }

  // Check rate limit (max 10/hour)
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentCount = await db.prepare(`
    SELECT COUNT(*) as count FROM proactive_events
    WHERE user_id = ? AND created_at > ? AND notified = 1
  `).bind(userId, hourAgo).first<{ count: number }>();

  if ((recentCount?.count || 0) >= 10) {
    return { success: true }; // rate limited
  }

  // Check VIP / blocked
  if (sender) {
    const senderLower = sender.toLowerCase();
    const vip = await db.prepare(`
      SELECT type FROM proactive_vip WHERE user_id = ? AND email = ?
    `).bind(userId, senderLower).first<{ type: string }>();

    if (vip?.type === 'blocked') {
      return { success: true }; // blocked sender
    }
  }

  // Save event
  const eventId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_events (id, user_id, source, title, body, sender, urgency, notified, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(eventId, userId, source, title || null, body?.slice(0, 500) || null, sender || null, urgency, now).run();

  // Send notification
  const notified = await sendNotification(db, userId, {
    title: formatTitle(source, title, sender, urgency),
    body: body?.slice(0, 200) || 'New notification',
    data: { eventId, source, urgency },
  });

  if (notified) {
    await db.prepare(`UPDATE proactive_events SET notified = 1 WHERE id = ?`).bind(eventId).run();
  }

  return { success: true, eventId };
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

function formatTitle(source: EventSource, title?: string, sender?: string, urgency?: UrgencyLevel): string {
  let prefix = '';
  if (urgency === 'critical') prefix = '\u{1F6A8} ';
  else if (urgency === 'high') prefix = '\u26A1 ';

  const senderName = sender?.split('<')[0].trim() || sender;

  switch (source) {
    case 'email':
      return prefix + (senderName ? `Email from ${senderName}` : 'New email');
    case 'calendar':
      return prefix + (title || 'Calendar event');
    case 'drive':
      return prefix + (title || 'File shared');
    case 'docs':
      return prefix + (title || 'Document comment');
    case 'slack':
      return prefix + (title || 'Slack message');
    case 'notion':
      return prefix + (title || 'Notion update');
    default:
      return prefix + (title || 'New notification');
  }
}

async function sendNotification(
  db: D1Database,
  userId: string,
  content: { title: string; body: string; data: Record<string, string> }
): Promise<boolean> {
  // Get push tokens
  const tokens = await db.prepare(`
    SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1
  `).bind(userId).all<{ push_token: string }>();

  if (!tokens.results?.length) {
    return false;
  }

  // Queue notification
  const now = new Date().toISOString();
  for (const { push_token } of tokens.results) {
    await db.prepare(`
      INSERT INTO scheduled_notifications (
        id, user_id, notification_type, title, body, data, channel_id,
        scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
      ) VALUES (?, ?, 'proactive', ?, ?, ?, 'proactive', ?, ?, 'UTC', 'pending', ?, ?)
    `).bind(
      nanoid(),
      userId,
      content.title,
      content.body,
      JSON.stringify({ ...content.data, pushToken: push_token }),
      now,
      now,
      now,
      now
    ).run();
  }

  return true;
}

// =============================================================================
// SETTINGS API
// =============================================================================

export async function getSettings(db: D1Database, userId: string) {
  let settings = await db.prepare(`
    SELECT * FROM proactive_settings WHERE user_id = ?
  `).bind(userId).first();

  if (!settings) {
    // Create defaults
    const id = nanoid();
    await db.prepare(`
      INSERT INTO proactive_settings (id, user_id, enabled, min_urgency, created_at, updated_at)
      VALUES (?, ?, 1, 'high', datetime('now'), datetime('now'))
    `).bind(id, userId).run();

    settings = { id, user_id: userId, enabled: 1, min_urgency: 'high' };
  }

  return {
    enabled: Boolean((settings as any).enabled),
    minUrgency: (settings as any).min_urgency,
  };
}

export async function updateSettings(
  db: D1Database,
  userId: string,
  updates: { enabled?: boolean; minUrgency?: string }
) {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const params: any[] = [];

  if (updates.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.minUrgency) {
    sets.push('min_urgency = ?');
    params.push(updates.minUrgency);
  }

  params.push(userId);

  await db.prepare(`
    UPDATE proactive_settings SET ${sets.join(', ')} WHERE user_id = ?
  `).bind(...params).run();

  return getSettings(db, userId);
}

// =============================================================================
// VIP API
// =============================================================================

export async function getVipSenders(db: D1Database, userId: string) {
  const result = await db.prepare(`
    SELECT email, name, type FROM proactive_vip WHERE user_id = ? ORDER BY name
  `).bind(userId).all();

  return result.results || [];
}

export async function addVipSender(
  db: D1Database,
  userId: string,
  email: string,
  name?: string,
  type: 'vip' | 'blocked' = 'vip'
) {
  await db.prepare(`
    INSERT INTO proactive_vip (id, user_id, email, name, type, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, email) DO UPDATE SET name = excluded.name, type = excluded.type
  `).bind(nanoid(), userId, email.toLowerCase(), name || null, type).run();
}

export async function removeVipSender(db: D1Database, userId: string, email: string) {
  await db.prepare(`
    DELETE FROM proactive_vip WHERE user_id = ? AND email = ?
  `).bind(userId, email.toLowerCase()).run();
}

// =============================================================================
// EVENTS API
// =============================================================================

export async function getEvents(db: D1Database, userId: string, limit = 50) {
  const result = await db.prepare(`
    SELECT * FROM proactive_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all();

  return result.results || [];
}

// =============================================================================
// CLEANUP (run on cron)
// =============================================================================

export async function cleanup(db: D1Database) {
  // Delete events older than 7 days
  await db.prepare(`
    DELETE FROM proactive_events WHERE created_at < datetime('now', '-7 days')
  `).run();
}
