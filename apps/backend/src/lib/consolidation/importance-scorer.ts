/**
 * Importance Scorer
 *
 * Calculates memory importance scores based on multiple factors:
 * - Content analysis (what it's about)
 * - Recency (newer = more important)
 * - Access patterns (more accessed = more important)
 * - Entity importance (mentions of important people/companies)
 * - Commitments (contains promises/deadlines)
 */

import type { ImportanceScore, ScoringContext } from './types';
import { ImportanceScoringError } from './types';
import type { Memory } from '../db/memories';
import { getMemoryEntities } from '../db/entities';

export class ImportanceScorer {
  private db: D1Database;
  private ai: any;

  // Scoring weights
  private static readonly WEIGHTS = {
    content: 0.3,
    recency: 0.2,
    access: 0.2,
    entities: 0.2,
    commitments: 0.1,
  };

  // Decay parameters
  private static readonly DECAY_HALF_LIFE_DAYS = 30; // Importance halves every 30 days
  private static readonly MAX_AGE_DAYS = 180; // 6 months

  constructor(db: D1Database, ai: any) {
    this.db = db;
    this.ai = ai;
  }

  /**
   * Score a memory's importance
   */
  async scoreMemory(
    memory: Memory,
    context: ScoringContext
  ): Promise<ImportanceScore> {
    try {
      // Calculate individual factors
      const contentScore = await this.analyzeContent(memory.content);
      const recencyScore = this.calculateRecency(
        memory.created_at,
        context.current_date
      );
      const accessScore = this.calculateAccessScore(
        context.access_count || 0,
        context.last_accessed
      );
      const entitiesScore = await this.calculateEntityScore(memory.id);
      const commitmentsScore = await this.hasCommitments(memory.id) ? 0.3 : 0;

      // Weighted average
      const finalScore =
        contentScore * ImportanceScorer.WEIGHTS.content +
        recencyScore * ImportanceScorer.WEIGHTS.recency +
        accessScore * ImportanceScorer.WEIGHTS.access +
        entitiesScore * ImportanceScorer.WEIGHTS.entities +
        commitmentsScore * ImportanceScorer.WEIGHTS.commitments;

      return {
        memory_id: memory.id,
        score: Math.min(1, Math.max(0, finalScore)),
        factors: {
          content: contentScore,
          recency: recencyScore,
          access: accessScore,
          entities: entitiesScore,
          commitments: commitmentsScore,
        },
        calculated_at: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[ImportanceScorer] Scoring failed:', error);
      throw new ImportanceScoringError(
        `Failed to score memory ${memory.id}: ${error.message}`,
        true,
        { memory_id: memory.id }
      );
    }
  }

  /**
   * Analyze content importance using rule-based scoring (OPTIMIZED - no LLM)
   *
   * Previously used LLM which added ~600ms per memory.
   * Now uses keyword matching and heuristics for <5ms scoring.
   */
  private async analyzeContent(content: string): Promise<number> {
    const lowerContent = content.toLowerCase();
    let score = 0.4; // Base score

    // === Critical Indicators (boost to 0.9-1.0) ===
    const criticalKeywords = [
      'major decision', 'life changing', 'milestone', 'promotion', 'fired',
      'hired', 'resigned', 'married', 'engaged', 'pregnant', 'born', 'died',
      'acquisition', 'ipo', 'funding round', 'series a', 'series b', 'series c',
      'closed the deal', 'signed the contract', 'accepted the offer',
    ];
    if (criticalKeywords.some(k => lowerContent.includes(k))) {
      score = 0.95;
    }

    // === High Importance Indicators (boost to 0.7-0.85) ===
    const highKeywords = [
      'decision', 'decided', 'commitment', 'promise', 'deadline', 'due date',
      'important', 'critical', 'urgent', 'priority', 'must', 'need to',
      'meeting with', 'call with', 'presentation', 'review', 'interview',
      'project', 'launch', 'release', 'deliver', 'ship',
      'ceo', 'cto', 'founder', 'investor', 'partner', 'client', 'customer',
    ];
    const highMatches = highKeywords.filter(k => lowerContent.includes(k)).length;
    if (highMatches >= 3) {
      score = Math.max(score, 0.85);
    } else if (highMatches >= 2) {
      score = Math.max(score, 0.75);
    } else if (highMatches >= 1) {
      score = Math.max(score, 0.65);
    }

    // === Medium Importance Indicators ===
    const mediumKeywords = [
      'plan', 'strategy', 'goal', 'objective', 'target',
      'update', 'progress', 'status', 'sync', 'standup',
      'learned', 'discovered', 'realized', 'insight',
      'feedback', 'suggestion', 'recommendation',
    ];
    const mediumMatches = mediumKeywords.filter(k => lowerContent.includes(k)).length;
    if (mediumMatches >= 2) {
      score = Math.max(score, 0.55);
    }

    // === Low Importance Indicators (reduce score) ===
    const lowKeywords = [
      'random thought', 'just thinking', 'wondering', 'maybe',
      'weather', 'lunch', 'coffee', 'tired', 'bored',
      'test', 'testing', 'ignore', 'delete this',
    ];
    if (lowKeywords.some(k => lowerContent.includes(k))) {
      score = Math.min(score, 0.3);
    }

    // === Content Quality Signals ===

    // Length suggests detail (longer = more context = more valuable)
    if (content.length > 500) score += 0.08;
    else if (content.length > 200) score += 0.04;
    else if (content.length < 30) score -= 0.1; // Very short = low value

    // Questions suggest active thinking/discussion
    const questionCount = (content.match(/\?/g) || []).length;
    if (questionCount >= 2) score += 0.05;

    // Numbers often indicate specific details (dates, amounts, metrics)
    const hasNumbers = /\d+/.test(content);
    if (hasNumbers) score += 0.03;

    // Proper nouns (capitalized words) suggest named entities
    const properNouns = content.match(/\b[A-Z][a-z]+\b/g) || [];
    if (properNouns.length >= 3) score += 0.05;

    // Email addresses suggest contacts
    if (/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(content)) score += 0.05;

    // Money amounts suggest financial importance
    if (/\$[\d,]+|\d+k|\d+m|\d+ million|\d+ thousand/i.test(content)) score += 0.1;

    // Clamp to valid range
    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Calculate recency score (newer = higher score)
   * Uses exponential decay
   */
  private calculateRecency(createdAt: string, currentDate: Date): number {
    const created = new Date(createdAt);
    const ageMs = currentDate.getTime() - created.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Exponential decay: score = 2^(-age/half_life)
    const score = Math.pow(
      2,
      -ageDays / ImportanceScorer.DECAY_HALF_LIFE_DAYS
    );

    return Math.max(0.1, Math.min(1, score)); // Floor at 0.1
  }

  /**
   * Calculate access score (more accessed = higher score)
   */
  private calculateAccessScore(
    accessCount: number,
    lastAccessed?: string
  ): number {
    if (accessCount === 0) {
      return 0.1; // Minimum score for never accessed
    }

    // Base score from access count (logarithmic)
    const countScore = Math.log10(accessCount + 1) / Math.log10(100); // Normalize to 0-1

    // Recency bonus (recently accessed = more important)
    let recencyBonus = 0;
    if (lastAccessed) {
      const lastAccessedDate = new Date(lastAccessed);
      const daysSinceAccess =
        (new Date().getTime() - lastAccessedDate.getTime()) /
        (1000 * 60 * 60 * 24);
      recencyBonus = daysSinceAccess < 7 ? 0.2 : daysSinceAccess < 30 ? 0.1 : 0;
    }

    return Math.min(1, countScore + recencyBonus);
  }

  /**
   * Calculate entity importance score
   * Memories mentioning important entities are more important
   */
  private async calculateEntityScore(memoryId: string): Promise<number> {
    try {
      const entities = await getMemoryEntities(this.db, memoryId);

      if (entities.length === 0) {
        return 0.1; // No entities = lower importance
      }

      // Average importance of linked entities
      const avgImportance =
        entities.reduce((sum, e) => sum + e.importance_score, 0) /
        entities.length;

      // Boost for multiple high-importance entities
      const highImportanceCount = entities.filter(
        (e) => e.importance_score > 0.7
      ).length;
      const multiEntityBonus = highImportanceCount > 1 ? 0.2 : 0;

      return Math.min(1, avgImportance + multiEntityBonus);
    } catch (error) {
      console.error('[ImportanceScorer] Entity score calculation failed:', error);
      return 0.5;
    }
  }

  /**
   * Check if memory has commitments
   */
  private async hasCommitments(memoryId: string): Promise<boolean> {
    try {
      // Check if there are any commitments linked to this memory
      // For now, use simple heuristics (we'll implement full commitment tracking in Phase 4)
      const memory = await this.db
        .prepare('SELECT content FROM memories WHERE id = ?')
        .bind(memoryId)
        .first<{ content: string }>();

      if (!memory) return false;

      // Simple keyword matching for commitment detection
      const commitmentKeywords = [
        'will',
        'promise',
        'commit',
        'deadline',
        'due',
        'schedule',
        'meeting',
        'deliverable',
        'follow up',
        'remind',
        'need to',
        'must',
        'should',
      ];

      const content = memory.content.toLowerCase();
      return commitmentKeywords.some((keyword) => content.includes(keyword));
    } catch (error) {
      console.error('[ImportanceScorer] Commitment check failed:', error);
      return false;
    }
  }

  /**
   * Batch score multiple memories
   */
  async batchScore(
    memories: Memory[],
    context: ScoringContext
  ): Promise<ImportanceScore[]> {
    const scores: ImportanceScore[] = [];

    for (const memory of memories) {
      try {
        const score = await this.scoreMemory(memory, context);
        scores.push(score);
      } catch (error) {
        console.error(
          `[ImportanceScorer] Failed to score memory ${memory.id}:`,
          error
        );
        // Continue with next memory
      }
    }

    return scores;
  }

  /**
   * Update importance scores in database
   */
  async updateMemoryImportance(
    memoryId: string,
    score: number
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE memories SET importance_score = ?, updated_at = ? WHERE id = ?'
      )
      .bind(score, new Date().toISOString(), memoryId)
      .run();
  }
}

/**
 * Helper function to score a memory
 */
export async function scoreMemoryImportance(
  db: D1Database,
  ai: any,
  memory: Memory,
  context: ScoringContext
): Promise<ImportanceScore> {
  const scorer = new ImportanceScorer(db, ai);
  return scorer.scoreMemory(memory, context);
}
