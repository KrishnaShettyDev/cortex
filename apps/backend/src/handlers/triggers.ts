/**
 * Triggers API Handler
 *
 * CRUD operations for user-defined triggers.
 * Allows users to create, update, delete, and list their scheduled triggers.
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { parseTriggerInput } from '../lib/triggers/parser';
import {
  createTrigger,
  getUserTriggers,
  updateTrigger,
  deleteTrigger,
  type Trigger,
} from '../lib/triggers/executor';

const app = new Hono<{ Bindings: Bindings }>();

// Helper to get userId from JWT payload
function getUserId(c: any): string | null {
  const jwtPayload = c.get('jwtPayload');
  return jwtPayload?.sub || null;
}

// =============================================================================
// GET /triggers - List all triggers for user
// =============================================================================

app.get('/', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const triggers = await getUserTriggers(c.env.DB, userId);

    return c.json({
      success: true,
      triggers: triggers.map(formatTriggerResponse),
    });
  } catch (error) {
    console.error('[Triggers API] List error:', error);
    return c.json({ success: false, error: 'Failed to list triggers' }, 500);
  }
});

// =============================================================================
// POST /triggers - Create a new trigger
// =============================================================================

app.post('/', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      input: string;
      name?: string;
      timezone?: string;
    }>();

    if (!body.input || typeof body.input !== 'string') {
      return c.json({ success: false, error: 'Input is required' }, 400);
    }

    const timezone = body.timezone || 'UTC';

    // Parse the natural language input
    const parseResult = await parseTriggerInput(
      body.input,
      timezone,
      c.env.OPENAI_API_KEY
    );

    if (!parseResult.success || !parseResult.trigger) {
      return c.json({
        success: false,
        error: parseResult.error || 'Could not parse trigger',
        needsMoreInfo: parseResult.needsMoreInfo,
      }, 400);
    }

    const { trigger: parsed } = parseResult;

    // Create the trigger
    const trigger = await createTrigger(c.env.DB, userId, {
      name: body.name || parsed.humanReadable,
      originalInput: body.input,
      cronExpression: parsed.cronExpression,
      actionType: parsed.actionType,
      actionPayload: parsed.actionPayload,
      timezone,
    });

    return c.json({
      success: true,
      trigger: formatTriggerResponse(trigger),
      parsed: {
        cronExpression: parsed.cronExpression,
        humanReadable: parsed.humanReadable,
        nextTriggerAt: parsed.nextTriggerAt,
        confidence: parsed.confidence,
      },
    });
  } catch (error) {
    console.error('[Triggers API] Create error:', error);
    return c.json({ success: false, error: 'Failed to create trigger' }, 500);
  }
});

// =============================================================================
// GET /triggers/:id - Get a specific trigger
// =============================================================================

app.get('/:id', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const triggerId = c.req.param('id');

  try {
    const triggers = await getUserTriggers(c.env.DB, userId);
    const trigger = triggers.find(t => t.id === triggerId);

    if (!trigger) {
      return c.json({ success: false, error: 'Trigger not found' }, 404);
    }

    // Get recent executions
    const executions = await c.env.DB.prepare(`
      SELECT id, scheduled_at, executed_at, status, error_message, execution_time_ms
      FROM trigger_execution_log
      WHERE trigger_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(triggerId, userId).all<{
      id: string;
      scheduled_at: string;
      executed_at: string;
      status: string;
      error_message: string | null;
      execution_time_ms: number;
    }>();

    return c.json({
      success: true,
      trigger: formatTriggerResponse(trigger),
      recentExecutions: executions.results || [],
    });
  } catch (error) {
    console.error('[Triggers API] Get error:', error);
    return c.json({ success: false, error: 'Failed to get trigger' }, 500);
  }
});

// =============================================================================
// PATCH /triggers/:id - Update a trigger
// =============================================================================

app.patch('/:id', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const triggerId = c.req.param('id');

  try {
    const body = await c.req.json<{
      name?: string;
      isActive?: boolean;
      input?: string; // Re-parse schedule from new input
    }>();

    const updates: Parameters<typeof updateTrigger>[3] = {};

    if (body.name !== undefined) {
      updates.name = body.name;
    }

    if (body.isActive !== undefined) {
      updates.isActive = body.isActive;
    }

    if (body.input) {
      // Re-parse the schedule
      const parseResult = await parseTriggerInput(
        body.input,
        'UTC',
        c.env.OPENAI_API_KEY
      );

      if (parseResult.success && parseResult.trigger) {
        updates.cronExpression = parseResult.trigger.cronExpression;
        updates.actionPayload = parseResult.trigger.actionPayload;
      }
    }

    const success = await updateTrigger(c.env.DB, userId, triggerId, updates);

    if (!success) {
      return c.json({ success: false, error: 'Trigger not found' }, 404);
    }

    // Get updated trigger
    const triggers = await getUserTriggers(c.env.DB, userId);
    const trigger = triggers.find(t => t.id === triggerId);

    return c.json({
      success: true,
      trigger: trigger ? formatTriggerResponse(trigger) : null,
    });
  } catch (error) {
    console.error('[Triggers API] Update error:', error);
    return c.json({ success: false, error: 'Failed to update trigger' }, 500);
  }
});

// =============================================================================
// DELETE /triggers/:id - Delete a trigger
// =============================================================================

app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const triggerId = c.req.param('id');

  try {
    const success = await deleteTrigger(c.env.DB, userId, triggerId);

    if (!success) {
      return c.json({ success: false, error: 'Trigger not found' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('[Triggers API] Delete error:', error);
    return c.json({ success: false, error: 'Failed to delete trigger' }, 500);
  }
});

// =============================================================================
// POST /triggers/parse - Parse a trigger without creating it
// =============================================================================

app.post('/parse', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      input: string;
      timezone?: string;
    }>();

    if (!body.input || typeof body.input !== 'string') {
      return c.json({ success: false, error: 'Input is required' }, 400);
    }

    const timezone = body.timezone || 'UTC';

    const parseResult = await parseTriggerInput(
      body.input,
      timezone,
      c.env.OPENAI_API_KEY
    );

    if (!parseResult.success || !parseResult.trigger) {
      return c.json({
        success: false,
        error: parseResult.error || 'Could not parse trigger',
        needsMoreInfo: parseResult.needsMoreInfo,
      }, 400);
    }

    return c.json({
      success: true,
      parsed: {
        cronExpression: parseResult.trigger.cronExpression,
        humanReadable: parseResult.trigger.humanReadable,
        actionType: parseResult.trigger.actionType,
        actionPayload: parseResult.trigger.actionPayload,
        nextTriggerAt: parseResult.trigger.nextTriggerAt,
        confidence: parseResult.trigger.confidence,
      },
    });
  } catch (error) {
    console.error('[Triggers API] Parse error:', error);
    return c.json({ success: false, error: 'Failed to parse trigger' }, 500);
  }
});

// =============================================================================
// POST /triggers/:id/test - Manually trigger for testing
// =============================================================================

app.post('/:id/test', async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const triggerId = c.req.param('id');

  try {
    const triggers = await getUserTriggers(c.env.DB, userId);
    const trigger = triggers.find(t => t.id === triggerId);

    if (!trigger) {
      return c.json({ success: false, error: 'Trigger not found' }, 404);
    }

    // Import executor dynamically to avoid circular deps
    const { processDueTriggers } = await import('../lib/triggers/executor');

    // Temporarily set next_trigger_at to now to make it execute
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      UPDATE user_triggers SET next_trigger_at = ? WHERE id = ?
    `).bind(now, triggerId).run();

    // Process the trigger
    const results = await processDueTriggers(c.env.DB);
    const result = results.find(r => r.triggerId === triggerId);

    return c.json({
      success: true,
      result: result || { status: 'not_executed' },
    });
  } catch (error) {
    console.error('[Triggers API] Test error:', error);
    return c.json({ success: false, error: 'Failed to test trigger' }, 500);
  }
});

// =============================================================================
// HELPERS
// =============================================================================

function formatTriggerResponse(trigger: Trigger) {
  return {
    id: trigger.id,
    name: trigger.name,
    originalInput: trigger.originalInput,
    cronExpression: trigger.cronExpression,
    humanReadable: formatCronToReadable(trigger.cronExpression),
    actionType: trigger.actionType,
    actionPayload: trigger.actionPayload,
    timezone: trigger.timezone,
    isActive: trigger.isActive,
    lastTriggeredAt: trigger.lastTriggeredAt,
    nextTriggerAt: trigger.nextTriggerAt,
    errorCount: trigger.errorCount,
    lastError: trigger.lastError,
    createdAt: trigger.createdAt,
  };
}

function formatCronToReadable(cron: string): string {
  const [minute, hour, , , dayOfWeek] = cron.split(' ');

  const time = formatTime(parseInt(hour) || 0, parseInt(minute) || 0);

  if (dayOfWeek === '1-5') return `Every weekday at ${time}`;
  if (dayOfWeek === '0,6') return `Every weekend at ${time}`;
  if (dayOfWeek === '*') return `Daily at ${time}`;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!isNaN(parseInt(dayOfWeek))) {
    return `Every ${days[parseInt(dayOfWeek)]} at ${time}`;
  }

  return `Scheduled: ${cron}`;
}

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${m} ${ampm}`;
}

export default app;
