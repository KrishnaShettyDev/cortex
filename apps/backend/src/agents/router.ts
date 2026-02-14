/**
 * Agent Router
 *
 * Orchestrates between Interaction and Execution agents.
 * The Interaction agent handles user conversation and delegates to Execution for actions.
 */

import type { Bindings } from '../types';
import type { AgentContext, InteractionResult, ExecutionResult, DelegateToExecutionParams } from './types';
import { getAgentConfig, type AgentConfig, type TemplateContext, clearConfigCache } from './config';
import { startExecution, type ExecutionTracker } from './logger';
import { searchMemories } from '../memory';
import {
  withTimeout,
  withFallback,
  withRetry,
  checkRateLimit,
  getCircuitBreaker,
  sanitizeToolArgs,
  validateGoal,
} from './safety';
import { sanitizeForPrompt, detectInjectionAttempt } from '../lib/sanitize';
import { parseTriggerInput } from '../lib/triggers/parser';
import { createTrigger, getUserTriggers, deleteTrigger } from '../lib/triggers/executor';
import {
  getUserMCPIntegrations,
  registerMCPIntegration,
  deleteMCPIntegration,
  discoverCapabilities,
  executeTool as mcpExecuteTool,
  type MCPIntegration,
  type MCPTool,
} from '../lib/mcp/integrations';
import { getUserContext, formatContextForPrompt, type UserContext } from '../lib/context';

export interface RouterOptions {
  env: Bindings;
  context: AgentContext;
}

export interface ChatInput {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Agent Router - main orchestration layer
 */
export class AgentRouter {
  private env: Bindings;
  private context: AgentContext;
  private interactionConfig: AgentConfig | null = null;
  private executionConfig: AgentConfig | null = null;
  // Cache for connected account ID (per request)
  private cachedConnectionId: string | null = null;
  private connectionCacheChecked = false;
  // Cache for MCP integrations (per request)
  private cachedMCPIntegrations: MCPIntegration[] | null = null;
  // Cache for user context (per request)
  private cachedUserContext: UserContext | null = null;

  constructor(options: RouterOptions) {
    this.env = options.env;
    this.context = options.context;
  }

  /**
   * Get cached Google connection ID (avoids repeated DB lookups)
   */
  private async getGoogleConnectionId(): Promise<string | null> {
    if (this.connectionCacheChecked) {
      return this.cachedConnectionId;
    }

    const integration = await this.env.DB
      .prepare(
        `SELECT access_token FROM integrations
         WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1`
      )
      .bind(this.context.userId)
      .first<{ access_token: string }>();

    this.cachedConnectionId = integration?.access_token || null;
    this.connectionCacheChecked = true;
    return this.cachedConnectionId;
  }

  /**
   * Get cached MCP integrations for the user
   * NOTE: Does NOT cache failures - allows retry on next request
   */
  private async getMCPIntegrations(): Promise<MCPIntegration[]> {
    if (this.cachedMCPIntegrations !== null) {
      return this.cachedMCPIntegrations;
    }

    try {
      this.cachedMCPIntegrations = await getUserMCPIntegrations(this.env.DB, this.context.userId);
      return this.cachedMCPIntegrations;
    } catch (error) {
      console.error('[Router] Failed to load MCP integrations:', error);
      // Don't cache failure - allow retry on next request
      // Return empty array for this request only
      return [];
    }
  }

  /**
   * Get active MCP tools from user's integrations
   */
  private async getActiveMCPTools(): Promise<Array<{ integration: MCPIntegration; tool: MCPTool }>> {
    const integrations = await this.getMCPIntegrations();
    const activeTools: Array<{ integration: MCPIntegration; tool: MCPTool }> = [];

    for (const integration of integrations) {
      if (!integration.isActive) continue;
      if (!integration.capabilities?.tools) continue;

      for (const tool of integration.capabilities.tools) {
        activeTools.push({ integration, tool });
      }
    }

    return activeTools;
  }

  /**
   * Initialize the router by loading agent configs
   */
  async initialize(): Promise<void> {
    clearConfigCache();

    const templateContext: TemplateContext = {
      userName: this.context.userName || 'there',
      userEmail: this.context.userEmail || '',
      currentDate: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: this.context.timezone || 'UTC',
      }),
      currentTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: this.context.timezone || 'UTC',
      }),
      timezone: this.context.timezone,
    };

    this.interactionConfig = await getAgentConfig(
      this.env.DB,
      'interaction',
      this.context.userId,
      templateContext
    );

    this.executionConfig = await getAgentConfig(
      this.env.DB,
      'execution',
      this.context.userId,
      templateContext
    );

    if (!this.interactionConfig || !this.executionConfig) {
      throw new Error('Failed to load agent configs');
    }

    // PERFORMANCE: Force gpt-4o-mini for both agents (faster, cheaper)
    // gpt-4o is overkill for most tasks and adds 1-2s per call
    this.interactionConfig.model = 'gpt-4o-mini';
    this.executionConfig.model = 'gpt-4o-mini';
  }

  /**
   * Main chat handler - routes through Interaction agent
   */
  async chat(input: ChatInput): Promise<InteractionResult> {
    if (!this.interactionConfig) {
      await this.initialize();
    }

    // Check rate limits
    const rateLimits = this.interactionConfig!.metadata.rateLimits;
    if (rateLimits) {
      const rateCheck = await checkRateLimit(
        this.env.DB,
        this.context.userId,
        'interaction',
        rateLimits
      );

      if (!rateCheck.allowed) {
        throw new Error(`Rate limit exceeded: ${rateCheck.reason}. Resets at ${rateCheck.resetAt}`);
      }
    }

    const tracker = startExecution(this.env.DB, {
      userId: this.context.userId,
      requestId: this.context.requestId,
      agentType: 'interaction',
      model: this.interactionConfig!.model,
    });

    try {
      // Apply timeout from config
      const timeoutMs = this.interactionConfig!.metadata.timeoutMs || 45000;

      const result = await withTimeout(
        () => this.runInteractionAgent(input, tracker),
        timeoutMs,
        'Chat request timed out'
      );

      await tracker.end({
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        toolCalls: result.toolCalls || 0,
        status: 'completed',
      });

      return {
        response: result.response,
        memoriesUsed: result.memoriesUsed,
        delegatedGoal: result.delegatedGoal,
        executionResult: result.executionResult,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');

      await tracker.end({
        inputTokens: 0,
        outputTokens: 0,
        status: isTimeout ? 'timeout' : 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Direct execution - skips interaction agent for speed
   * Used for known MCP tool patterns (crypto prices, etc.)
   */
  async directExecute(input: { goal: string; message: string }): Promise<InteractionResult> {
    if (!this.executionConfig) {
      await this.initialize();
    }

    console.log(`[Router] Direct execute: ${input.goal}`);

    // Modify the goal to explicitly request natural language formatting
    const goalWithFormatting = `${input.goal}

IMPORTANT: After getting the data, respond with a natural, conversational answer.
Do NOT return raw JSON. Format the result as a friendly message the user can read.
Example: "Bitcoin is currently trading at $70,423.20" NOT {"price": "70423.20"}`;

    const executionResult = await this.runExecutionAgent({
      goal: goalWithFormatting,
      context: { originalMessage: input.message },
    });

    // Use the execution agent's formatted message if available
    let response: string;
    if (executionResult.success && executionResult.data) {
      // The execution agent should return a formatted message
      if (executionResult.data.message && typeof executionResult.data.message === 'string') {
        response = executionResult.data.message;
      } else if (executionResult.data.summary) {
        response = executionResult.data.summary;
      } else {
        // Fallback: try to format from tool results
        const toolResults = executionResult.data.toolResults || executionResult.data;
        response = this.formatToolResultsAsResponse(toolResults, input.message);
      }
    } else {
      response = executionResult.error || 'Unable to get the information right now.';
    }

    return {
      response,
      memoriesUsed: 0,
      delegatedGoal: input.goal,
      executionResult,
    };
  }

  /**
   * Format raw tool results into a human-readable response
   */
  private formatToolResultsAsResponse(toolResults: any, originalMessage: string): string {
    // Check for crypto price data
    if (toolResults) {
      // Handle mcp_crypto_get_index_price result
      const priceData = toolResults.mcp_crypto_get_index_price ||
                        toolResults.mcp_crypto_get_ticker ||
                        toolResults;

      if (priceData?.structuredContent?.price) {
        const price = parseFloat(priceData.structuredContent.price);
        const instrument = priceData.structuredContent.instrument_name || 'BTC';
        const symbol = instrument.replace(/USD.*/, '');
        return `${symbol} is currently trading at $${price.toLocaleString()}.`;
      }

      if (priceData?.structuredContent?.last) {
        const price = parseFloat(priceData.structuredContent.last);
        const instrument = priceData.structuredContent.instrument_name || 'BTC';
        const symbol = instrument.replace(/USD.*/, '');
        return `${symbol} is currently at $${price.toLocaleString()}.`;
      }
    }

    // Generic fallback - shouldn't reach here if agent formats properly
    return `Here's what I found: ${JSON.stringify(toolResults).slice(0, 300)}...`;
  }

  /**
   * Run the Interaction agent with tool use support
   */
  private async runInteractionAgent(
    input: ChatInput,
    tracker: ExecutionTracker
  ): Promise<{
    response: string;
    memoriesUsed: number;
    delegatedGoal?: string;
    executionResult?: ExecutionResult;
    usage?: { inputTokens: number; outputTokens: number };
    toolCalls?: number;
  }> {
    const config = this.interactionConfig!;
    let memoriesUsed = 0;
    let delegatedGoal: string | undefined;
    let executionResult: ExecutionResult | undefined;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Get user context for proactive awareness (cached per request)
    if (!this.cachedUserContext) {
      try {
        this.cachedUserContext = await getUserContext(this.env.DB, this.context.userId);
      } catch (error) {
        console.warn('[Router] Failed to load user context:', error);
      }
    }

    // Build system prompt with user context
    let enhancedSystemPrompt = config.systemPrompt;
    if (this.cachedUserContext) {
      const contextBlock = formatContextForPrompt(this.cachedUserContext, this.context.userName);
      if (contextBlock) {
        enhancedSystemPrompt = `${config.systemPrompt}\n\n${contextBlock}`;
      }
    }

    // Build messages
    const messages: OpenAIMessage[] = [
      { role: 'system', content: enhancedSystemPrompt },
    ];

    // Add history (sanitized)
    if (input.history) {
      for (const msg of input.history.slice(-10)) {
        messages.push({ role: msg.role, content: sanitizeForPrompt(msg.content, 2000) });
      }
    }

    // Add current message (sanitized)
    const sanitizedMessage = sanitizeForPrompt(input.message, 4000);

    // Log if injection attempt detected (for monitoring)
    if (detectInjectionAttempt(input.message)) {
      console.warn(`[Security] Potential injection attempt detected for user ${this.context.userId}`);
    }

    messages.push({ role: 'user', content: sanitizedMessage });

    // Define tools
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'search_memories',
          description: 'Search the user\'s memories for relevant information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default: 5)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'delegate_to_execution',
          description: 'REQUIRED for any task involving: web searches, finding places/restaurants, emails, calendar, integrations, triggers, or external actions. You CANNOT access the internet, Gmail, Google Calendar, MCP integrations, or external services directly - you MUST delegate using this tool. Use for: WEB SEARCH (finding information online, looking up facts, finding restaurants/places, getting current prices, news, reviews), reading/sending/searching emails, checking/creating/updating calendar events, managing integrations, creating reminders/triggers. ALWAYS delegate these tasks - never say "I can\'t search the web" or "I don\'t have access".',
          parameters: {
            type: 'object',
            properties: {
              goal: { type: 'string', description: 'Clear, specific description of what needs to be done. For web searches, include the search query. For emails, include addresses, subjects. For calendar, include dates/times.' },
              context: { type: 'object', description: 'Additional structured context like { "query": "best restaurants in NYC", "date": "2024-01-15" }' },
            },
            required: ['goal'],
          },
        },
      },
    ];

    // Agentic loop - process tool calls until we get a final response
    const maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      const response = await this.callOpenAI(messages, config, tools);
      totalInputTokens += response.usage.prompt_tokens;
      totalOutputTokens += response.usage.completion_tokens;

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      // If no tool calls, we have our final response
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          response: assistantMessage.content || '',
          memoriesUsed,
          delegatedGoal,
          executionResult,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          toolCalls: totalToolCalls,
        };
      }

      // Process tool calls
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        totalToolCalls++;
        const args = JSON.parse(toolCall.function.arguments);
        let toolResult: string;

        switch (toolCall.function.name) {
          case 'search_memories': {
            const memories = await searchMemories(
              this.env.DB,
              this.env.VECTORIZE,
              this.context.userId,
              args.query,
              this.env.AI,
              { limit: args.limit || 5 }
            );
            memoriesUsed += memories.length;

            if (memories.length === 0) {
              toolResult = 'No relevant memories found.';
            } else {
              toolResult = memories
                .map((m, i) => {
                  const date = new Date(m.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  });
                  return `${i + 1}. (${date}) ${m.content}`;
                })
                .join('\n');
            }
            break;
          }

          case 'delegate_to_execution': {
            console.log('[Router] Delegation requested:', { goal: args.goal, context: args.context });
            delegatedGoal = args.goal;
            const execResult = await this.runExecutionAgent({
              goal: args.goal,
              context: args.context,
            });
            executionResult = execResult;
            console.log('[Router] Execution result:', { success: execResult.success, error: execResult.error, toolsCalled: execResult.toolCallsMade });

            toolResult = JSON.stringify(execResult);
            break;
          }

          default:
            toolResult = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
        }

        messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
        });
      }
    }

    // If we hit max iterations, return what we have
    return {
      response: 'I apologize, but I encountered an issue processing your request. Could you try rephrasing?',
      memoriesUsed,
      delegatedGoal,
      executionResult,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      toolCalls: totalToolCalls,
    };
  }

  /**
   * Run the Execution agent for a specific goal
   */
  private async runExecutionAgent(params: DelegateToExecutionParams): Promise<ExecutionResult> {
    const config = this.executionConfig!;

    // Validate the goal for safety
    const goalValidation = validateGoal(params.goal);
    if (!goalValidation.valid) {
      return {
        success: false,
        toolCallsMade: [],
        error: goalValidation.reason || 'Invalid goal',
      };
    }

    // Check rate limits for execution agent
    const rateLimits = config.metadata.rateLimits;
    if (rateLimits) {
      const rateCheck = await checkRateLimit(
        this.env.DB,
        this.context.userId,
        'execution',
        rateLimits
      );

      if (!rateCheck.allowed) {
        return {
          success: false,
          toolCallsMade: [],
          error: `Execution rate limit exceeded: ${rateCheck.reason}`,
        };
      }
    }

    const tracker = startExecution(this.env.DB, {
      userId: this.context.userId,
      requestId: this.context.requestId,
      agentType: 'execution',
      model: config.model,
      goal: params.goal,
      parentExecutionId: this.context.requestId,
    });

    try {
      // Apply timeout from config
      const timeoutMs = config.metadata.timeoutMs || 45000;

      const result = await withTimeout(
        () => this.executeGoal(params, config),
        timeoutMs,
        'Execution timed out'
      );

      await tracker.end({
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        toolCalls: result.toolCallsMade.length,
        status: result.success ? 'completed' : 'failed',
        error: result.error,
      });

      return {
        success: result.success,
        data: result.data,
        toolCallsMade: result.toolCallsMade,
        error: result.error,
        needsInput: result.needsInput,
        question: result.question,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');

      await tracker.end({
        inputTokens: 0,
        outputTokens: 0,
        status: isTimeout ? 'timeout' : 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        toolCallsMade: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a specific goal using the Execution agent
   */
  private async executeGoal(
    params: DelegateToExecutionParams,
    config: AgentConfig
  ): Promise<ExecutionResult & { usage?: { inputTokens: number; outputTokens: number } }> {
    const tools = await this.getExecutionTools();
    const toolCallsMade: string[] = [];
    const toolResults: Record<string, any> = {}; // Store tool results for rich content rendering
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Sanitize goal and context for prompt injection protection
    const sanitizedGoal = sanitizeForPrompt(params.goal, 2000);
    const sanitizedContext = params.context
      ? Object.fromEntries(
          Object.entries(params.context).map(([k, v]) => [
            k,
            typeof v === 'string' ? sanitizeForPrompt(v, 500) : v,
          ])
        )
      : {};

    const messages: OpenAIMessage[] = [
      { role: 'system', content: config.systemPrompt },
      {
        role: 'user',
        content: `GOAL: ${sanitizedGoal}\n\nCONTEXT: ${JSON.stringify(sanitizedContext)}`,
      },
    ];

    // Reduced from 10 to 5 - prevents long retry loops
    // With format hints in tool descriptions, fewer retries needed
    const maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      const response = await this.callOpenAI(messages, config, tools);
      totalInputTokens += response.usage.prompt_tokens;
      totalOutputTokens += response.usage.completion_tokens;

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      // If no tool calls, parse the final response
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        try {
          const content = assistantMessage.content || '{}';
          // Try to extract JSON from the response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return {
              success: result.success ?? true,
              data: { ...result.data, toolResults: Object.keys(toolResults).length > 0 ? toolResults : undefined },
              toolCallsMade,
              error: result.error,
              needsInput: result.needs_input,
              question: result.question,
              usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            };
          }
          // If no JSON found, treat as success with content as data
          return {
            success: true,
            data: { message: content, toolResults: Object.keys(toolResults).length > 0 ? toolResults : undefined },
            toolCallsMade,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          };
        } catch {
          return {
            success: true,
            data: { message: assistantMessage.content, toolResults: Object.keys(toolResults).length > 0 ? toolResults : undefined },
            toolCallsMade,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          };
        }
      }

      // Process tool calls
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        toolCallsMade.push(toolCall.function.name);
        const args = JSON.parse(toolCall.function.arguments);
        let toolResult: string;

        try {
          toolResult = await this.executeToolCall(toolCall.function.name, args);
        } catch (error) {
          toolResult = JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool execution failed',
          });
        }

        // Truncate tool results to prevent context overflow
        // gpt-4o-mini has 128k context, ~4 chars per token, leave room for system/user messages
        const MAX_TOOL_RESULT_CHARS = 80000; // ~20k tokens max per tool result
        if (toolResult.length > MAX_TOOL_RESULT_CHARS) {
          console.warn(`[Router] Truncating ${toolCall.function.name} result from ${toolResult.length} to ${MAX_TOOL_RESULT_CHARS} chars`);
          // Try to parse and truncate intelligently
          try {
            const parsed = JSON.parse(toolResult);
            // If it's an array (like email list), truncate the array
            if (Array.isArray(parsed)) {
              const truncated = parsed.slice(0, 10); // Keep first 10 items
              toolResult = JSON.stringify({
                items: truncated,
                _truncated: true,
                _originalCount: parsed.length,
                _warning: `IMPORTANT: This result was truncated. Only showing 10 of ${parsed.length} total items. The user may have more items that are not shown here. If you need more specific results, ask the user to refine their query.`,
              });
            } else if (parsed.data && Array.isArray(parsed.data)) {
              const truncated = parsed.data.slice(0, 10);
              toolResult = JSON.stringify({
                ...parsed,
                data: truncated,
                _truncated: true,
                _originalCount: parsed.data.length,
                _warning: `IMPORTANT: This result was truncated. Only showing 10 of ${parsed.data.length} total items. Ask for more specific queries to see other items.`,
              });
            } else {
              // Object too large - truncate and warn
              const truncatedStr = toolResult.substring(0, MAX_TOOL_RESULT_CHARS);
              toolResult = JSON.stringify({
                _truncated: true,
                _warning: 'IMPORTANT: This result was truncated due to size. Some information may be missing.',
                partialContent: truncatedStr.substring(0, 5000) + '...',
              });
            }
          } catch {
            // Not JSON, just truncate with clear warning
            toolResult = JSON.stringify({
              _truncated: true,
              _warning: 'IMPORTANT: This result was truncated due to size. Some information may be missing.',
              partialContent: toolResult.substring(0, 5000) + '...',
            });
          }
        }

        messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
        });

        // Store tool result for rich content rendering on frontend
        try {
          const parsedResult = JSON.parse(toolResult);
          if (parsedResult._tool) {
            // If tool marked itself with _tool, store for frontend rendering
            toolResults[parsedResult._tool] = parsedResult;
          } else if (parsedResult.emails) {
            // Email results
            toolResults['search_emails'] = parsedResult;
          } else if (parsedResult.events) {
            // Calendar results
            toolResults['get_calendar_events'] = parsedResult;
          } else if (parsedResult.free_slots) {
            // Free time results
            toolResults['find_free_time'] = parsedResult;
          }
        } catch {
          // Not JSON, ignore
        }
      }
    }

    return {
      success: false,
      error: 'Max iterations reached',
      toolCallsMade,
      data: Object.keys(toolResults).length > 0 ? { toolResults } : undefined,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(toolName: string, args: any): Promise<string> {
    const t0 = Date.now();

    // Tools that require Google integration
    const googleTools = ['gmail_send_email', 'gmail_create_draft', 'gmail_search', 'calendar_create_event', 'calendar_list_events', 'calendar_update_event', 'calendar_delete_event'];

    // Get integration only if needed (cached)
    let connectedAccountId: string | null = null;
    if (googleTools.includes(toolName)) {
      connectedAccountId = await this.getGoogleConnectionId();
      console.log(`[Perf] ${toolName} - Get connection (cached): ${Date.now() - t0}ms`);

      if (!connectedAccountId) {
        return JSON.stringify({ error: 'Google integration not connected. Please connect your Google account.' });
      }
    }

    switch (toolName) {
      case 'gmail_send_email':
        return this.composioExecute('GMAIL_SEND_EMAIL', connectedAccountId!, {
          recipient_email: args.recipient_email,
          subject: args.subject,
          body: args.body,
          cc: args.cc,
        });

      case 'gmail_create_draft':
        return this.composioExecute('GMAIL_CREATE_EMAIL_DRAFT', connectedAccountId!, {
          recipient_email: args.recipient_email,
          subject: args.subject,
          body: args.body,
        });

      case 'gmail_search': {
        // Limit results to prevent context overflow - emails can be very large
        const emailsResult = await this.composioExecute('GMAIL_FETCH_EMAILS', connectedAccountId!, {
          query: args.query,
          max_results: Math.min(args.max_results || 5, 10), // Default 5, max 10
        });

        // Transform the response to include structured email data for rich UI rendering
        try {
          const parsed = JSON.parse(emailsResult);

          // Handle different Composio response formats
          const rawEmails = parsed.data?.emails || parsed.emails || parsed.data || [];

          // Helper to extract header value from Gmail API format
          const getHeader = (email: any, name: string): string => {
            const headers = email.payload?.headers || email.headers || [];
            const header = headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase());
            return header?.value || '';
          };

          if (Array.isArray(rawEmails) && rawEmails.length > 0) {
            const transformedEmails = rawEmails.map((email: any) => ({
              id: email.id || email.messageId || '',
              thread_id: email.threadId || email.thread_id || '',
              subject: email.subject || getHeader(email, 'Subject') || '(no subject)',
              from: email.from || email.sender || getHeader(email, 'From') || 'Unknown',
              to: email.to ? (Array.isArray(email.to) ? email.to : [email.to]) : [],
              date: email.date || getHeader(email, 'Date') || email.internalDate || email.receivedDateTime || new Date().toISOString(),
              snippet: email.snippet || email.bodyPreview || (email.body ? email.body.substring(0, 200) : ''),
              body: email.body || email.bodyText || '',
              is_unread: email.labelIds?.includes('UNREAD') || !email.isRead,
              is_starred: email.labelIds?.includes('STARRED') || email.isStarred,
              is_important: email.labelIds?.includes('IMPORTANT') || email.importance === 'high',
              labels: email.labelIds || email.labels || [],
              attachment_count: email.attachments?.length || email.hasAttachments ? 1 : 0,
            }));

            return JSON.stringify({
              success: true,
              emails: transformedEmails,
              count: transformedEmails.length,
              _tool: 'search_emails', // Marker for rich content detection
            });
          }

          return emailsResult;
        } catch {
          return emailsResult;
        }
      }

      case 'calendar_create_event':
        return this.composioExecute('GOOGLECALENDAR_CREATE_EVENT', connectedAccountId!, {
          summary: args.summary,
          start_datetime: args.start_time,
          end_datetime: args.end_time,
          description: args.description,
          attendees: args.attendees?.join(','),
          location: args.location,
        });

      case 'calendar_list_events':
        return this.composioExecute('GOOGLECALENDAR_EVENTS_LIST', connectedAccountId!, {
          time_min: args.time_min || new Date().toISOString(),
          time_max: args.time_max,
          max_results: args.max_results || 10,
        });

      case 'calendar_update_event':
        return this.composioExecute('GOOGLECALENDAR_UPDATE_EVENT', connectedAccountId!, {
          event_id: args.event_id,
          summary: args.summary,
          start_datetime: args.start_time,
          end_datetime: args.end_time,
          description: args.description,
        });

      case 'calendar_delete_event':
        return this.composioExecute('GOOGLECALENDAR_DELETE_EVENT', connectedAccountId!, {
          event_id: args.event_id,
        });

      case 'search_memories': {
        const memories = await searchMemories(
          this.env.DB,
          this.env.VECTORIZE,
          this.context.userId,
          args.query,
          this.env.AI,
          { limit: args.limit || 5 }
        );

        if (memories.length === 0) {
          return JSON.stringify({ memories: [], message: 'No relevant memories found' });
        }

        return JSON.stringify({
          memories: memories.map((m) => ({
            content: m.content,
            date: m.created_at,
            source: m.source,
          })),
        });
      }

      // Trigger management tools
      case 'create_user_trigger': {
        // Get user's timezone from preferences
        const prefs = await this.env.DB.prepare(`
          SELECT timezone FROM notification_preferences WHERE user_id = ?
        `).bind(this.context.userId).first<{ timezone: string }>();
        const userTimezone = prefs?.timezone || this.context.timezone || 'Asia/Kolkata';

        // Parse the natural language schedule
        const parseResult = await parseTriggerInput(
          args.schedule_description,
          userTimezone,
          this.env.OPENAI_API_KEY
        );

        if (!parseResult.success || !parseResult.trigger) {
          return JSON.stringify({
            success: false,
            error: parseResult.error || 'Could not parse the schedule. Please try a different format like "every weekday at 9am" or "daily at 8:30am".',
          });
        }

        const { cronExpression, humanReadable, nextTriggerAt } = parseResult.trigger;

        // Create the trigger in the database
        const triggerName = args.action.slice(0, 50); // Use action as name, truncated
        const trigger = await createTrigger(this.env.DB, this.context.userId, {
          name: triggerName,
          originalInput: `${args.schedule_description}: ${args.action}`,
          cronExpression,
          actionType: args.trigger_type || 'custom',
          actionPayload: {
            action: args.action,
            triggerType: args.trigger_type,
            humanReadable,
          },
          timezone: userTimezone,
        });

        return JSON.stringify({
          success: true,
          trigger_id: trigger.id,
          name: triggerName,
          schedule: humanReadable,
          next_run: nextTriggerAt,
          message: `Done! I'll ${args.action.toLowerCase()} ${humanReadable}. First run: ${new Date(nextTriggerAt).toLocaleString('en-US', { timeZone: userTimezone })}`,
        });
      }

      case 'list_user_triggers': {
        const triggers = await getUserTriggers(this.env.DB, this.context.userId);

        const activeTriggers = args.include_inactive
          ? triggers
          : triggers.filter((t: any) => t.isActive); // Note: camelCase from getUserTriggers

        if (activeTriggers.length === 0) {
          return JSON.stringify({
            success: true,
            triggers: [],
            message: 'You don\'t have any active reminders or scheduled tasks.',
          });
        }

        return JSON.stringify({
          success: true,
          triggers: activeTriggers.map((t: any) => ({
            id: t.id,
            name: t.name,
            schedule: t.actionPayload?.humanReadable || t.originalInput,
            next_run: t.nextTriggerAt,
            is_active: t.isActive,
            action_type: t.actionType,
          })),
          count: activeTriggers.length,
        });
      }

      case 'delete_user_trigger': {
        // If trigger_id is provided, delete directly
        if (args.trigger_id) {
          await deleteTrigger(this.env.DB, args.trigger_id, this.context.userId);
          return JSON.stringify({
            success: true,
            message: 'Trigger deleted successfully.',
          });
        }

        // Otherwise, search by name pattern
        if (args.name_pattern) {
          const triggers = await getUserTriggers(this.env.DB, this.context.userId);
          const pattern = args.name_pattern.toLowerCase();
          const matching = triggers.filter((t: any) =>
            t.name.toLowerCase().includes(pattern) ||
            (t.original_input && t.original_input.toLowerCase().includes(pattern))
          );

          if (matching.length === 0) {
            return JSON.stringify({
              success: false,
              error: `No triggers found matching "${args.name_pattern}". Use list_user_triggers to see your active triggers.`,
            });
          }

          if (matching.length === 1) {
            await deleteTrigger(this.env.DB, matching[0].id, this.context.userId);
            return JSON.stringify({
              success: true,
              message: `Deleted trigger: ${matching[0].name}`,
            });
          }

          // Multiple matches - return list for user to choose
          return JSON.stringify({
            success: false,
            multiple_matches: matching.map((t: any) => ({
              id: t.id,
              name: t.name,
            })),
            message: `Found ${matching.length} matching triggers. Please specify which one to delete by ID.`,
          });
        }

        return JSON.stringify({
          success: false,
          error: 'Please specify either a trigger_id or name_pattern to delete.',
        });
      }

      // MCP Integration management tools
      case 'add_mcp_server': {
        try {
          // Build auth config based on auth_type
          let authConfig: Record<string, any> | undefined;
          const authType = args.auth_type || 'none';

          if (authType === 'api_key' && args.auth_token) {
            authConfig = { apiKey: args.auth_token };
          } else if (authType === 'bearer' && args.auth_token) {
            authConfig = { token: args.auth_token };
          }

          const integration = await registerMCPIntegration(
            this.env.DB,
            this.context.userId,
            {
              name: args.name,
              serverUrl: args.server_url,
              authType: authType as 'none' | 'api_key' | 'bearer',
              authConfig,
            }
          );

          // Try to discover capabilities
          let discoveryResult: any = null;
          try {
            const capabilities = await discoverCapabilities(
              this.env.DB,
              this.context.userId,
              integration.id
            );
            discoveryResult = {
              tools_count: capabilities.tools?.length || 0,
              tool_names: (capabilities.tools || []).map((t: MCPTool) => t.name),
            };
          } catch (discoverError) {
            console.warn('[Router] MCP discovery failed:', discoverError);
            discoveryResult = { error: 'Discovery failed, server may be offline' };
          }

          // Clear cache to include new integration
          this.cachedMCPIntegrations = null;

          return JSON.stringify({
            success: true,
            integration_id: integration.id,
            name: integration.name,
            status: integration.healthStatus,
            discovery: discoveryResult,
            message: discoveryResult?.tools_count
              ? `Connected ${args.name} with ${discoveryResult.tools_count} tools available.`
              : `Connected ${args.name}. Discovery pending - tools will be available after server responds.`,
          });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to add MCP server',
          });
        }
      }

      case 'list_mcp_servers': {
        const integrations = await this.getMCPIntegrations();
        const filtered = args.include_inactive
          ? integrations
          : integrations.filter(i => i.isActive);

        if (filtered.length === 0) {
          return JSON.stringify({
            success: true,
            integrations: [],
            message: 'You don\'t have any connected integrations. You can connect MCP servers like Spotify, Linear, or Notion.',
          });
        }

        return JSON.stringify({
          success: true,
          integrations: filtered.map(i => ({
            id: i.id,
            name: i.name,
            status: i.healthStatus,
            is_active: i.isActive,
            tools_count: i.capabilities?.tools?.length || 0,
            tool_names: (i.capabilities?.tools || []).slice(0, 5).map((t: MCPTool) => t.name),
            last_check: i.lastHealthCheck,
          })),
          count: filtered.length,
        });
      }

      case 'remove_mcp_server': {
        // If integration_id is provided, delete directly
        if (args.integration_id) {
          const success = await deleteMCPIntegration(
            this.env.DB,
            this.context.userId,
            args.integration_id
          );

          if (!success) {
            return JSON.stringify({
              success: false,
              error: 'Integration not found.',
            });
          }

          this.cachedMCPIntegrations = null;
          return JSON.stringify({
            success: true,
            message: 'Integration removed successfully.',
          });
        }

        // Otherwise, search by name pattern
        if (args.name_pattern) {
          const integrations = await this.getMCPIntegrations();
          const pattern = args.name_pattern.toLowerCase();
          const matching = integrations.filter(i =>
            i.name.toLowerCase().includes(pattern)
          );

          if (matching.length === 0) {
            return JSON.stringify({
              success: false,
              error: `No integrations found matching "${args.name_pattern}".`,
            });
          }

          if (matching.length === 1) {
            await deleteMCPIntegration(this.env.DB, this.context.userId, matching[0].id);
            this.cachedMCPIntegrations = null;
            return JSON.stringify({
              success: true,
              message: `Removed integration: ${matching[0].name}`,
            });
          }

          return JSON.stringify({
            success: false,
            multiple_matches: matching.map(i => ({ id: i.id, name: i.name })),
            message: `Found ${matching.length} matching integrations. Please specify which one to remove.`,
          });
        }

        return JSON.stringify({
          success: false,
          error: 'Please specify either an integration_id or name_pattern to remove.',
        });
      }

      case 'web_search': {
        return this.executeWebSearch(args);
      }

      case 'search_nearby': {
        return this.executeSearchNearby(args);
      }

      default: {
        // Check if this is a dynamic MCP tool (prefixed with mcp_)
        if (toolName.startsWith('mcp_')) {
          return this.executeMCPTool(toolName, args);
        }
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    }
  }

  /**
   * Execute web search using Tavily API
   */
  private async executeWebSearch(args: { query: string; num_results?: number }): Promise<string> {
    const tavilyApiKey = this.env.TAVILY_API_KEY;

    if (!tavilyApiKey) {
      console.error('[Router] TAVILY_API_KEY not configured');
      return JSON.stringify({
        success: false,
        error: 'Web search not configured',
        message: 'Web search is not available. Please contact support.',
      });
    }

    try {
      console.log(`[Router] Web search: "${args.query}"`);
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: args.query,
          max_results: Math.min(args.num_results || 5, 10),
          include_answer: true,
          include_raw_content: false,
          search_depth: 'basic',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Router] Tavily API error:', response.status, errorText);
        return JSON.stringify({
          success: false,
          error: `Search API error: ${response.status}`,
          message: 'Web search temporarily unavailable. Please try again later.',
        });
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{
          title: string;
          url: string;
          content: string;
          score: number;
        }>;
        query: string;
      };

      // Format results for the AI
      const results = {
        success: true,
        answer: data.answer,
        results: (data.results || []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          relevance: r.score,
        })),
        query: args.query,
        count: (data.results || []).length,
        _tool: 'web_search',
      };

      console.log(`[Router] Web search found ${results.count} results`);
      return JSON.stringify(results);
    } catch (error) {
      console.error('[Router] Web search error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        message: 'Web search failed. Please try again.',
      });
    }
  }

  /**
   * Execute nearby places search
   */
  private async executeSearchNearby(args: {
    query: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    open_now?: boolean;
    limit?: number;
  }): Promise<string> {
    let latitude = args.latitude;
    let longitude = args.longitude;

    // Get user's stored location if not provided
    if (!latitude || !longitude) {
      const userLocation = await this.env.DB.prepare(`
        SELECT latitude, longitude FROM users WHERE id = ?
      `).bind(this.context.userId).first<{ latitude: number; longitude: number }>();

      if (userLocation?.latitude && userLocation?.longitude) {
        latitude = userLocation.latitude;
        longitude = userLocation.longitude;
      } else {
        return JSON.stringify({
          success: false,
          error: 'Location required',
          message: 'I need your location to search for nearby places. Please enable location access in the app settings.',
          needs_location: true,
        });
      }
    }

    // Use Tavily web search as a fallback for nearby places
    // Format the query to get location-specific results
    const locationQuery = `${args.query} near latitude ${latitude} longitude ${longitude}`;

    try {
      console.log(`[Router] Nearby search: "${args.query}" at (${latitude}, ${longitude})`);

      // Use Tavily for nearby search with location context
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.env.TAVILY_API_KEY,
          query: `best ${args.query} restaurants places ${args.open_now ? 'open now' : ''}`,
          max_results: args.limit || 5,
          include_answer: true,
          search_depth: 'basic',
        }),
      });

      if (!response.ok) {
        return JSON.stringify({
          success: false,
          error: 'Search failed',
          message: 'Unable to search for nearby places right now.',
        });
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{
          title: string;
          url: string;
          content: string;
        }>;
      };

      return JSON.stringify({
        success: true,
        answer: data.answer,
        places: (data.results || []).map(r => ({
          name: r.title,
          url: r.url,
          description: r.content,
        })),
        query: args.query,
        location: { latitude, longitude },
        _tool: 'search_nearby',
      });
    } catch (error) {
      console.error('[Router] Nearby search error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        message: 'Unable to search for nearby places.',
      });
    }
  }

  /**
   * Execute a dynamic MCP tool
   */
  private async executeMCPTool(toolName: string, args: Record<string, any>): Promise<string> {
    console.log(`[MCP Tool] Executing: ${toolName}`, { args });

    // Parse tool name: mcp_{integration_name}_{tool_name}
    const parts = toolName.split('_');
    if (parts.length < 3) {
      console.error(`[MCP Tool] Invalid tool name format: ${toolName}`);
      return JSON.stringify({ error: 'Invalid MCP tool name format' });
    }

    // Remove 'mcp' prefix and extract integration name and tool name
    parts.shift(); // Remove 'mcp'

    // Find the integration by matching the prefix
    const integrations = await this.getMCPIntegrations();
    console.log(`[MCP Tool] Found ${integrations.length} integrations for user`);

    let matchedIntegration: MCPIntegration | null = null;
    let actualToolName: string = '';

    for (const integration of integrations) {
      const normalizedName = integration.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      console.log(`[MCP Tool] Checking integration: ${integration.name} (normalized: ${normalizedName})`);
      if (toolName.startsWith(`mcp_${normalizedName}_`)) {
        matchedIntegration = integration;
        actualToolName = toolName.replace(`mcp_${normalizedName}_`, '');
        console.log(`[MCP Tool] Matched! Actual tool name: ${actualToolName}`);
        break;
      }
    }

    if (!matchedIntegration) {
      console.error(`[MCP Tool] No matching integration found for: ${toolName}`);
      return JSON.stringify({ error: `MCP integration not found for tool: ${toolName}` });
    }

    if (!matchedIntegration.isActive) {
      console.error(`[MCP Tool] Integration "${matchedIntegration.name}" is disabled`);
      return JSON.stringify({ error: `Integration "${matchedIntegration.name}" is disabled` });
    }

    // Execute the tool via MCP
    try {
      console.log(`[MCP Tool] Calling MCP server: ${matchedIntegration.serverUrl}`);
      const result = await mcpExecuteTool(
        this.env.DB,
        this.context.userId,
        matchedIntegration.id,
        actualToolName,
        args
      );

      console.log(`[MCP Tool] Result:`, { success: result.success, executionTimeMs: result.executionTimeMs });

      if (!result.success) {
        console.error(`[MCP Tool] Execution failed:`, result.error);
        return JSON.stringify({
          success: false,
          error: result.error || 'MCP tool execution failed',
        });
      }

      return JSON.stringify({
        success: true,
        result: result.result,
        execution_time_ms: result.executionTimeMs,
      });
    } catch (error) {
      console.error(`[MCP Tool] Exception:`, error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'MCP tool execution failed',
      });
    }
  }

  /**
   * Execute a Composio tool using v2 API
   */
  private async composioExecute(
    toolSlug: string,
    connectedAccountId: string,
    args: Record<string, any>
  ): Promise<string> {
    const t0 = Date.now();

    try {
      // Use the correct v2 endpoint format: /actions/{toolSlug}/execute
      const response = await fetch(
        `https://backend.composio.dev/api/v2/actions/${toolSlug}/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.env.COMPOSIO_API_KEY,
          },
          body: JSON.stringify({
            connectedAccountId,
            input: args,
          }),
        }
      );

      const fetchTime = Date.now() - t0;
      console.log(`[Perf] Composio ${toolSlug} - API call: ${fetchTime}ms`);

      if (!response.ok) {
        const error = await response.text();
        console.error(`[Composio] Tool ${toolSlug} failed:`, error);
        return JSON.stringify({ error: `Tool execution failed: ${response.status}` });
      }

      const result = await response.json();
      console.log(`[Perf] Composio ${toolSlug} - Total: ${Date.now() - t0}ms`);
      return JSON.stringify(result);
    } catch (error) {
      console.error(`[Composio] Tool ${toolSlug} error:`, error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Tool execution failed',
      });
    }
  }

  /**
   * Get execution tools definition (including dynamic MCP tools)
   */
  private async getExecutionTools() {
    // Static tools (Gmail, Calendar, Memory, Triggers)
    const staticTools = [
      {
        type: 'function' as const,
        function: {
          name: 'gmail_send_email',
          description: 'Send an email via Gmail',
          parameters: {
            type: 'object',
            properties: {
              recipient_email: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body (plain text or HTML)' },
              cc: { type: 'string', description: 'CC email addresses (comma-separated)' },
            },
            required: ['recipient_email', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'gmail_create_draft',
          description: 'Create an email draft for later review',
          parameters: {
            type: 'object',
            properties: {
              recipient_email: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body' },
            },
            required: ['recipient_email', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'gmail_search',
          description: 'Search emails in Gmail',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Gmail search query' },
              max_results: { type: 'number', description: 'Maximum results (default: 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calendar_create_event',
          description: 'Create a Google Calendar event',
          parameters: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'Event title' },
              start_time: { type: 'string', description: 'Start time (ISO 8601)' },
              end_time: { type: 'string', description: 'End time (ISO 8601)' },
              description: { type: 'string', description: 'Event description' },
              attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails' },
              location: { type: 'string', description: 'Event location' },
            },
            required: ['summary', 'start_time', 'end_time'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calendar_list_events',
          description: 'List upcoming calendar events',
          parameters: {
            type: 'object',
            properties: {
              time_min: { type: 'string', description: 'Start of time range (ISO 8601)' },
              time_max: { type: 'string', description: 'End of time range (ISO 8601)' },
              max_results: { type: 'number', description: 'Maximum events (default: 10)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calendar_update_event',
          description: 'Update an existing calendar event',
          parameters: {
            type: 'object',
            properties: {
              event_id: { type: 'string', description: 'Event ID to update' },
              summary: { type: 'string', description: 'New event title' },
              start_time: { type: 'string', description: 'New start time' },
              end_time: { type: 'string', description: 'New end time' },
              description: { type: 'string', description: 'New description' },
            },
            required: ['event_id'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calendar_delete_event',
          description: 'Delete a calendar event',
          parameters: {
            type: 'object',
            properties: {
              event_id: { type: 'string', description: 'Event ID to delete' },
            },
            required: ['event_id'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'search_memories',
          description: 'Search user memories for context',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default: 5)' },
            },
            required: ['query'],
          },
        },
      },
      // Trigger management tools
      {
        type: 'function' as const,
        function: {
          name: 'create_user_trigger',
          description: 'Create a recurring or one-time trigger/reminder for the user. Use when user says things like "remind me", "every morning", "check daily", "notify me when", "brief me at", "schedule".',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'What Cortex should do when trigger fires. Write as a goal, e.g., "Generate morning briefing with today\'s calendar and important emails"' },
              schedule_description: { type: 'string', description: 'Human-readable schedule, e.g., "every weekday at 9am", "tomorrow at 3pm", "every Monday"' },
              trigger_type: { type: 'string', enum: ['reminder', 'briefing', 'check', 'custom'], description: 'Type of trigger' },
            },
            required: ['action', 'schedule_description', 'trigger_type'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_user_triggers',
          description: 'List all active triggers/reminders for the user. Use when user asks "what reminders do I have", "show my scheduled tasks", etc.',
          parameters: {
            type: 'object',
            properties: {
              include_inactive: { type: 'boolean', description: 'Include paused/disabled triggers (default: false)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'delete_user_trigger',
          description: 'Delete or disable a trigger/reminder. Use when user says "cancel my morning briefing", "stop the daily reminder", etc.',
          parameters: {
            type: 'object',
            properties: {
              trigger_id: { type: 'string', description: 'The trigger ID to delete (if known)' },
              name_pattern: { type: 'string', description: 'Pattern to match trigger name if ID not known, e.g., "morning briefing"' },
            },
            required: [],
          },
        },
      },
      // Web search tool (uses Tavily API)
      {
        type: 'function' as const,
        function: {
          name: 'web_search',
          description: 'Search the web for current information. Use this for: finding restaurants, checking prices, getting news, looking up facts, finding reviews, or any question that requires up-to-date information from the internet.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query. Be specific and include relevant details like location if needed.' },
              num_results: { type: 'number', description: 'Number of results to return (default: 5, max: 10)' },
            },
            required: ['query'],
          },
        },
      },
      // Location-based search tool
      {
        type: 'function' as const,
        function: {
          name: 'search_nearby',
          description: 'Search for nearby places like restaurants, cafes, gyms, stores, etc. Uses the user\'s location to find relevant businesses.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'What to search for (e.g., "Italian restaurants", "coffee shops", "gym")' },
              latitude: { type: 'number', description: 'Latitude (uses stored location if not provided)' },
              longitude: { type: 'number', description: 'Longitude (uses stored location if not provided)' },
              radius: { type: 'number', description: 'Search radius in meters (default: 5000)' },
              open_now: { type: 'boolean', description: 'Only show places open now' },
              limit: { type: 'number', description: 'Max results (default: 5)' },
            },
            required: ['query'],
          },
        },
      },
      // MCP Integration management tools
      {
        type: 'function' as const,
        function: {
          name: 'add_mcp_server',
          description: 'Connect a new MCP (Model Context Protocol) server integration. Use when user says "connect my Spotify", "add Notion integration", "link my Linear".',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Display name for the integration (e.g., "Spotify", "Linear", "Notion")' },
              server_url: { type: 'string', description: 'The MCP server URL (e.g., "https://mcp.spotify.com/sse")' },
              auth_type: { type: 'string', enum: ['none', 'api_key', 'bearer'], description: 'Authentication type (default: none)' },
              auth_token: { type: 'string', description: 'API key or bearer token if auth_type requires it' },
            },
            required: ['name', 'server_url'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_mcp_servers',
          description: 'List connected MCP integrations. Use when user asks "what integrations do I have", "show my connected apps", "what services are connected".',
          parameters: {
            type: 'object',
            properties: {
              include_inactive: { type: 'boolean', description: 'Include disabled integrations (default: false)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'remove_mcp_server',
          description: 'Disconnect an MCP integration. Use when user says "remove Spotify", "disconnect Linear", "unlink Notion".',
          parameters: {
            type: 'object',
            properties: {
              integration_id: { type: 'string', description: 'The integration ID to remove (if known)' },
              name_pattern: { type: 'string', description: 'Pattern to match integration name if ID not known' },
            },
            required: [],
          },
        },
      },
    ];

    // Load dynamic MCP tools from user's active integrations
    const mcpTools: typeof staticTools = [];
    try {
      const activeMCPTools = await this.getActiveMCPTools();
      for (const { integration, tool } of activeMCPTools) {
        // Create tool definition with prefixed name to avoid conflicts
        const prefixedName = `mcp_${integration.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${tool.name}`;

        // Sanitize input schema - OpenAI requires 'properties' when type is 'object'
        const sanitizedSchema = this.sanitizeToolSchema(tool.inputSchema);

        mcpTools.push({
          type: 'function' as const,
          function: {
            name: prefixedName,
            description: `[${integration.name}] ${tool.description || tool.name}`,
            parameters: sanitizedSchema,
          },
        });
      }
    } catch (error) {
      console.error('[Router] Failed to load MCP tools:', error);
    }

    return [...staticTools, ...mcpTools];
  }

  /**
   * Sanitize MCP tool schema for OpenAI compatibility
   * OpenAI requires 'properties' field when type is 'object'
   */
  private sanitizeToolSchema(schema: Record<string, any> | undefined): Record<string, any> {
    // Default schema if none provided
    if (!schema || Object.keys(schema).length === 0) {
      return {
        type: 'object',
        properties: {},
        required: [],
      };
    }

    // Deep clone to avoid mutating original
    const sanitized = JSON.parse(JSON.stringify(schema));

    // Recursively ensure all object types have properties
    const ensureProperties = (obj: Record<string, any>): void => {
      if (obj.type === 'object' && !obj.properties) {
        obj.properties = {};
      }

      // Recurse into properties
      if (obj.properties) {
        for (const key of Object.keys(obj.properties)) {
          ensureProperties(obj.properties[key]);
        }
      }

      // Recurse into items (for arrays)
      if (obj.items && typeof obj.items === 'object') {
        ensureProperties(obj.items);
      }

      // Recurse into additionalProperties
      if (obj.additionalProperties && typeof obj.additionalProperties === 'object') {
        ensureProperties(obj.additionalProperties);
      }
    };

    ensureProperties(sanitized);
    return sanitized;
  }

  /**
   * Call OpenAI API with retry and circuit breaker
   */
  private async callOpenAI(
    messages: OpenAIMessage[],
    config: AgentConfig,
    tools?: any[]
  ): Promise<OpenAIResponse> {
    const circuitBreaker = getCircuitBreaker('openai');

    const makeRequest = async (model: string): Promise<OpenAIResponse> => {
      const body: any = {
        model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${error}`);
      }

      return response.json() as Promise<OpenAIResponse>;
    };

    // Try with retry and circuit breaker
    try {
      return await circuitBreaker.execute(() =>
        withRetry(() => makeRequest(config.model), {
          maxRetries: 2,
          initialDelayMs: 1000,
        })
      );
    } catch (error) {
      // If primary model fails, try fallback model
      const fallbackModel = config.metadata.fallbackModel;
      if (fallbackModel && fallbackModel !== config.model) {
        console.warn(`[Router] Primary model failed, trying fallback: ${fallbackModel}`);
        return makeRequest(fallbackModel);
      }
      throw error;
    }
  }
}

/**
 * Create a router instance for a request
 */
export function createRouter(env: Bindings, context: AgentContext): AgentRouter {
  return new AgentRouter({ env, context });
}
