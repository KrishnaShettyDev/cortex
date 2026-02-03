/**
 * Intelligent Recall
 *
 * Enhanced recall that:
 * 1. Uses beliefs and learnings to inform responses
 * 2. Tracks what sources were used
 * 3. Records outcomes for the learning loop
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Ai, VectorizeIndex } from '@cloudflare/workers-types';

import { LearningRepository } from '../learning/repository';
import { BeliefRepository } from '../belief/repository';
import { OutcomeRepository } from './repository';
import type {
  RecordOutcomeInput,
  ReasoningTrace,
} from './types';
import type { Learning } from '../types';
import type { Belief } from '../belief/types';

// ============================================
// TYPES
// ============================================

export interface RecallInput {
  userId: string;
  query: string;
  context?: string;
  limit?: number;
  includeBeliefs?: boolean;
  includeLearnings?: boolean;
}

export interface RecallResult {
  /** The response content */
  response: string;

  /** Memories that were retrieved */
  memories: Array<{
    id: string;
    content: string;
    relevanceScore: number;
  }>;

  /** Learnings that informed the response */
  learnings: Learning[];

  /** Beliefs that informed the response */
  beliefs: Belief[];

  /** Reasoning trace for explainability */
  reasoningTrace: ReasoningTrace;

  /** Outcome ID for feedback tracking */
  outcomeId: string;

  /** Processing time in ms */
  processingTimeMs: number;
}

// ============================================
// RECALL CLASS
// ============================================

export class IntelligentRecall {
  constructor(
    private readonly db: D1Database,
    private readonly ai: Ai,
    private readonly vectorize: VectorizeIndex,
    private readonly learningRepository: LearningRepository,
    private readonly beliefRepository: BeliefRepository,
    private readonly outcomeRepository: OutcomeRepository
  ) {}

  /**
   * Perform intelligent recall
   */
  async recall(input: RecallInput): Promise<RecallResult> {
    const startTime = Date.now();
    const limit = input.limit ?? 10;

    // 1. Get relevant memories via vector search
    const memories = await this.searchMemories(input.userId, input.query, limit);

    // 2. Get relevant learnings
    const learnings =
      input.includeLearnings !== false
        ? await this.getRelevantLearnings(input.userId, input.query, 5)
        : [];

    // 3. Get relevant beliefs
    const beliefs =
      input.includeBeliefs !== false
        ? await this.getRelevantBeliefs(input.userId, input.query, 5)
        : [];

    // 4. Build context for LLM
    const contextStr = this.buildContext(memories, learnings, beliefs, input.context);

    // 5. Generate response
    const response = await this.generateResponse(input.query, contextStr);

    // 6. Build reasoning trace
    const reasoningTrace = this.buildReasoningTrace(
      input.query,
      memories,
      learnings,
      beliefs
    );

    // 7. Record outcome for learning loop
    const outcomeId = await this.recordOutcome(
      input.userId,
      input.query,
      response,
      reasoningTrace,
      memories,
      learnings,
      beliefs
    );

    console.log('[IntelligentRecall] Recall complete', {
      userId: input.userId,
      memoriesUsed: memories.length,
      learningsUsed: learnings.length,
      beliefsUsed: beliefs.length,
      processingTimeMs: Date.now() - startTime,
    });

    return {
      response,
      memories,
      learnings,
      beliefs,
      reasoningTrace,
      outcomeId,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Search memories using vector similarity
   */
  private async searchMemories(
    userId: string,
    query: string,
    limit: number
  ): Promise<Array<{ id: string; content: string; relevanceScore: number }>> {
    // Generate embedding for query
    const embeddingResult = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: query,
    });

    const queryVector = (embeddingResult as { data?: number[][] }).data?.[0];
    if (!queryVector) {
      return [];
    }

    // Search vectors
    const searchResult = await this.vectorize.query(queryVector, {
      topK: limit * 2, // Get more to filter by user
      filter: { user_id: userId },
      returnMetadata: 'all',
    });

    // Get memory content
    const memoryIds = searchResult.matches.map((m) => m.id);
    if (memoryIds.length === 0) {
      return [];
    }

    const placeholders = memoryIds.map(() => '?').join(', ');
    const memoriesResult = await this.db
      .prepare(
        `SELECT id, content
        FROM memories
        WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .bind(...memoryIds, userId)
      .all<{ id: string; content: string }>();

    const contentMap = new Map(
      (memoriesResult.results ?? []).map((m) => [m.id, m.content])
    );

    return searchResult.matches
      .filter((m) => contentMap.has(m.id))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        content: contentMap.get(m.id)!,
        relevanceScore: m.score,
      }));
  }

  /**
   * Get learnings relevant to the query
   */
  private async getRelevantLearnings(
    userId: string,
    query: string,
    limit: number
  ): Promise<Learning[]> {
    // Get active learnings with high confidence
    const { learnings } = await this.learningRepository.listLearnings(userId, {
      status: 'active',
      limit: 50,
    });

    // Filter to high confidence
    const highConfidence = learnings.filter((l) => l.confidence >= 0.5);

    // Simple relevance scoring based on keyword overlap
    const queryWords = new Set(
      query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    );

    const scored = highConfidence.map((learning) => {
      const statementWords = new Set(
        learning.statement.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      );
      const overlap = [...queryWords].filter((w) => statementWords.has(w)).length;
      return { learning, score: overlap + learning.confidence };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter((s) => s.score > 0.5)
      .map((s) => s.learning);
  }

  /**
   * Get beliefs relevant to the query
   */
  private async getRelevantBeliefs(
    userId: string,
    query: string,
    limit: number
  ): Promise<Belief[]> {
    const { beliefs } = await this.beliefRepository.queryBeliefs({
      userId,
      status: ['active'],
      minConfidence: 0.6,
      limit: 50,
    });

    // Simple relevance scoring
    const queryWords = new Set(
      query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    );

    const scored = beliefs.map((belief) => {
      const propWords = new Set(
        belief.proposition.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      );
      const overlap = [...queryWords].filter((w) => propWords.has(w)).length;
      return { belief, score: overlap + belief.currentConfidence };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter((s) => s.score > 0.6)
      .map((s) => s.belief);
  }

  /**
   * Build context string for LLM
   */
  private buildContext(
    memories: Array<{ id: string; content: string; relevanceScore: number }>,
    learnings: Learning[],
    beliefs: Belief[],
    additionalContext?: string
  ): string {
    const parts: string[] = [];

    if (beliefs.length > 0) {
      parts.push('USER BELIEFS (things I know about this user):');
      for (const belief of beliefs) {
        parts.push(
          `- ${belief.proposition} (confidence: ${(belief.currentConfidence * 100).toFixed(0)}%)`
        );
      }
      parts.push('');
    }

    if (learnings.length > 0) {
      parts.push("USER PATTERNS (things I've learned about this user):");
      for (const learning of learnings) {
        parts.push(`- ${learning.statement}`);
      }
      parts.push('');
    }

    if (memories.length > 0) {
      parts.push('RELEVANT MEMORIES:');
      for (const memory of memories) {
        parts.push(`- ${memory.content}`);
      }
      parts.push('');
    }

    if (additionalContext) {
      parts.push('ADDITIONAL CONTEXT:');
      parts.push(additionalContext);
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Generate response using LLM
   */
  private async generateResponse(query: string, context: string): Promise<string> {
    const systemPrompt = `You are a helpful assistant with knowledge about the user.
Use the provided context to personalize your response.
Be natural and conversational. Don't explicitly mention that you're using beliefs or memories.
If the context doesn't help, answer based on general knowledge.`;

    const userPrompt = `${context}

USER QUERY: ${query}

Please respond naturally, using the context above to personalize your answer.`;

    const response = await this.ai.run('@cf/meta/llama-3.1-70b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    return (
      (response as { response?: string }).response ??
      'I apologize, but I was unable to generate a response.'
    );
  }

  /**
   * Build reasoning trace for explainability
   */
  private buildReasoningTrace(
    query: string,
    memories: Array<{ id: string; content: string; relevanceScore: number }>,
    learnings: Learning[],
    beliefs: Belief[]
  ): ReasoningTrace {
    return {
      summary: `Retrieved ${memories.length} memories, applied ${learnings.length} learnings, and used ${beliefs.length} beliefs to answer: "${query.slice(0, 50)}..."`,
      memories: memories.map((m) => ({
        id: m.id,
        relevanceScore: m.relevanceScore,
        snippet: m.content.slice(0, 100) + (m.content.length > 100 ? '...' : ''),
      })),
      learnings: learnings.map((l) => ({
        id: l.id,
        insight: l.statement,
        confidence: l.confidence,
      })),
      beliefs: beliefs.map((b) => ({
        id: b.id,
        proposition: b.proposition,
        confidence: b.currentConfidence,
      })),
      selectionRationale:
        'Sources selected based on semantic relevance to query and confidence scores.',
    };
  }

  /**
   * Record outcome for learning loop
   */
  private async recordOutcome(
    userId: string,
    query: string,
    response: string,
    reasoningTrace: ReasoningTrace,
    memories: Array<{ id: string; content: string; relevanceScore: number }>,
    learnings: Learning[],
    beliefs: Belief[]
  ): Promise<string> {
    const sources: RecordOutcomeInput['sources'] = [];

    // Add memory sources
    for (const memory of memories) {
      sources.push({
        sourceType: 'memory',
        sourceId: memory.id,
        contributionWeight: memory.relevanceScore,
      });
    }

    // Add learning sources
    for (const learning of learnings) {
      sources.push({
        sourceType: 'learning',
        sourceId: learning.id,
        contributionWeight: learning.confidence,
      });
    }

    // Add belief sources
    for (const belief of beliefs) {
      sources.push({
        sourceType: 'belief',
        sourceId: belief.id,
        contributionWeight: belief.currentConfidence,
      });
    }

    const outcome = await this.outcomeRepository.recordOutcome({
      userId,
      actionType: 'recall',
      actionContent: response,
      actionContext: { query },
      reasoningTrace,
      sources,
    });

    return outcome.id;
  }
}
