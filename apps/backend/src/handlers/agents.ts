/**
 * Agent management handlers
 *
 * Endpoints for viewing agent stats, configurations, and execution history.
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import {
  getAgentConfig,
  getAllAgentConfigs,
  upsertAgentConfig,
  deleteUserConfig,
  getUserStats,
  getUserExecutions,
  getRequestTrace,
  type AgentType,
  type TemplateContext,
} from '../agents';
import { handleError } from '../utils/errors';

function getUserId(c: Context): string {
  return c.get('jwtPayload').sub;
}

function getUser(c: Context): { id: string; name?: string; email?: string; timezone?: string } {
  const payload = c.get('jwtPayload');
  return {
    id: payload.sub,
    name: payload.name,
    email: payload.email,
  };
}

/**
 * GET /v3/agents/stats
 * Get agent usage stats for the current user
 */
export async function getAgentStatsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const period = (c.req.query('period') || 'day') as 'day' | 'week' | 'month';

    const stats = await getUserStats(c.env.DB, userId, period);

    return c.json({
      period,
      stats,
    });
  });
}

/**
 * GET /v3/agents/executions
 * Get agent execution history for the current user
 */
export async function getAgentExecutionsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const agentType = c.req.query('agent_type') as AgentType | undefined;
    const status = c.req.query('status') as any;

    const { logs, total } = await getUserExecutions(c.env.DB, userId, {
      limit,
      offset,
      agentType,
      status,
    });

    return c.json({
      executions: logs,
      total,
      limit,
      offset,
    });
  });
}

/**
 * GET /v3/agents/executions/:requestId/trace
 * Get full execution trace for a request
 */
export async function getExecutionTraceHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const requestId = c.req.param('requestId');

    if (!requestId) {
      return c.json({ error: 'Request ID is required' }, 400);
    }

    const trace = await getRequestTrace(c.env.DB, requestId);

    // Verify user owns this trace
    const userId = getUserId(c);
    if (trace.length > 0 && trace[0].userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    return c.json({
      requestId,
      executions: trace,
      totalDurationMs: trace.reduce((sum, t) => sum + t.durationMs, 0),
      totalCost: trace.reduce((sum, t) => sum + t.costEstimate, 0),
    });
  });
}

/**
 * GET /v3/agents/configs
 * Get all agent configs for the current user
 */
export async function getAgentConfigsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);

    // Fetch user info for template context
    const user = await c.env.DB
      .prepare('SELECT name, email, timezone FROM users WHERE id = ?')
      .bind(userId)
      .first<{ name: string | null; email: string; timezone?: string }>();

    const templateContext: TemplateContext = {
      userName: user?.name || 'there',
      userEmail: user?.email || '',
      currentDate: new Date().toLocaleDateString('en-US'),
      currentTime: new Date().toLocaleTimeString('en-US'),
      timezone: user?.timezone,
    };

    const configs = await getAllAgentConfigs(c.env.DB, userId, templateContext);

    // Convert Map to object
    const configsObject: Record<string, any> = {};
    configs.forEach((config, agentType) => {
      configsObject[agentType] = {
        ...config,
        // Don't expose full system prompt to client
        systemPrompt: undefined,
        systemPromptPreview: config.systemPrompt.substring(0, 200) + '...',
      };
    });

    return c.json({
      configs: configsObject,
      multiAgentEnabled: c.env.MULTI_AGENT_ENABLED === 'true',
    });
  });
}

/**
 * GET /v3/agents/configs/:agentType
 * Get specific agent config
 */
export async function getAgentConfigHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const agentType = c.req.param('agentType') as AgentType;

    if (!['interaction', 'execution', 'proactive'].includes(agentType)) {
      return c.json({ error: 'Invalid agent type' }, 400);
    }

    const config = await getAgentConfig(c.env.DB, agentType, userId);

    if (!config) {
      return c.json({ error: 'Config not found' }, 404);
    }

    return c.json({
      config: {
        ...config,
        // Include full system prompt for this endpoint
      },
      isUserOverride: config.userId !== null,
    });
  });
}

/**
 * PATCH /v3/agents/configs/:agentType
 * Update agent config for the current user (creates user override if needed)
 */
export async function updateAgentConfigHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const agentType = c.req.param('agentType') as AgentType;

    if (!['interaction', 'execution', 'proactive'].includes(agentType)) {
      return c.json({ error: 'Invalid agent type' }, 400);
    }

    const body = await c.req.json();

    // Validate allowed fields
    const allowedFields = ['systemPrompt', 'model', 'temperature', 'maxTokens', 'metadata'];
    const updates: any = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }

    const config = await upsertAgentConfig(c.env.DB, userId, agentType, updates);

    return c.json({
      config,
      message: 'Config updated successfully',
    });
  });
}

/**
 * DELETE /v3/agents/configs/:agentType
 * Delete user-specific config override (reverts to global default)
 */
export async function deleteAgentConfigHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const agentType = c.req.param('agentType') as AgentType;

    if (!['interaction', 'execution', 'proactive'].includes(agentType)) {
      return c.json({ error: 'Invalid agent type' }, 400);
    }

    await deleteUserConfig(c.env.DB, userId, agentType);

    return c.json({
      message: 'Config override deleted. Using global default.',
    });
  });
}

/**
 * GET /v3/agents/status
 * Get multi-agent system status
 */
export async function getAgentStatusHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const multiAgentEnabled = c.env.MULTI_AGENT_ENABLED === 'true';

    // Check if agent_configs table exists and has defaults
    let hasConfigs = false;
    try {
      const count = await c.env.DB
        .prepare('SELECT COUNT(*) as count FROM agent_configs WHERE user_id IS NULL')
        .first<{ count: number }>();
      hasConfigs = (count?.count || 0) >= 3;
    } catch {
      // Table doesn't exist yet
    }

    return c.json({
      multiAgentEnabled,
      configsReady: hasConfigs,
      agents: ['interaction', 'execution', 'proactive'],
      features: {
        memoryEnrichment: true,
        toolExecution: true,
        costTracking: true,
        executionLogging: true,
      },
    });
  });
}
