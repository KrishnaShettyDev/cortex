/**
 * Integration Handlers
 *
 * Unified OAuth flow for all providers:
 * - Google Super (Gmail, Calendar, Drive, Docs, Sheets)
 * - Slack
 * - Notion
 *
 * On successful connect:
 * 1. Save to integrations table
 * 2. Setup Composio triggers
 * 3. Auto-enable proactive settings
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { createComposioServices } from '../lib/composio';
import {
  PROVIDER_CONFIG,
  Provider,
  setupTriggersForProvider,
  enableProactiveForUser,
  removeTriggersForAccount,
} from '../lib/triggers';

const BASE_URL = 'https://askcortex.plutas.in';

// ============================================================================
// STATUS
// ============================================================================

export async function getIntegrationStatus(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const userId = c.get('jwtPayload').sub;

  const result = await c.env.DB.prepare(`
    SELECT provider, connected, email, last_sync
    FROM integrations WHERE user_id = ?
  `).bind(userId).all();

  const integrations = (result.results || []) as any[];

  const status: Record<string, any> = {};
  for (const provider of Object.keys(PROVIDER_CONFIG) as Provider[]) {
    const integration = integrations.find(i => i.provider === provider);
    status[provider] = {
      connected: !!integration?.connected,
      email: integration?.email || null,
      lastSync: integration?.last_sync || null,
    };
  }

  // Legacy format for mobile app compatibility
  const googleIntegration = integrations.find(i => i.provider === 'googlesuper');
  status.google = {
    connected: !!googleIntegration?.connected,
    email: googleIntegration?.email || null,
    last_sync: googleIntegration?.last_sync || null,
    status: googleIntegration?.connected ? 'active' : 'not_connected',
  };

  return c.json(status);
}

// ============================================================================
// CONNECT (Generic)
// ============================================================================

async function connectProvider(
  c: Context<{ Bindings: Bindings }>,
  provider: Provider
): Promise<Response> {
  const userId = c.get('jwtPayload').sub;
  const config = PROVIDER_CONFIG[provider];
  const callbackUrl = `${BASE_URL}/integrations/${provider}/callback`;

  console.log(`[${config.name}] Creating auth link for user ${userId}`);

  const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
  const authLink = await composio.client.createAuthLink({
    toolkitSlug: config.toolkit,
    userId,
    callbackUrl,
  });

  return c.json({
    redirectUrl: authLink.redirectUrl,
    linkToken: authLink.linkToken,
    expiresAt: authLink.expiresAt,
  });
}

// ============================================================================
// CALLBACK (Generic)
// ============================================================================

async function handleCallback(
  c: Context<{ Bindings: Bindings }>,
  provider: Provider
): Promise<Response> {
  const config = PROVIDER_CONFIG[provider];

  const connectedAccountId = c.req.query('connectedAccountId') || c.req.query('connected_account_id');
  const status = c.req.query('status');
  const userId = c.req.query('entityId') || c.req.query('userId');

  console.log(`[${config.name} Callback]`, { status, connectedAccountId, userId });

  if (status !== 'success' || !connectedAccountId || !userId) {
    return c.html(errorPage(`${config.name} connection failed. Please try again.`));
  }

  const now = new Date().toISOString();

  // 1. Save integration
  await c.env.DB.prepare(`
    INSERT INTO integrations (user_id, provider, connected, access_token, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      connected = 1,
      access_token = excluded.access_token,
      updated_at = excluded.updated_at
  `).bind(userId, provider, connectedAccountId, now, now).run();

  // 2. Setup triggers (background)
  c.executionCtx.waitUntil(
    setupTriggersInBackground(c.env, provider, connectedAccountId, userId)
  );

  // 3. Auto-enable proactive
  c.executionCtx.waitUntil(
    enableProactiveForUser(c.env.DB, userId, provider)
  );

  return c.redirect(`cortex://oauth/success?provider=${provider}`);
}

async function setupTriggersInBackground(
  env: Bindings,
  provider: Provider,
  connectedAccountId: string,
  userId: string
): Promise<void> {
  try {
    const composio = createComposioServices(env.COMPOSIO_API_KEY);
    const result = await setupTriggersForProvider(
      composio.client,
      provider,
      connectedAccountId,
      userId
    );
    console.log(`[Triggers] ${provider}: ${result.triggers.length} setup, ${result.errors.length} errors`);
  } catch (error) {
    console.error(`[Triggers] ${provider} setup failed:`, error);
  }
}

// ============================================================================
// DISCONNECT
// ============================================================================

async function disconnectProvider(
  c: Context<{ Bindings: Bindings }>,
  provider: Provider
): Promise<Response> {
  const userId = c.get('jwtPayload').sub;

  const integration = await c.env.DB.prepare(`
    SELECT access_token FROM integrations WHERE user_id = ? AND provider = ?
  `).bind(userId, provider).first<{ access_token: string }>();

  if (integration?.access_token) {
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    await removeTriggersForAccount(composio.client, integration.access_token);
  }

  await c.env.DB.prepare(`
    UPDATE integrations SET connected = 0, access_token = NULL, updated_at = ?
    WHERE user_id = ? AND provider = ?
  `).bind(new Date().toISOString(), userId, provider).run();

  return c.json({ success: true });
}

// ============================================================================
// PROVIDER-SPECIFIC EXPORTS
// ============================================================================

// Google Super
export function connectGoogle(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return connectProvider(c, 'googlesuper');
}

export function googleCallback(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return handleCallback(c, 'googlesuper');
}

export function disconnectGoogle(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return disconnectProvider(c, 'googlesuper');
}

// Slack
export function connectSlack(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return connectProvider(c, 'slack');
}

export function slackCallback(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return handleCallback(c, 'slack');
}

export function disconnectSlack(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return disconnectProvider(c, 'slack');
}

// Notion
export function connectNotion(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return connectProvider(c, 'notion');
}

export function notionCallback(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return handleCallback(c, 'notion');
}

export function disconnectNotion(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  return disconnectProvider(c, 'notion');
}

// Legacy aliases for mobile app compatibility
export const connectGmail = connectGoogle;
export const gmailCallback = googleCallback;
export const connectCalendar = connectGoogle;
export const calendarCallback = googleCallback;

// ============================================================================
// SYNC (Manual trigger)
// ============================================================================

export async function triggerSync(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const userId = c.get('jwtPayload').sub;
  const provider = c.req.param('provider') as Provider;

  if (!PROVIDER_CONFIG[provider]) {
    return c.json({ error: 'Invalid provider' }, 400);
  }

  const integration = await c.env.DB.prepare(`
    SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1
  `).bind(userId, provider).first<{ access_token: string }>();

  if (!integration) {
    return c.json({ error: 'Integration not connected' }, 400);
  }

  // For now, just update last_sync timestamp
  // Full sync implementation can be added per provider
  await c.env.DB.prepare(`
    UPDATE integrations SET last_sync = ? WHERE user_id = ? AND provider = ?
  `).bind(new Date().toISOString(), userId, provider).run();

  return c.json({ success: true, synced: new Date().toISOString() });
}

// ============================================================================
// HELPERS
// ============================================================================

function errorPage(message: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head><title>Connection Error</title></head>
      <body style="font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff;">
        <h1 style="color: #ef4444;">Connection Error</h1>
        <p>${message}</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body>
    </html>
  `;
}

// ============================================================================
// CALENDAR EVENTS
// ============================================================================

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  meet_link?: string;
  meeting_type?: 'google_meet' | 'zoom' | 'teams' | 'webex' | 'offline';
  color?: string;
  attendees?: string[];
  is_all_day?: boolean;
}

/**
 * Get calendar events for a date range
 */
export async function getCalendarEvents(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  console.log('[Calendar] getCalendarEvents handler called');
  const userId = c.get('jwtPayload').sub;
  console.log('[Calendar] userId:', userId);

  const startParam = c.req.query('start');
  const endParam = c.req.query('end');

  if (!startParam || !endParam) {
    return c.json({ error: 'Missing start or end parameter' }, 400);
  }

  // Get connected Google account
  const integration = await c.env.DB.prepare(`
    SELECT access_token FROM integrations
    WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
  `).bind(userId).first<{ access_token: string }>();

  if (!integration?.access_token) {
    return c.json({ error: 'Google not connected', events: [] }, 400);
  }

  try {
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);

    // Fetch events from Google Calendar via Composio
    const result = await composio.calendar.listEvents({
      connectedAccountId: integration.access_token,
      timeMin: startParam,
      timeMax: endParam,
      maxResults: 250,
    });

    if (!result.successful || !result.data?.items) {
      console.error('[Calendar] Failed to fetch events:', result.error);
      return c.json({ events: [] });
    }

    // Transform to our format
    const events: CalendarEvent[] = result.data.items.map((event: any) => {
      const meetLink = detectMeetLink(event);
      return {
        id: event.id,
        title: event.summary || '(No Title)',
        description: event.description || undefined,
        start_time: event.start?.dateTime || event.start?.date,
        end_time: event.end?.dateTime || event.end?.date,
        location: event.location || undefined,
        meet_link: meetLink?.url,
        meeting_type: meetLink?.type || 'offline',
        attendees: event.attendees?.map((a: any) => a.email) || [],
        is_all_day: !!event.start?.date && !event.start?.dateTime,
      };
    });

    return c.json({ events });
  } catch (error: any) {
    console.error('[Calendar] Error fetching events:', error);
    return c.json({ error: error.message, events: [] }, 500);
  }
}

/**
 * Create a new calendar event
 */
export async function createCalendarEvent(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json();

  const { title, start_time, end_time, description, location, attendees, send_notifications } = body;

  if (!title || !start_time || !end_time) {
    return c.json({ error: 'Missing required fields: title, start_time, end_time' }, 400);
  }

  // Get connected Google account
  const integration = await c.env.DB.prepare(`
    SELECT access_token FROM integrations
    WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
  `).bind(userId).first<{ access_token: string }>();

  if (!integration?.access_token) {
    return c.json({ error: 'Google not connected', success: false }, 400);
  }

  try {
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);

    const result = await composio.calendar.createEvent({
      connectedAccountId: integration.access_token,
      summary: title,
      description: description || '',
      start: { dateTime: start_time },
      end: { dateTime: end_time },
      location: location || '',
      attendees: attendees?.map((email: string) => ({ email })) || [],
      sendNotifications: send_notifications ?? true,
    });

    if (!result.successful) {
      console.error('[Calendar] Failed to create event:', result.error);
      return c.json({ error: result.error, success: false }, 500);
    }

    const event = result.data;
    const meetLink = detectMeetLink(event);

    return c.json({
      success: true,
      event: {
        id: event.id,
        title: event.summary,
        start_time: event.start?.dateTime || event.start?.date,
        end_time: event.end?.dateTime || event.end?.date,
        location: event.location,
        meet_link: meetLink?.url,
        meeting_type: meetLink?.type || 'offline',
      },
    });
  } catch (error: any) {
    console.error('[Calendar] Error creating event:', error);
    return c.json({ error: error.message, success: false }, 500);
  }
}

/**
 * Detect meeting link and type from calendar event
 */
function detectMeetLink(event: any): { url: string; type: 'google_meet' | 'zoom' | 'teams' | 'webex' } | null {
  // Check Google Meet
  if (event.hangoutLink) {
    return { url: event.hangoutLink, type: 'google_meet' };
  }
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find((e: any) => e.entryPointType === 'video');
    if (videoEntry?.uri) {
      return { url: videoEntry.uri, type: 'google_meet' };
    }
  }

  // Check description and location for other meeting links
  const textToSearch = `${event.description || ''} ${event.location || ''}`.toLowerCase();

  if (textToSearch.includes('zoom.us')) {
    const zoomMatch = textToSearch.match(/https?:\/\/[^\s]*zoom\.us\/[^\s]*/i);
    if (zoomMatch) return { url: zoomMatch[0], type: 'zoom' };
  }

  if (textToSearch.includes('teams.microsoft.com')) {
    const teamsMatch = textToSearch.match(/https?:\/\/[^\s]*teams\.microsoft\.com\/[^\s]*/i);
    if (teamsMatch) return { url: teamsMatch[0], type: 'teams' };
  }

  if (textToSearch.includes('webex.com')) {
    const webexMatch = textToSearch.match(/https?:\/\/[^\s]*webex\.com\/[^\s]*/i);
    if (webexMatch) return { url: webexMatch[0], type: 'webex' };
  }

  return null;
}
