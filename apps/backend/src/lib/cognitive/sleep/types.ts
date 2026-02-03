/**
 * Sleep-Time Compute Type Definitions
 *
 * Defines all types for background cognitive processing.
 */

// ============================================
// JOB TYPES
// ============================================

/**
 * Types of compute tasks that run during sleep:
 * - learning_extraction: Extract learnings from recent memories
 * - belief_formation: Form beliefs from high-confidence learnings
 * - feedback_propagation: Propagate outcome feedback to update confidence
 * - confidence_decay: Decay stale learnings/beliefs that lack recent evidence
 * - conflict_resolution: Auto-resolve belief conflicts
 * - archival: Archive old/low-confidence items
 * - session_prep: Pre-compute context for next session
 */
export type SleepTaskType =
  | 'learning_extraction'
  | 'belief_formation'
  | 'feedback_propagation'
  | 'confidence_decay'
  | 'conflict_resolution'
  | 'archival'
  | 'session_prep';

/**
 * Job status
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Sleep compute trigger:
 * - scheduled: Triggered by cron
 * - manual: Triggered by API call
 * - threshold: Triggered when a threshold is met (e.g., N unprocessed memories)
 */
export type TriggerType = 'scheduled' | 'manual' | 'threshold';

// ============================================
// DATABASE ROWS
// ============================================

export interface SleepJobRow {
  id: string;
  user_id: string;
  trigger_type: TriggerType;
  status: JobStatus;

  // Task results (JSON)
  tasks_completed: string | null;
  tasks_failed: string | null;

  // Metrics
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;

  // Timing
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;

  // Error tracking
  error_message: string | null;

  created_at: string;
}

export interface SleepJob {
  id: string;
  userId: string;
  triggerType: TriggerType;
  status: JobStatus;

  tasksCompleted: TaskResult[];
  tasksFailed: TaskResult[];

  totalTasks: number;
  completedTasks: number;
  failedTasks: number;

  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;

  errorMessage: string | null;
  createdAt: Date;
}

// ============================================
// TASK TYPES
// ============================================

export interface TaskResult {
  taskType: SleepTaskType;
  status: JobStatus;
  durationMs: number;
  details: TaskDetails;
  error?: string;
}

/**
 * Details specific to each task type
 */
export type TaskDetails =
  | LearningExtractionDetails
  | BeliefFormationDetails
  | FeedbackPropagationDetails
  | ConfidenceDecayDetails
  | ConflictResolutionDetails
  | ArchivalDetails
  | SessionPrepDetails;

export interface LearningExtractionDetails {
  type: 'learning_extraction';
  memoriesProcessed: number;
  memoriesSkipped: number;
  learningsExtracted: number;
  learningsReinforced: number;
  learningsContradicted: number;
}

export interface BeliefFormationDetails {
  type: 'belief_formation';
  learningsEvaluated: number;
  beliefsFormed: number;
  beliefsSkipped: number;
  conflictsDetected: number;
}

export interface FeedbackPropagationDetails {
  type: 'feedback_propagation';
  outcomesPropagated: number;
  learningsUpdated: number;
  beliefsUpdated: number;
  totalConfidenceChanges: number;
}

export interface ConfidenceDecayDetails {
  type: 'confidence_decay';
  learningsDecayed: number;
  beliefsDecayed: number;
  learningsWeakened: number;
  beliefsWeakened: number;
}

export interface ConflictResolutionDetails {
  type: 'conflict_resolution';
  conflictsEvaluated: number;
  conflictsAutoResolved: number;
  conflictsEscalated: number;
}

export interface ArchivalDetails {
  type: 'archival';
  learningsArchived: number;
  beliefsArchived: number;
  outcomesArchived: number;
}

export interface SessionPrepDetails {
  type: 'session_prep';
  topBeliefs: number;
  topLearnings: number;
  recentOutcomes: number;
  contextGenerated: boolean;
}

// ============================================
// CONFIG TYPES
// ============================================

export interface SleepComputeConfig {
  /** Max memories to process per run */
  maxMemoriesPerRun: number;

  /** Max learnings to evaluate for belief formation */
  maxLearningsForBeliefs: number;

  /** Max outcomes to propagate per run */
  maxOutcomesToPropagate: number;

  /** Days of inactivity before decay starts */
  decayStartDays: number;

  /** Confidence decay rate per decay cycle */
  decayRate: number;

  /** Minimum confidence before archival */
  archivalThreshold: number;

  /** Days of inactivity before archival */
  archivalDays: number;

  /** Total time budget in ms (Cloudflare Workers have limits) */
  timeBudgetMs: number;

  /** Number of top items for session prep */
  sessionPrepLimit: number;
}

export const DEFAULT_CONFIG: SleepComputeConfig = {
  maxMemoriesPerRun: 200,
  maxLearningsForBeliefs: 100,
  maxOutcomesToPropagate: 50,
  decayStartDays: 30,
  decayRate: 0.02,
  archivalThreshold: 0.15,
  archivalDays: 90,
  timeBudgetMs: 25000, // 25s (CF Workers limit is 30s)
  sessionPrepLimit: 20,
};

// ============================================
// RESULT TYPES
// ============================================

export interface SleepComputeResult {
  jobId: string;
  userId: string;
  status: JobStatus;
  tasks: TaskResult[];
  totalDurationMs: number;
  summary: string;
}

// ============================================
// SESSION CONTEXT
// ============================================

export interface SessionContext {
  userId: string;
  generatedAt: string;

  /** Top beliefs for quick context */
  topBeliefs: Array<{
    id: string;
    proposition: string;
    confidence: number;
    domain: string | null;
  }>;

  /** Top learnings */
  topLearnings: Array<{
    id: string;
    statement: string;
    confidence: number;
    category: string;
  }>;

  /** Recent outcome summary */
  recentOutcomes: {
    total: number;
    positiveRate: number;
    topEffectiveSources: string[];
  };

  /** Pending items needing attention */
  pendingItems: {
    unresolvedConflicts: number;
    weakenedBeliefs: number;
    uncertainLearnings: number;
  };
}

// ============================================
// TYPE GUARDS
// ============================================

export function isValidSleepTaskType(value: unknown): value is SleepTaskType {
  const validTypes: SleepTaskType[] = [
    'learning_extraction',
    'belief_formation',
    'feedback_propagation',
    'confidence_decay',
    'conflict_resolution',
    'archival',
    'session_prep',
  ];
  return typeof value === 'string' && validTypes.includes(value as SleepTaskType);
}

export function isValidJobStatus(value: unknown): value is JobStatus {
  const validStatuses: JobStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];
  return typeof value === 'string' && validStatuses.includes(value as JobStatus);
}
