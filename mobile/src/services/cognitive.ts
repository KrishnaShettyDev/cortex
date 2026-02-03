/**
 * Cognitive Service
 *
 * Provides access to Cortex's cognitive layer:
 * - Learnings: Pattern discoveries from memories
 * - Beliefs: Probabilistic propositions about the user
 * - Outcomes: Tracking recall quality and feedback loop
 * - Sleep Compute: Background processing context
 */

import { api } from './api';

// ============== Learning Types ==============

export interface Learning {
  id: string;
  user_id: string;
  insight: string;
  category: string;
  pattern_type: string;
  confidence: number;
  evidence_count: number;
  supporting_memory_ids: string[];
  status: 'active' | 'validated' | 'invalidated' | 'superseded';
  first_observed: string;
  last_observed: string;
  created_at: string;
  updated_at: string;
}

export interface LearningProfile {
  preferences: Learning[];
  behaviors: Learning[];
  knowledge: Learning[];
  relationships: Learning[];
  goals: Learning[];
  [key: string]: Learning[]; // Allow other categories
}

// ============== Belief Types ==============

export interface Belief {
  id: string;
  user_id: string;
  proposition: string;
  belief_type: 'preference' | 'behavior' | 'fact' | 'relationship' | 'goal';
  current_confidence: number;
  prior_confidence: number;
  domain: string | null;
  status: 'active' | 'weakened' | 'invalidated' | 'superseded';
  source_learning_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface BeliefStats {
  total: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  average_confidence: number;
}

export interface BeliefConflict {
  id: string;
  belief_a_id: string;
  belief_b_id: string;
  belief_a_proposition: string;
  belief_b_proposition: string;
  conflict_type: string;
  resolution_status: 'unresolved' | 'resolved' | 'dismissed';
  detected_at: string;
}

// ============== Outcome Types ==============

export interface Outcome {
  id: string;
  user_id: string;
  query: string;
  response_summary: string;
  memories_used: number;
  learnings_used: number;
  beliefs_used: number;
  feedback_signal: 'positive' | 'negative' | 'neutral' | null;
  feedback_source: string | null;
  processing_time_ms: number;
  created_at: string;
}

export interface OutcomeStats {
  total: number;
  by_signal: Record<string, number>;
  feedback_rate: number;
  positive_rate: number;
}

// ============== Intelligent Recall Types ==============

export interface IntelligentRecallResponse {
  response: string;
  outcome_id: string;
  sources: {
    memories: number;
    learnings: number;
    beliefs: number;
  };
  processing_time_ms: number;
  top_beliefs_used?: Array<{ id: string; proposition: string; confidence: number }>;
  top_learnings_used?: Array<{ id: string; insight: string; confidence: number }>;
}

// ============== Session Context Types ==============

export interface SessionContext {
  top_beliefs: Array<{ id: string; proposition: string; confidence: number }>;
  top_learnings: Array<{ id: string; insight: string; confidence: number }>;
  recent_outcomes: { total: number; positive_rate: number };
  pending_items: {
    unresolved_conflicts: number;
    weakened_beliefs: number;
    uncertain_learnings: number;
  };
}

export interface SleepJob {
  id: string;
  user_id: string;
  job_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  stats: Record<string, number>;
  created_at: string;
}

// ============== Response Types ==============

export interface LearningsListResponse {
  learnings: Learning[];
  total: number;
}

export interface BeliefsListResponse {
  beliefs: Belief[];
  total: number;
}

export interface OutcomesListResponse {
  outcomes: Outcome[];
  total: number;
}

// ============== Service ==============

class CognitiveService {
  // ============== INTELLIGENT RECALL ==============

  /**
   * Make an intelligent recall query that uses the full cognitive layer.
   * Returns a response along with an outcome_id for feedback tracking.
   */
  async intelligentRecall(
    query: string,
    options?: {
      context?: string;
      include_beliefs?: boolean;
      include_learnings?: boolean;
    }
  ): Promise<IntelligentRecallResponse> {
    return api.request<IntelligentRecallResponse>('/v3/recall/intelligent', {
      method: 'POST',
      body: {
        query,
        ...options,
      },
    });
  }

  /**
   * Provide feedback on a recall outcome.
   * This feeds back into the belief system to improve future responses.
   */
  async provideFeedback(
    outcomeId: string,
    signal: 'positive' | 'negative' | 'neutral',
    source: string = 'explicit_feedback'
  ): Promise<void> {
    await api.request(`/v3/outcomes/${outcomeId}/feedback`, {
      method: 'POST',
      body: { signal, source },
    });
  }

  // ============== LEARNINGS ==============

  /**
   * Get all learnings for the current user
   */
  async getLearnings(params?: {
    category?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<LearningsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.append('category', params.category);
    if (params?.status) searchParams.append('status', params.status);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.request<LearningsListResponse>(`/v3/learnings${query ? `?${query}` : ''}`);
  }

  /**
   * Get a single learning by ID
   */
  async getLearning(id: string): Promise<Learning> {
    const response = await api.request<{ learning: Learning }>(`/v3/learnings/${id}`);
    return response.learning;
  }

  /**
   * Get learnings organized by category (profile view)
   */
  async getLearningProfile(): Promise<LearningProfile> {
    return api.request<LearningProfile>('/v3/learnings/profile');
  }

  /**
   * Get learnings grouped by category
   */
  async getLearningCategories(): Promise<Record<string, Learning[]>> {
    return api.request<Record<string, Learning[]>>('/v3/learnings/categories');
  }

  /**
   * Validate a learning (user confirms it's accurate)
   */
  async validateLearning(id: string): Promise<Learning> {
    const response = await api.request<{ learning: Learning }>(`/v3/learnings/${id}/validate`, {
      method: 'POST',
    });
    return response.learning;
  }

  /**
   * Invalidate a learning (user says it's wrong)
   */
  async invalidateLearning(id: string): Promise<Learning> {
    const response = await api.request<{ learning: Learning }>(`/v3/learnings/${id}/invalidate`, {
      method: 'POST',
    });
    return response.learning;
  }

  /**
   * Start backfill job to discover learnings from existing memories
   */
  async startLearningBackfill(): Promise<{ job_id: string; status: string }> {
    return api.request('/v3/learnings/backfill', {
      method: 'POST',
    });
  }

  /**
   * Get backfill job progress
   */
  async getBackfillProgress(): Promise<{
    job_id: string | null;
    status: string;
    progress: number;
    learnings_discovered: number;
  }> {
    return api.request('/v3/learnings/backfill');
  }

  // ============== BELIEFS ==============

  /**
   * Get all beliefs for the current user
   */
  async getBeliefs(params?: {
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<BeliefsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.append('type', params.type);
    if (params?.status) searchParams.append('status', params.status);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.request<BeliefsListResponse>(`/v3/beliefs${query ? `?${query}` : ''}`);
  }

  /**
   * Get a single belief by ID
   */
  async getBelief(id: string): Promise<Belief> {
    const response = await api.request<{ belief: Belief }>(`/v3/beliefs/${id}`);
    return response.belief;
  }

  /**
   * Get belief statistics
   */
  async getBeliefStats(): Promise<BeliefStats> {
    return api.request<BeliefStats>('/v3/beliefs/stats');
  }

  /**
   * Get belief conflicts that need resolution
   */
  async getBeliefConflicts(): Promise<{ conflicts: BeliefConflict[] }> {
    return api.request('/v3/beliefs/conflicts');
  }

  /**
   * Form new beliefs from validated learnings
   */
  async formBeliefs(): Promise<{ formed: number; beliefs: Belief[] }> {
    return api.request('/v3/beliefs/form', {
      method: 'POST',
    });
  }

  /**
   * Add evidence to a belief (updates confidence via Bayesian update)
   */
  async addBeliefEvidence(
    beliefId: string,
    evidence: { supports: boolean; strength: number; source?: string }
  ): Promise<Belief> {
    const response = await api.request<{ belief: Belief }>(`/v3/beliefs/${beliefId}/evidence`, {
      method: 'POST',
      body: evidence,
    });
    return response.belief;
  }

  /**
   * Resolve a belief conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: { winner_belief_id: string; reason?: string }
  ): Promise<{ success: boolean }> {
    return api.request(`/v3/beliefs/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      body: resolution,
    });
  }

  // ============== OUTCOMES ==============

  /**
   * Get past outcomes (recall history)
   */
  async getOutcomes(params?: {
    limit?: number;
    offset?: number;
  }): Promise<OutcomesListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.request<OutcomesListResponse>(`/v3/outcomes${query ? `?${query}` : ''}`);
  }

  /**
   * Get a single outcome by ID
   */
  async getOutcome(id: string): Promise<Outcome> {
    const response = await api.request<{ outcome: Outcome }>(`/v3/outcomes/${id}`);
    return response.outcome;
  }

  /**
   * Get outcome statistics
   */
  async getOutcomeStats(): Promise<OutcomeStats> {
    return api.request<OutcomeStats>('/v3/outcomes/stats');
  }

  /**
   * Get the reasoning chain for an outcome
   */
  async getOutcomeReasoning(id: string): Promise<{
    memories: Array<{ id: string; content: string; relevance: number }>;
    learnings: Array<{ id: string; insight: string; relevance: number }>;
    beliefs: Array<{ id: string; proposition: string; confidence: number }>;
  }> {
    return api.request(`/v3/outcomes/${id}/reasoning`);
  }

  /**
   * Propagate outcome feedback to beliefs
   */
  async propagateOutcome(id: string): Promise<{
    beliefs_updated: number;
    learnings_updated: number;
  }> {
    return api.request(`/v3/outcomes/${id}/propagate`, {
      method: 'POST',
    });
  }

  // ============== SLEEP COMPUTE ==============

  /**
   * Get pre-computed session context from last sleep compute
   */
  async getSessionContext(): Promise<{
    context: SessionContext | null;
    generated_at: string | null;
  }> {
    return api.request('/v3/sleep/context');
  }

  /**
   * Trigger a manual sleep compute run
   */
  async triggerSleepCompute(): Promise<{ job_id: string; status: string }> {
    return api.request('/v3/sleep/run', {
      method: 'POST',
    });
  }

  /**
   * Get sleep compute jobs
   */
  async getSleepJobs(params?: { limit?: number }): Promise<{ jobs: SleepJob[] }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());

    const query = searchParams.toString();
    return api.request(`/v3/sleep/jobs${query ? `?${query}` : ''}`);
  }

  /**
   * Get details of a specific sleep job
   */
  async getSleepJob(id: string): Promise<SleepJob> {
    return api.request(`/v3/sleep/jobs/${id}`);
  }

  /**
   * Get sleep compute statistics
   */
  async getSleepStats(): Promise<{
    total_jobs: number;
    last_run: string | null;
    average_duration_ms: number;
    learnings_discovered: number;
    beliefs_formed: number;
  }> {
    return api.request('/v3/sleep/stats');
  }
}

export const cognitiveService = new CognitiveService();
