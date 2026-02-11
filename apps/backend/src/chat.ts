/**
 * Chat service with memory context and action support
 * Retrieves relevant memories, parses actions, and generates AI responses
 *
 * Supports Iris/Poke-like chat actions:
 * - Schedule meetings via natural language
 * - Send/reply to emails
 * - Query calendar and emails
 * - Manage tasks and reminders
 */

import { searchMemories } from './memory';
import { parseActionsFromMessage, type ParseResult, type ParsedAction, requiresConfirmation, generateConfirmationMessage } from './lib/actions/parser';
import { ActionExecutor, type ActionResult } from './lib/actions/executor';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  response: string;
  memories_used: number;
  model: string;
}

// Enhanced chat response with action support
interface ActionChatResponse extends ChatResponse {
  actions?: {
    pending: PendingAction[];
    executed: ActionResult[];
  };
  queryResults?: any; // For read-only queries like "what's on my calendar"
}

interface PendingAction {
  id: string;
  action: string;
  parameters: Record<string, any>;
  confirmationMessage: string;
  confidence: number;
  expiresAt: string;
}

/**
 * Format memories as context for the AI
 */
function formatMemoriesContext(
  memories: Array<{
    content: string;
    created_at: string;
    source: string | null;
  }>
): string {
  if (memories.length === 0) {
    return 'No relevant memories found.';
  }

  const formatted = memories
    .map((memory, idx) => {
      const date = new Date(memory.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const source = memory.source ? ` [${memory.source}]` : '';
      return `${idx + 1}. (${date}${source}) ${memory.content}`;
    })
    .join('\n\n');

  return `Relevant memories:\n\n${formatted}`;
}

/**
 * Call OpenAI Chat Completion API
 */
async function callOpenAI(
  messages: ChatMessage[],
  apiKey: string,
  model: string = 'gpt-4o-mini'
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0].message.content;
}

/**
 * Generate chat response with memory context
 */
export async function chat(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  message: string,
  openaiKey: string,
  ai: any,
  options: {
    model?: string;
    contextLimit?: number;
  } = {}
): Promise<ChatResponse> {
  const model = options.model || 'gpt-4o-mini';
  const contextLimit = Math.min(options.contextLimit || 5, 10);

  // Search for relevant memories using Cloudflare AI for embeddings
  const memories = await searchMemories(
    db,
    vectorize,
    userId,
    message,
    ai,
    { limit: contextLimit }
  );

  // Format system message with memory context
  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI-powered second brain assistant. You help users remember information, make connections, and answer questions based on their memories.

${formatMemoriesContext(memories)}

When answering:
- Use the relevant memories above to provide personalized, context-aware responses
- If the memories contain the answer, reference them naturally
- If no relevant memories exist, acknowledge this and provide general help
- Be concise, friendly, and helpful
- Don't make up information not present in the memories`,
  };

  // User message
  const userMessage: ChatMessage = {
    role: 'user',
    content: message,
  };

  // Call OpenAI
  const response = await callOpenAI(
    [systemMessage, userMessage],
    openaiKey,
    model
  );

  return {
    response,
    memories_used: memories.length,
    model,
  };
}

/**
 * Generate chat response with conversation history
 */
export async function chatWithHistory(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  openaiKey: string,
  ai: any,
  options: {
    model?: string;
    contextLimit?: number;
    userName?: string;
    userEmail?: string;
  } = {}
): Promise<ChatResponse> {
  const model = options.model || 'gpt-4o-mini';
  const contextLimit = Math.min(options.contextLimit || 5, 10);

  // Search for relevant memories using Cloudflare AI for embeddings
  const memories = await searchMemories(
    db,
    vectorize,
    userId,
    message,
    ai,
    { limit: contextLimit }
  );

  // Build user identity string
  const userIdentity = options.userName
    ? `You are assisting ${options.userName}${options.userEmail ? ` (${options.userEmail})` : ''}.`
    : options.userEmail
    ? `You are assisting the user with email ${options.userEmail}.`
    : '';

  // Format system message with memory context
  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI-powered second brain assistant. You help users remember information, make connections, and answer questions based on their memories.

${userIdentity}

${formatMemoriesContext(memories)}

When answering:
- Use the relevant memories above to provide personalized, context-aware responses
- Consider the conversation history to maintain context
- If the memories contain the answer, reference them naturally
- If no relevant memories exist, acknowledge this and provide general help
- Be concise, friendly, and helpful
- Don't make up information not present in the memories`,
  };

  // Build message array with history
  const messages: ChatMessage[] = [systemMessage];

  // Add conversation history (limit to last 10 messages to avoid token limits)
  const recentHistory = history.slice(-10);
  messages.push(...recentHistory);

  // Add current user message
  messages.push({
    role: 'user',
    content: message,
  });

  // Call OpenAI
  const response = await callOpenAI(messages, openaiKey, model);

  return {
    response,
    memories_used: memories.length,
    model,
  };
}

/**
 * Enhanced chat with action support
 * Parses natural language for calendar/email actions like Iris or Poke
 */
export async function chatWithActions(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  message: string,
  openaiKey: string,
  composioApiKey: string,
  ai: any,
  options: {
    model?: string;
    contextLimit?: number;
    autoExecuteQueries?: boolean; // Auto-execute read-only actions
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    userName?: string;
    userEmail?: string;
  } = {}
): Promise<ActionChatResponse> {
  const model = options.model || 'gpt-4o-mini';
  const contextLimit = Math.min(options.contextLimit || 5, 10);
  const autoExecuteQueries = options.autoExecuteQueries ?? true;

  // Step 1: Parse message for actions (include history for context)
  const parseResult = await parseActionsFromMessage(message, openaiKey, {
    currentDate: new Date().toISOString().split('T')[0],
    history: options.history,
  });

  // Step 2: Search for relevant memories
  const memories = await searchMemories(
    db,
    vectorize,
    userId,
    message,
    ai,
    { limit: contextLimit }
  );

  // Step 3: Process actions if found
  const pendingActions: PendingAction[] = [];
  const executedActions: ActionResult[] = [];
  let queryResults: any = null;

  if (parseResult.hasAction && parseResult.actions.length > 0) {
    const executor = new ActionExecutor({
      composioApiKey,
      db,
      userId,
    });

    for (const action of parseResult.actions) {
      const actionDef = requiresConfirmation(action.action);

      // For read-only queries, auto-execute
      const isQuery = ['get_calendar_events', 'search_emails', 'search_contacts', 'fetch_emails'].includes(action.action);

      if (isQuery && autoExecuteQueries) {
        // Execute read-only actions immediately
        const result = await executor.executeAction({
          action: action.action,
          parameters: action.parameters,
          confirmed: true,
        });
        executedActions.push(result);
        if (result.success) {
          queryResults = result.result;
        }
      } else if (actionDef) {
        // Create pending action for confirmation
        const pendingId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry

        // Store pending action in database
        await db.prepare(`
          INSERT INTO pending_actions (id, user_id, action, parameters, confirmation_message, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          pendingId,
          userId,
          action.action,
          JSON.stringify(action.parameters),
          generateConfirmationMessage(action),
          expiresAt,
          new Date().toISOString()
        ).run();

        pendingActions.push({
          id: pendingId,
          action: action.action,
          parameters: action.parameters,
          confirmationMessage: generateConfirmationMessage(action),
          confidence: action.confidence,
          expiresAt,
        });
      } else {
        // Action doesn't require confirmation - execute directly
        const result = await executor.executeAction({
          action: action.action,
          parameters: action.parameters,
          confirmed: true,
        });
        executedActions.push(result);
      }
    }
  }

  // Step 4: Generate response with context
  const actionContext = buildActionContext(parseResult, pendingActions, executedActions, queryResults);

  // Build user identity string
  const userIdentity = options.userName
    ? `You are assisting ${options.userName}${options.userEmail ? ` (${options.userEmail})` : ''}.`
    : options.userEmail
    ? `You are assisting the user with email ${options.userEmail}.`
    : '';

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI assistant that helps manage calendar, email, and memories. You can take actions on behalf of the user.

${userIdentity}

${formatMemoriesContext(memories)}

${actionContext}

When responding:
- If you created a pending action, confirm what you're about to do and ask for confirmation
- If you executed a query, summarize the results naturally
- If there was an error, explain what went wrong
- Be conversational, concise, and helpful
- Reference memories when relevant
- For calendar events, mention the date/time clearly
- For emails, mention who it's to/from
- When drafting emails, sign with the user's name (${options.userName || 'the user'}), never use placeholders like [Your Name]`,
  };

  const messages: ChatMessage[] = [systemMessage];

  // Add history if provided
  if (options.history) {
    messages.push(...options.history.slice(-8));
  }

  messages.push({
    role: 'user',
    content: message,
  });

  const response = await callOpenAI(messages, openaiKey, model);

  return {
    response,
    memories_used: memories.length,
    model,
    actions: pendingActions.length > 0 || executedActions.length > 0
      ? { pending: pendingActions, executed: executedActions }
      : undefined,
    queryResults,
  };
}

/**
 * Confirm and execute a pending action
 */
export async function confirmAction(
  db: D1Database,
  userId: string,
  actionId: string,
  composioApiKey: string
): Promise<ActionResult> {
  // Get pending action
  const pending = await db.prepare(`
    SELECT action, parameters
    FROM pending_actions
    WHERE id = ? AND user_id = ? AND expires_at > ?
  `).bind(actionId, userId, new Date().toISOString()).first<{
    action: string;
    parameters: string;
  }>();

  if (!pending) {
    return {
      success: false,
      action: 'unknown',
      error: 'Action not found or expired',
      message: 'This action has expired or was already processed.',
    };
  }

  // Execute the action
  const executor = new ActionExecutor({
    composioApiKey,
    db,
    userId,
  });

  const result = await executor.executeAction({
    action: pending.action,
    parameters: JSON.parse(pending.parameters),
    confirmed: true,
  });

  // Delete pending action
  await db.prepare(`
    DELETE FROM pending_actions WHERE id = ?
  `).bind(actionId).run();

  return result;
}

/**
 * Cancel a pending action
 */
export async function cancelAction(
  db: D1Database,
  userId: string,
  actionId: string
): Promise<{ success: boolean; message: string }> {
  const result = await db.prepare(`
    DELETE FROM pending_actions
    WHERE id = ? AND user_id = ?
  `).bind(actionId, userId).run();

  if (result.meta.changes === 0) {
    return {
      success: false,
      message: 'Action not found or already processed.',
    };
  }

  return {
    success: true,
    message: 'Action cancelled.',
  };
}

/**
 * Build context string for AI based on action parsing results
 */
function buildActionContext(
  parseResult: ParseResult,
  pendingActions: PendingAction[],
  executedActions: ActionResult[],
  queryResults: any
): string {
  const parts: string[] = [];

  if (pendingActions.length > 0) {
    parts.push(`PENDING ACTIONS (waiting for confirmation):
${pendingActions.map(a => `- ${a.action}: ${a.confirmationMessage}`).join('\n')}`);
  }

  if (executedActions.length > 0) {
    const successful = executedActions.filter(a => a.success);
    const failed = executedActions.filter(a => !a.success);

    if (successful.length > 0) {
      parts.push(`COMPLETED ACTIONS:
${successful.map(a => `- ${a.action}: ${a.message}`).join('\n')}`);
    }

    if (failed.length > 0) {
      parts.push(`FAILED ACTIONS:
${failed.map(a => `- ${a.action}: ${a.error}`).join('\n')}`);
    }
  }

  if (queryResults) {
    if (Array.isArray(queryResults?.items)) {
      // Calendar events
      const events = queryResults.items.slice(0, 5);
      if (events.length > 0) {
        parts.push(`CALENDAR EVENTS:
${events.map((e: any) => {
  const start = e.start?.dateTime || e.start?.date;
  const time = start ? new Date(start).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) : 'No time';
  return `- ${e.summary || 'No title'} (${time})`;
}).join('\n')}`);
      } else {
        parts.push('CALENDAR: No events found for the requested time range.');
      }
    } else if (queryResults?.emails && Array.isArray(queryResults.emails)) {
      // Email fetch/search results (new format with emails array)
      const emails = queryResults.emails.slice(0, 10);
      if (emails.length > 0) {
        parts.push(`YOUR EMAILS (${queryResults.count || emails.length} found):
${emails.map((e: any) => {
  const date = e.date ? new Date(e.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) : '';
  const unread = e.is_unread ? '📩 ' : '';
  const starred = e.is_starred ? '⭐ ' : '';
  return `- ${unread}${starred}${e.from}: "${e.subject}" ${date ? `(${date})` : ''}`;
}).join('\n')}`);
      } else {
        parts.push('EMAIL: No emails found.');
      }
    } else if (Array.isArray(queryResults)) {
      // Legacy email search results (plain array)
      const emails = queryResults.slice(0, 5);
      if (emails.length > 0) {
        parts.push(`EMAIL SEARCH RESULTS:
${emails.map((e: any) => `- From: ${e.from}, Subject: ${e.subject}`).join('\n')}`);
      }
    }
  }

  if (parseResult.queryIntent) {
    parts.push(`USER QUERY INTENT: ${parseResult.queryIntent}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}
