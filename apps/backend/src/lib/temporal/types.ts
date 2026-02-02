/**
 * Temporal Intelligence Types
 *
 * Types for temporal reasoning, conflict resolution, and time-travel queries.
 */

export type MemoryType = 'episodic' | 'semantic';

export interface TemporalMemory {
  id: string;
  user_id: string;
  content: string;
  valid_from: string; // ISO timestamp when fact became true
  valid_to: string | null; // ISO timestamp when fact ceased to be true (NULL = still true)
  event_date: string | null; // ISO timestamp of the event described
  supersedes: string | null; // ID of memory this supersedes
  superseded_by: string | null; // ID of memory that superseded this
  memory_type: MemoryType;
  created_at: string; // When we learned this fact
  updated_at: string;
}

export interface EventDateExtraction {
  event_date: string | null; // ISO timestamp
  confidence: number; // 0-1
  original_phrase: string | null; // Original temporal phrase from content
  is_relative: boolean; // Whether date was relative ("last week") or absolute ("Jan 15")
}

export interface ConflictResolution {
  action: 'add' | 'update' | 'supersede' | 'noop';
  existing_memory_id?: string;
  valid_to_date?: string; // When to set valid_to on existing memory
  reason: string;
  confidence: number;
}

export interface TimeTravelQuery {
  user_id: string;
  as_of_date: string; // ISO timestamp
  query?: string; // Optional content filter
  container_tag?: string;
  limit?: number;
}

export interface TimeTravelResult {
  memories: TemporalMemory[];
  snapshot_date: string;
  total_valid_at_time: number;
}

/**
 * Error types
 */
export class TemporalError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'TemporalError';
  }
}

export class ConflictResolutionError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'ConflictResolutionError';
  }
}
