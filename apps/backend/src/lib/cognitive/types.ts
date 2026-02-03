/**
 * Cognitive Layer Types
 *
 * Types for the cognitive layer that extracts patterns, preferences,
 * and insights from user memories.
 */

// ============================================
// LEARNING TYPES
// ============================================

export type LearningCategory =
  | 'preference'      // User likes/dislikes
  | 'habit'           // Behavioral patterns
  | 'relationship'    // Social connections
  | 'work_pattern'    // Professional behaviors
  | 'health'          // Health and wellness patterns
  | 'interest'        // Hobbies, topics of interest
  | 'routine'         // Daily/weekly routines
  | 'communication'   // Communication style preferences
  | 'decision_style'  // How they make decisions
  | 'value'           // Core values and beliefs
  | 'goal'            // Aspirations and objectives
  | 'skill'           // Abilities and expertise
  | 'other';

export type LearningStrength = 'weak' | 'moderate' | 'strong' | 'definitive';

export type LearningStatus = 'active' | 'invalidated' | 'superseded' | 'archived';

/**
 * A learned pattern/preference about the user
 */
export interface Learning {
  id: string;
  user_id: string;
  container_tag: string;

  // Core learning data
  category: LearningCategory;
  statement: string;           // The actual learning: "User prefers morning meetings"
  reasoning: string;           // Why we learned this

  // Strength and confidence
  strength: LearningStrength;
  confidence: number;          // 0-1 confidence in this learning
  evidence_count: number;      // Number of memories supporting this

  // Status tracking
  status: LearningStatus;
  invalidated_by: string | null;     // Memory ID that invalidated this
  superseded_by: string | null;      // Learning ID that supersedes this

  // Temporal
  first_observed: string;      // When we first saw evidence
  last_reinforced: string;     // When we last saw confirming evidence
  valid_from: string | null;   // Temporal validity start
  valid_to: string | null;     // Temporal validity end (if invalidated)

  // Metadata
  created_at: string;
  updated_at: string;
}

/**
 * Evidence linking a learning to a memory
 */
export interface LearningEvidence {
  id: string;
  learning_id: string;
  memory_id: string;

  // Evidence type
  evidence_type: 'supports' | 'contradicts' | 'neutral';

  // Context
  excerpt: string;             // Relevant text from memory
  confidence: number;          // Confidence this memory supports/contradicts

  created_at: string;
}

/**
 * Extracted learning from LLM (before saving to DB)
 */
export interface ExtractedLearning {
  category: LearningCategory;
  statement: string;
  reasoning: string;
  confidence: number;
  excerpt: string;             // Supporting excerpt from content
}

/**
 * Learning extraction context
 */
export interface LearningExtractionContext {
  user_id: string;
  container_tag: string;
  memory_id: string;
  memory_content: string;
  created_at: string;
  existing_learnings?: Learning[];  // For conflict detection
}

/**
 * Learning extraction result
 */
export interface LearningExtractionResult {
  learnings: ExtractedLearning[];
  saved?: Learning[];
  conflicts?: LearningConflict[];
  extraction_metadata: LearningExtractionMetadata;
}

/**
 * Conflict between new and existing learning
 */
export interface LearningConflict {
  new_learning: ExtractedLearning;
  existing_learning: Learning;
  conflict_type: 'contradiction' | 'refinement' | 'temporal_change';
  resolution: 'keep_existing' | 'replace' | 'merge' | 'pending';
}

/**
 * Metadata about learning extraction
 */
export interface LearningExtractionMetadata {
  total_extracted: number;
  high_confidence_count: number;
  conflicts_detected: number;
  processing_time_ms: number;
  skipped_reason?: 'no_signals' | 'too_short' | 'low_value';
}

// ============================================
// PROFILE TYPES (User Profile Summary)
// ============================================

/**
 * Aggregated user profile from learnings
 */
export interface UserCognitiveProfile {
  user_id: string;

  // Aggregated insights by category
  preferences: LearningSummary[];
  habits: LearningSummary[];
  relationships: LearningSummary[];
  work_patterns: LearningSummary[];
  interests: LearningSummary[];
  values: LearningSummary[];
  goals: LearningSummary[];

  // Stats
  total_learnings: number;
  strong_learnings: number;
  recent_learnings: number;

  // Metadata
  profile_version: string;
  last_updated: string;
}

/**
 * Summary of a learning for profile display
 */
export interface LearningSummary {
  statement: string;
  strength: LearningStrength;
  confidence: number;
  evidence_count: number;
  last_reinforced: string;
}

// ============================================
// ERROR TYPES
// ============================================

export class LearningExtractionError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'LearningExtractionError';
  }
}

export class LearningConflictError extends Error {
  constructor(
    message: string,
    public conflict: LearningConflict
  ) {
    super(message);
    this.name = 'LearningConflictError';
  }
}

// ============================================
// API TYPES
// ============================================

export interface ListLearningsQuery {
  category?: LearningCategory;
  status?: LearningStatus;
  strength?: LearningStrength;
  limit?: number;
  offset?: number;
}

export interface ValidateLearningBody {
  is_valid: boolean;
  correction?: string;
  notes?: string;
}

export interface LearningResponse {
  learning: Learning;
  evidence: LearningEvidence[];
  related_learnings?: Learning[];
}
