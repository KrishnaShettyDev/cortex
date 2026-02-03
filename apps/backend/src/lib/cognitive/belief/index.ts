/**
 * Belief Module
 *
 * Exports for belief system with Bayesian confidence tracking.
 */

export * from './types';
export * from './bayesian';
export * from './repository';
export * from './formation';

export { BeliefRepository } from './repository';
export { BeliefFormationEngine, formBeliefsFromLearnings } from './formation';
export {
  bayesianUpdate,
  combineEvidence,
  createHistoryEntry,
  appendToHistory,
  analyzeConfidenceHistory,
  getBeliefStrength,
  shouldTransitionStatus,
  getDefaultEvidenceStrength,
  CONFIDENCE_THRESHOLDS,
  EVIDENCE_WEIGHTS,
} from './bayesian';
