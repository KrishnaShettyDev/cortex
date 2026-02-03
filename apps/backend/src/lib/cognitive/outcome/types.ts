/**
 * Outcome Tracking Type Definitions
 *
 * Tracks actions taken by the system, what informed them,
 * and feedback received to close the learning loop.
 */

// ============================================
// OUTCOME TYPES
// ============================================

/**
 * Types of actions the system can take:
 * - recall: Retrieved memories for a query
 * - suggestion: Proactively suggested something
 * - prediction: Made a prediction about user behavior/preferences
 * - answer: Answered a question using beliefs/learnings
 * - recommendation: Recommended something based on profile
 * - completion: Completed a task using context
 */
export type ActionType =
  | 'recall'
  | 'suggestion'
  | 'prediction'
  | 'answer'
  | 'recommendation'
  | 'completion';

/**
 * Outcome signal from user:
 * - positive: User indicated the action was helpful
 * - negative: User indicated the action was not helpful
 * - neutral: User didn't indicate either way
 * - unknown: No feedback received yet
 */
export type OutcomeSignal = 'positive' | 'negative' | 'neutral' | 'unknown';

/**
 * How the outcome signal was determined:
 * - explicit_feedback: User clicked thumbs up/down
 * - implicit_positive: User continued conversation, used suggestion
 * - implicit_negative: User corrected, ignored, or abandoned
 * - follow_up: Determined from follow-up conversation
 * - inferred: Inferred from subsequent behavior
 */
export type OutcomeSource =
  | 'explicit_feedback'
  | 'implicit_positive'
  | 'implicit_negative'
  | 'follow_up'
  | 'inferred';

/**
 * Types of sources that can inform an action:
 * - memory: A retrieved memory
 * - learning: An extracted learning
 * - belief: A formed belief
 */
export type SourceType = 'memory' | 'learning' | 'belief';

// ============================================
// DATABASE ROWS
// ============================================

/**
 * Database row for outcomes table
 */
export interface OutcomeRow {
  id: string;
  user_id: string;

  // What action was taken
  action_type: string;
  action_content: string;
  action_context: string | null; // JSON: the query/prompt that triggered this

  // What informed the action
  reasoning_trace: string | null; // JSON: explanation of why this action was taken

  // Outcome
  outcome_signal: string;
  outcome_source: string | null;
  outcome_details: string | null; // JSON: additional context

  // Timing
  action_at: string;
  outcome_at: string | null;

  // Propagation tracking
  feedback_propagated: number; // 0 or 1
  propagated_at: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * Outcome with parsed fields
 */
export interface Outcome {
  id: string;
  userId: string;

  actionType: ActionType;
  actionContent: string;
  actionContext: Record<string, unknown> | null;

  reasoningTrace: ReasoningTrace | null;

  outcomeSignal: OutcomeSignal;
  outcomeSource: OutcomeSource | null;
  outcomeDetails: Record<string, unknown> | null;

  actionAt: Date;
  outcomeAt: Date | null;

  feedbackPropagated: boolean;
  propagatedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database row for outcome_sources table
 */
export interface OutcomeSourceRow {
  id: string;
  outcome_id: string;
  source_type: string;
  source_id: string;
  contribution_weight: number;
  created_at: string;
}

/**
 * Outcome source with parsed fields
 */
export interface OutcomeSourceRecord {
  id: string;
  outcomeId: string;
  sourceType: SourceType;
  sourceId: string;
  contributionWeight: number;
  createdAt: Date;
}

// ============================================
// REASONING TRACE
// ============================================

/**
 * Explains what informed an action
 */
export interface ReasoningTrace {
  /** High-level explanation */
  summary: string;

  /** Memories that were retrieved */
  memories: Array<{
    id: string;
    relevanceScore: number;
    snippet: string;
  }>;

  /** Learnings that were applied */
  learnings: Array<{
    id: string;
    insight: string;
    confidence: number;
  }>;

  /** Beliefs that informed the response */
  beliefs: Array<{
    id: string;
    proposition: string;
    confidence: number;
  }>;

  /** Why these sources were chosen */
  selectionRationale?: string;
}

// ============================================
// INPUT TYPES
// ============================================

/**
 * Input for recording a new outcome
 */
export interface RecordOutcomeInput {
  userId: string;
  actionType: ActionType;
  actionContent: string;
  actionContext?: Record<string, unknown>;
  reasoningTrace?: ReasoningTrace;
  sources: Array<{
    sourceType: SourceType;
    sourceId: string;
    contributionWeight?: number;
  }>;
}

/**
 * Input for recording feedback
 */
export interface RecordFeedbackInput {
  outcomeId: string;
  userId: string;
  signal: OutcomeSignal;
  source: OutcomeSource;
  details?: Record<string, unknown>;
}

/**
 * Input for implicit feedback detection
 */
export interface ImplicitFeedbackInput {
  outcomeId: string;
  userId: string;
  /** Did user continue the conversation? */
  continued: boolean;
  /** Did user correct the response? */
  corrected: boolean;
  /** Did user use the suggestion/answer? */
  used: boolean;
  /** Did user abandon the conversation? */
  abandoned: boolean;
  /** Follow-up message if any */
  followUpMessage?: string;
}

// ============================================
// PROPAGATION TYPES
// ============================================

/**
 * Result of propagating feedback
 */
export interface PropagationResult {
  outcomeId: string;
  signal: OutcomeSignal;

  learningsUpdated: Array<{
    id: string;
    previousConfidence: number;
    newConfidence: number;
    change: number;
  }>;

  beliefsUpdated: Array<{
    id: string;
    previousConfidence: number;
    newConfidence: number;
    change: number;
  }>;

  totalSourcesUpdated: number;
  processingTimeMs: number;
}

/**
 * Weights for propagating feedback to different source types
 */
export interface PropagationWeights {
  /** How much to update based on positive feedback */
  positiveBoost: number;
  /** How much to reduce based on negative feedback */
  negativeReduction: number;
  /** Minimum change threshold (don't update if below this) */
  minChangeThreshold: number;
  /** Maximum change per update */
  maxChangePerUpdate: number;
}

// ============================================
// QUERY TYPES
// ============================================

export interface OutcomeQueryOptions {
  userId: string;
  actionTypes?: ActionType[];
  outcomeSignals?: OutcomeSignal[];
  fromDate?: Date;
  toDate?: Date;
  feedbackPropagated?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'action_at' | 'outcome_at' | 'created_at';
  orderDirection?: 'asc' | 'desc';
}

export interface OutcomeWithSources extends Outcome {
  sources: OutcomeSourceRecord[];
}

// ============================================
// ANALYTICS TYPES
// ============================================

export interface OutcomeStats {
  total: number;
  bySignal: Record<OutcomeSignal, number>;
  byActionType: Record<ActionType, number>;
  feedbackRate: number; // % of outcomes with feedback
  positiveRate: number; // % of feedbacked outcomes that are positive
  avgSourcesPerOutcome: number;
}

export interface SourceEffectiveness {
  sourceType: SourceType;
  totalUses: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  effectivenessRate: number; // positive / (positive + negative)
}

// ============================================
// TYPE GUARDS
// ============================================

export function isValidActionType(value: unknown): value is ActionType {
  const validTypes: ActionType[] = [
    'recall',
    'suggestion',
    'prediction',
    'answer',
    'recommendation',
    'completion',
  ];
  return typeof value === 'string' && validTypes.includes(value as ActionType);
}

export function isValidOutcomeSignal(value: unknown): value is OutcomeSignal {
  const validSignals: OutcomeSignal[] = ['positive', 'negative', 'neutral', 'unknown'];
  return typeof value === 'string' && validSignals.includes(value as OutcomeSignal);
}

export function isValidOutcomeSource(value: unknown): value is OutcomeSource {
  const validSources: OutcomeSource[] = [
    'explicit_feedback',
    'implicit_positive',
    'implicit_negative',
    'follow_up',
    'inferred',
  ];
  return typeof value === 'string' && validSources.includes(value as OutcomeSource);
}

export function isValidSourceType(value: unknown): value is SourceType {
  const validTypes: SourceType[] = ['memory', 'learning', 'belief'];
  return typeof value === 'string' && validTypes.includes(value as SourceType);
}
