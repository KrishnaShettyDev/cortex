/**
 * Incremental Sync Fallback
 *
 * When Composio webhooks fail or are delayed, this service catches up
 * by polling Gmail History API for users who haven't received events recently.
 *
 * Features:
 * - Uses Gmail historyId for efficient delta sync
 * - Only syncs users with stale webhook data (>30 min no events)
 * - Limits sync to 5-10 users per cron to control costs
 * - Processes emails as if they came from webhooks
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { log } from '../logger';
import { sanitizeForPrompt } from '../sanitize';
import { getAccessToken } from '../crypto';

const logger = log.sync;

export interface SyncResult {
  userId: string;
  provider: string;
  messagesFound: number;
  eventsCreated: number;
  error?: string;
}

export interface IncrementalSyncStats {
  usersChecked: number;
  usersSynced: number;
  totalEvents: number;
  errors: string[];
}

/**
 * Get users who need incremental sync (no webhook events in last 30 min)
 */
export async function getStaleUsers(
  db: D1Database,
  limit: number = 5
): Promise<Array<{ userId: string; provider: string; lastHistoryId: string | null }>> {
  // Find users with Gmail connected who haven't received events recently
  const result = await db.prepare(`
    SELECT
      i.user_id as userId,
      'gmail' as provider,
      ss.last_history_id as lastHistoryId
    FROM integrations i
    LEFT JOIN sync_state ss ON ss.user_id = i.user_id AND ss.provider = 'gmail'
    LEFT JOIN (
      SELECT user_id, MAX(created_at) as last_event
      FROM proactive_events
      WHERE source = 'email' AND created_at > datetime('now', '-30 minutes')
      GROUP BY user_id
    ) pe ON pe.user_id = i.user_id
    WHERE i.provider = 'google_super'
      AND i.connected = 1
      AND pe.last_event IS NULL
      AND (ss.sync_errors IS NULL OR ss.sync_errors < 5)
    ORDER BY COALESCE(ss.last_sync_at, '2000-01-01') ASC
    LIMIT ?
  `).bind(limit).all<{
    userId: string;
    provider: string;
    lastHistoryId: string | null;
  }>();

  return result.results || [];
}

/**
 * Perform incremental sync for a single user
 */
export async function syncUserGmail(
  db: D1Database,
  userId: string,
  composioApiKey: string,
  encryptionKey: string
): Promise<SyncResult> {
  const result: SyncResult = {
    userId,
    provider: 'gmail',
    messagesFound: 0,
    eventsCreated: 0,
  };

  try {
    // Get access token (encrypted)
    const accessToken = await getAccessToken(db, userId, 'google_super', encryptionKey);

    if (!accessToken) {
      result.error = 'No access token found';
      await recordSyncError(db, userId, 'gmail');
      return result;
    }

    // Get last history ID
    const syncState = await db.prepare(`
      SELECT last_history_id, last_sync_token
      FROM sync_state
      WHERE user_id = ? AND provider = 'gmail'
    `).bind(userId).first<{ last_history_id: string | null; last_sync_token: string | null }>();

    const lastHistoryId = syncState?.last_history_id;

    // If no history ID, we need to do an initial sync to get one
    if (!lastHistoryId) {
      const initialResult = await initializeGmailSync(db, userId, accessToken);
      if (initialResult.error) {
        result.error = initialResult.error;
        await recordSyncError(db, userId, 'gmail');
      }
      return result;
    }

    // Fetch history since last known ID via Composio
    // Note: In production, this would call Composio's Gmail action
    // For now, we'll use a direct Gmail API call pattern
    const historyResponse = await fetchGmailHistory(accessToken, lastHistoryId);

    if (!historyResponse.success) {
      result.error = historyResponse.error;
      await recordSyncError(db, userId, 'gmail');
      return result;
    }

    const { messages, newHistoryId } = historyResponse;
    result.messagesFound = messages.length;

    // Process messages (max 10 to avoid timeout)
    const messagesToProcess = messages.slice(0, 10);

    for (const message of messagesToProcess) {
      try {
        const eventCreated = await processGmailMessage(db, userId, message);
        if (eventCreated) {
          result.eventsCreated++;
        }
      } catch (error) {
        logger.error('message_processing_failed', error, { userId, messageId: message.id });
      }
    }

    // Update sync state
    await db.prepare(`
      INSERT INTO sync_state (user_id, provider, last_history_id, last_sync_at, sync_errors, updated_at)
      VALUES (?, 'gmail', ?, datetime('now'), 0, datetime('now'))
      ON CONFLICT(user_id, provider) DO UPDATE SET
        last_history_id = excluded.last_history_id,
        last_sync_at = excluded.last_sync_at,
        sync_errors = 0,
        updated_at = excluded.updated_at
    `).bind(userId, newHistoryId || lastHistoryId).run();

    logger.info('sync_completed', {
      userId,
      messagesFound: result.messagesFound,
      eventsCreated: result.eventsCreated,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    logger.error('sync_failed', error, { userId });
    await recordSyncError(db, userId, 'gmail');
    return result;
  }
}

/**
 * Initialize Gmail sync by getting the current historyId
 */
async function initializeGmailSync(
  db: D1Database,
  userId: string,
  accessToken: string
): Promise<{ error?: string }> {
  try {
    // Get user's profile to get current historyId
    const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const error = await response.text();
      return { error: `Gmail API error: ${response.status} - ${error}` };
    }

    const profile = await response.json() as { historyId: string };

    // Store initial history ID
    await db.prepare(`
      INSERT INTO sync_state (user_id, provider, last_history_id, last_sync_at, created_at, updated_at)
      VALUES (?, 'gmail', ?, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(user_id, provider) DO UPDATE SET
        last_history_id = excluded.last_history_id,
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at
    `).bind(userId, profile.historyId).run();

    logger.info('sync_initialized', { userId, historyId: profile.historyId });
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetch Gmail history since a given historyId
 */
async function fetchGmailHistory(
  accessToken: string,
  startHistoryId: string
): Promise<{
  success: boolean;
  messages: Array<{ id: string; threadId: string }>;
  newHistoryId?: string;
  error?: string;
}> {
  try {
    const url = new URL('https://www.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    url.searchParams.set('maxResults', '20');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const error = await response.text();

      // Handle "historyId is too old" error - need to re-initialize
      if (response.status === 404 || error.includes('historyId')) {
        return { success: false, messages: [], error: 'historyId_expired' };
      }

      return { success: false, messages: [], error: `Gmail API error: ${response.status}` };
    }

    const data = await response.json() as {
      history?: Array<{ messagesAdded?: Array<{ message: { id: string; threadId: string } }> }>;
      historyId: string;
    };

    const messages: Array<{ id: string; threadId: string }> = [];

    for (const h of data.history || []) {
      for (const added of h.messagesAdded || []) {
        messages.push(added.message);
      }
    }

    return {
      success: true,
      messages,
      newHistoryId: data.historyId,
    };
  } catch (error) {
    return {
      success: false,
      messages: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process a Gmail message and create a proactive event
 */
async function processGmailMessage(
  db: D1Database,
  userId: string,
  message: { id: string; threadId: string }
): Promise<boolean> {
  // Check if we already have this message
  const existing = await db.prepare(
    'SELECT 1 FROM seen_events WHERE event_id = ?'
  ).bind(`gmail_${message.id}`).first();

  if (existing) {
    return false; // Already processed
  }

  // Mark as seen
  await db.prepare(
    'INSERT INTO seen_events (event_id, created_at) VALUES (?, datetime("now"))'
  ).bind(`gmail_${message.id}`).run();

  // Note: In production, we would fetch the full message details here
  // For now, we create a basic event that the user can view
  const eventId = nanoid();

  await db.prepare(`
    INSERT INTO proactive_events (id, user_id, source, title, body, urgency, notified, created_at)
    VALUES (?, ?, 'email', 'New email (synced)', 'Email synced via incremental sync', 'medium', 0, datetime('now'))
  `).bind(eventId, userId).run();

  return true;
}

/**
 * Record a sync error for a user (for circuit breaker pattern)
 */
async function recordSyncError(
  db: D1Database,
  userId: string,
  provider: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (user_id, provider, sync_errors, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id, provider) DO UPDATE SET
      sync_errors = COALESCE(sync_errors, 0) + 1,
      updated_at = datetime('now')
  `).bind(userId, provider).run();
}

/**
 * Run incremental sync for stale users (called from cron)
 */
export async function runIncrementalSync(
  db: D1Database,
  composioApiKey: string,
  encryptionKey: string,
  maxUsers: number = 5
): Promise<IncrementalSyncStats> {
  const stats: IncrementalSyncStats = {
    usersChecked: 0,
    usersSynced: 0,
    totalEvents: 0,
    errors: [],
  };

  // Get stale users
  const staleUsers = await getStaleUsers(db, maxUsers);
  stats.usersChecked = staleUsers.length;

  if (staleUsers.length === 0) {
    logger.info('no_stale_users', { message: 'All users have recent webhook data' });
    return stats;
  }

  logger.info('incremental_sync_starting', {
    usersToSync: staleUsers.length,
    users: staleUsers.map(u => u.userId),
  });

  for (const user of staleUsers) {
    const result = await syncUserGmail(db, user.userId, composioApiKey, encryptionKey);

    if (result.error) {
      stats.errors.push(`${user.userId}: ${result.error}`);
    } else {
      stats.usersSynced++;
      stats.totalEvents += result.eventsCreated;
    }
  }

  logger.info('incremental_sync_completed', {
    usersChecked: stats.usersChecked,
    usersSynced: stats.usersSynced,
    totalEvents: stats.totalEvents,
    errorCount: stats.errors.length,
  });

  return stats;
}
