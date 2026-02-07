/**
 * Trigger Executor
 *
 * Executes scheduled triggers when their time comes.
 * Called by the 1-minute cron job to process due triggers.
 *
 * Action types:
 * - reminder: Send a reminder notification to the user
 * - briefing: Generate and send a briefing (morning/evening)
 * - check: Check status of integrations and summarize
 * - query: Execute a query and return results
 * - custom: Custom action defined by user
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { calculateNextTrigger } from './parser';

// =============================================================================
// TYPES
// =============================================================================

export interface Trigger {
  id: string;
  userId: string;
  name: string;
  originalInput: string;
  cronExpression: string;
  agentId: string | null;
  actionType: 'reminder' | 'briefing' | 'check' | 'query' | 'custom';
  actionPayload: Record<string, any>;
  timezone: string;
  isActive: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  errorCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionResult {
  triggerId: string;
  userId: string;
  status: 'success' | 'error' | 'skipped';
  result?: Record<string, any>;
  errorMessage?: string;
  executionTimeMs: number;
}

// =============================================================================
// MAIN EXECUTOR
// =============================================================================

/**
 * Process all due triggers
 * Called by 1-minute cron
 */
export async function processDueTriggers(db: D1Database): Promise<ExecutionResult[]> {
  const now = new Date().toISOString();
  const results: ExecutionResult[] = [];

  // Get triggers that are due
  const dueTriggers = await db.prepare(`
    SELECT
      id, user_id, name, original_input, cron_expression,
      agent_id, action_type, action_payload, timezone,
      is_active, last_triggered_at, next_trigger_at,
      error_count, last_error, created_at, updated_at
    FROM user_triggers
    WHERE is_active = 1
    AND next_trigger_at <= ?
    ORDER BY next_trigger_at ASC
    LIMIT 50
  `).bind(now).all<{
    id: string;
    user_id: string;
    name: string;
    original_input: string;
    cron_expression: string;
    agent_id: string | null;
    action_type: string;
    action_payload: string;
    timezone: string;
    is_active: number;
    last_triggered_at: string | null;
    next_trigger_at: string | null;
    error_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>();

  if (!dueTriggers.results?.length) {
    return results;
  }

  console.log(`[Triggers] Processing ${dueTriggers.results.length} due triggers`);

  for (const row of dueTriggers.results) {
    const trigger: Trigger = {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      originalInput: row.original_input,
      cronExpression: row.cron_expression,
      agentId: row.agent_id,
      actionType: row.action_type as Trigger['actionType'],
      actionPayload: JSON.parse(row.action_payload || '{}'),
      timezone: row.timezone,
      isActive: row.is_active === 1,
      lastTriggeredAt: row.last_triggered_at,
      nextTriggerAt: row.next_trigger_at,
      errorCount: row.error_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const result = await executeTrigger(db, trigger);
    results.push(result);
  }

  return results;
}

/**
 * Execute a single trigger
 */
async function executeTrigger(db: D1Database, trigger: Trigger): Promise<ExecutionResult> {
  const startTime = Date.now();
  const scheduledAt = trigger.nextTriggerAt || new Date().toISOString();

  try {
    // Check if user has proactive enabled
    const settings = await db.prepare(`
      SELECT enabled FROM proactive_settings WHERE user_id = ?
    `).bind(trigger.userId).first<{ enabled: number }>();

    if (settings && settings.enabled === 0) {
      const result: ExecutionResult = {
        triggerId: trigger.id,
        userId: trigger.userId,
        status: 'skipped',
        errorMessage: 'Proactive notifications disabled',
        executionTimeMs: Date.now() - startTime,
      };
      await logExecution(db, trigger, scheduledAt, result);
      await updateTriggerNextRun(db, trigger);
      return result;
    }

    // Execute based on action type
    let actionResult: Record<string, any>;

    switch (trigger.actionType) {
      case 'reminder':
        actionResult = await executeReminder(db, trigger);
        break;
      case 'briefing':
        actionResult = await executeBriefing(db, trigger);
        break;
      case 'check':
        actionResult = await executeCheck(db, trigger);
        break;
      case 'query':
        actionResult = await executeQuery(db, trigger);
        break;
      case 'custom':
        actionResult = await executeCustom(db, trigger);
        break;
      default:
        actionResult = { error: 'Unknown action type' };
    }

    const executionResult: ExecutionResult = {
      triggerId: trigger.id,
      userId: trigger.userId,
      status: 'success',
      result: actionResult,
      executionTimeMs: Date.now() - startTime,
    };

    // Log execution and update trigger
    await logExecution(db, trigger, scheduledAt, executionResult);
    await updateTriggerNextRun(db, trigger, true);

    return executionResult;
  } catch (error) {
    const executionResult: ExecutionResult = {
      triggerId: trigger.id,
      userId: trigger.userId,
      status: 'error',
      errorMessage: String(error),
      executionTimeMs: Date.now() - startTime,
    };

    // Log error and update trigger
    await logExecution(db, trigger, scheduledAt, executionResult);
    await updateTriggerNextRun(db, trigger, false, String(error));

    return executionResult;
  }
}

// =============================================================================
// ACTION EXECUTORS
// =============================================================================

/**
 * Execute reminder action - sends a notification to the user
 */
async function executeReminder(db: D1Database, trigger: Trigger): Promise<Record<string, any>> {
  const message = trigger.actionPayload.message || trigger.name;

  // Create proactive message
  const messageId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, trigger_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'reminder', ?, ?, 0, ?)
  `).bind(
    messageId,
    trigger.userId,
    trigger.id,
    `⏰ **Reminder**: ${message}`,
    JSON.stringify([
      { type: 'snooze', label: 'Snooze 1h' },
      { type: 'dismiss', label: 'Dismiss' },
    ]),
    now
  ).run();

  // Schedule push notification
  await db.prepare(`
    INSERT INTO scheduled_notifications (
      id, user_id, notification_type, title, body, data, channel_id,
      scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
    ) VALUES (?, ?, 'trigger_reminder', ?, ?, ?, 'reminders', ?, ?, ?, 'pending', ?, ?)
  `).bind(
    nanoid(),
    trigger.userId,
    'Reminder',
    message,
    JSON.stringify({ triggerId: trigger.id, messageId }),
    now,
    now,
    trigger.timezone,
    now,
    now
  ).run();

  return { messageId, message };
}

/**
 * Execute briefing action - generates morning/evening briefing
 */
async function executeBriefing(db: D1Database, trigger: Trigger): Promise<Record<string, any>> {
  const briefingType = trigger.actionPayload.briefingType || 'morning';

  // Create proactive message prompting a briefing
  const messageId = nanoid();
  const now = new Date().toISOString();

  const content = briefingType === 'morning'
    ? '☀️ **Good morning!** Here\'s your daily briefing. Type "briefing" to see your schedule and important updates.'
    : '🌙 **Good evening!** Here\'s your end-of-day summary. Type "recap" to see what happened today.';

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, trigger_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'briefing', ?, ?, 0, ?)
  `).bind(
    messageId,
    trigger.userId,
    trigger.id,
    content,
    JSON.stringify([
      { type: 'get_briefing', label: briefingType === 'morning' ? 'Get Briefing' : 'Get Recap' },
      { type: 'dismiss', label: 'Skip' },
    ]),
    now
  ).run();

  // Schedule push notification
  await db.prepare(`
    INSERT INTO scheduled_notifications (
      id, user_id, notification_type, title, body, data, channel_id,
      scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
    ) VALUES (?, ?, 'trigger_briefing', ?, ?, ?, 'briefings', ?, ?, ?, 'pending', ?, ?)
  `).bind(
    nanoid(),
    trigger.userId,
    briefingType === 'morning' ? 'Morning Briefing' : 'Evening Recap',
    'Tap to see your personalized briefing',
    JSON.stringify({ triggerId: trigger.id, messageId, briefingType }),
    now,
    now,
    trigger.timezone,
    now,
    now
  ).run();

  return { messageId, briefingType };
}

/**
 * Execute check action - checks status of something
 */
async function executeCheck(db: D1Database, trigger: Trigger): Promise<Record<string, any>> {
  const checkType = trigger.actionPayload.checkType || 'general';
  const message = trigger.actionPayload.message || 'Status check';

  // Create proactive message
  const messageId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, trigger_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'insight', ?, ?, 0, ?)
  `).bind(
    messageId,
    trigger.userId,
    trigger.id,
    `🔍 **Check**: ${message}`,
    JSON.stringify([
      { type: 'view_details', label: 'View Details' },
      { type: 'dismiss', label: 'Dismiss' },
    ]),
    now
  ).run();

  return { messageId, checkType };
}

/**
 * Execute query action - runs a query
 */
async function executeQuery(db: D1Database, trigger: Trigger): Promise<Record<string, any>> {
  const query = trigger.actionPayload.query || '';

  // For now, just create a message prompting the query
  const messageId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, trigger_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'insight', ?, ?, 0, ?)
  `).bind(
    messageId,
    trigger.userId,
    trigger.id,
    `📊 Scheduled query: "${query}"`,
    JSON.stringify([
      { type: 'run_query', label: 'Run Query', payload: { query } },
      { type: 'dismiss', label: 'Skip' },
    ]),
    now
  ).run();

  return { messageId, query };
}

/**
 * Execute custom action
 */
async function executeCustom(db: D1Database, trigger: Trigger): Promise<Record<string, any>> {
  // Custom actions are user-defined
  const messageId = nanoid();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO proactive_messages (
      id, user_id, trigger_id, message_type, content, suggested_actions, is_read, created_at
    ) VALUES (?, ?, ?, 'action_result', ?, ?, 0, ?)
  `).bind(
    messageId,
    trigger.userId,
    trigger.id,
    `⚡ Custom trigger: ${trigger.name}`,
    JSON.stringify(trigger.actionPayload.actions || []),
    now
  ).run();

  return { messageId, customPayload: trigger.actionPayload };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Log trigger execution
 */
async function logExecution(
  db: D1Database,
  trigger: Trigger,
  scheduledAt: string,
  result: ExecutionResult
): Promise<void> {
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO trigger_execution_log (
      id, trigger_id, user_id, scheduled_at, executed_at, status,
      result, error_message, execution_time_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    nanoid(),
    trigger.id,
    trigger.userId,
    scheduledAt,
    now,
    result.status,
    result.result ? JSON.stringify(result.result) : null,
    result.errorMessage || null,
    result.executionTimeMs,
    now
  ).run();
}

/**
 * Update trigger with next run time
 */
async function updateTriggerNextRun(
  db: D1Database,
  trigger: Trigger,
  success: boolean = true,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  const nextTriggerAt = calculateNextTrigger(trigger.cronExpression, trigger.timezone);

  if (success) {
    await db.prepare(`
      UPDATE user_triggers
      SET last_triggered_at = ?,
          next_trigger_at = ?,
          error_count = 0,
          last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `).bind(now, nextTriggerAt, now, trigger.id).run();
  } else {
    const newErrorCount = trigger.errorCount + 1;
    const shouldDisable = newErrorCount >= 5; // Circuit breaker: disable after 5 failures

    await db.prepare(`
      UPDATE user_triggers
      SET last_triggered_at = ?,
          next_trigger_at = ?,
          error_count = ?,
          last_error = ?,
          is_active = ?,
          updated_at = ?
      WHERE id = ?
    `).bind(
      now,
      nextTriggerAt,
      newErrorCount,
      errorMessage || null,
      shouldDisable ? 0 : 1,
      now,
      trigger.id
    ).run();

    if (shouldDisable) {
      console.log(`[Triggers] Disabled trigger ${trigger.id} after ${newErrorCount} failures`);
    }
  }
}

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Create a new trigger
 */
export async function createTrigger(
  db: D1Database,
  userId: string,
  data: {
    name: string;
    originalInput: string;
    cronExpression: string;
    actionType: Trigger['actionType'];
    actionPayload: Record<string, any>;
    timezone: string;
    agentId?: string;
  }
): Promise<Trigger> {
  const id = nanoid();
  const now = new Date().toISOString();
  const nextTriggerAt = calculateNextTrigger(data.cronExpression, data.timezone);

  await db.prepare(`
    INSERT INTO user_triggers (
      id, user_id, name, original_input, cron_expression,
      agent_id, action_type, action_payload, timezone,
      is_active, next_trigger_at, error_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
  `).bind(
    id,
    userId,
    data.name,
    data.originalInput,
    data.cronExpression,
    data.agentId || null,
    data.actionType,
    JSON.stringify(data.actionPayload),
    data.timezone,
    nextTriggerAt,
    now,
    now
  ).run();

  return {
    id,
    userId,
    name: data.name,
    originalInput: data.originalInput,
    cronExpression: data.cronExpression,
    agentId: data.agentId || null,
    actionType: data.actionType,
    actionPayload: data.actionPayload,
    timezone: data.timezone,
    isActive: true,
    lastTriggeredAt: null,
    nextTriggerAt,
    errorCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get triggers for a user
 */
export async function getUserTriggers(db: D1Database, userId: string): Promise<Trigger[]> {
  const result = await db.prepare(`
    SELECT
      id, user_id, name, original_input, cron_expression,
      agent_id, action_type, action_payload, timezone,
      is_active, last_triggered_at, next_trigger_at,
      error_count, last_error, created_at, updated_at
    FROM user_triggers
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).bind(userId).all<{
    id: string;
    user_id: string;
    name: string;
    original_input: string;
    cron_expression: string;
    agent_id: string | null;
    action_type: string;
    action_payload: string;
    timezone: string;
    is_active: number;
    last_triggered_at: string | null;
    next_trigger_at: string | null;
    error_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>();

  return (result.results || []).map(row => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    originalInput: row.original_input,
    cronExpression: row.cron_expression,
    agentId: row.agent_id,
    actionType: row.action_type as Trigger['actionType'],
    actionPayload: JSON.parse(row.action_payload || '{}'),
    timezone: row.timezone,
    isActive: row.is_active === 1,
    lastTriggeredAt: row.last_triggered_at,
    nextTriggerAt: row.next_trigger_at,
    errorCount: row.error_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Update a trigger
 */
export async function updateTrigger(
  db: D1Database,
  userId: string,
  triggerId: string,
  updates: Partial<{
    name: string;
    isActive: boolean;
    cronExpression: string;
    actionPayload: Record<string, any>;
  }>
): Promise<boolean> {
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }
  if (updates.cronExpression !== undefined) {
    sets.push('cron_expression = ?');
    values.push(updates.cronExpression);

    // Recalculate next trigger time
    const trigger = await db.prepare(`
      SELECT timezone FROM user_triggers WHERE id = ? AND user_id = ?
    `).bind(triggerId, userId).first<{ timezone: string }>();

    if (trigger) {
      const nextTriggerAt = calculateNextTrigger(updates.cronExpression, trigger.timezone);
      sets.push('next_trigger_at = ?');
      values.push(nextTriggerAt);
    }
  }
  if (updates.actionPayload !== undefined) {
    sets.push('action_payload = ?');
    values.push(JSON.stringify(updates.actionPayload));
  }

  values.push(triggerId, userId);

  const result = await db.prepare(`
    UPDATE user_triggers
    SET ${sets.join(', ')}
    WHERE id = ? AND user_id = ?
  `).bind(...values).run();

  return (result.meta?.changes || 0) > 0;
}

/**
 * Delete a trigger
 */
export async function deleteTrigger(
  db: D1Database,
  userId: string,
  triggerId: string
): Promise<boolean> {
  const result = await db.prepare(`
    DELETE FROM user_triggers WHERE id = ? AND user_id = ?
  `).bind(triggerId, userId).run();

  return (result.meta?.changes || 0) > 0;
}
