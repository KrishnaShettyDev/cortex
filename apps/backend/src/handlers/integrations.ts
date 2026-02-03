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
 */
export async function getIntegrationStatus(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    // Query our database for integration status
    const integrations = await c.env.DB.prepare(
      'SELECT provider, connected, email, last_sync FROM integrations WHERE user_id = ?'
    )
      .bind(userId)
      .all();

    // Try to check Composio for active connections (gracefully handle errors)
    let gmailAccount = null;
    let calendarAccount = null;

    try {
      const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
      const composioAccounts = await composio.client.listConnectedAccounts({
        userId,
        statuses: ['ACTIVE'],
      });

      // Map Composio accounts to our format
      gmailAccount = composioAccounts.items?.find((a) => a.toolkitSlug === 'gmail') || null;
      calendarAccount = composioAccounts.items?.find(
        (a) => a.toolkitSlug === 'googlecalendar'
      ) || null;
    } catch (error: any) {
      // Log but don't fail - Composio may return 404 when no accounts exist
      console.warn('[Integrations] Composio lookup failed (likely no accounts):', error.message);
    }

    return c.json({
      gmail: {
        connected: !!gmailAccount,
        accountId: gmailAccount?.id || null,
        status: gmailAccount?.status || null,
        lastSync:
          integrations.results?.find((i: any) => i.provider === 'gmail')?.last_sync || null,
      },
      calendar: {
        connected: !!calendarAccount,
        accountId: calendarAccount?.id || null,
        status: calendarAccount?.status || null,
        lastSync:
          integrations.results?.find((i: any) => i.provider === 'googlecalendar')?.last_sync ||
          null,
      },
    });
  });
}

/**
 * POST /integrations/gmail/connect
 * Start OAuth flow for Gmail
 */
export async function connectGmail(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    console.log(`[Gmail Connect] Creating auth link for user ${userId}`);

    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const authLink = await composio.client.createAuthLink({
      toolkitSlug: 'gmail',
      userId,
      callbackUrl: '', // v3 uses auth config's redirect URL
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
 */
export async function connectCalendar(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    const body = await c.req.json().catch(() => ({}));
    const callbackUrl =
      body.callbackUrl || `${new URL(c.req.url).origin}/integrations/calendar/callback`;

    console.log(`[Calendar Connect] Creating auth link for user ${userId}`);

    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const authLink = await composio.client.createAuthLink({
      toolkitSlug: 'googlecalendar',
      userId,
      callbackUrl,
    });

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
 */
export async function gmailCallback(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    // Composio handles the OAuth flow, we just need to verify and save
    const connectedAccountId = c.req.query('connected_account_id');
    const status = c.req.query('status');

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

    // Get the connected account to verify
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const account = await composio.client.getConnectedAccount(connectedAccountId);

    console.log(`[Gmail Callback] Account connected for user ${account.userId}`);

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
        account.userId,
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
        userId: account.userId,
        connectedAccountId: account.id,
        sinceDays: 7,
        maxEmails: 50,
      })
    );

    return c.html(`
      <html>
        <head>
          <style>
            body { font-family: system-ui; padding: 40px; text-align: center; background: #000; color: #fff; }
            h1 { color: #22c55e; }
          </style>
        </head>
        <body>
          <h1>✓ Gmail Connected!</h1>
          <p>Syncing your emails now. You can close this window.</p>
          <script>
            // Send message to parent window
            if (window.opener) {
              window.opener.postMessage({ type: 'GMAIL_CONNECTED', success: true }, '*');
            }
            // Auto-close after 1 second
            setTimeout(() => window.close(), 1000);
          </script>
        </body>
      </html>
    `);
  });
}

/**
 * GET /integrations/calendar/callback
 * OAuth callback for Google Calendar
 */
export async function calendarCallback(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
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
        <body>
          <h1>Calendar Connected!</h1>
          <p>Your Google Calendar has been successfully connected. We're syncing your events now.</p>
          <script>
            setTimeout(() => {
              window.close();
              window.opener?.location.reload();
            }, 2000);
          </script>
        </body>
      </html>
    `);
  });
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
