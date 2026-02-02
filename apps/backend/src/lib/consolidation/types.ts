/**
 * Memory Consolidation & Importance Scoring Types
 *
 * Types for memory decay, consolidation, and importance scoring.
 */

export interface ImportanceScore {
  memory_id: string;
  score: number; // 0-1
  factors: {
    content: number;
    recency: number;
    access: number;
    entities: number;
    commitments: number;
  };
  calculated_at: string;
}

export interface ScoringContext {
  user_id: string;
  current_date: Date;
  access_count?: number;
  last_accessed?: string;
}

export interface DecayStats {
  memories_scored: number;
  memories_consolidated: number;
  memories_archived: number;
  semantic_facts_created: number;
  processing_time_ms: number;
}

export interface MemoryCluster {
  cluster_id: number;
  memories: Array<{
    id: string;
    content: string;
    event_date: string | null;
    importance_score: number;
  }>;
  semantic_theme: string | null;
  should_consolidate: boolean;
}

export interface ConsolidationResult {
  semantic_memory_id: string | null;
  consolidated_count: number;
  archived_memory_ids: string[];
  semantic_facts: string | null;
}

/**
 * Error types
 */
export class ImportanceScoringError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'ImportanceScoringError';
  }
}

export class ConsolidationError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'ConsolidationError';
  }
}
