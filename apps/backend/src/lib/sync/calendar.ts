/**
 * Google Calendar Sync Worker
 *
 * Auto-ingests calendar events into memory layer
 * - Fetches upcoming and recent events
 * - Creates memories with event details
 * - Enables proactive scheduling suggestions
 */

import type { Bindings } from '../../types';
import { createComposioServices } from '../composio';
import { createMemory } from '../db/memories';

export interface CalendarSyncOptions {
  userId: string;
  connectedAccountId: string;
  containerTag?: string;
  daysBack?: number; // How far back to sync (default: 7)
  daysForward?: number; // How far ahead to sync (default: 30)
  maxEvents?: number;
  syncType?: 'full' | 'delta'; // Full sync or delta sync
  syncToken?: string; // For delta sync - Calendar sync token
}

export interface CalendarSyncResult {
  success: boolean;
  eventsProcessed: number;
  memoriesCreated: number;
  errors: string[];
  nextSyncToken?: string; // For next delta sync
  syncType: 'full' | 'delta';
  durationMs: number;
}

/**
 * Sync calendar events into memories
 * Supports both full sync and delta sync (using Calendar sync tokens)
 */
export async function syncCalendar(
  env: Bindings,
  options: CalendarSyncOptions
): Promise<CalendarSyncResult> {
  const startTime = Date.now();
  const containerTag = options.containerTag || 'default';
  let syncType = options.syncType || (options.syncToken ? 'delta' : 'full');

  const result: CalendarSyncResult = {
    success: false,
    eventsProcessed: 0,
    memoriesCreated: 0,
    errors: [],
    syncType,
    durationMs: 0,
  };

  try {
    const composio = createComposioServices(env.COMPOSIO_API_KEY);

    console.log(`[Calendar Sync] Starting ${syncType} sync for user ${options.userId}`);

    let events: any[] = [];
    let nextSyncToken: string | undefined;

    if (syncType === 'delta' && options.syncToken) {
      // Delta sync using sync token
      console.log(`[Calendar Sync] Using delta sync with syncToken`);

      try {
        const deltaResult = await composio.calendar.listEventsDelta({
          connectedAccountId: options.connectedAccountId,
          syncToken: options.syncToken,
          maxResults: options.maxEvents || 250,
        });

        if (deltaResult.successful && deltaResult.data) {
          events = deltaResult.data.items || [];
          nextSyncToken = deltaResult.data.nextSyncToken;
          console.log(`[Calendar Sync] Delta found ${events.length} changed events`);
        }
      } catch (error: any) {
        console.warn(`[Calendar Sync] Delta sync failed, falling back to full sync:`, error);
        // Fall back to full sync if delta fails
        syncType = 'full';
      }
    }

    if (syncType === 'full' || events.length === 0) {
      // Full sync with time range
      console.log(`[Calendar Sync] Performing full sync`);

      const now = new Date();
      const daysBack = options.daysBack || 7;
      const daysForward = options.daysForward || 30;

      const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString();

      console.log(`[Calendar Sync] Time range: ${timeMin} to ${timeMax}`);

      const eventsResult = await composio.calendar.listEvents({
        connectedAccountId: options.connectedAccountId,
        timeMin,
        timeMax,
        maxResults: options.maxEvents || 100,
      });

      if (!eventsResult.successful || !eventsResult.data?.items) {
        throw new Error(`Failed to fetch events: ${eventsResult.error}`);
      }

      events = eventsResult.data.items || [];
      nextSyncToken = eventsResult.data.nextSyncToken;
    }

    console.log(`[Calendar Sync] Found ${events.length} events to process`);

    // Process each event
    for (const event of events) {
      try {
        result.eventsProcessed++;

        const eventId = event.id;

        // Skip cancelled events
        if (event.status === 'cancelled') {
          console.log(`[Calendar Sync] Skipping cancelled event: ${eventId}`);
          continue;
        }

        // Check if already synced (deduplication)
        const existingItem = await env.DB.prepare(`
          SELECT id, content_hash FROM sync_items
          WHERE provider_item_id = ?
        `).bind(eventId).first();

        // Extract event details
        const title = event.summary || '(No Title)';
        const description = event.description || '';
        const location = event.location || '';
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;
        const attendees = event.attendees?.map((a: any) => a.email).join(', ') || '';
        const organizer = event.organizer?.email || '';

        // Calculate content hash
        const contentForHash = `${title}|${startTime}|${endTime}|${location}|${attendees}`;
        const contentHash = await hashContent(contentForHash);

        // Skip if already synced with same content
        if (existingItem && existingItem.content_hash === contentHash) {
          console.log(`[Calendar Sync] Skipping already synced event: ${eventId}`);
          continue;
        }

        // Create memory from event
        const memoryContent = formatEventAsMemory({
          title,
          description,
          location,
          startTime,
          endTime,
          attendees,
          organizer,
        });

        const memory = await createMemory(
          env.DB,
          options.userId,
          memoryContent,
          'calendar', // source
          containerTag // container
        );

        result.memoriesCreated++;
        console.log(`[Calendar Sync] Created memory ${memory.id} from event: ${title}`);

        // Track sync item for deduplication
        await trackSyncItem(env.DB, {
          providerItemId: eventId,
          itemType: 'calendar_event',
          memoryId: memory.id,
          subject: title,
          eventDate: startTime,
          contentHash,
        });
      } catch (error: any) {
        console.error(`[Calendar Sync] Error processing event:`, error);
        result.errors.push(`Event ${event.id}: ${error.message}`);
      }
    }

    result.success = true;
    result.nextSyncToken = nextSyncToken;
    result.durationMs = Date.now() - startTime;

    console.log(
      `[Calendar Sync] Completed (${result.durationMs}ms): ${result.eventsProcessed} events → ${result.memoriesCreated} memories`
    );

    return result;
  } catch (error: any) {
    console.error(`[Calendar Sync] Fatal error:`, error);
    result.errors.push(`Fatal: ${error.message}`);
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

/**
 * Format calendar event into a memory-friendly string
 */
function formatEventAsMemory(event: {
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  attendees: string;
  organizer: string;
}): string {
  const parts = [
    `Calendar event: ${event.title}`,
    event.startTime ? `Start: ${event.startTime}` : null,
    event.endTime ? `End: ${event.endTime}` : null,
    event.location ? `Location: ${event.location}` : null,
    event.organizer ? `Organizer: ${event.organizer}` : null,
    event.attendees ? `Attendees: ${event.attendees}` : null,
    event.description ? `Description: ${event.description}` : null,
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Check if user has Google Calendar connected
 */
export async function hasCalendarConnected(
  env: Bindings,
  userId: string
): Promise<{ connected: boolean; accountId?: string }> {
  const composio = createComposioServices(env.COMPOSIO_API_KEY);

  const accounts = await composio.client.listConnectedAccounts({
    userId,
    toolkitSlugs: ['googlecalendar'],
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
