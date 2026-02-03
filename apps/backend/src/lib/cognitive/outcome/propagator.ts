/**
 * Feedback Propagator
 *
 * Propagates outcome feedback to update learning and belief confidence.
 * This is the key mechanism that makes the system self-improving.
 */

import type { D1Database } from '@cloudflare/workers-types';

import { LearningRepository } from '../learning/repository';
import { BeliefRepository } from '../belief/repository';
import { OutcomeRepository } from './repository';
import type {
  OutcomeSignal,
  OutcomeWithSources,
  PropagationResult,
  PropagationWeights,
  SourceType,
} from './types';

// ============================================
// DEFAULT WEIGHTS
// ============================================

const DEFAULT_WEIGHTS: PropagationWeights = {
  positiveBoost: 0.05, // +5% confidence for positive feedback
  negativeReduction: 0.08, // -8% confidence for negative feedback
  minChangeThreshold: 0.01, // Don't update if change < 1%
  maxChangePerUpdate: 0.15, // Max 15% change per update
};

// ============================================
// PROPAGATOR CLASS
// ============================================

export class FeedbackPropagator {
  private readonly weights: PropagationWeights;

  constructor(
    private readonly db: D1Database,
    private readonly outcomeRepository: OutcomeRepository,
    private readonly learningRepository: LearningRepository,
    private readonly beliefRepository: BeliefRepository,
    weights: Partial<PropagationWeights> = {}
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Propagate feedback for a single outcome
   */
  async propagateOutcome(outcome: OutcomeWithSources): Promise<PropagationResult> {
    const startTime = Date.now();
    const learningsUpdated: PropagationResult['learningsUpdated'] = [];
    const beliefsUpdated: PropagationResult['beliefsUpdated'] = [];

    // Only propagate if we have actionable feedback
    if (outcome.outcomeSignal === 'unknown' || outcome.outcomeSignal === 'neutral') {
      return {
        outcomeId: outcome.id,
        signal: outcome.outcomeSignal,
        learningsUpdated: [],
        beliefsUpdated: [],
        totalSourcesUpdated: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Calculate base confidence change
    const isPositive = outcome.outcomeSignal === 'positive';
    const baseChange = isPositive
      ? this.weights.positiveBoost
      : -this.weights.negativeReduction;

    // Process each source
    for (const source of outcome.sources) {
      // Scale change by contribution weight
      const scaledChange = baseChange * source.contributionWeight;

      // Check threshold
      if (Math.abs(scaledChange) < this.weights.minChangeThreshold) {
        continue;
      }

      // Clamp to max change
      const finalChange = Math.max(
        -this.weights.maxChangePerUpdate,
        Math.min(this.weights.maxChangePerUpdate, scaledChange)
      );

      // Update the appropriate source
      const updateResult = await this.updateSource(
        source.sourceType,
        source.sourceId,
        outcome.userId,
        finalChange,
        isPositive
      );

      if (updateResult) {
        if (source.sourceType === 'learning') {
          learningsUpdated.push(updateResult);
        } else if (source.sourceType === 'belief') {
          beliefsUpdated.push(updateResult);
        }
      }
    }

    // Mark outcome as propagated
    await this.outcomeRepository.markPropagated(outcome.id);

    console.log('[FeedbackPropagator] Feedback propagated', {
      outcomeId: outcome.id,
      signal: outcome.outcomeSignal,
      learningsUpdated: learningsUpdated.length,
      beliefsUpdated: beliefsUpdated.length,
    });

    return {
      outcomeId: outcome.id,
      signal: outcome.outcomeSignal,
      learningsUpdated,
      beliefsUpdated,
      totalSourcesUpdated: learningsUpdated.length + beliefsUpdated.length,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Update a single source's confidence
   */
  private async updateSource(
    sourceType: SourceType,
    sourceId: string,
    userId: string,
    confidenceChange: number,
    isPositive: boolean
  ): Promise<{
    id: string;
    previousConfidence: number;
    newConfidence: number;
    change: number;
  } | null> {
    switch (sourceType) {
      case 'learning':
        return this.updateLearning(sourceId, userId, confidenceChange, isPositive);
      case 'belief':
        return this.updateBelief(sourceId, userId, confidenceChange, isPositive);
      case 'memory':
        // Memory sources don't have confidence to update
        return null;
      default:
        return null;
    }
  }

  /**
   * Update learning confidence
   */
  private async updateLearning(
    learningId: string,
    userId: string,
    confidenceChange: number,
    isPositive: boolean
  ): Promise<{
    id: string;
    previousConfidence: number;
    newConfidence: number;
    change: number;
  } | null> {
    // Get the learning
    const learning = await this.learningRepository.getLearning(learningId);
    if (!learning) return null;

    // Verify ownership
    if (learning.user_id !== userId) return null;

    const previousConfidence = learning.confidence;

    // Calculate new confidence
    let newConfidence = previousConfidence + confidenceChange;
    newConfidence = Math.max(0.01, Math.min(0.99, newConfidence));

    // Calculate new strength based on confidence
    const newStrength = this.calculateStrength(newConfidence);

    const now = new Date().toISOString();

    // Update the learning directly
    await this.db
      .prepare(
        `UPDATE learnings SET
          confidence = ?,
          strength = ?,
          last_reinforced = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(newConfidence, newStrength, now, now, learningId)
      .run();

    return {
      id: learningId,
      previousConfidence,
      newConfidence,
      change: newConfidence - previousConfidence,
    };
  }

  /**
   * Calculate strength label from confidence
   */
  private calculateStrength(confidence: number): string {
    if (confidence >= 0.8) return 'definitive';
    if (confidence >= 0.6) return 'strong';
    if (confidence >= 0.3) return 'moderate';
    return 'weak';
  }

  /**
   * Update belief confidence using Bayesian update
   */
  private async updateBelief(
    beliefId: string,
    userId: string,
    confidenceChange: number,
    isPositive: boolean
  ): Promise<{
    id: string;
    previousConfidence: number;
    newConfidence: number;
    change: number;
  } | null> {
    // Get the belief
    const belief = await this.beliefRepository.getBelief(beliefId);
    if (!belief) return null;

    // Verify ownership
    if (belief.userId !== userId) return null;

    const previousConfidence = belief.currentConfidence;

    // Use Bayesian update for beliefs
    const reason = isPositive
      ? 'Positive outcome feedback'
      : 'Negative outcome feedback';

    const updatedBelief = await this.beliefRepository.applyBayesianUpdate({
      beliefId,
      userId,
      evidenceStrength: Math.abs(confidenceChange) * 2, // Scale for Bayesian
      supports: isPositive,
      reason,
    });

    const newConfidence = updatedBelief.currentConfidence;

    return {
      id: beliefId,
      previousConfidence,
      newConfidence,
      change: newConfidence - previousConfidence,
    };
  }

  /**
   * Process all pending propagations
   */
  async processPendingPropagations(limit: number = 100): Promise<{
    processed: number;
    results: PropagationResult[];
  }> {
    const pending = await this.outcomeRepository.getPendingPropagation(limit);
    const results: PropagationResult[] = [];

    for (const outcome of pending) {
      const result = await this.propagateOutcome(outcome);
      results.push(result);
    }

    console.log('[FeedbackPropagator] Batch propagation complete', {
      processed: results.length,
      totalLearningsUpdated: results.reduce((sum, r) => sum + r.learningsUpdated.length, 0),
      totalBeliefsUpdated: results.reduce((sum, r) => sum + r.beliefsUpdated.length, 0),
    });

    return { processed: results.length, results };
  }
}
