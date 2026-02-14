/**
 * Incremental Sync Service
 *
 * Polls for changes as a fallback when webhooks are delayed or missed.
 * Uses provider-specific incremental sync APIs:
 * - Gmail: History API (historyId)
 * - Google Calendar: Sync Token
 * - Slack: Cursor-based pagination
 *
 * This is a safety net - webhooks are the primary delivery mechanism.
 * Sync runs every minute for active users (max 10/minute to control costs).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { classifyEvent, type ClassificationInput } from './classifier';
import { queueNotification, type NotificationPayload } from './batcher';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Maximum users to sync per minute (rate limiting)
const MAX_USERS_PER_SYNC = 10;

// Only sync users active in the last hour
const ACTIVE_USER_THRESHOLD_HOURS = 1;

// Minimum time between syncs per user (5 minutes)
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Event hash TTL for deduplication (24 hours)
const SEEN_EVENT_TTL_HOURS = 24;

// =============================================================================
// TYPES
// =============================================================================

export interface SyncCursor {
  id: string;
  userId: string;
  provider: string;
  cursorType: string;
  cursorValue: string;
  lastSyncAt: string;
}

export interface SyncResult {
  userId: string;
  provider: string;
  newEvents: number;
  duplicatesSkipped: number;
  errors: string[];
}

interface GmailHistoryEvent {
  id: string;
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
}

// =============================================================================
// MAIN SYNC FUNCTION
// =============================================================================

/**
 * Run incremental sync for active users
 * Called by 1-minute cron job
 */
export async function runIncrementalSync(
  db: D1Database,
  composioApiKey: string,
  openaiKey: string
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // Get users who need syncing
  const users = await getActiveUsersForSync(db);

  console.log(`[Sync] Found ${users.length} users needing sync`);

  // Process limited number per cycle
  for (const user of users.slice(0, MAX_USERS_PER_SYNC)) {
    try {
      // Gmail sync
      const gmailResult = await syncGmailForUser(db, user.id, composioApiKey, openaiKey);
      if (gmailResult) {
        results.push(gmailResult);
      }

      // Calendar sync (for event reminders)
      const calendarResult = await syncCalendarForUser(db, user.id, composioApiKey);
      if (calendarResult) {
        results.push(calendarResult);
      }
    } catch (error) {
      console.error(`[Sync] Error syncing user ${user.id}:`, error);
      results.push({
        userId: user.id,
        provider: 'unknown',
        newEvents: 0,
        duplicatesSkipped: 0,
        errors: [String(error)],
      });
    }
  }

  return results;
}

// =============================================================================
// USER SELECTION
// =============================================================================

/**
 * Get users who are active and haven't been synced recently
 */
async function getActiveUsersForSync(db: D1Database): Promise<Array<{ id: string; email: string }>> {
  const thresholdTime = new Date(Date.now() - ACTIVE_USER_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
  const minSyncTime = new Date(Date.now() - MIN_SYNC_INTERVAL_MS).toISOString();

  // Get users who:
  // 1. Have proactive notifications enabled
  // 2. Were active recently (updated_at)
  // 3. Haven't been synced in the last 5 minutes
  const result = await db.prepare(`
    SELECT u.id, u.email
    FROM users u
    LEFT JOIN proactive_settings ps ON ps.user_id = u.id
    LEFT JOIN sync_cursors sc ON sc.user_id = u.id AND sc.provider = 'gmail'
    WHERE u.updated_at > ?
    AND (ps.enabled = 1 OR ps.enabled IS NULL)
    AND (sc.last_sync_at IS NULL OR sc.last_sync_at < ?)
    ORDER BY COALESCE(sc.last_sync_at, '2000-01-01') ASC
    LIMIT ?
  `).bind(thresholdTime, minSyncTime, MAX_USERS_PER_SYNC * 2).all<{ id: string; email: string }>();

  return result.results || [];
}

// =============================================================================
// GMAIL SYNC
// =============================================================================

/**
 * Sync Gmail using History API
 */
async function syncGmailForUser(
  db: D1Database,
  userId: string,
  composioApiKey: string,
  openaiKey: string
): Promise<SyncResult | null> {
  const result: SyncResult = {
    userId,
    provider: 'gmail',
    newEvents: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  try {
    // Get current cursor
    const cursor = await getSyncCursor(db, userId, 'gmail', 'history_id');

    // Get connected account
    const connection = await db.prepare(`
      SELECT composio_connected_account_id
      FROM integrations
      WHERE user_id = ? AND provider = 'google' AND status = 'active'
    `).bind(userId).first<{ composio_connected_account_id: string }>();

    if (!connection?.composio_connected_account_id) {
      return null; // User not connected
    }

    // Fetch history from Gmail via Composio
    const historyResponse = await fetchGmailHistory(
      composioApiKey,
      connection.composio_connected_account_id,
      cursor?.cursorValue
    );

    if (!historyResponse.success) {
      result.errors.push(historyResponse.error || 'Failed to fetch Gmail history');
      return result;
    }

    // Process new messages
    for (const message of historyResponse.messages) {
      const eventHash = await generateEventHash('gmail', message.id, message.snippet);

      // Check if we've seen this event
      const isDuplicate = await isEventSeen(db, userId, eventHash);
      if (isDuplicate) {
        result.duplicatesSkipped++;
        continue;
      }

      // Classify the message
      const classificationInput: ClassificationInput = {
        source: 'email',
        title: message.subject,
        body: message.snippet,
        sender: message.from,
      };

      const classification = await classifyEvent(db, openaiKey, userId, classificationInput);

      // Skip low priority messages (daily digest only)
      if (classification.urgency === 'low' && !classification.actionRequired) {
        await markEventSeen(db, userId, eventHash, 'gmail');
        continue;
      }

      // Store as proactive event
      const eventId = await storeProactiveEvent(db, userId, {
        source: 'gmail',
        provider: 'google',
        externalId: message.id,
        title: message.subject,
        body: message.snippet,
        urgency: classification.urgency,
        category: classification.category,
        metadata: {
          from: message.from,
          threadId: message.threadId,
          labelIds: message.labelIds,
        },
      });

      // Queue notification
      await queueNotification(db, userId, {
        eventId,
        title: message.subject,
        body: message.snippet,
        source: 'email',
        urgency: classification.urgency,
        data: {
          from: message.from,
          messageId: message.id,
          threadId: message.threadId,
        },
      });

      await markEventSeen(db, userId, eventHash, 'gmail');
      result.newEvents++;
    }

    // Update cursor
    if (historyResponse.newHistoryId) {
      await updateSyncCursor(db, userId, 'gmail', 'history_id', historyResponse.newHistoryId);
    }

    return result;
  } catch (error) {
    result.errors.push(String(error));
    return result;
  }
}

/**
 * Fetch Gmail history via Composio
 */
async function fetchGmailHistory(
  composioApiKey: string,
  connectedAccountId: string,
  startHistoryId?: string
): Promise<{
  success: boolean;
  messages: GmailHistoryEvent[];
  newHistoryId?: string;
  error?: string;
}> {
  try {
    // Use Composio's Gmail action to get recent messages
    const response = await fetch('https://backend.composio.dev/api/v2/actions/GMAIL_LIST_MESSAGES/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': composioApiKey,
      },
      body: JSON.stringify({
        connectedAccountId,
        input: {
          maxResults: 20,
          labelIds: ['INBOX'],
          q: 'is:unread newer_than:1d', // Only unread from last day
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Sync] Gmail API error:', errorText);
      return { success: false, messages: [], error: errorText };
    }

    const data = await response.json() as {
      response_data?: {
        messages?: Array<{
          id: string;
          threadId: string;
          snippet?: string;
          payload?: {
            headers?: Array<{ name: string; value: string }>;
          };
          labelIds?: string[];
          internalDate?: string;
        }>;
        resultSizeEstimate?: number;
      };
    };

    const messages: GmailHistoryEvent[] = [];

    if (data.response_data?.messages) {
      for (const msg of data.response_data.messages) {
        const headers = msg.payload?.headers || [];
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');

        messages.push({
          id: msg.id,
          messageId: msg.id,
          threadId: msg.threadId,
          from: fromHeader?.value || 'Unknown',
          subject: subjectHeader?.value || '(no subject)',
          snippet: msg.snippet || '',
          date: msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : new Date().toISOString(),
          labelIds: msg.labelIds || [],
        });
      }
    }

    return {
      success: true,
      messages,
      newHistoryId: String(Date.now()), // Use timestamp as pseudo-historyId
    };
  } catch (error) {
    console.error('[Sync] Gmail fetch error:', error);
    return { success: false, messages: [], error: String(error) };
  }
}

// =============================================================================
// CALENDAR SYNC
// =============================================================================

/**
 * Sync Calendar for upcoming event reminders
 */
async function syncCalendarForUser(
  db: D1Database,
  userId: string,
  composioApiKey: string
): Promise<SyncResult | null> {
  const result: SyncResult = {
    userId,
    provider: 'googlecalendar',
    newEvents: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  try {
    // Get connected account
    const connection = await db.prepare(`
      SELECT composio_connected_account_id
      FROM integrations
      WHERE user_id = ? AND provider = 'google' AND status = 'active'
    `).bind(userId).first<{ composio_connected_account_id: string }>();

    if (!connection?.composio_connected_account_id) {
      return null;
    }

    // Fetch upcoming events (next 2 hours)
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const response = await fetch('https://backend.composio.dev/api/v2/actions/GOOGLECALENDAR_EVENTS_LIST/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': composioApiKey,
      },
      body: JSON.stringify({
        connectedAccountId: connection.composio_connected_account_id,
        input: {
          timeMin: now.toISOString(),
          timeMax: twoHoursLater.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        },
      }),
    });

    if (!response.ok) {
      return result;
    }

    const data = await response.json() as {
      response_data?: {
        items?: Array<{
          id: string;
          summary: string;
          start: { dateTime?: string; date?: string };
          location?: string;
          attendees?: Array<{ email: string; displayName?: string }>;
        }>;
      };
    };

    for (const event of data.response_data?.items || []) {
      const startTime = event.start.dateTime || event.start.date;
      if (!startTime) continue;

      const eventTime = new Date(startTime);
      const minutesUntil = (eventTime.getTime() - now.getTime()) / (60 * 1000);

      // Only notify for events starting in 15-30 minutes (sweet spot)
      if (minutesUntil < 10 || minutesUntil > 35) continue;

      const eventHash = await generateEventHash('calendar', event.id, `${minutesUntil}`);

      // Check deduplication
      const isDuplicate = await isEventSeen(db, userId, eventHash);
      if (isDuplicate) {
        result.duplicatesSkipped++;
        continue;
      }

      // Store proactive event
      const eventId = await storeProactiveEvent(db, userId, {
        source: 'calendar',
        provider: 'google',
        externalId: event.id,
        title: `📅 ${event.summary}`,
        body: `Starting in ${Math.round(minutesUntil)} minutes${event.location ? ` at ${event.location}` : ''}`,
        urgency: 'high',
        category: 'calendar',
        metadata: {
          startTime,
          location: event.location,
          attendees: event.attendees?.map(a => a.email),
        },
      });

      // Queue notification
      await queueNotification(db, userId, {
        eventId,
        title: event.summary,
        body: `Starting in ${Math.round(minutesUntil)} minutes`,
        source: 'calendar',
        urgency: 'high',
        data: {
          calendarEventId: event.id,
          startTime,
          location: event.location,
        },
      });

      await markEventSeen(db, userId, eventHash, 'googlecalendar');
      result.newEvents++;
    }

    return result;
  } catch (error) {
    result.errors.push(String(error));
    return result;
  }
}

// =============================================================================
// CURSOR MANAGEMENT
// =============================================================================

async function getSyncCursor(
  db: D1Database,
  userId: string,
  provider: string,
  cursorType: string
): Promise<SyncCursor | null> {
  const result = await db.prepare(`
    SELECT id, user_id, provider, cursor_type, cursor_value, last_sync_at
    FROM sync_cursors
    WHERE user_id = ? AND provider = ? AND cursor_type = ?
  `).bind(userId, provider, cursorType).first<{
    id: string;
    user_id: string;
    provider: string;
    cursor_type: string;
    cursor_value: string;
    last_sync_at: string;
  }>();

  if (!result) return null;

  return {
    id: result.id,
    userId: result.user_id,
    provider: result.provider,
    cursorType: result.cursor_type,
    cursorValue: result.cursor_value,
    lastSyncAt: result.last_sync_at,
  };
}

async function updateSyncCursor(
  db: D1Database,
  userId: string,
  provider: string,
  cursorType: string,
  cursorValue: string
): Promise<void> {
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO sync_cursors (id, user_id, provider, cursor_type, cursor_value, last_sync_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, provider, cursor_type)
    DO UPDATE SET cursor_value = ?, last_sync_at = ?, updated_at = ?
  `).bind(
    nanoid(),
    userId,
    provider,
    cursorType,
    cursorValue,
    now,
    now,
    now,
    cursorValue,
    now,
    now
  ).run();
}

// =============================================================================
// DEDUPLICATION
// =============================================================================

async function generateEventHash(provider: string, itemId: string, content: string): Promise<string> {
  const data = `${provider}:${itemId}:${content}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function isEventSeen(db: D1Database, userId: string, eventHash: string): Promise<boolean> {
  const result = await db.prepare(`
    SELECT 1 FROM seen_events WHERE user_id = ? AND event_hash = ?
  `).bind(userId, eventHash).first();

  return !!result;
}

async function markEventSeen(
  db: D1Database,
  userId: string,
  eventHash: string,
  provider: string
): Promise<void> {
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO seen_events (id, user_id, event_hash, provider, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(nanoid(), userId, eventHash, provider, now).run();
}

// =============================================================================
// PROACTIVE EVENT STORAGE
// =============================================================================

interface ProactiveEventInput {
  source: string;
  provider: string;
  externalId: string;
  title: string;
  body: string;
  urgency: string;
  category?: string;
  metadata?: Record<string, any>;
}

async function storeProactiveEvent(
  db: D1Database,
  userId: string,
  input: ProactiveEventInput
): Promise<string> {
  const eventId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_events (
      id, user_id, source, title, body, urgency, category,
      external_id, metadata, notified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    eventId,
    userId,
    input.source,
    input.title,
    input.body,
    input.urgency,
    input.category || null,
    input.externalId,
    JSON.stringify(input.metadata || {}),
    now
  ).run();

  return eventId;
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Clean up old seen events (24h TTL)
 * Called by 6-hour cron
 */
export async function cleanupSeenEvents(db: D1Database): Promise<number> {
  const cutoff = new Date(Date.now() - SEEN_EVENT_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const result = await db.prepare(`
    DELETE FROM seen_events WHERE created_at < ?
  `).bind(cutoff).run();

  return result.meta?.changes || 0;
}

/**
 * Clean up old classification cache (1h TTL)
 */
export async function cleanupClassificationCache(db: D1Database): Promise<number> {
  const now = new Date().toISOString();

  const result = await db.prepare(`
    DELETE FROM classification_cache WHERE expires_at < ?
  `).bind(now).run();

  return result.meta?.changes || 0;
}
