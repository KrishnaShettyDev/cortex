/**
 * Proactive Monitoring - API Routes
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  handleWebhook,
  getSettings,
  updateSettings,
  getVipSenders,
  addVipSender,
  removeVipSender,
  getEvents,
  cleanup,
} from '../lib/proactive';

const proactiveRouter = new Hono<{ Bindings: Bindings }>();

// =============================================================================
// SETTINGS
// =============================================================================

proactiveRouter.get('/settings', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const settings = await getSettings(c.env.DB, userId);
  return c.json(settings);
});

proactiveRouter.patch('/settings', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json();
  const settings = await updateSettings(c.env.DB, userId, body);
  return c.json(settings);
});

// =============================================================================
// VIP SENDERS
// =============================================================================

proactiveRouter.get('/vip', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const senders = await getVipSenders(c.env.DB, userId);
  return c.json({ senders });
});

proactiveRouter.post('/vip', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { email, name, type } = await c.req.json();
  if (!email) return c.json({ error: 'email required' }, 400);

  await addVipSender(c.env.DB, userId, email, name, type);
  return c.json({ success: true }, 201);
});

proactiveRouter.delete('/vip/:email', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const email = decodeURIComponent(c.req.param('email'));
  await removeVipSender(c.env.DB, userId, email);
  return c.json({ success: true });
});

// =============================================================================
// EVENTS
// =============================================================================

proactiveRouter.get('/events', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const events = await getEvents(c.env.DB, userId);
  return c.json({ events });
});

// =============================================================================
// MESSAGES (for chat UI - combines events + trigger messages)
// =============================================================================

proactiveRouter.get('/messages', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const url = new URL(c.req.url);
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const since = url.searchParams.get('since');

  try {
    // Get proactive events (from webhooks)
    let eventsQuery = `
      SELECT
        id,
        'notification' as message_type,
        COALESCE(title, 'New notification') as content,
        '[]' as suggested_actions,
        CASE WHEN notified = 1 THEN 1 ELSE 0 END as is_read,
        created_at,
        NULL as event_id,
        NULL as trigger_id,
        source,
        urgency
      FROM proactive_events
      WHERE user_id = ?
    `;
    const eventsParams: any[] = [userId];

    if (since) {
      eventsQuery += ` AND created_at > ?`;
      eventsParams.push(since);
    }

    eventsQuery += ` ORDER BY created_at DESC LIMIT ?`;
    eventsParams.push(limit);

    const eventsResult = await c.env.DB.prepare(eventsQuery).bind(...eventsParams).all();

    // Get trigger messages (from user_triggers)
    let messagesQuery = `
      SELECT
        id,
        message_type,
        content,
        suggested_actions,
        is_read,
        created_at,
        event_id,
        trigger_id
      FROM proactive_messages
      WHERE user_id = ?
    `;
    const messagesParams: any[] = [userId];

    if (unreadOnly) {
      messagesQuery += ` AND is_read = 0`;
    }
    if (since) {
      messagesQuery += ` AND created_at > ?`;
      messagesParams.push(since);
    }

    messagesQuery += ` ORDER BY created_at DESC LIMIT ?`;
    messagesParams.push(limit);

    const messagesResult = await c.env.DB.prepare(messagesQuery).bind(...messagesParams).all();

    // Combine and sort by created_at
    const allMessages = [
      ...(eventsResult.results || []).map((e: any) => ({
        id: e.id,
        message_type: e.message_type,
        content: e.content,
        suggested_actions: e.suggested_actions,
        is_read: e.is_read,
        created_at: e.created_at,
        event_id: e.event_id,
        trigger_id: e.trigger_id,
        metadata: { source: e.source, urgency: e.urgency },
      })),
      ...(messagesResult.results || []).map((m: any) => ({
        id: m.id,
        message_type: m.message_type,
        content: m.content,
        suggested_actions: m.suggested_actions,
        is_read: m.is_read,
        created_at: m.created_at,
        event_id: m.event_id,
        trigger_id: m.trigger_id,
        metadata: null,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
     .slice(0, limit);

    return c.json({ success: true, messages: allMessages });
  } catch (error: any) {
    console.error('[Proactive] Messages fetch error:', error);
    return c.json({ success: false, messages: [], error: error.message }, 500);
  }
});

proactiveRouter.post('/messages/:id/read', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const messageId = c.req.param('id');

  // Try to mark in proactive_messages first
  await c.env.DB.prepare(`
    UPDATE proactive_messages SET is_read = 1 WHERE id = ? AND user_id = ?
  `).bind(messageId, userId).run();

  // Also mark in proactive_events (notified = 1 means "read")
  await c.env.DB.prepare(`
    UPDATE proactive_events SET notified = 1 WHERE id = ? AND user_id = ?
  `).bind(messageId, userId).run();

  return c.json({ success: true });
});

proactiveRouter.get('/messages/unread-count', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Count unread from both tables
  const eventsCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM proactive_events WHERE user_id = ? AND notified = 0
  `).bind(userId).first<{ count: number }>();

  const messagesCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM proactive_messages WHERE user_id = ? AND is_read = 0
  `).bind(userId).first<{ count: number }>();

  return c.json({
    success: true,
    count: (eventsCount?.count || 0) + (messagesCount?.count || 0),
  });
});

// =============================================================================
// MANUAL SYNC (Pull-to-refresh fallback)
// =============================================================================

proactiveRouter.post('/sync/manual', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const t0 = Date.now();

  try {
    // Get user's Google integration
    const integration = await c.env.DB.prepare(`
      SELECT access_token FROM integrations
      WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
    `).bind(userId).first<{ access_token: string }>();

    if (!integration?.access_token) {
      return c.json({
        success: false,
        error: 'Google not connected',
        newEvents: 0,
      }, 400);
    }

    // Fetch recent emails (last 1 hour) via Composio
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const response = await fetch(
      'https://backend.composio.dev/api/v2/actions/GMAIL_FETCH_EMAILS/execute',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': c.env.COMPOSIO_API_KEY,
        },
        body: JSON.stringify({
          connectedAccountId: integration.access_token,
          input: {
            query: `after:${Math.floor(Date.now() / 1000 - 3600)}`, // Unix timestamp for last hour
            max_results: 20,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('[ManualSync] Composio fetch failed:', response.status);
      return c.json({
        success: false,
        error: 'Failed to fetch emails',
        newEvents: 0,
      }, 500);
    }

    const result = await response.json() as any;
    const emails = result.data?.emails || result.emails || [];

    // Process each email through proactive pipeline
    let newEvents = 0;
    for (const email of emails) {
      // Check if already processed (dedupe)
      const existing = await c.env.DB.prepare(`
        SELECT id FROM proactive_events
        WHERE user_id = ? AND source = 'email'
        AND title = ? AND created_at > datetime('now', '-1 hour')
      `).bind(userId, email.subject || '').first();

      if (existing) continue;

      // Create synthetic webhook payload
      const payload = {
        type: 'GOOGLESUPER_NEW_MESSAGE',
        connectionId: integration.access_token,
        data: {
          subject: email.subject,
          snippet: email.snippet || email.bodyPreview,
          from: email.from || email.sender,
        },
      };

      // Process through webhook handler
      const result = await handleWebhook(
        c.env.DB,
        JSON.stringify(payload),
        '', // No signature for manual sync
        '' // No secret needed
      );

      if (result.success && result.eventId) {
        newEvents++;
      }
    }

    // Get last webhook time for health check
    const lastWebhook = await c.env.DB.prepare(`
      SELECT MAX(created_at) as last FROM proactive_events
      WHERE user_id = ? AND source = 'email'
    `).bind(userId).first<{ last: string }>();

    return c.json({
      success: true,
      newEvents,
      emailsChecked: emails.length,
      lastWebhookAt: lastWebhook?.last || null,
      syncDurationMs: Date.now() - t0,
    });
  } catch (error: any) {
    console.error('[ManualSync] Error:', error);
    return c.json({
      success: false,
      error: error.message,
      newEvents: 0,
    }, 500);
  }
});

// Health check for webhook reliability
proactiveRouter.get('/health', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Check when last webhook was received
  const lastWebhook = await c.env.DB.prepare(`
    SELECT MAX(created_at) as last FROM proactive_events
    WHERE user_id = ? AND source = 'email'
  `).bind(userId).first<{ last: string }>();

  // Check if user has active integrations
  const integration = await c.env.DB.prepare(`
    SELECT provider FROM integrations
    WHERE user_id = ? AND connected = 1
  `).bind(userId).first<{ provider: string }>();

  const lastWebhookTime = lastWebhook?.last ? new Date(lastWebhook.last) : null;
  const hoursSinceWebhook = lastWebhookTime
    ? (Date.now() - lastWebhookTime.getTime()) / (1000 * 60 * 60)
    : null;

  return c.json({
    hasIntegration: !!integration,
    lastWebhookAt: lastWebhook?.last || null,
    hoursSinceWebhook,
    webhookHealthy: hoursSinceWebhook !== null ? hoursSinceWebhook < 24 : null,
    suggestManualSync: hoursSinceWebhook !== null && hoursSinceWebhook > 6,
  });
});

// =============================================================================
// WEBHOOK (public - verified by signature)
// =============================================================================

// Generic webhook endpoint
proactiveRouter.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-composio-signature') || '';
  const secret = c.env.COMPOSIO_WEBHOOK_SECRET || '';

  const result = await handleWebhook(c.env.DB, rawBody, signature, secret);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true, eventId: result.eventId });
});

// Provider-specific webhook endpoints (same handler, different routes for clarity)
proactiveRouter.post('/webhook/:provider', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-composio-signature') || '';
  const secret = c.env.COMPOSIO_WEBHOOK_SECRET || '';

  const result = await handleWebhook(c.env.DB, rawBody, signature, secret);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true, eventId: result.eventId });
});

// =============================================================================
// ADMIN
// =============================================================================

proactiveRouter.post('/cleanup', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  await cleanup(c.env.DB);
  return c.json({ success: true });
});

export default proactiveRouter;
