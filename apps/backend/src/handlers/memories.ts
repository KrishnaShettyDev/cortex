/**
 * Memory route handlers
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import {
  createMemory,
  getMemory,
  getMemories,
  updateMemory,
  deleteMemory,
  searchMemories,
} from '../memory';
import { chat, chatWithHistory, chatWithActions, confirmAction, cancelAction } from '../chat';
import { createRouter, type AgentContext } from '../agents';
import { handleError } from '../utils/errors';

function getUserId(c: Context): string {
  return c.get('jwtPayload').sub;
}

/**
 * Detect if a message is a direct MCP tool query that can skip the interaction agent
 * Returns the query type and a pre-formatted goal for faster execution
 */
function detectDirectMCPQuery(message: string): { type: string; goal: string } | null {
  const lowerMessage = message.toLowerCase();

  // Crypto price queries
  if (/\b(bitcoin|btc|eth|ethereum|crypto|sol|solana|xrp|doge)\b.*\b(price|trading|worth|cost|value)\b/i.test(message) ||
      /\b(price|trading|worth|cost|value)\b.*\b(bitcoin|btc|eth|ethereum|crypto|sol|solana|xrp|doge)\b/i.test(message) ||
      /what('s| is)?\s+(bitcoin|btc|eth|ethereum)\s*(at|price)?/i.test(message)) {
    // Extract the crypto symbol
    let symbol = 'BTC';
    if (/\beth(ereum)?\b/i.test(message)) symbol = 'ETH';
    else if (/\bsol(ana)?\b/i.test(message)) symbol = 'SOL';
    else if (/\bxrp\b/i.test(message)) symbol = 'XRP';
    else if (/\bdoge\b/i.test(message)) symbol = 'DOGE';

    return {
      type: 'crypto_price',
      goal: `Get the current price of ${symbol} using the crypto MCP server. Use instrument format ${symbol}USD or ${symbol}USDT (no slashes).`,
    };
  }

  return null;
}

export async function listMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const source = c.req.query('source');

    const result = await getMemories(c.env.DB, userId, {
      limit,
      offset,
      source: source || undefined,
    });

    return c.json(result);
  });
}

export async function getMemoryById(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');

    const memory = await getMemory(c.env.DB, memoryId, userId);

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    return c.json(memory);
  });
}

export async function createNewMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const body = await c.req.json();

    const memory = await createMemory(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.AI
    );

    return c.json(memory, 201);
  });
}

export async function updateExistingMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');
    const body = await c.req.json();

    const memory = await updateMemory(
      c.env.DB,
      c.env.VECTORIZE,
      memoryId,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.AI
    );

    return c.json(memory);
  });
}

export async function deleteExistingMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');

    await deleteMemory(c.env.DB, c.env.VECTORIZE, memoryId, userId);

    return c.json({ message: 'Memory deleted successfully' });
  });
}

export async function search(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const { query, limit, source } = await c.req.json();

    if (!query || query.trim().length === 0) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    const results = await searchMemories(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      query,
      c.env.AI,
      {
        limit: limit || 10,
        source: source || undefined,
      }
    );

    return c.json({ results, count: results.length });
  });
}

export async function chatWithMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const { message, history, model, contextLimit } = await c.req.json();

    if (!message || message.trim().length === 0) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // Fetch user info for personalized responses
    const user = await c.env.DB.prepare(
      'SELECT name, email FROM users WHERE id = ?'
    ).bind(userId).first<{ name: string | null; email: string }>();

    const result = history
      ? await chatWithHistory(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          history,
          c.env.OPENAI_API_KEY,
          c.env.AI,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
            userName: user?.name || undefined,
            userEmail: user?.email,
          }
        )
      : await chat(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          c.env.OPENAI_API_KEY,
          c.env.AI,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
          }
        );

    return c.json(result);
  });
}

/**
 * Chat with action support (Iris/Poke-style)
 * Parses natural language for calendar/email actions
 *
 * When MULTI_AGENT_ENABLED=true, uses the new multi-agent orchestration system:
 * - Interaction Agent: Handles conversation, personality, memory context
 * - Execution Agent: Executes actions via Composio (email, calendar, etc.)
 */
export async function chatWithActionsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const { message, history, model, contextLimit, autoExecuteQueries } = await c.req.json();

    if (!message || message.trim().length === 0) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // Fetch user info for personalized responses
    const user = await c.env.DB.prepare(
      'SELECT name, email FROM users WHERE id = ?'
    ).bind(userId).first<{ name: string | null; email: string }>();

    // Check if multi-agent system is enabled
    const multiAgentEnabled = c.env.MULTI_AGENT_ENABLED === 'true';

    if (multiAgentEnabled) {
      // Use new multi-agent orchestration system
      const requestId = crypto.randomUUID();

      const agentContext: AgentContext = {
        userId,
        userName: user?.name || undefined,
        userEmail: user?.email,
        timezone: 'UTC', // TODO: Add timezone column to users table
        requestId,
      };

      try {
        const router = createRouter(c.env, agentContext);

        // Check for direct MCP tool patterns (skip interaction agent for speed)
        const directMCPPattern = detectDirectMCPQuery(message);

        let result;
        if (directMCPPattern) {
          // Fast path: Skip interaction agent, go directly to execution
          console.log(`[FastPath] Direct MCP query detected: ${directMCPPattern.type}`);
          result = await router.directExecute({
            goal: directMCPPattern.goal,
            message,
          });
        } else {
          // Normal path: Full multi-agent orchestration
          result = await router.chat({
            message,
            history,
          });
        }

        // Transform result to match existing response format
        return c.json({
          response: result.response,
          memories_used: result.memoriesUsed,
          model: 'gpt-4o', // Interaction agent uses gpt-4o
          actions: result.executionResult
            ? {
                pending: [],
                executed: [
                  {
                    action: result.delegatedGoal || 'execution',
                    success: result.executionResult.success,
                    result: result.executionResult.data,
                    error: result.executionResult.error,
                    message: result.executionResult.success
                      ? 'Action completed successfully'
                      : result.executionResult.error || 'Action failed',
                  },
                ],
              }
            : undefined,
          _multiAgent: true, // Flag to indicate multi-agent system was used
          _requestId: requestId,
        });
      } catch (error) {
        console.error('[MultiAgent] Chat failed, falling back to legacy:', error);
        // Fall through to legacy system on error
      }
    }

    // Legacy single-agent system
    const result = await chatWithActions(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      message,
      c.env.OPENAI_API_KEY,
      c.env.COMPOSIO_API_KEY,
      c.env.AI,
      {
        model: model || 'gpt-4o-mini',
        contextLimit: contextLimit || 5,
        autoExecuteQueries: autoExecuteQueries ?? true,
        history,
        userName: user?.name || undefined,
        userEmail: user?.email,
      }
    );

    return c.json(result);
  });
}

/**
 * Confirm and execute a pending action
 */
export async function confirmActionHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const actionId = c.req.param('id');

    if (!actionId) {
      return c.json({ error: 'Action ID is required' }, 400);
    }

    const result = await confirmAction(
      c.env.DB,
      userId,
      actionId,
      c.env.COMPOSIO_API_KEY
    );

    return c.json(result);
  });
}

/**
 * Cancel a pending action
 */
export async function cancelActionHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const actionId = c.req.param('id');

    if (!actionId) {
      return c.json({ error: 'Action ID is required' }, 400);
    }

    const result = await cancelAction(c.env.DB, userId, actionId);

    return c.json(result);
  });
}
