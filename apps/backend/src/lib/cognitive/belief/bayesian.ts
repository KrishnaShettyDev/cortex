/**
 * Bayesian Confidence Engine
 *
 * Implements Bayesian inference for belief confidence updates.
 * P(H|E) = P(E|H) × P(H) / P(E)
 *
 * Where:
 * - H = Hypothesis (the belief is true)
 * - E = Evidence (new observation)
 * - P(H) = Prior probability (current confidence)
 * - P(E|H) = Likelihood (how likely is this evidence if belief is true)
 * - P(E) = Marginal likelihood (how likely is this evidence overall)
 */

import type { ConfidenceHistoryEntry } from './types';

// ============================================
// CONSTANTS
// ============================================

/**
 * Confidence thresholds for belief status transitions
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Below this, belief becomes 'uncertain' */
  UNCERTAIN: 0.3,
  /** Below this for 'active', use 'weak' */
  WEAK: 0.4,
  /** Above this, belief is 'strong' */
  STRONG: 0.7,
  /** Above this, belief is 'definitive' */
  DEFINITIVE: 0.85,
  /** Minimum confidence to form a belief from learning */
  FORMATION_MIN: 0.5,
} as const;

/**
 * Evidence strength modifiers
 */
export const EVIDENCE_WEIGHTS = {
  /** Direct user statement */
  DIRECT: 0.9,
  /** Inferred from behavior */
  INFERRED: 0.6,
  /** Derived from learning */
  LEARNED: 0.7,
  /** Validated by outcome */
  VALIDATED: 0.95,
  /** Contradicted by evidence */
  CONTRADICTED: 0.8,
} as const;

// ============================================
// BAYESIAN UPDATE FUNCTIONS
// ============================================

export interface BayesianUpdateParams {
  /** Current confidence (prior probability) */
  priorConfidence: number;
  /** Strength of the evidence (0-1) */
  evidenceStrength: number;
  /** Whether evidence supports the belief */
  supports: boolean;
  /** Base rate for this type of evidence */
  baseRate?: number;
}

export interface BayesianUpdateResult {
  /** New confidence after update */
  posteriorConfidence: number;
  /** Change in confidence */
  confidenceDelta: number;
  /** Whether belief should be re-evaluated */
  shouldReEvaluate: boolean;
  /** Suggested status based on new confidence */
  suggestedStatus: 'active' | 'uncertain' | 'invalidated';
}

/**
 * Performs a Bayesian update on belief confidence
 *
 * Uses a simplified Bayesian update formula:
 * - For supporting evidence: confidence increases toward 1
 * - For contradicting evidence: confidence decreases toward 0
 * - Evidence strength determines the magnitude of the update
 */
export function bayesianUpdate(params: BayesianUpdateParams): BayesianUpdateResult {
  const { priorConfidence, evidenceStrength, supports, baseRate = 0.5 } = params;

  // Clamp inputs
  const prior = Math.max(0.01, Math.min(0.99, priorConfidence));
  const strength = Math.max(0.1, Math.min(1.0, evidenceStrength));

  let posterior: number;

  if (supports) {
    // Supporting evidence increases confidence
    // P(H|E) = P(E|H) × P(H) / P(E)
    // Simplified: use evidence strength as likelihood ratio
    const likelihoodRatio = 1 + strength * 2; // Range: 1.2 to 3.0
    const odds = prior / (1 - prior);
    const newOdds = odds * likelihoodRatio;
    posterior = newOdds / (1 + newOdds);
  } else {
    // Contradicting evidence decreases confidence
    const likelihoodRatio = 1 / (1 + strength * 2); // Range: 0.33 to 0.83
    const odds = prior / (1 - prior);
    const newOdds = odds * likelihoodRatio;
    posterior = newOdds / (1 + newOdds);
  }

  // Ensure bounds
  posterior = Math.max(0.01, Math.min(0.99, posterior));

  const confidenceDelta = posterior - prior;

  // Determine suggested status
  let suggestedStatus: 'active' | 'uncertain' | 'invalidated';
  if (posterior < 0.1) {
    suggestedStatus = 'invalidated';
  } else if (posterior < CONFIDENCE_THRESHOLDS.UNCERTAIN) {
    suggestedStatus = 'uncertain';
  } else {
    suggestedStatus = 'active';
  }

  // Should re-evaluate if confidence changed significantly
  const shouldReEvaluate = Math.abs(confidenceDelta) > 0.1;

  return {
    posteriorConfidence: posterior,
    confidenceDelta,
    shouldReEvaluate,
    suggestedStatus,
  };
}

/**
 * Calculates the combined confidence from multiple pieces of evidence
 */
export function combineEvidence(
  priorConfidence: number,
  evidenceItems: Array<{ strength: number; supports: boolean }>
): number {
  let confidence = priorConfidence;

  for (const evidence of evidenceItems) {
    const result = bayesianUpdate({
      priorConfidence: confidence,
      evidenceStrength: evidence.strength,
      supports: evidence.supports,
    });
    confidence = result.posteriorConfidence;
  }

  return confidence;
}

// ============================================
// CONFIDENCE HISTORY MANAGEMENT
// ============================================

/**
 * Creates a new confidence history entry
 */
export function createHistoryEntry(
  confidence: number,
  reason: string,
  evidenceId?: string
): ConfidenceHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    confidence,
    reason,
    evidenceId,
  };
}

/**
 * Appends to confidence history, keeping last N entries
 */
export function appendToHistory(
  history: ConfidenceHistoryEntry[],
  entry: ConfidenceHistoryEntry,
  maxEntries: number = 50
): ConfidenceHistoryEntry[] {
  const newHistory = [...history, entry];
  if (newHistory.length > maxEntries) {
    return newHistory.slice(-maxEntries);
  }
  return newHistory;
}

/**
 * Analyzes confidence history for trends
 */
export interface ConfidenceTrend {
  /** Average confidence over the period */
  average: number;
  /** Standard deviation */
  stdDev: number;
  /** Direction: 'increasing', 'decreasing', 'stable' */
  direction: 'increasing' | 'decreasing' | 'stable';
  /** Number of updates */
  updateCount: number;
  /** Time span in days */
  timeSpanDays: number;
}

export function analyzeConfidenceHistory(history: ConfidenceHistoryEntry[]): ConfidenceTrend | null {
  if (history.length < 2) {
    return null;
  }

  const confidences = history.map((h) => h.confidence);

  // Calculate average
  const average = confidences.reduce((a, b) => a + b, 0) / confidences.length;

  // Calculate standard deviation
  const squaredDiffs = confidences.map((c) => Math.pow(c - average, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Calculate trend using linear regression
  const n = confidences.length;
  const xMean = (n - 1) / 2;
  const yMean = average;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (confidences[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  let direction: 'increasing' | 'decreasing' | 'stable';
  if (slope > 0.01) {
    direction = 'increasing';
  } else if (slope < -0.01) {
    direction = 'decreasing';
  } else {
    direction = 'stable';
  }

  // Calculate time span
  const firstTimestamp = new Date(history[0].timestamp);
  const lastTimestamp = new Date(history[history.length - 1].timestamp);
  const timeSpanMs = lastTimestamp.getTime() - firstTimestamp.getTime();
  const timeSpanDays = timeSpanMs / (1000 * 60 * 60 * 24);

  return {
    average,
    stdDev,
    direction,
    updateCount: history.length,
    timeSpanDays,
  };
}

// ============================================
// BELIEF STRENGTH CALCULATION
// ============================================

export type BeliefStrength = 'weak' | 'moderate' | 'strong' | 'definitive';

/**
 * Calculates belief strength from confidence
 */
export function getBeliefStrength(confidence: number): BeliefStrength {
  if (confidence >= CONFIDENCE_THRESHOLDS.DEFINITIVE) {
    return 'definitive';
  } else if (confidence >= CONFIDENCE_THRESHOLDS.STRONG) {
    return 'strong';
  } else if (confidence >= CONFIDENCE_THRESHOLDS.WEAK) {
    return 'moderate';
  } else {
    return 'weak';
  }
}

/**
 * Determines if a belief should transition to a different status
 */
export function shouldTransitionStatus(
  currentStatus: string,
  currentConfidence: number,
  supportingCount: number,
  contradictingCount: number
): { shouldTransition: boolean; newStatus: string; reason: string } | null {
  // Check for invalidation
  if (currentConfidence < 0.1 && contradictingCount > supportingCount) {
    if (currentStatus !== 'invalidated') {
      return {
        shouldTransition: true,
        newStatus: 'invalidated',
        reason: 'Confidence dropped below threshold with contradicting evidence',
      };
    }
  }

  // Check for uncertainty
  if (
    currentConfidence < CONFIDENCE_THRESHOLDS.UNCERTAIN &&
    currentStatus === 'active'
  ) {
    return {
      shouldTransition: true,
      newStatus: 'uncertain',
      reason: `Confidence dropped below ${CONFIDENCE_THRESHOLDS.UNCERTAIN}`,
    };
  }

  // Check for recovery from uncertainty
  if (
    currentConfidence >= CONFIDENCE_THRESHOLDS.WEAK &&
    currentStatus === 'uncertain'
  ) {
    return {
      shouldTransition: true,
      newStatus: 'active',
      reason: 'Confidence recovered above threshold',
    };
  }

  return null;
}

// ============================================
// EVIDENCE TYPE UTILITIES
// ============================================

/**
 * Gets the default strength for an evidence type
 */
export function getDefaultEvidenceStrength(
  evidenceType: 'direct' | 'inferred' | 'learned' | 'validated' | 'contradicted'
): number {
  return EVIDENCE_WEIGHTS[evidenceType.toUpperCase() as keyof typeof EVIDENCE_WEIGHTS] || 0.5;
}
