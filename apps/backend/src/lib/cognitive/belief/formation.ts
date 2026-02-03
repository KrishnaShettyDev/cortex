/**
 * Belief Formation Engine
 *
 * Transforms high-confidence learnings into beliefs.
 * Handles deduplication, conflict detection, and dependency tracking.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Ai } from '@cloudflare/workers-types';
import type { Learning } from '../types';
import type {
  Belief,
  BeliefType,
  BeliefFormationResult,
  BeliefConflict,
  CreateBeliefInput,
} from './types';
import { BeliefRepository } from './repository';
import { CONFIDENCE_THRESHOLDS } from './bayesian';
import { LearningRepository } from '../learning/repository';

// ============================================
// CONSTANTS
// ============================================

const LEARNING_TO_BELIEF_TYPE: Record<string, BeliefType> = {
  preference: 'preference',
  habit: 'state',
  relationship: 'relationship',
  work_pattern: 'state',
  health: 'state',
  interest: 'preference',
  routine: 'state',
  communication: 'preference',
  decision_style: 'identity',
  value: 'identity',
  goal: 'intention',
  skill: 'capability',
  other: 'fact',
};

// ============================================
// BELIEF FORMATION ENGINE
// ============================================

export class BeliefFormationEngine {
  private beliefRepo: BeliefRepository;
  private learningRepo: LearningRepository;

  constructor(
    private db: D1Database,
    private ai?: Ai
  ) {
    this.beliefRepo = new BeliefRepository(db);
    this.learningRepo = new LearningRepository(db);
  }

  /**
   * Form beliefs from high-confidence learnings
   */
  async formBeliefsFromLearnings(
    userId: string,
    options: {
      minConfidence?: number;
      maxLearnings?: number;
      category?: string;
    } = {}
  ): Promise<BeliefFormationResult> {
    const startTime = Date.now();
    const formed: Belief[] = [];
    const skipped: Array<{ learningId: string; reason: string }> = [];
    const conflicts: BeliefConflict[] = [];

    const minConfidence =
      options.minConfidence ?? CONFIDENCE_THRESHOLDS.FORMATION_MIN;

    // Get high-confidence learnings that haven't been converted to beliefs yet
    const { learnings } = await this.learningRepo.listLearnings(userId, {
      status: 'active',
      category: options.category as any,
      limit: options.maxLearnings ?? 100,
    });

    // Filter to high-confidence learnings
    const eligibleLearnings = learnings.filter(
      (l) => l.confidence >= minConfidence
    );

    for (const learning of eligibleLearnings) {
      try {
        const result = await this.formBeliefFromLearning(learning, userId);

        if (result.belief) {
          formed.push(result.belief);
          if (result.conflicts) {
            conflicts.push(...result.conflicts);
          }
        } else if (result.skipReason) {
          skipped.push({
            learningId: learning.id,
            reason: result.skipReason,
          });
        }
      } catch (error) {
        console.error(
          `[BeliefFormation] Error processing learning ${learning.id}:`,
          error
        );
        skipped.push({
          learningId: learning.id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      formed,
      skipped,
      conflicts,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Form a belief from a single learning
   */
  async formBeliefFromLearning(
    learning: Learning,
    userId: string
  ): Promise<{
    belief?: Belief;
    skipReason?: string;
    conflicts?: BeliefConflict[];
  }> {
    // Check if belief already exists for this learning
    const existingBeliefs = await this.beliefRepo.getBeliefsFromLearning(
      learning.id
    );
    if (existingBeliefs.length > 0) {
      return { skipReason: 'Belief already exists for this learning' };
    }

    // Map learning category to belief type
    const beliefType = LEARNING_TO_BELIEF_TYPE[learning.category] || 'fact';

    // Create proposition from learning
    const proposition = this.createProposition(learning);

    // Check for similar existing beliefs
    const similarBeliefs = await this.beliefRepo.findSimilarBeliefs(
      userId,
      proposition,
      beliefType
    );

    // Check for potential conflicts
    const conflicts: BeliefConflict[] = [];

    if (similarBeliefs.length > 0) {
      // Check if any similar belief contradicts this one
      for (const existing of similarBeliefs) {
        const conflictCheck = await this.checkConflict(
          proposition,
          existing.proposition,
          learning
        );

        if (conflictCheck.isConflict) {
          // Record the conflict
          const conflict = await this.beliefRepo.recordConflict(
            existing.id,
            'PENDING', // Will be updated after creation
            conflictCheck.type,
            conflictCheck.description
          );
          conflicts.push(conflict);
        }

        // If very similar, update existing instead of creating new
        if (conflictCheck.isDuplicate) {
          // Reinforce existing belief
          await this.beliefRepo.applyBayesianUpdate({
            beliefId: existing.id,
            userId,
            evidenceStrength: learning.confidence,
            supports: true,
            reason: `Reinforced by learning: ${learning.id}`,
          });

          return {
            skipReason: `Merged with existing belief: ${existing.id}`,
          };
        }
      }
    }

    // Create the belief
    const beliefInput: CreateBeliefInput = {
      userId,
      proposition,
      beliefType,
      domain: learning.category,
      priorConfidence: learning.confidence,
      derivedFromLearning: learning.id,
      sourceLearningId: learning.id,
    };

    const belief = await this.beliefRepo.createBelief(beliefInput);

    // Update conflict records with the new belief ID
    for (const conflict of conflicts) {
      if (conflict.beliefBId === 'PENDING') {
        await this.db
          .prepare('UPDATE belief_conflicts SET belief_b_id = ? WHERE id = ?')
          .bind(belief.id, conflict.id)
          .run();
        conflict.beliefBId = belief.id;
      }
    }

    return { belief, conflicts };
  }

  /**
   * Create a proposition statement from a learning
   */
  private createProposition(learning: Learning): string {
    // The learning statement is already a proposition, use it directly
    let proposition = learning.statement;

    // Clean up and normalize
    proposition = proposition.trim();

    // Ensure it ends properly
    if (!proposition.endsWith('.') && !proposition.endsWith('!')) {
      proposition += '.';
    }

    return proposition;
  }

  /**
   * Check for conflicts between propositions
   */
  private async checkConflict(
    newProposition: string,
    existingProposition: string,
    learning: Learning
  ): Promise<{
    isConflict: boolean;
    isDuplicate: boolean;
    type: 'contradiction' | 'overlap' | 'temporal';
    description: string;
  }> {
    // Simple heuristic-based conflict detection
    // In production, use LLM for semantic comparison

    const newLower = newProposition.toLowerCase();
    const existingLower = existingProposition.toLowerCase();

    // Check for near-duplicate (high word overlap)
    const newWords = new Set(newLower.split(/\s+/).filter((w) => w.length > 3));
    const existingWords = new Set(
      existingLower.split(/\s+/).filter((w) => w.length > 3)
    );

    const intersection = [...newWords].filter((w) => existingWords.has(w));
    const overlapRatio =
      intersection.length / Math.min(newWords.size, existingWords.size);

    if (overlapRatio > 0.8) {
      return {
        isConflict: false,
        isDuplicate: true,
        type: 'overlap',
        description: 'Near-duplicate proposition',
      };
    }

    // Check for contradiction keywords
    const contradictionPatterns = [
      { positive: /likes?|loves?|enjoys?|prefers?/i, negative: /hates?|dislikes?|avoids?/i },
      { positive: /always|every|constantly/i, negative: /never|rarely|seldom/i },
      { positive: /can|able to|capable/i, negative: /cannot|unable|incapable/i },
      { positive: /is a|works as|employed/i, negative: /is not|isn't|no longer/i },
    ];

    for (const pattern of contradictionPatterns) {
      const newHasPositive = pattern.positive.test(newProposition);
      const newHasNegative = pattern.negative.test(newProposition);
      const existingHasPositive = pattern.positive.test(existingProposition);
      const existingHasNegative = pattern.negative.test(existingProposition);

      // Check if they're about the same topic but with opposite sentiment
      if (overlapRatio > 0.4) {
        if (
          (newHasPositive && existingHasNegative) ||
          (newHasNegative && existingHasPositive)
        ) {
          return {
            isConflict: true,
            isDuplicate: false,
            type: 'contradiction',
            description: `Potential contradiction: "${newProposition}" vs "${existingProposition}"`,
          };
        }
      }
    }

    // Check for temporal conflict (same topic, different time periods)
    const timePatterns = /\b(now|currently|used to|before|previously|lately|recently)\b/i;
    if (
      overlapRatio > 0.5 &&
      timePatterns.test(newProposition) &&
      timePatterns.test(existingProposition)
    ) {
      return {
        isConflict: true,
        isDuplicate: false,
        type: 'temporal',
        description: `Possible temporal conflict: beliefs may apply to different time periods`,
      };
    }

    return {
      isConflict: false,
      isDuplicate: false,
      type: 'overlap',
      description: '',
    };
  }

  /**
   * Run belief formation backfill for existing high-confidence learnings
   */
  async runFormationBackfill(
    userId: string,
    options: {
      batchSize?: number;
      onProgress?: (processed: number, formed: number) => void;
    } = {}
  ): Promise<BeliefFormationResult> {
    const batchSize = options.batchSize ?? 50;
    let offset = 0;
    let totalProcessed = 0;

    const allFormed: Belief[] = [];
    const allSkipped: Array<{ learningId: string; reason: string }> = [];
    const allConflicts: BeliefConflict[] = [];
    const startTime = Date.now();

    while (true) {
      const result = await this.formBeliefsFromLearnings(userId, {
        minConfidence: CONFIDENCE_THRESHOLDS.FORMATION_MIN,
        maxLearnings: batchSize,
      });

      allFormed.push(...result.formed);
      allSkipped.push(...result.skipped);
      allConflicts.push(...result.conflicts);

      totalProcessed += result.formed.length + result.skipped.length;

      if (options.onProgress) {
        options.onProgress(totalProcessed, allFormed.length);
      }

      // If we got fewer than batch size, we're done
      if (result.formed.length + result.skipped.length < batchSize) {
        break;
      }

      offset += batchSize;

      // Safety limit
      if (offset > 10000) {
        console.warn('[BeliefFormation] Hit safety limit of 10000 learnings');
        break;
      }
    }

    return {
      formed: allFormed,
      skipped: allSkipped,
      conflicts: allConflicts,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ============================================
// CONVENIENCE FUNCTION
// ============================================

/**
 * Form beliefs from learnings for a user
 */
export async function formBeliefsFromLearnings(
  db: D1Database,
  userId: string,
  options?: {
    minConfidence?: number;
    maxLearnings?: number;
  }
): Promise<BeliefFormationResult> {
  const engine = new BeliefFormationEngine(db);
  return engine.formBeliefsFromLearnings(userId, options);
}
