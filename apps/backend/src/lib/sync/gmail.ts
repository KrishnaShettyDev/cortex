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
  maxEmails?: number;
  onlyUnread?: boolean;
  sinceDays?: number; // How far back to sync (default: 7 days)
}

export interface GmailSyncResult {
  emailsProcessed: number;
  memoriesCreated: number;
  profilesDiscovered: number;
  errors: string[];
}

/**
 * Sync emails from Gmail into memories
 */
export async function syncGmail(
  env: Bindings,
  options: GmailSyncOptions
): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    emailsProcessed: 0,
    memoriesCreated: 0,
    profilesDiscovered: 0,
    errors: [],
  };

  try {
    const composio = createComposioServices(env.COMPOSIO_API_KEY);

    // Build Gmail search query
    const queries: string[] = [];
    if (options.onlyUnread) queries.push('is:unread');
    if (options.sinceDays) {
      queries.push(`newer_than:${options.sinceDays}d`);
    }
    const query = queries.join(' ');

    // Fetch emails from Gmail
    console.log(`[Gmail Sync] Fetching emails for user ${options.userId}`);
    const emailsResult = await composio.gmail.fetchEmails({
      connectedAccountId: options.connectedAccountId,
      maxResults: options.maxEmails || 50,
      query: query || undefined,
    });

    if (!emailsResult.successful || !emailsResult.data?.messages) {
      throw new Error(`Failed to fetch emails: ${emailsResult.error}`);
    }

    const emails = emailsResult.data.messages;
    console.log(`[Gmail Sync] Found ${emails.length} emails to process`);

    // Process each email
    for (const email of emails) {
      try {
        result.emailsProcessed++;

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
        const snippet = email.snippet || body.substring(0, 500);

        // Create memory from email
        const memoryContent = formatEmailAsMemory({
          from,
          subject,
          snippet,
          date,
        });

        const memory = await createMemory(
          env.DB,
          options.userId,
          memoryContent,
          'email', // source
          'default' // container
        );

        result.memoriesCreated++;
        console.log(`[Gmail Sync] Created memory ${memory.id} from email: ${subject}`);

        // TODO: Extract sender name and company, search for LinkedIn profile
        // This would use COMPOSIO_SEARCH or web search to find social profiles
        // For now, we'll just log it
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

    console.log(
      `[Gmail Sync] Completed: ${result.emailsProcessed} emails → ${result.memoriesCreated} memories`
    );

    return result;
  } catch (error: any) {
    console.error(`[Gmail Sync] Fatal error:`, error);
    result.errors.push(`Fatal: ${error.message}`);
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
