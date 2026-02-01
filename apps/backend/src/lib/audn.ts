/**
 * AUDN Cycle - Smart Memory Deduplication
 *
 * Implements Mem0-style intelligent memory management:
 * - ADD: Completely new information
 * - UPDATE: Enhances/extends existing memory (keeps ID, creates version)
 * - DELETE: Contradicts existing memory (marks as outdated)
 * - NOOP: Already present, no action needed
 *
 * Uses LLM (GPT-4o-mini, temp=0.1) for deterministic decisions.
 *
 * Performance target:
 * - Accuracy: 70%+ (beat Mem0's 66.9%)
 * - Latency: <500ms p95
 * - Token usage: <1.5K per operation
 */

import { vectorSearch } from './vectorize';
import { getMemoryById, updateMemory, forgetMemory, type Memory } from './db/memories';

export interface AUDNDecision {
  action: 'add' | 'update' | 'delete' | 'noop';
  target_memory_id?: string; // For update/delete actions
  reason: string;
  confidence: number; // 0-1
}

export interface AUDNContext {
  new_content: string;
  similar_memories: Array<{
    id: string;
    content: string;
    score: number;
  }>;
}

/**
 * Determine what action to take with new memory
 */
export async function determineAUDNAction(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  userId: string,
  newContent: string,
  embedding: number[]
): Promise<AUDNDecision> {
  // 1. Find similar existing memories (top 5, score > 0.75)
  const similarMatches = await vectorSearch(env.VECTORIZE, embedding, userId, {
    topK: 5,
    minScore: 0.75,
    type: 'memory',
  });

  // If no similar memories, it's a clear ADD
  if (similarMatches.length === 0) {
    return {
      action: 'add',
      reason: 'No similar existing memories found',
      confidence: 1.0,
    };
  }

  // 2. Fetch full memory content
  const similarMemories = await Promise.all(
    similarMatches.map(async (match) => {
      const memory = await getMemoryById(env.DB, match.id);
      return {
        id: match.id,
        content: memory?.content || '',
        score: match.score,
      };
    })
  );

  // 3. Call LLM to make AUDN decision
  const decision = await callAUDNDecisionModel(env.AI, {
    new_content: newContent,
    similar_memories: similarMemories,
  });

  return decision;
}

/**
 * Call LLM to make AUDN decision
 */
async function callAUDNDecisionModel(
  ai: any,
  context: AUDNContext
): Promise<AUDNDecision> {
  const prompt = buildAUDNPrompt(context);

  // Use GPT-4o-mini with temp=0.1 for deterministic results
  const response = await ai.run('@cf/openai/gpt-4o-mini', {
    messages: [
      {
        role: 'system',
        content: AUDN_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.1,
    max_tokens: 200,
  });

  // Parse JSON response
  try {
    const parsed = JSON.parse(response.response);
    return {
      action: parsed.action,
      target_memory_id: parsed.target_memory_id,
      reason: parsed.reason,
      confidence: parsed.confidence || 0.8,
    };
  } catch (error) {
    console.error('[AUDN] Failed to parse LLM response:', error);
    // Fallback to ADD if parsing fails
    return {
      action: 'add',
      reason: 'Failed to determine action, defaulting to ADD',
      confidence: 0.5,
    };
  }
}

/**
 * Build prompt for AUDN decision
 */
function buildAUDNPrompt(context: AUDNContext): string {
  const similarMemoriesText = context.similar_memories
    .map((m, i) => `${i + 1}. [ID: ${m.id}, Score: ${m.score.toFixed(2)}]\n   "${m.content}"`)
    .join('\n\n');

  return `
NEW MEMORY:
"${context.new_content}"

EXISTING SIMILAR MEMORIES:
${similarMemoriesText}

Analyze the new memory against existing memories and decide the appropriate action.

Return ONLY valid JSON with this structure:
{
  "action": "add|update|delete|noop",
  "target_memory_id": "memory_id_if_applicable",
  "reason": "brief explanation",
  "confidence": 0.0-1.0
}

Decision rules:
- ADD: New information not covered by existing memories
- UPDATE: Enhances/extends an existing memory (provide target_memory_id)
- DELETE: Directly contradicts an existing memory (provide target_memory_id)
- NOOP: Information already present, no action needed

Choose the action that best preserves memory accuracy and prevents duplication.
`.trim();
}

/**
 * System prompt for AUDN model
 */
const AUDN_SYSTEM_PROMPT = `You are a memory management AI that determines how to handle new information.

Your job is to analyze new memories against existing ones and decide:
- ADD: If it's genuinely new information
- UPDATE: If it enhances/extends existing memory
- DELETE: If it contradicts existing memory
- NOOP: If it's already captured

Key principles:
1. Prefer UPDATE over ADD when information is related
2. Use DELETE only for direct contradictions (e.g., "moved to NYC" vs "moved to LA")
3. Use NOOP for near-duplicates
4. Be conservative - when uncertain, choose ADD

Return only valid JSON. No additional text.`;

/**
 * Apply AUDN decision to database
 */
export async function applyAUDNDecision(
  env: { DB: D1Database; VECTORIZE: Vectorize },
  userId: string,
  newContent: string,
  decision: AUDNDecision,
  embedding: number[]
): Promise<{ action: string; memory_id: string }> {
  switch (decision.action) {
    case 'add':
      // Create new memory (handled by caller)
      return { action: 'add', memory_id: '' };

    case 'update':
      if (!decision.target_memory_id) {
        throw new Error('UPDATE action requires target_memory_id');
      }

      // Update existing memory (creates new version)
      const updatedMemory = await updateMemory(env.DB, {
        memoryId: decision.target_memory_id,
        newContent,
        relationType: 'updates',
      });

      console.log(`[AUDN] Updated memory ${decision.target_memory_id} -> ${updatedMemory.id}`);

      return { action: 'update', memory_id: updatedMemory.id };

    case 'delete':
      if (!decision.target_memory_id) {
        throw new Error('DELETE action requires target_memory_id');
      }

      // Soft delete (forget) the contradicted memory
      await forgetMemory(env.DB, decision.target_memory_id);

      console.log(`[AUDN] Deleted (forgot) memory ${decision.target_memory_id}`);

      // Still create the new memory (handled by caller)
      return { action: 'delete_and_add', memory_id: '' };

    case 'noop':
      console.log('[AUDN] No action needed, memory already exists');
      return { action: 'noop', memory_id: decision.target_memory_id || '' };

    default:
      console.warn(`[AUDN] Unknown action: ${decision.action}, defaulting to ADD`);
      return { action: 'add', memory_id: '' };
  }
}

/**
 * Full AUDN pipeline for new memory
 */
export async function processMemoryWithAUDN(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  userId: string,
  newContent: string,
  embedding: number[]
): Promise<{
  action: string;
  memory_id: string;
  decision: AUDNDecision;
}> {
  // 1. Determine action
  const decision = await determineAUDNAction(env, userId, newContent, embedding);

  console.log(`[AUDN] Decision: ${decision.action} (confidence: ${decision.confidence})`);
  console.log(`[AUDN] Reason: ${decision.reason}`);

  // 2. Apply action
  const result = await applyAUDNDecision(env, userId, newContent, decision, embedding);

  return {
    ...result,
    decision,
  };
}
