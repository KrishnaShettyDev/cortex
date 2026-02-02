/**
 * Relationship Intelligence Module
 *
 * Exports for relationship health scoring and proactive nudges.
 */

export * from './types';
export * from './health-scorer';
export * from './nudge-generator';
export {
  RelationshipHealthScorer,
  scoreRelationshipHealth,
} from './health-scorer';
export {
  ProactiveNudgeGenerator,
  generateProactiveNudges,
} from './nudge-generator';
