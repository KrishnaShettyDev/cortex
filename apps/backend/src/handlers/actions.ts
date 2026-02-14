/**
 * Actions API Handler
 *
 * Endpoints for executing actions on behalf of the user:
 * - GET /actions - List available actions
 * - POST /actions/execute - Execute an action
 * - GET /actions/pending - Get pending actions requiring confirmation
 * - POST /actions/confirm/:id - Confirm a pending action
 * - POST /actions/cancel/:id - Cancel a pending action
 * - GET /actions/history - Get action execution history
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { createActionExecutor, AVAILABLE_ACTIONS } from '../lib/actions';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /actions
 * List available actions for the user
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const executor = createActionExecutor({
      composioApiKey: c.env.COMPOSIO_API_KEY,
      openaiKey: c.env.OPENAI_API_KEY,
      tavilyApiKey: c.env.TAVILY_API_KEY,
      db: c.env.DB,
      userId,
    });

    const availableActions = await executor.getAvailableActions();

    return c.json({
      actions: availableActions,
      total: availableActions.length,
    });
  } catch (error: any) {
    console.error('[Actions] List failed:', error);
    return c.json({ error: 'Failed to list actions', message: error.message }, 500);
  }
});

/**
 * POST /actions/execute
 * Execute an action
 */
app.post('/execute', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();
    const { action, parameters, confirmed } = body;

    if (!action) {
      return c.json({ error: 'Missing action name' }, 400);
    }

    // Get user info for personalized content
    const user = await c.env.DB.prepare(
      'SELECT name FROM users WHERE id = ?'
    ).bind(userId).first<{ name: string | null }>();

    const executor = createActionExecutor({
      composioApiKey: c.env.COMPOSIO_API_KEY,
      openaiKey: c.env.OPENAI_API_KEY,
      tavilyApiKey: c.env.TAVILY_API_KEY,
      db: c.env.DB,
      userId,
      userName: user?.name || undefined,
    });

    const result = await executor.executeAction({
      action,
      parameters: parameters || {},
      confirmed,
    });

    // If confirmation is required, store as pending action
    if (result.requiresConfirmation && !confirmed) {
      const pendingId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

      await c.env.DB.prepare(`
        INSERT INTO pending_actions (id, user_id, action, parameters, confirmation_message, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        pendingId,
        userId,
        action,
        JSON.stringify(parameters || {}),
        result.confirmationMessage,
        expiresAt,
        new Date().toISOString()
      ).run();

      return c.json({
        ...result,
        pendingActionId: pendingId,
      });
    }

    return c.json(result);
  } catch (error: any) {
    console.error('[Actions] Execute failed:', error);
    return c.json({ error: 'Failed to execute action', message: error.message }, 500);
  }
});

/**
 * GET /actions/pending
 * Get pending actions requiring confirmation
 */
app.get('/pending', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const now = new Date().toISOString();

    const pending = await c.env.DB.prepare(`
      SELECT id, action, parameters, confirmation_message, expires_at, created_at
      FROM pending_actions
      WHERE user_id = ? AND expires_at > ?
      ORDER BY created_at DESC
    `).bind(userId, now).all();

    const actions = (pending.results as any[]).map((p) => ({
      id: p.id,
      action: p.action,
      parameters: JSON.parse(p.parameters),
      confirmationMessage: p.confirmation_message,
      expiresAt: p.expires_at,
      createdAt: p.created_at,
    }));

    return c.json({
      pendingActions: actions,
      total: actions.length,
    });
  } catch (error: any) {
    console.error('[Actions] Get pending failed:', error);
    return c.json({ error: 'Failed to get pending actions', message: error.message }, 500);
  }
});

/**
 * POST /actions/confirm/:id
 * Confirm and execute a pending action
 */
app.post('/confirm/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const pendingId = c.req.param('id');

  try {
    // Get pending action
    const pending = await c.env.DB.prepare(`
      SELECT * FROM pending_actions
      WHERE id = ? AND user_id = ?
    `).bind(pendingId, userId).first();

    if (!pending) {
      return c.json({ error: 'Pending action not found' }, 404);
    }

    // Check if expired
    if (new Date(pending.expires_at as string) < new Date()) {
      await c.env.DB.prepare('DELETE FROM pending_actions WHERE id = ?').bind(pendingId).run();
      return c.json({ error: 'Action expired' }, 410);
    }

    // Get user info for personalized content
    const user = await c.env.DB.prepare(
      'SELECT name FROM users WHERE id = ?'
    ).bind(userId).first<{ name: string | null }>();

    // Execute the action with confirmation
    const executor = createActionExecutor({
      composioApiKey: c.env.COMPOSIO_API_KEY,
      openaiKey: c.env.OPENAI_API_KEY,
      tavilyApiKey: c.env.TAVILY_API_KEY,
      db: c.env.DB,
      userId,
      userName: user?.name || undefined,
    });

    const result = await executor.executeAction({
      action: pending.action as string,
      parameters: JSON.parse(pending.parameters as string),
      confirmed: true,
    });

    // Delete pending action
    await c.env.DB.prepare('DELETE FROM pending_actions WHERE id = ?').bind(pendingId).run();

    return c.json(result);
  } catch (error: any) {
    console.error('[Actions] Confirm failed:', error);
    return c.json({ error: 'Failed to confirm action', message: error.message }, 500);
  }
});

/**
 * POST /actions/cancel/:id
 * Cancel a pending action
 */
app.post('/cancel/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const pendingId = c.req.param('id');

  try {
    const result = await c.env.DB.prepare(`
      DELETE FROM pending_actions
      WHERE id = ? AND user_id = ?
    `).bind(pendingId, userId).run();

    if (!result.meta.changes) {
      return c.json({ error: 'Pending action not found' }, 404);
    }

    return c.json({ success: true, message: 'Action cancelled' });
  } catch (error: any) {
    console.error('[Actions] Cancel failed:', error);
    return c.json({ error: 'Failed to cancel action', message: error.message }, 500);
  }
});

/**
 * GET /actions/history
 * Get action execution history
 */
app.get('/history', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const history = await c.env.DB.prepare(`
      SELECT id, action, parameters, result, status, error, created_at
      FROM action_log
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM action_log WHERE user_id = ?'
    ).bind(userId).first<{ count: number }>();

    const actions = (history.results as any[]).map((a) => ({
      id: a.id,
      action: a.action,
      parameters: JSON.parse(a.parameters),
      result: a.result ? JSON.parse(a.result) : null,
      status: a.status,
      error: a.error,
      createdAt: a.created_at,
    }));

    return c.json({
      history: actions,
      total: countResult?.count || 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Actions] History failed:', error);
    return c.json({ error: 'Failed to get action history', message: error.message }, 500);
  }
});

export default app;
