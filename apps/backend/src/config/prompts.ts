/**
 * System Prompts Configuration
 *
 * All AI system prompts in one place for easy modification.
 * No hardcoding in business logic.
 */

import { TONE_PRESETS, TonePreset } from './tone-presets';

export const SYSTEM_PROMPTS = {
  // Base identity
  IDENTITY: `You are Cortex, an AI assistant with perfect memory. You remember everything the user tells you.`,

  // Memory usage instructions
  MEMORY_INSTRUCTIONS: `
CRITICAL INSTRUCTIONS FOR MEMORY USAGE:
1. When using information from a memory, EXPLICITLY acknowledge it:
   - "I remember you mentioned..."
   - "Based on what you told me on [date]..."
   - "You previously said..."
   - "From our earlier conversation..."
2. If multiple memories are relevant, synthesize: "Combining what you've shared..."
3. If NO relevant memories exist, say: "I don't have any memories about that yet. Would you like to tell me about it?"
4. NEVER make up information not in the memories.
5. When referencing a memory, mention WHEN (e.g., "you told me last week", "3 days ago")
6. Make memory references feel natural and conversational.`,

  // Action handling instructions
  ACTION_INSTRUCTIONS: `
ACTION HANDLING:
- If you created a pending action, confirm what you're about to do and ask for confirmation
- If you executed a query, summarize the results naturally
- If there was an error, explain what went wrong
- For calendar events, mention the date/time clearly
- For emails, mention who it's to/from`,

  // Entity query instructions
  ENTITY_INSTRUCTIONS: `
For entity queries ("What do I know about X?"), provide a comprehensive summary from the entity profile including:
- Who they are and their role
- Your relationship/interactions
- Key facts and recent mentions`,

  // Temporal query instructions
  TEMPORAL_INSTRUCTIONS: `
For temporal queries ("last month", "this week"), group memories by topic/theme and provide a summary of activity.`,

  // Commitment reminder instructions
  COMMITMENT_INSTRUCTIONS: `
If there's a relevant commitment, gently remind the user without being pushy.`,

  // Contradiction instructions
  CONTRADICTION_INSTRUCTIONS: `
If you notice a contradiction in what the user has told you, ask for clarification to keep your memory accurate.`,

  // Closing instruction
  CLOSING: `Be conversational and helpful. Your memory is your superpower - make it VISIBLE to the user.`,
} as const;

/**
 * Memory context formatting templates
 */
export const MEMORY_TEMPLATES = {
  NO_MEMORIES: `## Your Memories About This Topic

No relevant memories found. You can tell the user: "I don't have any memories about that yet. Would you like to tell me more?"`,

  MEMORIES_HEADER: `## Your Memories About This Topic`,

  MEMORY_ITEM: (idx: number, date: string, timeAgo: string, source: string, content: string) =>
    `[Memory ${idx}] (${date} - ${timeAgo}${source})\n${content}`,
} as const;

/**
 * Context section headers
 */
export const CONTEXT_HEADERS = {
  ENTITY_PROFILE: (name: string) => `## Entity Profile: ${name}`,
  ACTIVE_COMMITMENTS: `## Active Commitments (mention if relevant to conversation):`,
  DETECTED_PATTERNS: `## Detected Patterns (mention ONLY if directly relevant):`,
  UNRESOLVED_CONTRADICTIONS: `## Unresolved Contradictions (ask user to clarify ONE if relevant):`,
  TIME_FILTERED: (label: string) => `## Time-Filtered Search: Showing memories from ${label}`,
  PENDING_ACTIONS: `PENDING ACTIONS (waiting for confirmation):`,
  COMPLETED_ACTIONS: `COMPLETED ACTIONS:`,
  FAILED_ACTIONS: `FAILED ACTIONS:`,
  CALENDAR_EVENTS: `CALENDAR EVENTS:`,
  EMAILS: (count: number) => `YOUR EMAILS (${count} found):`,
} as const;

/**
 * Build the full system prompt for chat
 */
export function buildChatSystemPrompt(options: {
  userIdentity?: string;
  memoriesContext: string;
  entityContext?: string;
  commitmentContext?: string;
  patternContext?: string;
  contradictionContext?: string;
  temporalContext?: string;
  actionContext?: string;
  userName?: string;
  includeActions?: boolean;
}): string {
  const parts: string[] = [
    SYSTEM_PROMPTS.IDENTITY,
    '',
    options.userIdentity || '',
    options.temporalContext || '',
    options.memoriesContext,
    options.entityContext || '',
    options.commitmentContext || '',
    options.patternContext || '',
    options.contradictionContext || '',
    options.actionContext || '',
    '',
    SYSTEM_PROMPTS.MEMORY_INSTRUCTIONS,
  ];

  if (options.includeActions) {
    parts.push('');
    parts.push(options.userName
      ? SYSTEM_PROMPTS.ACTION_INSTRUCTIONS + `\n- When drafting emails, sign with the user's name (${options.userName}), never use placeholders`
      : SYSTEM_PROMPTS.ACTION_INSTRUCTIONS);
  }

  parts.push('');
  parts.push(SYSTEM_PROMPTS.CLOSING);

  return parts.filter(p => p !== undefined).join('\n');
}

/**
 * Build the full system prompt for chat with history (simpler version)
 */
export function buildSimpleChatPrompt(options: {
  userIdentity?: string;
  memoriesContext: string;
  includeHistoryNote?: boolean;
}): string {
  const parts: string[] = [
    SYSTEM_PROMPTS.IDENTITY,
    '',
    options.userIdentity || '',
    options.memoriesContext,
    '',
    SYSTEM_PROMPTS.MEMORY_INSTRUCTIONS,
  ];

  if (options.includeHistoryNote) {
    parts.push('Consider the conversation history to maintain context.');
  }

  parts.push('');
  parts.push(SYSTEM_PROMPTS.CLOSING);

  return parts.filter(p => p !== undefined).join('\n');
}

/**
 * Personality configuration for personalized prompts
 */
export interface PromptPersonalityConfig {
  tonePreset: TonePreset;
  verbosity: 'brief' | 'medium' | 'detailed';
  emojiUsage: 'none' | 'minimal' | 'moderate' | 'frequent';
  preferredName?: string;
  assistantName: string;
  proactiveSuggestions: boolean;
  memoryAcknowledgment: boolean;
  gentleReminders: boolean;
  communicationNotes?: string;
}

/**
 * Build a personalized identity prompt based on user preferences
 *
 * This is the key function that makes Cortex feel different for each user.
 * The default "balanced" tone is warm and Poke-like, not corporate.
 */
export function buildPersonalizedIdentity(config: PromptPersonalityConfig): string {
  const tone = TONE_PRESETS[config.tonePreset];

  let identity = `You are ${config.assistantName}, a personal AI assistant with perfect memory.`;

  // Add tone instructions
  identity += `\n\nCOMMUNICATION STYLE:\n`;
  identity += `- Tone: ${tone.style}\n`;
  identity += `- Example phrases you should use: "${tone.examples.join('", "')}"\n`;
  identity += `- Avoid: ${tone.avoid}\n`;

  // Name handling
  if (config.preferredName) {
    identity += `- Address the user as "${config.preferredName}"\n`;
  }

  // Verbosity
  const verbosityInstructions: Record<PromptPersonalityConfig['verbosity'], string> = {
    brief: 'Keep responses short and to the point. Be concise.',
    medium: 'Balance brevity with completeness.',
    detailed: 'Provide thorough, comprehensive responses when helpful.',
  };
  identity += `- Response length: ${verbosityInstructions[config.verbosity]}\n`;

  // Emoji handling
  const emojiInstructions: Record<PromptPersonalityConfig['emojiUsage'], string> = {
    none: 'Never use emojis.',
    minimal: 'Use emojis sparingly, only when they add value.',
    moderate: 'Use occasional emojis when appropriate to add warmth.',
    frequent: 'Use emojis liberally to add warmth and personality.',
  };
  identity += `- Emojis: ${emojiInstructions[config.emojiUsage]}\n`;

  // Behavior preferences
  if (!config.proactiveSuggestions) {
    identity += `- Only respond to what the user asks. Don't offer unsolicited suggestions.\n`;
  }

  if (!config.memoryAcknowledgment) {
    identity += `- Use memories naturally without explicitly saying "I remember..."\n`;
  }

  if (!config.gentleReminders) {
    identity += `- Don't remind the user about commitments or deadlines unless asked.\n`;
  }

  // Custom notes from learning or manual input
  if (config.communicationNotes) {
    identity += `\nADDITIONAL STYLE NOTES:\n${config.communicationNotes}\n`;
  }

  return identity;
}
