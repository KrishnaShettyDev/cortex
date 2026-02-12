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
import { getUnresolvedContradictions, formatContradictionForChat } from './lib/contradiction/detector';

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
 * Format memories as context for the AI - ENHANCED for visible memory moat
 */
function formatMemoriesContext(
  memories: Array<{
    content: string;
    created_at: string;
    source: string | null;
  }>
): string {
  if (memories.length === 0) {
    return '## Your Memories About This Topic\n\nNo relevant memories found. You can tell the user: "I don\'t have any memories about that yet. Would you like to tell me more?"';
  }

  const formatted = memories
    .map((memory, idx) => {
      const date = new Date(memory.created_at).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const source = memory.source ? ` [from ${memory.source}]` : '';
      // Calculate how long ago
      const daysAgo = Math.floor((Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const timeAgo = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
      return `[Memory ${idx + 1}] (${date} - ${timeAgo}${source})\n${memory.content}`;
    })
    .join('\n\n');

  return `## Your Memories About This Topic\n\n${formatted}`;
}

// =============================================================================
// PRIORITY 2: ENTITY INTELLIGENCE
// =============================================================================

interface EntityQueryResult {
  isEntityQuery: boolean;
  entityName: string | null;
}

/**
 * Detect if user is asking about a specific person/entity
 * Examples: "What do I know about Josh?", "Tell me about Sarah"
 */
function detectEntityQuery(message: string): EntityQueryResult {
  const patterns = [
    /what do (?:you|I) know about (.+?)[\?]?$/i,
    /what do you remember about (.+?)[\?]?$/i,
    /tell me about (.+?)[\?]?$/i,
    /who is (.+?)[\?]?$/i,
    /summarize (.+?)[\?]?$/i,
    /what['']?s (.+?)['']?s (?:info|information|details)[\?]?$/i,
    /everything (?:about|on) (.+?)[\?]?$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return { isEntityQuery: true, entityName: match[1].trim() };
    }
  }
  return { isEntityQuery: false, entityName: null };
}

/**
 * Get comprehensive entity context including relationships and memories
 */
async function getEntityContext(db: D1Database, userId: string, entityName: string): Promise<string | null> {
  // Search entity by name (fuzzy match)
  const entity = await db.prepare(`
    SELECT * FROM entities
    WHERE user_id = ? AND (name LIKE ? OR canonical_name LIKE ?)
    ORDER BY importance_score DESC LIMIT 1
  `).bind(userId, `%${entityName}%`, `%${entityName.toLowerCase()}%`).first<{
    id: string;
    name: string;
    entity_type: string;
    canonical_name: string;
    metadata: string | null;
    importance_score: number;
    mention_count: number;
    first_seen: string;
    last_seen: string;
  }>();

  if (!entity) return null;

  // Get relationships
  const relationships = await db.prepare(`
    SELECT er.relationship_type, er.strength, e.name as related_name, e.entity_type as related_type
    FROM entity_relationships er
    JOIN entities e ON (
      CASE WHEN er.source_entity_id = ? THEN er.target_entity_id = e.id
           ELSE er.source_entity_id = e.id END
    )
    WHERE (er.source_entity_id = ? OR er.target_entity_id = ?)
    ORDER BY er.strength DESC LIMIT 10
  `).bind(entity.id, entity.id, entity.id).all();

  // Get memories mentioning this entity
  const memories = await db.prepare(`
    SELECT m.content, m.created_at, m.source FROM memories m
    JOIN memory_entities me ON m.id = me.memory_id
    WHERE me.entity_id = ? AND m.is_forgotten = 0
    ORDER BY m.created_at DESC LIMIT 5
  `).bind(entity.id).all<{ content: string; created_at: string; source: string | null }>();

  // Format context
  let context = `\n## Entity Profile: ${entity.name}\n`;
  context += `Type: ${entity.entity_type}\n`;
  context += `Mentioned: ${entity.mention_count} times\n`;
  context += `First mentioned: ${new Date(entity.first_seen).toLocaleDateString()}\n`;
  context += `Last mentioned: ${new Date(entity.last_seen).toLocaleDateString()}\n`;

  // Add metadata if available
  if (entity.metadata) {
    try {
      const meta = JSON.parse(entity.metadata);
      if (meta.email) context += `Email: ${meta.email}\n`;
      if (meta.company) context += `Company: ${meta.company}\n`;
      if (meta.role) context += `Role: ${meta.role}\n`;
    } catch {}
  }

  if (relationships.results && relationships.results.length > 0) {
    context += `\n### Relationships:\n`;
    for (const r of relationships.results as any[]) {
      context += `- ${r.relationship_type}: ${r.related_name} (${r.related_type})\n`;
    }
  }

  if (memories.results && memories.results.length > 0) {
    context += `\n### Recent Memories About ${entity.name}:\n`;
    for (let i = 0; i < memories.results.length; i++) {
      const m = memories.results[i];
      const date = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      context += `${i + 1}. (${date}) ${m.content}\n`;
    }
  }

  return context;
}

// =============================================================================
// PRIORITY 3: COMMITMENT SURFACING
// =============================================================================

/**
 * Get active commitments that are due soon or overdue
 */
async function getActiveCommitmentsContext(db: D1Database, userId: string): Promise<string> {
  const now = new Date().toISOString();
  const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const commitments = await db.prepare(`
      SELECT description, to_entity_name, due_date, commitment_type,
        CASE WHEN due_date < ? THEN 1 ELSE 0 END as is_overdue
      FROM commitments
      WHERE user_id = ? AND status IN ('pending', 'overdue')
        AND (due_date < ? OR due_date <= ?)
      ORDER BY is_overdue DESC, due_date ASC LIMIT 5
    `).bind(now, userId, now, threeDays).all<{
      description: string;
      to_entity_name: string | null;
      due_date: string | null;
      commitment_type: string;
      is_overdue: number;
    }>();

    if (!commitments.results || commitments.results.length === 0) return '';

    let context = '\n## Active Commitments (mention if relevant to conversation):\n';
    for (const c of commitments.results) {
      const status = c.is_overdue ? '⚠️ OVERDUE' : '📅 Due soon';
      const person = c.to_entity_name ? ` with ${c.to_entity_name}` : '';
      const date = c.due_date ? ` (due ${new Date(c.due_date).toLocaleDateString()})` : '';
      context += `- [${status}] "${c.description}"${person}${date}\n`;
    }
    context += '\nIf user mentions someone they have a commitment with, gently remind them.\n';

    return context;
  } catch {
    return '';
  }
}

// =============================================================================
// PRIORITY 4: TEMPORAL QUERIES
// =============================================================================

interface TemporalQueryResult {
  isTemporalQuery: boolean;
  startDate: Date | null;
  endDate: Date | null;
  label: string | null;
}

/**
 * Detect temporal queries like "What was I working on last month?"
 */
function detectTemporalQuery(message: string): TemporalQueryResult {
  const now = new Date();
  const lowerMsg = message.toLowerCase();

  const patterns: Array<{
    regex: RegExp;
    getRange: () => { start: Date; end: Date; label: string };
  }> = [
    {
      regex: /last month|previous month/i,
      getRange: () => ({
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
        label: 'last month',
      }),
    },
    {
      regex: /this month/i,
      getRange: () => ({
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: now,
        label: 'this month',
      }),
    },
    {
      regex: /last week|previous week/i,
      getRange: () => {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay() - 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'last week' };
      },
    },
    {
      regex: /this week/i,
      getRange: () => {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        return { start, end: now, label: 'this week' };
      },
    },
    {
      regex: /yesterday/i,
      getRange: () => {
        const start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'yesterday' };
      },
    },
    {
      regex: /past (\d+) days/i,
      getRange: () => {
        const match = lowerMsg.match(/past (\d+) days/i);
        const days = match ? parseInt(match[1]) : 7;
        const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        return { start, end: now, label: `past ${days} days` };
      },
    },
  ];

  for (const { regex, getRange } of patterns) {
    if (regex.test(lowerMsg)) {
      const { start, end, label } = getRange();
      return { isTemporalQuery: true, startDate: start, endDate: end, label };
    }
  }
  return { isTemporalQuery: false, startDate: null, endDate: null, label: null };
}

/**
 * Search memories within a specific time range
 */
async function searchMemoriesInTimeRange(
  db: D1Database,
  userId: string,
  startDate: Date,
  endDate: Date,
  limit: number = 15
): Promise<Array<{ content: string; created_at: string; source: string | null }>> {
  const results = await db.prepare(`
    SELECT content, created_at, source FROM memories
    WHERE user_id = ? AND created_at >= ? AND created_at <= ? AND is_forgotten = 0
    ORDER BY created_at DESC LIMIT ?
  `).bind(userId, startDate.toISOString(), endDate.toISOString(), limit).all<{
    content: string;
    created_at: string;
    source: string | null;
  }>();

  return results.results || [];
}

// =============================================================================
// PRIORITY 5: PATTERN SURFACING
// =============================================================================

/**
 * Get detected patterns and nudges to mention if relevant
 */
async function getUserPatterns(db: D1Database, userId: string): Promise<string> {
  try {
    const nudges = await db.prepare(`
      SELECT nudge_type, title, message FROM proactive_nudges
      WHERE user_id = ? AND dismissed = 0 AND acted = 0
      ORDER BY priority DESC LIMIT 3
    `).bind(userId).all<{ nudge_type: string; title: string; message: string }>();

    if (!nudges.results || nudges.results.length === 0) return '';

    let context = '\n## Detected Patterns (mention ONLY if directly relevant):\n';
    for (const n of nudges.results) {
      context += `- ${n.message}\n`;
    }
    context += '\nMention a pattern only if it naturally fits the conversation.\n';

    return context;
  } catch {
    return '';
  }
}

// =============================================================================
// PRIORITY 6: CONTRADICTION CONTEXT
// =============================================================================

/**
 * Get unresolved contradictions to mention in chat
 */
async function getContradictionContext(db: D1Database, userId: string): Promise<string> {
  try {
    const contradictions = await getUnresolvedContradictions(db, userId, 2);

    if (contradictions.length === 0) return '';

    let context = '\n## Unresolved Contradictions (ask user to clarify ONE if relevant):\n';
    for (const c of contradictions) {
      context += `- "${c.existingContent}" vs "${c.newContent}" (${c.conflictType})\n`;
    }
    context += '\nOnly ask about a contradiction if the current conversation relates to it.\n';

    return context;
  } catch {
    return '';
  }
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

  // Format system message with memory context - ENHANCED for visible memory moat
  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI assistant with perfect memory. You remember everything the user tells you.

${formatMemoriesContext(memories)}

CRITICAL INSTRUCTIONS FOR MEMORY USAGE:
1. When using information from a memory, EXPLICITLY acknowledge it with phrases like:
   - "I remember you mentioned..."
   - "Based on what you told me on [date]..."
   - "You previously said..."
   - "From our earlier conversation..."
2. If multiple memories are relevant, synthesize them: "Combining what you've shared..."
3. If NO relevant memories exist, say: "I don't have any memories about that yet. Would you like to tell me about it?"
4. NEVER make up information not in the memories above.
5. Make memory references feel natural and conversational.
6. When referencing a memory, mention WHEN the user told you (e.g., "last week", "3 days ago")

Be concise, friendly, and helpful. Your memory is your superpower - make it VISIBLE to the user.`,
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

  // Format system message with memory context - ENHANCED for visible memory moat
  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI assistant with perfect memory. You remember everything the user tells you.

${userIdentity}

${formatMemoriesContext(memories)}

CRITICAL INSTRUCTIONS FOR MEMORY USAGE:
1. When using information from a memory, EXPLICITLY acknowledge it with phrases like:
   - "I remember you mentioned..."
   - "Based on what you told me on [date]..."
   - "You previously said..."
   - "From our earlier conversation..."
2. If multiple memories are relevant, synthesize them: "Combining what you've shared..."
3. If NO relevant memories exist, say: "I don't have any memories about that yet. Would you like to tell me about it?"
4. NEVER make up information not in the memories above.
5. Make memory references feel natural and conversational.
6. When referencing a memory, mention WHEN the user told you (e.g., "last week", "3 days ago")
7. Consider the conversation history to maintain context.

Be concise, friendly, and helpful. Your memory is your superpower - make it VISIBLE to the user.`,
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
    serperApiKey?: string; // For web search
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

  // Step 2: Detect special query types
  const entityQuery = detectEntityQuery(message);
  const temporalQuery = detectTemporalQuery(message);

  // Step 3: Search for relevant memories (use time-filtered if temporal query)
  let memories: Array<{ content: string; created_at: string; source: string | null }>;
  if (temporalQuery.isTemporalQuery && temporalQuery.startDate && temporalQuery.endDate) {
    memories = await searchMemoriesInTimeRange(
      db,
      userId,
      temporalQuery.startDate,
      temporalQuery.endDate,
      contextLimit
    );
  } else {
    memories = await searchMemories(
      db,
      vectorize,
      userId,
      message,
      ai,
      { limit: contextLimit }
    );
  }

  // Step 4: Gather additional context (entity, commitments, patterns, contradictions)
  let entityContext = '';
  if (entityQuery.isEntityQuery && entityQuery.entityName) {
    entityContext = await getEntityContext(db, userId, entityQuery.entityName) || '';
  }

  const commitmentContext = await getActiveCommitmentsContext(db, userId);
  const patternContext = await getUserPatterns(db, userId);
  const contradictionContext = await getContradictionContext(db, userId);

  // Step 5: Process actions if found
  const pendingActions: PendingAction[] = [];
  const executedActions: ActionResult[] = [];
  let queryResults: any = null;

  if (parseResult.hasAction && parseResult.actions.length > 0) {
    const executor = new ActionExecutor({
      composioApiKey,
      openaiKey,
      serperApiKey: options.serperApiKey,
      db,
      userId,
      userName: options.userName,
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

  // Step 6: Generate response with context
  const actionContext = buildActionContext(parseResult, pendingActions, executedActions, queryResults);

  // Build user identity string
  const userIdentity = options.userName
    ? `You are assisting ${options.userName}${options.userEmail ? ` (${options.userEmail})` : ''}.`
    : options.userEmail
    ? `You are assisting the user with email ${options.userEmail}.`
    : '';

  // Build temporal context if time-filtered query
  const temporalContext = temporalQuery.isTemporalQuery && temporalQuery.label
    ? `\n## Time-Filtered Search: Showing memories from ${temporalQuery.label}\n`
    : '';

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are Cortex, an AI assistant with perfect memory that can take actions (calendar, email, etc.) on behalf of the user.

${userIdentity}
${temporalContext}
${formatMemoriesContext(memories)}
${entityContext}
${commitmentContext}
${patternContext}
${contradictionContext}
${actionContext}

CRITICAL INSTRUCTIONS FOR MEMORY USAGE:
1. When using information from a memory, EXPLICITLY acknowledge it:
   - "I remember you mentioned..."
   - "Based on what you told me on [date]..."
   - "You previously said..."
2. If multiple memories are relevant, synthesize: "Combining what you've shared..."
3. If NO relevant memories exist for a question, say: "I don't have any memories about that yet."
4. NEVER make up information not in the memories.
5. When referencing a memory, mention WHEN (e.g., "you told me last week", "3 days ago")
6. For entity queries ("What do I know about X?"), give a comprehensive summary from the entity profile.
7. For temporal queries ("last month", "this week"), group memories by topic/theme.
8. If there's a relevant commitment, gently remind the user.

ACTION HANDLING:
- If you created a pending action, confirm what you're about to do and ask for confirmation
- If you executed a query, summarize the results naturally
- If there was an error, explain what went wrong
- For calendar events, mention the date/time clearly
- For emails, mention who it's to/from
- When drafting emails, sign with the user's name (${options.userName || 'the user'}), never use placeholders

Be conversational and helpful. Your memory is your superpower - make it VISIBLE to the user.`,
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
  composioApiKey: string,
  openaiKey: string,
  options?: {
    serperApiKey?: string;
    userName?: string;
  }
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
    openaiKey,
    serperApiKey: options?.serperApiKey,
    db,
    userId,
    userName: options?.userName,
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
