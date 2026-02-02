/**
 * Relationship Intelligence Types
 *
 * Types for relationship health scoring and proactive nudges.
 */

export type RelationshipHealthStatus = 'healthy' | 'attention_needed' | 'at_risk' | 'dormant';

export type NudgeType =
  | 'follow_up'
  | 'relationship_maintenance'
  | 'commitment_due'
  | 'deadline_approaching'
  | 'overdue_commitment'
  | 'dormant_relationship';

export type NudgePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface RelationshipHealth {
  entity_id: string;
  entity_name: string;
  entity_type: string;

  // Health metrics
  health_status: RelationshipHealthStatus;
  health_score: number; // 0-1

  // Communication patterns
  total_interactions: number;
  last_interaction_date: string | null;
  days_since_last_interaction: number | null;
  avg_interaction_frequency_days: number | null;

  // Sentiment
  avg_sentiment: number | null; // -1 to 1

  // Commitments
  pending_commitments: number;
  completed_commitments: number;
  overdue_commitments: number;
  commitment_completion_rate: number | null;

  // Recommendations
  recommended_action: string | null;

  calculated_at: string;
}

export interface ProactiveNudge {
  id: string;
  user_id: string;

  // Nudge details
  nudge_type: NudgeType;
  priority: NudgePriority;
  title: string;
  message: string;

  // Context
  entity_id: string | null;
  entity_name: string | null;
  commitment_id: string | null;
  memory_id: string | null;

  // Actionable
  suggested_action: string | null;
  action_url: string | null;

  // Scheduling
  scheduled_for: string;
  expires_at: string | null;

  // Status
  status: 'pending' | 'sent' | 'dismissed' | 'acted_on' | 'expired';
  sent_at: string | null;
  dismissed_at: string | null;
  acted_on_at: string | null;

  // Metadata
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface NudgeGenerationResult {
  nudges: ProactiveNudge[];
  generation_metadata: {
    total_generated: number;
    high_priority_count: number;
    processing_time_ms: number;
  };
}

export interface RelationshipMetrics {
  entity_id: string;
  first_interaction: string | null;
  last_interaction: string | null;
  total_memories: number;
  total_commitments: number;
  pending_commitments: number;
}

/**
 * Error types
 */
export class RelationshipScoringError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'RelationshipScoringError';
  }
}

export class NudgeGenerationError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'NudgeGenerationError';
  }
}
