/**
 * Temporal Conflict Resolver
 *
 * Handles contradictions and updates in temporal context.
 * Implements sophisticated AUDN logic with temporal awareness.
 *
 * Examples:
 * - "I love Adidas" → "Adidas sucks, switching to Puma" = SUPERSEDE (preference changed)
 * - "Met Sarah" → "Sarah from Lightspeed gave great feedback" = UPDATE (adding detail)
 * - "Had coffee Monday" → "Had lunch Wednesday" = ADD (separate events)
 * - "Met Sarah at conference" → "I met Sarah at the conference" = NOOP (duplicate)
 */

import type { ConflictResolution, TemporalMemory } from './types';
import { ConflictResolutionError } from './types';
import { vectorSearch, generateEmbedding } from '../vectorize';

export class TemporalConflictResolver {
  private db: D1Database;
  private vectorize: Vectorize;
  private ai: any;

  constructor(db: D1Database, vectorize: Vectorize, ai: any) {
    this.db = db;
    this.vectorize = vectorize;
    this.ai = ai;
  }

  /**
   * Resolve conflict between new memory and existing memories
   */
  async resolveConflict(
    newMemory: {
      content: string;
      event_date?: string;
      created_at: string;
      user_id: string;
      container_tag: string;
    }
  ): Promise<ConflictResolution> {
    try {
      // Find potentially conflicting memories via vector search
      const embedding = await generateEmbedding({ AI: this.ai }, newMemory.content);

      const candidates = await vectorSearch(
        this.vectorize,
        embedding,
        newMemory.user_id,
        {
          containerTag: newMemory.container_tag,
          limit: 5,
          scoreThreshold: 0.85, // High similarity threshold
        }
      );

      if (candidates.length === 0) {
        return {
          action: 'add',
          reason: 'No similar memories found',
          confidence: 1.0,
        };
      }

      // Fetch full memory details
      const existingMemories = await this.fetchMemoryDetails(
        candidates.map((c) => c.id)
      );

      // Use LLM to analyze conflict
      return await this.analyzeConflict(newMemory, existingMemories);
    } catch (error: any) {
      console.error('[TemporalConflictResolver] Resolution failed:', error);
      // Default to ADD on error (fail open)
      return {
        action: 'add',
        reason: `Conflict resolution failed: ${error.message}`,
        confidence: 0.5,
      };
    }
  }

  /**
   * Fetch full memory details
   */
  private async fetchMemoryDetails(memoryIds: string[]): Promise<TemporalMemory[]> {
    if (memoryIds.length === 0) return [];

    const placeholders = memoryIds.map(() => '?').join(',');
    const query = `
      SELECT id, user_id, content, valid_from, valid_to, event_date,
             supersedes, superseded_by, memory_type, created_at, updated_at
      FROM memories
      WHERE id IN (${placeholders})
        AND valid_to IS NULL
      ORDER BY created_at DESC
    `;

    const result = await this.db
      .prepare(query)
      .bind(...memoryIds)
      .all<TemporalMemory>();

    return result.results || [];
  }

  /**
   * Analyze conflict using LLM
   */
  private async analyzeConflict(
    newMemory: any,
    existingMemories: TemporalMemory[]
  ): Promise<ConflictResolution> {
    const prompt = this.buildConflictPrompt(newMemory, existingMemories);

    try {
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a temporal conflict resolution expert. Determine how a new memory relates to existing memories. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      });

      return this.parseConflictResponse(response.response, existingMemories);
    } catch (error) {
      console.error('[TemporalConflictResolver] LLM analysis failed:', error);
      return {
        action: 'add',
        reason: 'LLM analysis failed, defaulting to ADD',
        confidence: 0.5,
      };
    }
  }

  /**
   * Build conflict analysis prompt
   */
  private buildConflictPrompt(
    newMemory: any,
    existingMemories: TemporalMemory[]
  ): string {
    return `Analyze the relationship between this new memory and existing similar memories.

NEW MEMORY:
- Content: "${newMemory.content}"
- Event Date: ${newMemory.event_date || 'unknown'}
- Created At: ${newMemory.created_at}

EXISTING MEMORIES:
${existingMemories
  .map(
    (m, i) => `
${i + 1}. ID: ${m.id}
   Content: "${m.content}"
   Valid From: ${m.valid_from}
   Valid To: ${m.valid_to || 'present (still true)'}
   Event Date: ${m.event_date || 'unknown'}
   Type: ${m.memory_type}
`
  )
  .join('\n')}

DETERMINE THE RELATIONSHIP:

**SUPERSEDE** - New memory contradicts or negates existing memory
Examples:
- Old: "I love Adidas" → New: "Adidas sucks, switching to Puma"
- Old: "Sarah works at Google" → New: "Sarah joined Lightspeed as Partner"
- Old: "My favorite food is pizza" → New: "I'm now vegetarian, no more pizza"
Action: Set valid_to on old memory (knowledge changed), create new memory

**UPDATE** - New memory adds detail WITHOUT contradiction
Examples:
- Old: "Met Sarah" → New: "Sarah from Lightspeed gave great feedback"
- Old: "Had a meeting" → New: "The meeting went well, signed the deal"
- Old: "Visited SF" → New: "Had coffee at Blue Bottle in SF"
Action: Can merge (episodic) or create new with reference (semantic)

**ADD** - New memory is independent event despite similarity
Examples:
- Old: "Had coffee with Sarah on Monday" → New: "Had lunch with Sarah on Wednesday"
- Old: "Read about AI in January" → New: "Read about AI in February"
- Old: "Meeting at 2pm" → New: "Meeting at 4pm" (different times)
Action: Create new memory, they're separate events

**NOOP** - New memory is redundant/duplicate
Examples:
- Old: "Met Sarah at the conference" → New: "I met Sarah at the conference"
- Old: "Love hiking in mountains" → New: "I enjoy hiking in the mountains"
- Old: "Work at Google" → New: "I work at Google"
Action: Don't create duplicate, existing memory is sufficient

RESPONSE FORMAT (JSON only):
{
  "action": "supersede" | "update" | "add" | "noop",
  "existing_memory_id": "uuid" (if supersede/update/noop) or null (if add),
  "valid_to_date": "2025-01-15T00:00:00Z" (if supersede) or null,
  "reason": "brief explanation",
  "confidence": 0.9
}

Analyze now:`;
  }

  /**
   * Parse conflict resolution response
   */
  private parseConflictResponse(
    response: string,
    existingMemories: TemporalMemory[]
  ): ConflictResolution {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate action
      if (!['add', 'update', 'supersede', 'noop'].includes(parsed.action)) {
        throw new Error(`Invalid action: ${parsed.action}`);
      }

      // If supersede, ensure valid_to_date is set (default to now)
      let valid_to_date = parsed.valid_to_date;
      if (parsed.action === 'supersede' && !valid_to_date) {
        valid_to_date = new Date().toISOString();
      }

      return {
        action: parsed.action,
        existing_memory_id: parsed.existing_memory_id || existingMemories[0]?.id,
        valid_to_date,
        reason: parsed.reason || 'No reason provided',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
      };
    } catch (error) {
      console.error('[TemporalConflictResolver] Failed to parse response:', error);
      return {
        action: 'add',
        reason: 'Failed to parse LLM response',
        confidence: 0.5,
      };
    }
  }

  /**
   * Execute conflict resolution
   */
  async executeResolution(
    resolution: ConflictResolution,
    newMemoryId: string
  ): Promise<void> {
    if (resolution.action === 'noop') {
      // Delete the new memory (it's redundant)
      await this.db
        .prepare('DELETE FROM memories WHERE id = ?')
        .bind(newMemoryId)
        .run();
      return;
    }

    if (resolution.action === 'supersede' && resolution.existing_memory_id) {
      // Set valid_to on existing memory
      await this.db
        .prepare(
          `UPDATE memories
           SET valid_to = ?,
               superseded_by = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .bind(
          resolution.valid_to_date || new Date().toISOString(),
          newMemoryId,
          new Date().toISOString(),
          resolution.existing_memory_id
        )
        .run();

      // Set supersedes on new memory
      await this.db
        .prepare(
          `UPDATE memories
           SET supersedes = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .bind(
          resolution.existing_memory_id,
          new Date().toISOString(),
          newMemoryId
        )
        .run();
    }

    // For 'add' and 'update', no additional action needed
    // New memory already exists, just leave it as is
  }
}

/**
 * Helper function to resolve conflicts
 */
export async function resolveMemoryConflict(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  newMemory: {
    content: string;
    event_date?: string;
    created_at: string;
    user_id: string;
    container_tag: string;
  }
): Promise<ConflictResolution> {
  const resolver = new TemporalConflictResolver(env.DB, env.VECTORIZE, env.AI);
  return resolver.resolveConflict(newMemory);
}
