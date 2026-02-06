/**
 * Integration route handlers
 *
 * Handles:
 * - OAuth connection flow (Gmail, Calendar)
 * - Integration status
 * - Manual sync triggers
 * - Disconnection
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import { createComposioServices } from '../lib/composio';
import { syncGmail } from '../lib/sync/gmail';
import { syncCalendar } from '../lib/sync/calendar';

/**
 * GET /integrations/status
 * Get all connected integrations for user
 *
 * Uses our database as the source of truth for connection status.
 * Returns format expected by mobile app.
 */
export async function getIntegrationStatus(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    // Query our database for integration status - this is our source of truth
    const integrations = await c.env.DB.prepare(
      'SELECT provider, connected, email, last_sync, access_token FROM integrations WHERE user_id = ?'
    )
      .bind(userId)
      .all();

    // Find Gmail and Calendar integrations from our database
    const gmailIntegration = integrations.results?.find((i: any) => i.provider === 'gmail');
    const calendarIntegration = integrations.results?.find((i: any) => i.provider === 'googlecalendar');

    const gmailConnected = !!gmailIntegration?.connected;
    const calendarConnected = !!calendarIntegration?.connected;
    const googleConnected = gmailConnected || calendarConnected;

    // Return format expected by mobile app
    return c.json({
      google: {
        connected: googleConnected,
        email: gmailIntegration?.email || calendarIntegration?.email || null,
        last_sync: gmailIntegration?.last_sync || calendarIntegration?.last_sync || null,
        status: googleConnected ? 'active' : 'not_connected',
        gmail_connected: gmailConnected,
        calendar_connected: calendarConnected,
      },
      microsoft: {
        connected: false,
        email: null,
        last_sync: null,
        status: 'not_connected',
        gmail_connected: false,
        calendar_connected: false,
      },
    });
  });
}

/**
 * POST /integrations/gmail/connect
 * Start OAuth flow for Gmail
 *
 * Uses Composio's managed OAuth by default (avoids Google verification)
 */
export async function connectGmail(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    // Build callback URL for this backend
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/integrations/gmail/callback`;

    console.log(`[Gmail Connect] Creating auth link for user ${userId}, callback: ${callbackUrl}`);

    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const authLink = await composio.client.createAuthLink({
      toolkitSlug: 'gmail',
      userId,
      callbackUrl,
    });

    console.log(`[Gmail Connect] Auth link created:`, authLink);

    return c.json({
      redirectUrl: authLink.redirectUrl,
      linkToken: authLink.linkToken,
      expiresAt: authLink.expiresAt,
    });
  });
}

/**
 * POST /integrations/calendar/connect
 * Start OAuth flow for Google Calendar
 *
 * Uses Composio's managed OAuth by default (avoids Google verification)
 */
export async function connectCalendar(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    // Build callback URL for this backend
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/integrations/calendar/callback`;

    console.log(`[Calendar Connect] Creating auth link for user ${userId}, callback: ${callbackUrl}`);

    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const authLink = await composio.client.createAuthLink({
      toolkitSlug: 'googlecalendar',
      userId,
      callbackUrl,
    });

    console.log(`[Calendar Connect] Auth link created:`, authLink);

    return c.json({
      redirectUrl: authLink.redirectUrl,
      linkToken: authLink.linkToken,
      expiresAt: authLink.expiresAt,
    });
  });
}

/**
 * GET /integrations/gmail/callback
 * OAuth callback for Gmail (user gets redirected here after auth)
 * NOTE: This is a PUBLIC endpoint - no JWT auth required
 */
export async function gmailCallback(c: Context<{ Bindings: Bindings }>) {
  try {
    // Composio sends connectedAccountId (camelCase) in the callback
    const connectedAccountId = c.req.query('connectedAccountId') || c.req.query('connected_account_id');
    const status = c.req.query('status');

    // Get userId from the connection - Composio encodes it in the state
    const userId = c.req.query('entityId') || c.req.query('userId');

    console.log('[Gmail Callback] Received callback:', { status, connectedAccountId, userId });

    if (status !== 'success' || !connectedAccountId) {
      return c.html(`
        <html>
          <body>
            <h1>Gmail Connection Failed</h1>
            <p>There was an error connecting your Gmail account. Please try again.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
    }

    // We trust the callback from Composio - no need to verify the account
    // The connectedAccountId is valid if status is 'success'
    if (!userId) {
      console.error('[Gmail Callback] No userId in callback URL');
      return c.html(`
        <html>
          <body style="font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff;">
            <h1 style="color: #ef4444;">Connection Error</h1>
            <p>Missing user information. Please try again.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
    }

    console.log(`[Gmail Callback] Account connected for user ${userId}, connectedAccountId: ${connectedAccountId}`);

    // Save to our database
    await c.env.DB.prepare(
      `INSERT INTO integrations (user_id, provider, connected, access_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         connected = 1,
         access_token = excluded.access_token,
         updated_at = excluded.updated_at`
    )
      .bind(
        userId,
        'gmail',
        1,
        connectedAccountId, // Store Composio account ID as access_token
        new Date().toISOString(),
        new Date().toISOString()
      )
      .run();

    // Trigger initial sync in background
    c.executionCtx.waitUntil(
      syncGmail(c.env, {
        userId,
        connectedAccountId,
        sinceDays: 7,
        maxEmails: 50,
      })
    );

    // Redirect to app deep link to close the WebBrowser
    return c.redirect('cortex://oauth/success?provider=gmail');
  } catch (error: any) {
    console.error('[Gmail Callback] Error:', error);
    return c.html(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff;">
          <h1 style="color: #ef4444;">Connection Error</h1>
          <p>${error.message || 'An error occurred'}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  }
}

/**
 * GET /integrations/calendar/callback
 * OAuth callback for Google Calendar
 * NOTE: This is a PUBLIC endpoint - no JWT auth required
 */
export async function calendarCallback(c: Context<{ Bindings: Bindings }>) {
  try {
    console.log('[Calendar Callback] Received callback');
    const connectedAccountId = c.req.query('connected_account_id');
    const status = c.req.query('status');

    if (status !== 'success' || !connectedAccountId) {
      return c.html(`
        <html>
          <body>
            <h1>Calendar Connection Failed</h1>
            <p>There was an error connecting your Google Calendar. Please try again.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
    }

    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const account = await composio.client.getConnectedAccount(connectedAccountId);

    console.log(`[Calendar Callback] Account connected for user ${account.userId}`);

    await c.env.DB.prepare(
      `INSERT INTO integrations (user_id, provider, connected, access_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         connected = 1,
         access_token = excluded.access_token,
         updated_at = excluded.updated_at`
    )
      .bind(
        account.userId,
        'googlecalendar',
        1,
        connectedAccountId,
        new Date().toISOString(),
        new Date().toISOString()
      )
      .run();

    // Trigger initial sync
    c.executionCtx.waitUntil(
      syncCalendar(c.env, {
        userId: account.userId,
        connectedAccountId: account.id,
        daysBack: 7,
        daysForward: 30,
      })
    );

    return c.html(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff;">
          <h1 style="color: #22c55e;">✓ Calendar Connected!</h1>
          <p>Your Google Calendar has been successfully connected. We're syncing your events now.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'CALENDAR_CONNECTED', success: true }, '*');
            }
            setTimeout(() => window.close(), 1000);
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('[Calendar Callback] Error:', error);
    return c.html(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff;">
          <h1 style="color: #ef4444;">Connection Error</h1>
          <p>${error.message || 'An error occurred'}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  }
}

/**
 * POST /integrations/gmail/sync
 * Manually trigger Gmail sync
 */
export async function triggerGmailSync(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    // Get connected account
    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1'
    )
      .bind(userId, 'gmail')
      .first();

    if (!integration) {
      return c.json({ error: 'Gmail not connected' }, 400);
    }

    const connectedAccountId = integration.access_token as string;

    // Trigger sync
    const result = await syncGmail(c.env, {
      userId,
      connectedAccountId,
      sinceDays: 7,
      maxEmails: 50,
    });

    // Update last_sync timestamp
    await c.env.DB.prepare(
      'UPDATE integrations SET last_sync = ? WHERE user_id = ? AND provider = ?'
    )
      .bind(new Date().toISOString(), userId, 'gmail')
      .run();

    return c.json(result);
  });
}

/**
 * POST /integrations/calendar/sync
 * Manually trigger Calendar sync
 */
export async function triggerCalendarSync(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1'
    )
      .bind(userId, 'googlecalendar')
      .first();

    if (!integration) {
      return c.json({ error: 'Calendar not connected' }, 400);
    }

    const connectedAccountId = integration.access_token as string;

    const result = await syncCalendar(c.env, {
      userId,
      connectedAccountId,
      daysBack: 7,
      daysForward: 30,
    });

    await c.env.DB.prepare(
      'UPDATE integrations SET last_sync = ? WHERE user_id = ? AND provider = ?'
    )
      .bind(new Date().toISOString(), userId, 'googlecalendar')
      .run();

    return c.json(result);
  });
}

/**
 * GET /integrations/calendar/events
 * Get calendar events from synced data
 *
 * Query params:
 * - start: ISO date string (required)
 * - end: ISO date string (required)
 */
export async function getCalendarEvents(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const start = c.req.query('start');
    const end = c.req.query('end');

    if (!start || !end) {
      return c.json({ error: 'start and end query parameters are required' }, 400);
    }

    // Query sync_items joined with memories to get calendar events
    const eventsResult = await c.env.DB.prepare(`
      SELECT
        si.provider_item_id as id,
        si.subject as title,
        si.event_date as start_time,
        m.content,
        m.metadata,
        m.created_at
      FROM sync_items si
      LEFT JOIN memories m ON si.memory_id = m.id
      WHERE si.item_type = 'calendar_event'
        AND m.user_id = ?
        AND si.event_date >= ?
        AND si.event_date <= ?
      ORDER BY si.event_date ASC
    `).bind(userId, start, end).all();

    // Parse events into the format frontend expects
    const events = (eventsResult.results as any[]).map((row) => {
      // Parse metadata if exists
      let metadata: any = {};
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata);
        } catch {
          // Ignore parse errors
        }
      }

      // Extract event details from content
      const content = row.content || '';

      // Parse end_time from content or estimate 1 hour
      let endTime = row.start_time;
      const durationMatch = content.match(/Duration:\s*(\d+)\s*(?:minutes?|mins?|hours?|hrs?)/i);
      if (durationMatch) {
        const duration = parseInt(durationMatch[1], 10);
        const startDate = new Date(row.start_time);
        if (content.toLowerCase().includes('hour')) {
          startDate.setHours(startDate.getHours() + duration);
        } else {
          startDate.setMinutes(startDate.getMinutes() + duration);
        }
        endTime = startDate.toISOString();
      } else {
        // Default to 1 hour
        const startDate = new Date(row.start_time);
        startDate.setHours(startDate.getHours() + 1);
        endTime = startDate.toISOString();
      }

      // Extract location from content
      const locationMatch = content.match(/Location:\s*(.+?)(?:\n|$)/i);
      const location = locationMatch ? locationMatch[1].trim() : metadata.location || undefined;

      // Extract attendees from content
      const attendeesMatch = content.match(/Attendees?:\s*(.+?)(?:\n|$)/i);
      const attendees = attendeesMatch
        ? attendeesMatch[1].split(',').map((a: string) => a.trim())
        : metadata.attendees || [];

      // Extract description
      const descMatch = content.match(/Description:\s*(.+?)(?:\n\n|$)/is);
      const description = descMatch ? descMatch[1].trim() : undefined;

      // Detect meeting type from content
      let meetingType: string | undefined;
      let meetLink: string | undefined;

      if (content.includes('meet.google.com')) {
        meetingType = 'google_meet';
        const linkMatch = content.match(/(https:\/\/meet\.google\.com\/[^\s]+)/);
        meetLink = linkMatch ? linkMatch[1] : undefined;
      } else if (content.includes('zoom.us')) {
        meetingType = 'zoom';
        const linkMatch = content.match(/(https:\/\/[^\s]*zoom\.us[^\s]+)/);
        meetLink = linkMatch ? linkMatch[1] : undefined;
      } else if (content.includes('teams.microsoft.com')) {
        meetingType = 'teams';
        const linkMatch = content.match(/(https:\/\/teams\.microsoft\.com[^\s]+)/);
        meetLink = linkMatch ? linkMatch[1] : undefined;
      }

      return {
        id: row.id,
        title: row.title || 'Untitled Event',
        description,
        start_time: row.start_time,
        end_time: endTime,
        location,
        attendees,
        meeting_type: meetingType,
        meet_link: meetLink,
        source: 'google_calendar',
        created_at: row.created_at,
      };
    });

    return c.json({
      success: true,
      events,
      message: `Found ${events.length} events`,
    });
  });
}

/**
 * POST /integrations/calendar/events
 * Create a calendar event via Composio
 */
export async function createCalendarEvent(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json();

    const { title, start_time, end_time, location, description, attendees, send_notifications } = body;

    if (!title || !start_time || !end_time) {
      return c.json({ error: 'title, start_time, and end_time are required' }, 400);
    }

    // Get connected account
    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1'
    ).bind(userId, 'googlecalendar').first();

    if (!integration) {
      return c.json({ error: 'Calendar not connected' }, 400);
    }

    const connectedAccountId = integration.access_token as string;
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);

    // Create event via Composio
    const result = await composio.calendar.createEvent({
      connectedAccountId,
      title,
      startTime: start_time,
      endTime: end_time,
      location,
      description,
      attendees: attendees?.map((email: string) => ({ email })),
      sendNotifications: send_notifications ?? true,
    });

    if (!result.successful) {
      return c.json({ error: 'Failed to create event', details: result.error }, 500);
    }

    const event = result.data;

    return c.json({
      id: event.id,
      title: event.summary || title,
      start_time: event.start?.dateTime || start_time,
      end_time: event.end?.dateTime || end_time,
      location: event.location,
      description: event.description,
      attendees: event.attendees?.map((a: any) => a.email) || attendees,
      source: 'google_calendar',
      created_at: new Date().toISOString(),
    });
  });
}

/**
 * PUT /integrations/calendar/events/:id
 * Update a calendar event
 */
export async function updateCalendarEvent(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const eventId = c.req.param('id');
    const body = await c.req.json();

    // Get connected account
    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1'
    ).bind(userId, 'googlecalendar').first();

    if (!integration) {
      return c.json({ error: 'Calendar not connected' }, 400);
    }

    const connectedAccountId = integration.access_token as string;
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);

    // Update event via Composio
    const result = await composio.calendar.updateEvent({
      connectedAccountId,
      eventId,
      ...body,
    });

    if (!result.successful) {
      return c.json({ error: 'Failed to update event', details: result.error }, 500);
    }

    return c.json({
      id: eventId,
      ...body,
      updated_at: new Date().toISOString(),
    });
  });
}

/**
 * DELETE /integrations/calendar/events/:id
 * Delete a calendar event
 */
export async function deleteCalendarEvent(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const eventId = c.req.param('id');

    // Get connected account
    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ? AND connected = 1'
    ).bind(userId, 'googlecalendar').first();

    if (!integration) {
      return c.json({ error: 'Calendar not connected' }, 400);
    }

    const connectedAccountId = integration.access_token as string;
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);

    // Delete event via Composio
    const result = await composio.calendar.deleteEvent({
      connectedAccountId,
      eventId,
    });

    if (!result.successful) {
      return c.json({ error: 'Failed to delete event', details: result.error }, 500);
    }

    // Also delete from sync_items
    await c.env.DB.prepare(
      'DELETE FROM sync_items WHERE provider_item_id = ?'
    ).bind(eventId).run();

    return c.json({ success: true });
  });
}

/**
 * DELETE /integrations/:provider
 * Disconnect an integration
 */
export async function disconnectIntegration(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const provider = c.req.param('provider');

    if (!['gmail', 'googlecalendar'].includes(provider)) {
      return c.json({ error: 'Invalid provider' }, 400);
    }

    // Get connected account ID
    const integration = await c.env.DB.prepare(
      'SELECT access_token FROM integrations WHERE user_id = ? AND provider = ?'
    )
      .bind(userId, provider)
      .first();

    if (integration?.access_token) {
      // Delete from Composio
      const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
      try {
        await composio.client.deleteConnectedAccount(integration.access_token as string);
      } catch (error) {
        console.error(`[Disconnect] Failed to delete Composio account:`, error);
      }
    }

    // Delete from our database
    await c.env.DB.prepare('DELETE FROM integrations WHERE user_id = ? AND provider = ?')
      .bind(userId, provider)
      .run();

    return c.json({ success: true });
  });
}
