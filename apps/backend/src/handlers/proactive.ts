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
// WEBHOOK (public - verified by signature)
// =============================================================================

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
