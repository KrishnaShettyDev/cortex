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
