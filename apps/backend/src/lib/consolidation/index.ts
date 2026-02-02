/**
 * Memory Consolidation Module
 *
 * Exports for importance scoring, decay management, and consolidation.
 */

export * from './types';
export * from './importance-scorer';
export * from './decay-manager';
export {
  ImportanceScorer,
  scoreMemoryImportance,
} from './importance-scorer';
export {
  DecayManager,
  runMemoryDecay,
} from './decay-manager';
