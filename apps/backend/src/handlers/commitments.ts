/**
 * Commitment Tracking API Handlers
 *
 * Endpoints:
 * - GET /v3/commitments - List commitments
 * - GET /v3/commitments/:id - Get commitment details
 * - POST /v3/commitments/:id/complete - Mark commitment as complete
 * - POST /v3/commitments/:id/cancel - Cancel a commitment
 * - GET /v3/commitments/overdue - Get overdue commitments
 * - GET /v3/commitments/upcoming - Get upcoming commitments
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import type { Commitment } from '../lib/commitments/types';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/commitments/overdue
 * Get overdue commitments
 */
app.get('/overdue', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const now = new Date().toISOString();

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM commitments
       WHERE user_id = ?
         AND status = 'pending'
         AND due_date IS NOT NULL
         AND due_date < ?
       ORDER BY due_date ASC`
    )
      .bind(userId, now)
      .all<Commitment>();

    // Update status to overdue
    if (result.results && result.results.length > 0) {
      const ids = result.results.map((c) => c.id);
      await c.env.DB.prepare(
        `UPDATE commitments SET status = 'overdue', updated_at = ?
         WHERE id IN (${ids.map(() => '?').join(', ')})`
      )
        .bind(now, ...ids)
        .run();
    }

    return c.json({
      commitments: result.results || [],
      total: result.results?.length || 0,
    });
  } catch (error: any) {
    console.error('[Commitments] Overdue failed:', error);
    return c.json(
      {
        error: 'Failed to get overdue commitments',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/commitments/upcoming
 * Get upcoming commitments (due in next 7 days)
 */
app.get('/upcoming', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM commitments
       WHERE user_id = ?
         AND status = 'pending'
         AND due_date IS NOT NULL
         AND due_date >= ?
         AND due_date <= ?
       ORDER BY due_date ASC`
    )
      .bind(userId, now.toISOString(), sevenDaysFromNow.toISOString())
      .all<Commitment>();

    return c.json({
      commitments: result.results || [],
      total: result.results?.length || 0,
    });
  } catch (error: any) {
    console.error('[Commitments] Upcoming failed:', error);
    return c.json(
      {
        error: 'Failed to get upcoming commitments',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/commitments
 * List commitments for the current user
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const status = c.req.query('status'); // pending, completed, overdue
  const type = c.req.query('type'); // promise, deadline, follow_up, meeting, deliverable
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    let query = `SELECT * FROM commitments WHERE user_id = ?`;
    const params: any[] = [userId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (type) {
      query += ` AND commitment_type = ?`;
      params.push(type);
    }

    query += ` ORDER BY CASE
      WHEN due_date IS NULL THEN 1
      ELSE 0
    END, due_date ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await c.env.DB.prepare(query)
      .bind(...params)
      .all<Commitment>();

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM commitments WHERE user_id = ?`;
    const countParams: any[] = [userId];

    if (status) {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    }

    if (type) {
      countQuery += ` AND commitment_type = ?`;
      countParams.push(type);
    }

    const countResult = await c.env.DB.prepare(countQuery)
      .bind(...countParams)
      .first<{ count: number }>();

    return c.json({
      commitments: result.results || [],
      total: countResult?.count || 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Commitments] List failed:', error);
    return c.json(
      {
        error: 'Failed to list commitments',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/commitments/:id
 * Get commitment details
 */
app.get('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const commitment = await c.env.DB.prepare(
      'SELECT * FROM commitments WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first<Commitment>();

    if (!commitment) {
      return c.json({ error: 'Commitment not found' }, 404);
    }

    // Get associated memory
    const memory = await c.env.DB.prepare(
      'SELECT id, content, created_at FROM memories WHERE id = ?'
    )
      .bind(commitment.memory_id)
      .first<{ id: string; content: string; created_at: string }>();

    // Get entity details if linked
    let entity = null;
    if (commitment.to_entity_id) {
      entity = await c.env.DB.prepare(
        'SELECT id, name, entity_type FROM entities WHERE id = ?'
      )
        .bind(commitment.to_entity_id)
        .first<{ id: string; name: string; entity_type: string }>();
    }

    return c.json({
      commitment,
      memory,
      entity,
    });
  } catch (error: any) {
    console.error('[Commitments] Get failed:', error);
    return c.json(
      {
        error: 'Failed to get commitment',
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /v3/commitments/:id/complete
 * Mark commitment as complete
 */
app.post('/:id/complete', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<{
    completion_note?: string;
  }>();

  try {
    // Verify ownership
    const commitment = await c.env.DB.prepare(
      'SELECT * FROM commitments WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first<Commitment>();

    if (!commitment) {
      return c.json({ error: 'Commitment not found' }, 404);
    }

    // Update status
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE commitments SET status = ?, completed_at = ?, completion_note = ?, updated_at = ? WHERE id = ?'
    )
      .bind('completed', now, body.completion_note || null, now, id)
      .run();

    // Cancel any pending reminders
    await c.env.DB.prepare(
      'UPDATE commitment_reminders SET status = ? WHERE commitment_id = ? AND status = ?'
    )
      .bind('cancelled', id, 'pending')
      .run();

    return c.json({
      success: true,
      commitment_id: id,
      completed_at: now,
    });
  } catch (error: any) {
    console.error('[Commitments] Complete failed:', error);
    return c.json(
      {
        error: 'Failed to complete commitment',
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /v3/commitments/:id/cancel
 * Cancel a commitment
 */
app.post('/:id/cancel', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    // Verify ownership
    const commitment = await c.env.DB.prepare(
      'SELECT * FROM commitments WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first<Commitment>();

    if (!commitment) {
      return c.json({ error: 'Commitment not found' }, 404);
    }

    // Update status
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?'
    )
      .bind('cancelled', now, id)
      .run();

    // Cancel any pending reminders
    await c.env.DB.prepare(
      'UPDATE commitment_reminders SET status = ? WHERE commitment_id = ? AND status = ?'
    )
      .bind('cancelled', id, 'pending')
      .run();

    return c.json({
      success: true,
      commitment_id: id,
      cancelled_at: now,
    });
  } catch (error: any) {
    console.error('[Commitments] Cancel failed:', error);
    return c.json(
      {
        error: 'Failed to cancel commitment',
        message: error.message,
      },
      500
    );
  }
});

export default app;
