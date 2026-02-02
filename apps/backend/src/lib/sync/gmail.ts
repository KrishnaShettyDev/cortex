/**
 * Gmail Sync Worker
 *
 * Auto-ingests emails from connected Gmail accounts into memory layer
 * - Fetches recent emails
 * - Extracts key information (sender, subject, body, date)
 * - Creates memories with proper attribution
 * - Discovers LinkedIn/Twitter profiles from email signatures
 */

import type { Bindings } from '../../types';
import { createComposioServices } from '../composio';
import { createMemory } from '../db/memories';

export interface GmailSyncOptions {
  userId: string;
  connectedAccountId: string;
  containerTag?: string;
  maxEmails?: number;
  onlyUnread?: boolean;
  sinceDays?: number; // How far back to sync (default: 7 days)
  syncType?: 'full' | 'delta'; // Full sync or delta sync
  historyId?: string; // For delta sync - Gmail history ID
}

export interface GmailSyncResult {
  success: boolean;
  emailsProcessed: number;
  memoriesCreated: number;
  profilesDiscovered: number;
  errors: string[];
  nextHistoryId?: string; // For next delta sync
  syncType: 'full' | 'delta';
  durationMs: number;
}

/**
 * Sync emails from Gmail into memories
 * Supports both full sync and delta sync (using Gmail History API)
 */
export async function syncGmail(
  env: Bindings,
  options: GmailSyncOptions
): Promise<GmailSyncResult> {
  const startTime = Date.now();
  const containerTag = options.containerTag || 'default';
  let syncType = options.syncType || (options.historyId ? 'delta' : 'full');

  const result: GmailSyncResult = {
    success: false,
    emailsProcessed: 0,
    memoriesCreated: 0,
    profilesDiscovered: 0,
    errors: [],
    syncType,
    durationMs: 0,
  };

  try {
    const composio = createComposioServices(env.COMPOSIO_API_KEY);

    console.log(`[Gmail Sync] Starting ${syncType} sync for user ${options.userId}`);

    let emails: any[] = [];
    let nextHistoryId: string | undefined;

    if (syncType === 'delta' && options.historyId) {
      // Delta sync using Gmail History API
      console.log(`[Gmail Sync] Using delta sync with historyId: ${options.historyId}`);

      try {
        const historyResult = await composio.gmail.fetchHistory({
          connectedAccountId: options.connectedAccountId,
          startHistoryId: options.historyId,
          maxResults: options.maxEmails || 100,
        });

        if (historyResult.successful && historyResult.data) {
          const history = historyResult.data.history || [];
          nextHistoryId = historyResult.data.historyId;

          // Extract message IDs from history
          const messageIds = new Set<string>();
          for (const historyItem of history) {
            // messagesAdded contains new messages
            if (historyItem.messagesAdded) {
              for (const msgAdded of historyItem.messagesAdded) {
                if (msgAdded.message?.id) {
                  messageIds.add(msgAdded.message.id);
                }
              }
            }
          }

          // Fetch full message details for each ID
          console.log(`[Gmail Sync] Delta found ${messageIds.size} new/changed messages`);
          for (const messageId of Array.from(messageIds)) {
            const msgResult = await composio.gmail.fetchEmailById({
              connectedAccountId: options.connectedAccountId,
              messageId,
            });

            if (msgResult.successful && msgResult.data) {
              emails.push(msgResult.data);
            }
          }
        }
      } catch (error: any) {
        console.warn(`[Gmail Sync] Delta sync failed, falling back to full sync:`, error);
        // Fall back to full sync if delta fails
        syncType = 'full';
      }
    }

    if (syncType === 'full' || emails.length === 0) {
      // Full sync using list messages
      console.log(`[Gmail Sync] Performing full sync`);

      // Build Gmail search query
      const queries: string[] = [];
      if (options.onlyUnread) queries.push('is:unread');
      if (options.sinceDays) {
        queries.push(`newer_than:${options.sinceDays}d`);
      }
      const query = queries.join(' ');

      const emailsResult = await composio.gmail.fetchEmails({
        connectedAccountId: options.connectedAccountId,
        maxResults: options.maxEmails || 50,
        query: query || undefined,
      });

      if (!emailsResult.successful || !emailsResult.data?.messages) {
        throw new Error(`Failed to fetch emails: ${emailsResult.error}`);
      }

      emails = emailsResult.data.messages || [];
      nextHistoryId = emailsResult.data.historyId;
    }

    console.log(`[Gmail Sync] Found ${emails.length} emails to process`);

    // Process each email
    for (const email of emails) {
      try {
        result.emailsProcessed++;

        const emailId = email.id;

        // Check if already synced (deduplication)
        const existingItem = await env.DB.prepare(`
          SELECT id, content_hash FROM sync_items
          WHERE provider_item_id = ?
        `).bind(emailId).first();

        // Calculate content hash
        const snippet = email.snippet || '';
        const contentHash = await hashContent(snippet);

        // Skip if already synced with same content
        if (existingItem && existingItem.content_hash === contentHash) {
          console.log(`[Gmail Sync] Skipping already synced email: ${emailId}`);
          continue;
        }

        // Extract email metadata
        const headers = email.payload?.headers || [];
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
        const date = headers.find((h: any) => h.name === 'Date')?.value;

        // Extract email body (simplified - may need to handle multipart)
        let body = '';
        if (email.payload?.body?.data) {
          body = Buffer.from(email.payload.body.data, 'base64').toString('utf-8');
        } else if (email.payload?.parts) {
          // Multipart email - find text/plain or text/html
          const textPart = email.payload.parts.find(
            (p: any) => p.mimeType === 'text/plain' || p.mimeType === 'text/html'
          );
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          }
        }

        // Truncate body if too long
        const snippetText = email.snippet || body.substring(0, 500);

        // Create memory from email
        const memoryContent = formatEmailAsMemory({
          from,
          subject,
          snippet: snippetText,
          date,
        });

        const memory = await createMemory(
          env.DB,
          options.userId,
          memoryContent,
          'email', // source
          containerTag // container
        );

        result.memoriesCreated++;
        console.log(`[Gmail Sync] Created memory ${memory.id} from email: ${subject}`);

        // Track sync item for deduplication
        await trackSyncItem(env.DB, {
          providerItemId: emailId,
          itemType: 'email',
          memoryId: memory.id,
          subject,
          senderEmail: extractEmailAddress(from),
          contentHash,
        });

        // TODO: Extract sender name and company, search for LinkedIn profile
        const senderName = extractSenderName(from);
        if (senderName) {
          console.log(`[Gmail Sync] TODO: Search LinkedIn for ${senderName}`);
          // result.profilesDiscovered++;
        }
      } catch (error: any) {
        console.error(`[Gmail Sync] Error processing email:`, error);
        result.errors.push(`Email ${email.id}: ${error.message}`);
      }
    }

    result.success = true;
    result.nextHistoryId = nextHistoryId;
    result.durationMs = Date.now() - startTime;

    console.log(
      `[Gmail Sync] Completed (${result.durationMs}ms): ${result.emailsProcessed} emails → ${result.memoriesCreated} memories`
    );

    return result;
  } catch (error: any) {
    console.error(`[Gmail Sync] Fatal error:`, error);
    result.errors.push(`Fatal: ${error.message}`);
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Format email data into a memory-friendly string
 */
function formatEmailAsMemory(email: {
  from: string;
  subject: string;
  snippet: string;
  date?: string;
}): string {
  const parts = [
    `Email from ${email.from}`,
    `Subject: ${email.subject}`,
    email.date ? `Date: ${email.date}` : null,
    `Content: ${email.snippet}`,
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Extract sender name from email address
 * "John Doe <john@example.com>" → "John Doe"
 */
function extractSenderName(from: string): string | null {
  const match = from.match(/^(.+?)\s*<.*>$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract email address from string
 * "John Doe <john@example.com>" → "john@example.com"
 */
function extractEmailAddress(from: string): string {
  const match = from.match(/<(.+?)>/);
  if (match) {
    return match[1].trim();
  }
  // If no brackets, assume whole string is email
  return from.trim();
}

/**
 * Hash content for change detection
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Track synced item for deduplication
 */
async function trackSyncItem(
  db: D1Database,
  params: {
    providerItemId: string;
    itemType: 'email' | 'calendar_event';
    memoryId: string;
    subject: string;
    senderEmail?: string;
    eventDate?: string;
    contentHash: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  // Note: connection_id will be set by the orchestrator
  // For now we'll use a placeholder that gets updated later
  await db.prepare(`
    INSERT INTO sync_items (
      id, connection_id, provider_item_id, item_type, memory_id,
      subject, sender_email, event_date, content_hash,
      first_synced_at, last_synced_at, sync_count
    )
    VALUES (?, 'PLACEHOLDER', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(connection_id, provider_item_id) DO UPDATE SET
      memory_id = excluded.memory_id,
      content_hash = excluded.content_hash,
      last_synced_at = excluded.last_synced_at,
      sync_count = sync_count + 1
  `).bind(
    crypto.randomUUID(),
    params.providerItemId,
    params.itemType,
    params.memoryId,
    params.subject,
    params.senderEmail || null,
    params.eventDate || null,
    params.contentHash,
    now,
    now
  ).run();
}

/**
 * Check if user has Gmail connected
 */
export async function hasGmailConnected(
  env: Bindings,
  userId: string
): Promise<{ connected: boolean; accountId?: string }> {
  const composio = createComposioServices(env.COMPOSIO_API_KEY);

  const accounts = await composio.client.listConnectedAccounts({
    userId,
    toolkitSlugs: ['gmail'],
    statuses: ['ACTIVE'],
  });

  if (accounts.items.length > 0) {
    return {
      connected: true,
      accountId: accounts.items[0].id,
    };
  }

  return { connected: false };
}
