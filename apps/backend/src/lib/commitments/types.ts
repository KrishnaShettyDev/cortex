/**
 * Commitment Tracking Types
 *
 * Types for tracking promises, deadlines, and follow-ups.
 */

export type CommitmentType =
  | 'promise'
  | 'deadline'
  | 'follow_up'
  | 'meeting'
  | 'deliverable';

export type CommitmentStatus = 'pending' | 'completed' | 'cancelled' | 'overdue';

export type CommitmentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Commitment {
  id: string;
  user_id: string;
  memory_id: string;

  // Commitment details
  commitment_type: CommitmentType;
  description: string;

  // Participants
  to_entity_id: string | null;
  to_entity_name: string | null;
  from_entity_id: string | null;

  // Temporal fields
  due_date: string | null;
  reminder_date: string | null;

  // Status tracking
  status: CommitmentStatus;
  priority: CommitmentPriority;

  // Context
  context: string | null;
  tags: string | null; // JSON array

  // Completion tracking
  completed_at: string | null;
  completion_note: string | null;

  // Metadata
  extraction_confidence: number;
  created_at: string;
  updated_at: string;
}

export interface CommitmentReminder {
  id: string;
  commitment_id: string;
  user_id: string;

  reminder_type: 'due_soon' | 'overdue' | 'follow_up';
  scheduled_for: string;
  sent_at: string | null;

  status: 'pending' | 'sent' | 'cancelled';

  created_at: string;
}

export interface ExtractedCommitment {
  commitment_type: CommitmentType;
  description: string;
  to_entity_name: string | null;
  due_date: string | null;
  priority: CommitmentPriority;
  context: string | null;
  confidence: number;
}

export interface CommitmentExtractionMetadata {
  total_extracted: number;
  high_confidence_count: number;
  processing_time_ms: number;
  skipped_reason?: 'no_signals';
}

export interface CommitmentExtractionResult {
  commitments: ExtractedCommitment[];
  saved?: Commitment[];
  extraction_metadata: CommitmentExtractionMetadata;
}

/**
 * Error types
 */
export class CommitmentExtractionError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'CommitmentExtractionError';
  }
}
