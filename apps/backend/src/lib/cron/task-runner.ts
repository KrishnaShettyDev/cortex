/**
 * Cron Task Runner with Production-Grade Features
 *
 * Features:
 * - Per-task isolation (one failure doesn't kill others)
 * - Per-task timeouts
 * - LLM budget tracking via KV (not global variables)
 * - Cron overlap protection via KV locks
 * - Wall time awareness (stay under Cloudflare's 30s limit)
 * - Structured logging for all operations
 */

import type { D1Database, KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { log, logCronResult, type CronTaskResult, type CronResult } from '../logger';
import type { Bindings } from '../../types';

// Configuration
const CRON_WALL_TIME_LIMIT_MS = 25000; // 25s safety margin (Cloudflare limit is 30s)
const CRON_LLM_BUDGET_PER_MINUTE = 10; // Max LLM calls per minute across all tasks
const CRON_LOCK_TTL_SECONDS = 120; // Lock TTL
const CRON_LOCK_STALE_MS = 55000; // Consider lock stale after 55s

const logger = log.cron;

export type CronInterval =
  | 'every_minute'
  | 'every_5_min'
  | 'every_hour'
  | 'every_6_hours'
  | 'daily';

export interface CronTask {
  name: string;
  handler: (env: Bindings, ctx: ExecutionContext) => Promise<void>;
  timeoutMs: number;
  llmBudget: number; // Max LLM calls this task can make
  priority: number; // Lower = runs first
  interval: CronInterval;
}

/**
 * Timeout helper - creates a promise that rejects after specified ms
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms)
  );
}

/**
 * Get current LLM budget key (per-minute granularity)
 */
function getLLMBudgetKey(): string {
  const now = new Date();
  // Format: llm_budget:YYYY-MM-DDTHH:MM
  return `llm_budget:${now.toISOString().slice(0, 16)}`;
}

/**
 * Check if LLM budget is available
 */
export async function checkLLMBudget(kv: KVNamespace): Promise<boolean> {
  const key = getLLMBudgetKey();
  const currentStr = await kv.get(key);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (isNaN(current)) {
    return true; // If parsing fails, allow the call
  }

  return current < CRON_LLM_BUDGET_PER_MINUTE;
}

/**
 * Record an LLM call against the budget
 */
export async function recordLLMCall(kv: KVNamespace): Promise<void> {
  const key = getLLMBudgetKey();
  const currentStr = await kv.get(key);
  const current = currentStr ? parseInt(currentStr, 10) : 0;
  const newValue = (isNaN(current) ? 0 : current) + 1;

  // TTL of 120s ensures cleanup even if minute boundary issues occur
  await kv.put(key, newValue.toString(), { expirationTtl: 120 });
}

/**
 * Get remaining LLM budget for current minute
 */
export async function getRemainingLLMBudget(kv: KVNamespace): Promise<number> {
  const key = getLLMBudgetKey();
  const currentStr = await kv.get(key);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (isNaN(current)) {
    return CRON_LLM_BUDGET_PER_MINUTE;
  }

  return Math.max(0, CRON_LLM_BUDGET_PER_MINUTE - current);
}

/**
 * Acquire a cron lock for a specific interval
 * Returns true if lock acquired, false if another cron is running
 */
export async function acquireCronLock(
  kv: KVNamespace,
  interval: CronInterval
): Promise<boolean> {
  const lockKey = `cron_lock:${interval}`;

  // Add small jitter to reduce race conditions
  await new Promise(r => setTimeout(r, Math.random() * 500));

  const existing = await kv.get(lockKey);

  if (existing) {
    const lockTime = parseInt(existing, 10);
    if (!isNaN(lockTime) && Date.now() - lockTime < CRON_LOCK_STALE_MS) {
      logger.info('lock_blocked', {
        interval,
        lockAge: Date.now() - lockTime,
        reason: 'previous_cron_running',
      });
      return false;
    }
    // Lock is stale, proceed to acquire
    logger.warn('stale_lock_override', {
      interval,
      lockAge: Date.now() - lockTime,
    });
  }

  // Acquire lock
  await kv.put(lockKey, Date.now().toString(), { expirationTtl: CRON_LOCK_TTL_SECONDS });
  return true;
}

/**
 * Release a cron lock
 */
export async function releaseCronLock(
  kv: KVNamespace,
  interval: CronInterval
): Promise<void> {
  const lockKey = `cron_lock:${interval}`;
  await kv.delete(lockKey);
}

/**
 * Run all tasks for a given interval with isolation, timeouts, and budget tracking
 */
export async function runCronTasks(
  tasks: CronTask[],
  env: Bindings,
  ctx: ExecutionContext,
  interval: CronInterval
): Promise<CronResult> {
  const cronStart = Date.now();
  const results: CronTaskResult[] = [];
  let totalLLMCalls = 0;
  let wallTimeExceeded = false;

  // Filter and sort tasks for this interval
  const tasksToRun = tasks
    .filter(t => t.interval === interval)
    .sort((a, b) => a.priority - b.priority);

  logger.info('cron_starting', {
    interval,
    taskCount: tasksToRun.length,
    tasks: tasksToRun.map(t => t.name),
  });

  for (const task of tasksToRun) {
    // Check wall time before starting new task
    const elapsed = Date.now() - cronStart;
    if (elapsed > CRON_WALL_TIME_LIMIT_MS) {
      wallTimeExceeded = true;
      const remaining = tasksToRun.slice(tasksToRun.indexOf(task));
      logger.warn('wall_time_exceeded', {
        elapsed,
        limit: CRON_WALL_TIME_LIMIT_MS,
        skippedTasks: remaining.map(t => t.name),
      });

      // Mark remaining tasks as skipped
      for (const skipped of remaining) {
        results.push({
          name: skipped.name,
          status: 'skipped',
          durationMs: 0,
          error: 'Wall time limit exceeded',
        });
      }
      break;
    }

    // Check LLM budget for this task
    if (task.llmBudget > 0 && env.CACHE) {
      const remaining = await getRemainingLLMBudget(env.CACHE);
      if (remaining < task.llmBudget) {
        logger.warn('llm_budget_insufficient', {
          task: task.name,
          required: task.llmBudget,
          remaining,
        });
        results.push({
          name: task.name,
          status: 'skipped',
          durationMs: 0,
          error: `LLM budget insufficient (need ${task.llmBudget}, have ${remaining})`,
        });
        continue;
      }
    }

    const taskStart = Date.now();
    let taskLLMCalls = 0;

    try {
      // Run task with timeout
      await Promise.race([
        task.handler(env, ctx),
        createTimeout(task.timeoutMs),
      ]);

      // Estimate LLM calls (task should call recordLLMCall, but we track here too)
      if (task.llmBudget > 0 && env.CACHE) {
        const afterBudget = await getRemainingLLMBudget(env.CACHE);
        const beforeBudget = CRON_LLM_BUDGET_PER_MINUTE - totalLLMCalls;
        taskLLMCalls = Math.max(0, beforeBudget - afterBudget);
        totalLLMCalls += taskLLMCalls;
      }

      results.push({
        name: task.name,
        status: 'success',
        durationMs: Date.now() - taskStart,
        llmCalls: taskLLMCalls,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');

      results.push({
        name: task.name,
        status: isTimeout ? 'timeout' : 'error',
        durationMs: Date.now() - taskStart,
        error: errorMessage,
        llmCalls: taskLLMCalls,
      });

      logger.error(`task_${isTimeout ? 'timeout' : 'failed'}`, error, {
        task: task.name,
        durationMs: Date.now() - taskStart,
      });

      // Continue with other tasks - don't let one failure kill the cron
    }
  }

  const cronResult: CronResult = {
    interval,
    tasks: results,
    totalDurationMs: Date.now() - cronStart,
    totalLLMCalls,
    wallTimeExceeded,
  };

  // Log the complete result
  logCronResult(cronResult);

  // Store metrics in D1 for observability
  if (env.DB) {
    try {
      await storeCronMetrics(env.DB, cronResult);
    } catch (error) {
      logger.error('metrics_storage_failed', error);
    }
  }

  return cronResult;
}

/**
 * Store cron metrics in D1 for observability
 */
async function storeCronMetrics(db: D1Database, result: CronResult): Promise<void> {
  const batch = result.tasks.map(task =>
    db.prepare(`
      INSERT INTO cron_metrics (id, cron_interval, task_name, status, duration_ms, llm_calls, error, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      `${Date.now()}-${task.name}`,
      result.interval,
      task.name,
      task.status,
      task.durationMs,
      task.llmCalls || 0,
      task.error || null,
      JSON.stringify({
        totalDurationMs: result.totalDurationMs,
        wallTimeExceeded: result.wallTimeExceeded,
      })
    )
  );

  await db.batch(batch);
}

/**
 * Determine which intervals should run based on current time
 */
export function getIntervalsToRun(cronExpression: string): CronInterval[] {
  const now = new Date();
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();

  const intervals: CronInterval[] = [];

  // Map cron expressions to intervals
  switch (cronExpression) {
    case '* * * * *':
      intervals.push('every_minute');
      if (minute % 5 === 0) intervals.push('every_5_min');
      if (minute === 0) intervals.push('every_hour');
      if (minute === 0 && hour % 6 === 0) intervals.push('every_6_hours');
      break;

    case '0 */6 * * *':
      intervals.push('every_6_hours');
      break;

    case '0 2 * * SUN':
      if (hour === 2 && dayOfWeek === 0) intervals.push('daily');
      break;

    case '0 8 * * *':
    case '0 20 * * *':
      // Morning/evening briefings handled separately
      break;
  }

  return intervals;
}

/**
 * Main cron handler - called from index.ts scheduled()
 */
export async function handleScheduledEvent(
  cronExpression: string,
  tasks: CronTask[],
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  const intervals = getIntervalsToRun(cronExpression);

  for (const interval of intervals) {
    // Try to acquire lock
    if (!env.CACHE) {
      logger.warn('no_kv_namespace', { interval, reason: 'CACHE not configured' });
      // Run without lock if KV not available (not recommended for production)
      await runCronTasks(tasks, env, ctx, interval);
      continue;
    }

    const locked = await acquireCronLock(env.CACHE, interval);
    if (!locked) {
      logger.info('cron_skipped', { interval, reason: 'lock_held' });
      continue;
    }

    try {
      await runCronTasks(tasks, env, ctx, interval);
    } finally {
      await releaseCronLock(env.CACHE, interval);
    }
  }
}
