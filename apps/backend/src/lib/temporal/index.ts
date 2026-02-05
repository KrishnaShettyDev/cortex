/**
 * Temporal Intelligence Module
 *
 * Exports for temporal reasoning, conflict resolution, and time-travel queries.
 */

export * from './types';
export * from './resolver';
export * from './conflict-resolver';
export * from './time-travel';
export {
  extractEventDate,
  TemporalResolver,
} from './resolver';
export {
  resolveMemoryConflict,
  TemporalConflictResolver,
} from './conflict-resolver';
export {
  timeTravelQuery,
  getMemoryHistory,
  getCurrentlyValidMemories,
  getSupersededMemories,
} from './time-travel';

// Supermemory++ Phase 2: Enhanced temporal extraction
export {
  extractTemporalData,
  extractExplicitDates,
  extractRelativeDates,
  saveMemoryEvents,
  updateMemoryTemporalFields,
  type ExtractedDate,
  type TemporalExtractionResult,
} from './extractor';
