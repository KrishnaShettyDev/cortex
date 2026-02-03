/**
 * Belief System Type Definitions
 *
 * Beliefs are higher-level propositions formed from learnings.
 * They use Bayesian confidence tracking and support dependency graphs.
 */

// ============================================
// BELIEF TYPES
// ============================================

/**
 * Belief status lifecycle:
 * - active: Currently held belief
 * - uncertain: Confidence dropped below threshold
 * - invalidated: Proven false
 * - superseded: Replaced by a more accurate belief
 * - archived: Old/unused
 */
export type BeliefStatus =
  | 'active'
  | 'uncertain'
  | 'invalidated'
  | 'superseded'
  | 'archived';

/**
 * Types of beliefs:
 * - fact: Something the user believes to be true
 * - preference: What the user prefers (stronger than learning preference)
 * - capability: What the user can/cannot do
 * - state: Current state of something (job, relationship, health)
 * - relationship: How entities relate to each other
 * - intention: What the user intends to do
 * - identity: Who the user is (values, roles)
 */
export type BeliefType =
  | 'fact'
  | 'preference'
  | 'capability'
  | 'state'
  | 'relationship'
  | 'intention'
  | 'identity';

/**
 * Evidence types for beliefs:
 * - direct: Directly stated by user
 * - inferred: Inferred from behavior/patterns
 * - learned: Derived from a learning
 * - validated: Confirmed by outcome
 * - contradicted: Evidence against the belief
 */
export type BeliefEvidenceType =
  | 'direct'
  | 'inferred'
  | 'learned'
  | 'validated'
  | 'contradicted';

/**
 * Confidence history entry
 */
export interface ConfidenceHistoryEntry {
  timestamp: string;
  confidence: number;
  reason: string;
  evidenceId?: string;
}

/**
 * Database row for beliefs table
 */
export interface BeliefRow {
  id: string;
  user_id: string;
  proposition: string;
  belief_type: string;
  domain: string | null;

  // Bayesian confidence
  prior_confidence: number;
  current_confidence: number;
  confidence_history: string | null; // JSON array

  // Evidence tracking
  supporting_count: number;
  contradicting_count: number;

  // Temporal validity
  valid_from: string | null;
  valid_to: string | null;

  // Dependencies
  depends_on: string | null; // JSON array of belief IDs

  // Source
  derived_from_learning: string | null;

  // Status
  status: string;
  superseded_by: string | null;
  invalidation_reason: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * Belief with parsed fields for application use
 */
export interface Belief {
  id: string;
  userId: string;
  proposition: string;
  beliefType: BeliefType;
  domain: string | null;

  // Bayesian confidence
  priorConfidence: number;
  currentConfidence: number;
  confidenceHistory: ConfidenceHistoryEntry[];

  // Evidence tracking
  supportingCount: number;
  contradictingCount: number;

  // Temporal validity
  validFrom: Date | null;
  validTo: Date | null;

  // Dependencies
  dependsOn: string[];

  // Source
  derivedFromLearning: string | null;

  // Status
  status: BeliefStatus;
  supersededBy: string | null;
  invalidationReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database row for belief_evidence table
 */
export interface BeliefEvidenceRow {
  id: string;
  belief_id: string;
  memory_id: string | null;
  learning_id: string | null;
  evidence_type: string;
  supports: number; // 0 or 1 (SQLite boolean)
  strength: number;
  notes: string | null;
  created_at: string;
}

/**
 * Belief evidence with parsed fields
 */
export interface BeliefEvidence {
  id: string;
  beliefId: string;
  memoryId: string | null;
  learningId: string | null;
  evidenceType: BeliefEvidenceType;
  supports: boolean;
  strength: number;
  notes: string | null;
  createdAt: Date;
}

/**
 * Database row for belief_conflicts table
 */
export interface BeliefConflictRow {
  id: string;
  belief_a_id: string;
  belief_b_id: string;
  conflict_type: string;
  description: string;
  resolved: number; // 0 or 1
  resolution: string | null;
  winner_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Belief conflict with parsed fields
 */
export interface BeliefConflict {
  id: string;
  beliefAId: string;
  beliefBId: string;
  conflictType: 'contradiction' | 'overlap' | 'temporal';
  description: string;
  resolved: boolean;
  resolution: string | null;
  winnerId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ============================================
// INPUT TYPES
// ============================================

export interface CreateBeliefInput {
  userId: string;
  proposition: string;
  beliefType: BeliefType;
  domain?: string;
  priorConfidence?: number;
  validFrom?: Date;
  validTo?: Date;
  dependsOn?: string[];
  derivedFromLearning?: string;
  sourceMemoryId?: string;
  sourceLearningId?: string;
}

export interface AddBeliefEvidenceInput {
  beliefId: string;
  memoryId?: string;
  learningId?: string;
  evidenceType: BeliefEvidenceType;
  supports: boolean;
  strength?: number;
  notes?: string;
}

export interface BayesianUpdateInput {
  beliefId: string;
  userId: string;
  evidenceStrength: number;
  supports: boolean;
  reason: string;
  evidenceId?: string;
}

// ============================================
// QUERY TYPES
// ============================================

export interface BeliefQueryOptions {
  userId: string;
  status?: BeliefStatus[];
  beliefTypes?: BeliefType[];
  domain?: string;
  minConfidence?: number;
  validAt?: Date; // Only beliefs valid at this time
  limit?: number;
  offset?: number;
  orderBy?: 'confidence' | 'created_at' | 'updated_at';
  orderDirection?: 'asc' | 'desc';
}

export interface BeliefWithEvidence extends Belief {
  evidence: BeliefEvidence[];
}

export interface BeliefWithDependencies extends Belief {
  dependencies: Belief[];
  dependents: Belief[];
}

// ============================================
// FORMATION TYPES
// ============================================

export interface BeliefFormationResult {
  formed: Belief[];
  skipped: Array<{
    learningId: string;
    reason: string;
  }>;
  conflicts: BeliefConflict[];
  processingTimeMs: number;
}

// ============================================
// TYPE GUARDS
// ============================================

export function isValidBeliefType(value: unknown): value is BeliefType {
  const validTypes: BeliefType[] = [
    'fact',
    'preference',
    'capability',
    'state',
    'relationship',
    'intention',
    'identity',
  ];
  return typeof value === 'string' && validTypes.includes(value as BeliefType);
}

export function isValidBeliefStatus(value: unknown): value is BeliefStatus {
  const validStatuses: BeliefStatus[] = [
    'active',
    'uncertain',
    'invalidated',
    'superseded',
    'archived',
  ];
  return typeof value === 'string' && validStatuses.includes(value as BeliefStatus);
}

export function isValidBeliefEvidenceType(value: unknown): value is BeliefEvidenceType {
  const validTypes: BeliefEvidenceType[] = [
    'direct',
    'inferred',
    'learned',
    'validated',
    'contradicted',
  ];
  return typeof value === 'string' && validTypes.includes(value as BeliefEvidenceType);
}
