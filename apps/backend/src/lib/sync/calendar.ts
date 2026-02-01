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
  daysBack?: number; // How far back to sync (default: 7)
  daysForward?: number; // How far ahead to sync (default: 30)
  maxEvents?: number;
}

export interface CalendarSyncResult {
  eventsProcessed: number;
  memoriesCreated: number;
  errors: string[];
}

/**
 * Sync calendar events into memories
 */
export async function syncCalendar(
  env: Bindings,
  options: CalendarSyncOptions
): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    eventsProcessed: 0,
    memoriesCreated: 0,
    errors: [],
  };

  try {
    const composio = createComposioServices(env.COMPOSIO_API_KEY);

    // Calculate time range
    const now = new Date();
    const daysBack = options.daysBack || 7;
    const daysForward = options.daysForward || 30;

    const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + daysForward * 24 * 60 * 60 * 1000).toISOString();

    console.log(
      `[Calendar Sync] Fetching events for user ${options.userId} (${timeMin} to ${timeMax})`
    );

    // Fetch events from Google Calendar
    const eventsResult = await composio.calendar.listEvents({
      connectedAccountId: options.connectedAccountId,
      timeMin,
      timeMax,
      maxResults: options.maxEvents || 100,
    });

    if (!eventsResult.successful || !eventsResult.data?.items) {
      throw new Error(`Failed to fetch events: ${eventsResult.error}`);
    }

    const events = eventsResult.data.items;
    console.log(`[Calendar Sync] Found ${events.length} events to process`);

    // Process each event
    for (const event of events) {
      try {
        result.eventsProcessed++;

        // Skip cancelled events
        if (event.status === 'cancelled') {
          continue;
        }

        // Extract event details
        const title = event.summary || '(No Title)';
        const description = event.description || '';
        const location = event.location || '';
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;
        const attendees = event.attendees?.map((a: any) => a.email).join(', ') || '';
        const organizer = event.organizer?.email || '';

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
          'default' // container
        );

        result.memoriesCreated++;
        console.log(`[Calendar Sync] Created memory ${memory.id} from event: ${title}`);
      } catch (error: any) {
        console.error(`[Calendar Sync] Error processing event:`, error);
        result.errors.push(`Event ${event.id}: ${error.message}`);
      }
    }

    console.log(
      `[Calendar Sync] Completed: ${result.eventsProcessed} events → ${result.memoriesCreated} memories`
    );

    return result;
  } catch (error: any) {
    console.error(`[Calendar Sync] Fatal error:`, error);
    result.errors.push(`Fatal: ${error.message}`);
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
