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

  constructor(options: RouterOptions) {
    this.env = options.env;
    this.context = options.context;
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

    // Build messages
    const messages: OpenAIMessage[] = [
      { role: 'system', content: config.systemPrompt },
    ];

    // Add history
    if (input.history) {
      for (const msg of input.history.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: input.message });

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
          description: 'REQUIRED for any task involving emails, calendar, or external actions. You CANNOT access Gmail, Google Calendar, or external services directly - you MUST delegate using this tool. Use for: reading emails, sending emails, searching emails, checking calendar, creating events, updating events, deleting events, searching contacts. Always delegate these tasks - never say "I don\'t have access".',
          parameters: {
            type: 'object',
            properties: {
              goal: { type: 'string', description: 'Clear, specific description of what needs to be done. Include all relevant details: email addresses, dates, times, subject lines, body content, event names, etc.' },
              context: { type: 'object', description: 'Additional structured context like { "email": "user@example.com", "date": "2024-01-15" }' },
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
    const tools = this.getExecutionTools();
    const toolCallsMade: string[] = [];
    const toolResults: Record<string, any> = {}; // Store tool results for rich content rendering
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const messages: OpenAIMessage[] = [
      { role: 'system', content: config.systemPrompt },
      {
        role: 'user',
        content: `GOAL: ${params.goal}\n\nCONTEXT: ${JSON.stringify(params.context || {})}`,
      },
    ];

    const maxIterations = 10;
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
          console.log(`[Router] Truncating tool result from ${toolResult.length} to ${MAX_TOOL_RESULT_CHARS} chars`);
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
                _message: `Showing 10 of ${parsed.length} items. Ask for more specific queries to narrow results.`,
              });
            } else if (parsed.data && Array.isArray(parsed.data)) {
              const truncated = parsed.data.slice(0, 10);
              toolResult = JSON.stringify({
                ...parsed,
                data: truncated,
                _truncated: true,
                _originalCount: parsed.data.length,
                _message: `Showing 10 of ${parsed.data.length} items.`,
              });
            } else {
              // Just truncate the string
              toolResult = toolResult.substring(0, MAX_TOOL_RESULT_CHARS) + '... [TRUNCATED - result too large]';
            }
          } catch {
            // Not JSON, just truncate
            toolResult = toolResult.substring(0, MAX_TOOL_RESULT_CHARS) + '... [TRUNCATED - result too large]';
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
    // Get user's Composio connection ID for Gmail/Calendar
    const integration = await this.env.DB
      .prepare(
        `SELECT access_token FROM integrations
         WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1`
      )
      .bind(this.context.userId)
      .first<{ access_token: string }>();

    if (!integration) {
      return JSON.stringify({ error: 'Google integration not connected. Please connect your Google account.' });
    }

    const connectedAccountId = integration.access_token;

    switch (toolName) {
      case 'gmail_send_email':
        return this.composioExecute('GMAIL_SEND_EMAIL', connectedAccountId, {
          recipient_email: args.recipient_email,
          subject: args.subject,
          body: args.body,
          cc: args.cc,
        });

      case 'gmail_create_draft':
        return this.composioExecute('GMAIL_CREATE_EMAIL_DRAFT', connectedAccountId, {
          recipient_email: args.recipient_email,
          subject: args.subject,
          body: args.body,
        });

      case 'gmail_search': {
        // Limit results to prevent context overflow - emails can be very large
        const emailsResult = await this.composioExecute('GMAIL_FETCH_EMAILS', connectedAccountId, {
          query: args.query,
          max_results: Math.min(args.max_results || 5, 10), // Default 5, max 10
        });

        // Transform the response to include structured email data for rich UI rendering
        try {
          const parsed = JSON.parse(emailsResult);

          // Handle different Composio response formats
          const rawEmails = parsed.data?.emails || parsed.emails || parsed.data || [];

          if (Array.isArray(rawEmails) && rawEmails.length > 0) {
            const transformedEmails = rawEmails.map((email: any) => ({
              id: email.id || email.messageId || '',
              thread_id: email.threadId || email.thread_id || '',
              subject: email.subject || '(no subject)',
              from: email.from || email.sender || '',
              to: email.to ? (Array.isArray(email.to) ? email.to : [email.to]) : [],
              date: email.date || email.internalDate || email.receivedDateTime || new Date().toISOString(),
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
        return this.composioExecute('GOOGLECALENDAR_CREATE_EVENT', connectedAccountId, {
          summary: args.summary,
          start_datetime: args.start_time,
          end_datetime: args.end_time,
          description: args.description,
          attendees: args.attendees?.join(','),
          location: args.location,
        });

      case 'calendar_list_events':
        return this.composioExecute('GOOGLECALENDAR_LIST_EVENTS', connectedAccountId, {
          time_min: args.time_min || new Date().toISOString(),
          time_max: args.time_max,
          max_results: args.max_results || 10,
        });

      case 'calendar_update_event':
        return this.composioExecute('GOOGLECALENDAR_UPDATE_EVENT', connectedAccountId, {
          event_id: args.event_id,
          summary: args.summary,
          start_datetime: args.start_time,
          end_datetime: args.end_time,
          description: args.description,
        });

      case 'calendar_delete_event':
        return this.composioExecute('GOOGLECALENDAR_DELETE_EVENT', connectedAccountId, {
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

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
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

      if (!response.ok) {
        const error = await response.text();
        console.error(`[Composio] Tool ${toolSlug} failed:`, error);
        return JSON.stringify({ error: `Tool execution failed: ${response.status}` });
      }

      const result = await response.json();
      return JSON.stringify(result);
    } catch (error) {
      console.error(`[Composio] Tool ${toolSlug} error:`, error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : 'Tool execution failed',
      });
    }
  }

  /**
   * Get execution tools definition
   */
  private getExecutionTools() {
    return [
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
    ];
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
