/**
 * Agent Execution Logger
 *
 * Logs every agent call for cost tracking, debugging, and performance monitoring.
 */

import type { AgentType } from './config';
import { calculateCost } from './config';

export type ExecutionStatus = 'completed' | 'failed' | 'timeout' | 'partial';

export interface ExecutionLog {
  id: string;
  userId: string;
  requestId: string | null;
  agentType: AgentType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number;
  costEstimate: number;
  goal: string | null;
  status: ExecutionStatus;
  error: string | null;
  parentExecutionId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface ExecutionStartParams {
  userId: string;
  requestId?: string;
  agentType: AgentType;
  model: string;
  goal?: string;
  parentExecutionId?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionEndParams {
  inputTokens: number;
  outputTokens: number;
  toolCalls?: number;
  status: ExecutionStatus;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Execution tracker for a single agent call
 */
export class ExecutionTracker {
  private id: string;
  private startTime: number;
  private params: ExecutionStartParams;
  private db: D1Database;

  constructor(db: D1Database, params: ExecutionStartParams) {
    this.id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
    this.startTime = Date.now();
    this.params = params;
    this.db = db;
  }

  getId(): string {
    return this.id;
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * End the execution and log to D1
   */
  async end(endParams: ExecutionEndParams): Promise<ExecutionLog> {
    const durationMs = this.getElapsedMs();
    const costEstimate = calculateCost(
      this.params.model,
      endParams.inputTokens,
      endParams.outputTokens
    );

    const now = new Date().toISOString();

    const log: ExecutionLog = {
      id: this.id,
      userId: this.params.userId,
      requestId: this.params.requestId || null,
      agentType: this.params.agentType,
      model: this.params.model,
      inputTokens: endParams.inputTokens,
      outputTokens: endParams.outputTokens,
      toolCalls: endParams.toolCalls || 0,
      durationMs,
      costEstimate,
      goal: this.params.goal || null,
      status: endParams.status,
      error: endParams.error || null,
      parentExecutionId: this.params.parentExecutionId || null,
      metadata: { ...this.params.metadata, ...endParams.metadata },
      createdAt: now,
    };

    // Log to D1
    try {
      await this.db
        .prepare(
          `INSERT INTO agent_executions
           (id, user_id, request_id, agent_type, model, input_tokens, output_tokens, tool_calls, duration_ms, cost_estimate, goal, status, error, parent_execution_id, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log.id,
          log.userId,
          log.requestId,
          log.agentType,
          log.model,
          log.inputTokens,
          log.outputTokens,
          log.toolCalls,
          log.durationMs,
          log.costEstimate,
          log.goal,
          log.status,
          log.error,
          log.parentExecutionId,
          JSON.stringify(log.metadata),
          log.createdAt
        )
        .run();
    } catch (err) {
      console.error('[ExecutionLogger] Failed to log execution:', err);
    }

    // Console log for debugging
    const statusEmoji = log.status === 'completed' ? '✓' : log.status === 'failed' ? '✗' : '⚠';
    console.log(
      `[Agent] ${statusEmoji} ${log.agentType} | ${log.model} | ${log.durationMs}ms | ` +
        `${log.inputTokens}+${log.outputTokens} tokens | $${log.costEstimate.toFixed(5)} | ` +
        `${log.toolCalls} tools${log.error ? ` | Error: ${log.error}` : ''}`
    );

    return log;
  }
}

/**
 * Start tracking a new agent execution
 */
export function startExecution(
  db: D1Database,
  params: ExecutionStartParams
): ExecutionTracker {
  return new ExecutionTracker(db, params);
}

/**
 * Get execution logs for a user
 */
export async function getUserExecutions(
  db: D1Database,
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    agentType?: AgentType;
    status?: ExecutionStatus;
    startDate?: string;
    endDate?: string;
  }
): Promise<{ logs: ExecutionLog[]; total: number }> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let whereClause = 'WHERE user_id = ?';
  const params: any[] = [userId];

  if (options?.agentType) {
    whereClause += ' AND agent_type = ?';
    params.push(options.agentType);
  }

  if (options?.status) {
    whereClause += ' AND status = ?';
    params.push(options.status);
  }

  if (options?.startDate) {
    whereClause += ' AND created_at >= ?';
    params.push(options.startDate);
  }

  if (options?.endDate) {
    whereClause += ' AND created_at <= ?';
    params.push(options.endDate);
  }

  // Get total count
  const countResult = await db
    .prepare(`SELECT COUNT(*) as count FROM agent_executions ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();

  // Get logs
  const logs = await db
    .prepare(
      `SELECT * FROM agent_executions ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();

  return {
    logs: logs.results.map(parseLogRow),
    total: countResult?.count || 0,
  };
}

/**
 * Get aggregated stats for a user
 */
export async function getUserStats(
  db: D1Database,
  userId: string,
  period: 'day' | 'week' | 'month' = 'day'
): Promise<{
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  byAgent: Record<AgentType, { calls: number; tokens: number; cost: number }>;
  avgDurationMs: number;
  errorRate: number;
}> {
  const periodMap = {
    day: '-1 day',
    week: '-7 days',
    month: '-30 days',
  };

  const startDate = new Date();
  startDate.setDate(
    startDate.getDate() - (period === 'day' ? 1 : period === 'week' ? 7 : 30)
  );

  const stats = await db
    .prepare(
      `SELECT
         agent_type,
         COUNT(*) as calls,
         SUM(input_tokens + output_tokens) as total_tokens,
         SUM(cost_estimate) as total_cost,
         AVG(duration_ms) as avg_duration,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
       FROM agent_executions
       WHERE user_id = ? AND created_at >= ?
       GROUP BY agent_type`
    )
    .bind(userId, startDate.toISOString())
    .all();

  const byAgent: Record<AgentType, { calls: number; tokens: number; cost: number }> = {
    interaction: { calls: 0, tokens: 0, cost: 0 },
    execution: { calls: 0, tokens: 0, cost: 0 },
    proactive: { calls: 0, tokens: 0, cost: 0 },
  };

  let totalCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let totalFailed = 0;

  for (const row of stats.results) {
    const agentType = row.agent_type as AgentType;
    const calls = Number(row.calls) || 0;
    const tokens = Number(row.total_tokens) || 0;
    const cost = Number(row.total_cost) || 0;

    byAgent[agentType] = { calls, tokens, cost };
    totalCalls += calls;
    totalTokens += tokens;
    totalCost += cost;
    totalDuration += (Number(row.avg_duration) || 0) * calls;
    totalFailed += Number(row.failed_count) || 0;
  }

  return {
    totalCalls,
    totalTokens,
    totalCost,
    byAgent,
    avgDurationMs: totalCalls > 0 ? totalDuration / totalCalls : 0,
    errorRate: totalCalls > 0 ? totalFailed / totalCalls : 0,
  };
}

/**
 * Get executions grouped by request (for tracing)
 */
export async function getRequestTrace(
  db: D1Database,
  requestId: string
): Promise<ExecutionLog[]> {
  const logs = await db
    .prepare(
      `SELECT * FROM agent_executions
       WHERE request_id = ?
       ORDER BY created_at ASC`
    )
    .bind(requestId)
    .all();

  return logs.results.map(parseLogRow);
}

function parseLogRow(row: any): ExecutionLog {
  return {
    id: row.id,
    userId: row.user_id,
    requestId: row.request_id,
    agentType: row.agent_type as AgentType,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    toolCalls: row.tool_calls,
    durationMs: row.duration_ms,
    costEstimate: row.cost_estimate,
    goal: row.goal,
    status: row.status as ExecutionStatus,
    error: row.error,
    parentExecutionId: row.parent_execution_id,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  };
}
