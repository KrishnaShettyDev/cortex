/**
 * Chat service with memory context
 * Retrieves relevant memories and generates AI responses
 */

import { searchMemories } from './memory';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  response: string;
  memories_used: number;
  model: string;
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
