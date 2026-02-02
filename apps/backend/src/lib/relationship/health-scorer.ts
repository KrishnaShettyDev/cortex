/**
 * Relationship Health Scorer
 *
 * Analyzes relationship health based on:
 * - Communication frequency and recency
 * - Commitment fulfillment patterns
 * - Interaction sentiment (if available)
 * - Response time patterns
 *
 * Inspired by professional relationship management systems.
 */

import type {
  RelationshipHealth,
  RelationshipHealthStatus,
  RelationshipMetrics,
} from './types';
import { RelationshipScoringError } from './types';

export class RelationshipHealthScorer {
  private db: D1Database;

  // Health thresholds
  private static readonly HEALTHY_INTERACTION_DAYS = 14; // 2 weeks
  private static readonly ATTENTION_NEEDED_DAYS = 30; // 1 month
  private static readonly AT_RISK_DAYS = 60; // 2 months
  private static readonly DORMANT_DAYS = 90; // 3 months

  private static readonly MIN_COMMITMENT_RATE = 0.7; // 70% completion rate

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Score relationship health for an entity
   */
  async scoreRelationship(
    userId: string,
    entityId: string
  ): Promise<RelationshipHealth> {
    try {
      // Get entity details
      const entity = await this.db
        .prepare('SELECT id, name, entity_type FROM entities WHERE id = ?')
        .bind(entityId)
        .first<{ id: string; name: string; entity_type: string }>();

      if (!entity) {
        throw new RelationshipScoringError('Entity not found', false, {
          entity_id: entityId,
        });
      }

      // Get relationship metrics
      const metrics = await this.getRelationshipMetrics(userId, entityId);

      // Calculate health components
      const interactionScore = this.calculateInteractionScore(metrics);
      const commitmentScore = await this.calculateCommitmentScore(
        userId,
        entityId
      );
      const recencyScore = this.calculateRecencyScore(metrics);

      // Weighted health score
      const healthScore =
        interactionScore * 0.4 + commitmentScore * 0.3 + recencyScore * 0.3;

      // Determine health status
      const healthStatus = this.determineHealthStatus(
        metrics.last_interaction,
        metrics.pending_commitments,
        commitmentScore
      );

      // Generate recommendation
      const recommendedAction = this.generateRecommendation(
        healthStatus,
        metrics,
        commitmentScore
      );

      // Calculate stats
      const daysSinceLastInteraction = metrics.last_interaction
        ? Math.floor(
            (new Date().getTime() - new Date(metrics.last_interaction).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null;

      const avgFrequency =
        metrics.first_interaction && metrics.total_memories > 1
          ? Math.floor(
              (new Date().getTime() -
                new Date(metrics.first_interaction).getTime()) /
                (1000 * 60 * 60 * 24) /
                metrics.total_memories
            )
          : null;

      // Get commitment stats
      const commitmentStats = await this.getCommitmentStats(userId, entityId);

      return {
        entity_id: entityId,
        entity_name: entity.name,
        entity_type: entity.entity_type,
        health_status: healthStatus,
        health_score: healthScore,
        total_interactions: metrics.total_memories,
        last_interaction_date: metrics.last_interaction,
        days_since_last_interaction: daysSinceLastInteraction,
        avg_interaction_frequency_days: avgFrequency,
        avg_sentiment: null, // TODO: Implement sentiment analysis
        pending_commitments: commitmentStats.pending,
        completed_commitments: commitmentStats.completed,
        overdue_commitments: commitmentStats.overdue,
        commitment_completion_rate: commitmentStats.completion_rate,
        recommended_action: recommendedAction,
        calculated_at: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[RelationshipHealthScorer] Scoring failed:', error);
      throw new RelationshipScoringError(
        `Failed to score relationship: ${error.message}`,
        true,
        { user_id: userId, entity_id: entityId }
      );
    }
  }

  /**
   * Score all relationships for a user
   */
  async scoreAllRelationships(userId: string): Promise<RelationshipHealth[]> {
    // Get all entities for user
    const entities = await this.db
      .prepare(
        `SELECT DISTINCT e.id, e.name, e.entity_type
         FROM entities e
         INNER JOIN memory_entities me ON e.id = me.entity_id
         INNER JOIN memories m ON me.memory_id = m.id
         WHERE m.user_id = ?
           AND e.entity_type IN ('person', 'company')
         ORDER BY e.importance_score DESC
         LIMIT 50`
      )
      .bind(userId)
      .all<{ id: string; name: string; entity_type: string }>();

    const health: RelationshipHealth[] = [];

    for (const entity of entities.results || []) {
      try {
        const score = await this.scoreRelationship(userId, entity.id);
        health.push(score);
      } catch (error) {
        console.error(
          `[RelationshipHealthScorer] Failed to score entity ${entity.id}:`,
          error
        );
      }
    }

    return health;
  }

  /**
   * Get relationship metrics
   */
  private async getRelationshipMetrics(
    userId: string,
    entityId: string
  ): Promise<RelationshipMetrics> {
    const result = await this.db
      .prepare(
        `SELECT
           MIN(m.created_at) as first_interaction,
           MAX(m.created_at) as last_interaction,
           COUNT(DISTINCT m.id) as total_memories
         FROM memories m
         INNER JOIN memory_entities me ON m.id = me.memory_id
         WHERE m.user_id = ?
           AND me.entity_id = ?
           AND m.valid_to IS NULL
           AND m.is_forgotten = 0`
      )
      .bind(userId, entityId)
      .first<{
        first_interaction: string | null;
        last_interaction: string | null;
        total_memories: number;
      }>();

    // Get commitment counts
    const commitments = await this.db
      .prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
         FROM commitments
         WHERE user_id = ? AND to_entity_id = ?`
      )
      .bind(userId, entityId)
      .first<{ total: number; pending: number }>();

    return {
      entity_id: entityId,
      first_interaction: result?.first_interaction || null,
      last_interaction: result?.last_interaction || null,
      total_memories: result?.total_memories || 0,
      total_commitments: commitments?.total || 0,
      pending_commitments: commitments?.pending || 0,
    };
  }

  /**
   * Calculate interaction score (0-1)
   */
  private calculateInteractionScore(metrics: RelationshipMetrics): number {
    if (metrics.total_memories === 0) return 0;

    // Logarithmic scale: more interactions = higher score
    const score = Math.log10(metrics.total_memories + 1) / Math.log10(50);
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Calculate commitment score (0-1)
   */
  private async calculateCommitmentScore(
    userId: string,
    entityId: string
  ): Promise<number> {
    const stats = await this.getCommitmentStats(userId, entityId);

    if (stats.total === 0) return 0.5; // Neutral if no commitments

    // Penalize for overdue
    if (stats.overdue > 0) {
      return Math.max(0, stats.completion_rate - stats.overdue * 0.1);
    }

    return stats.completion_rate;
  }

  /**
   * Calculate recency score (0-1)
   */
  private calculateRecencyScore(metrics: RelationshipMetrics): number {
    if (!metrics.last_interaction) return 0;

    const daysSince = Math.floor(
      (new Date().getTime() - new Date(metrics.last_interaction).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // Exponential decay
    if (daysSince <= RelationshipHealthScorer.HEALTHY_INTERACTION_DAYS)
      return 1.0;
    if (daysSince <= RelationshipHealthScorer.ATTENTION_NEEDED_DAYS)
      return 0.7;
    if (daysSince <= RelationshipHealthScorer.AT_RISK_DAYS) return 0.4;
    if (daysSince <= RelationshipHealthScorer.DORMANT_DAYS) return 0.2;
    return 0.1;
  }

  /**
   * Determine health status
   */
  private determineHealthStatus(
    lastInteraction: string | null,
    pendingCommitments: number,
    commitmentScore: number
  ): RelationshipHealthStatus {
    if (!lastInteraction) return 'dormant';

    const daysSince = Math.floor(
      (new Date().getTime() - new Date(lastInteraction).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // Dormant: 90+ days
    if (daysSince >= RelationshipHealthScorer.DORMANT_DAYS) return 'dormant';

    // At risk: 60+ days or low commitment score
    if (
      daysSince >= RelationshipHealthScorer.AT_RISK_DAYS ||
      (commitmentScore < 0.5 && pendingCommitments > 0)
    )
      return 'at_risk';

    // Attention needed: 30+ days or pending commitments with low score
    if (
      daysSince >= RelationshipHealthScorer.ATTENTION_NEEDED_DAYS ||
      (pendingCommitments > 2 && commitmentScore < 0.7)
    )
      return 'attention_needed';

    return 'healthy';
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(
    status: RelationshipHealthStatus,
    metrics: RelationshipMetrics,
    commitmentScore: number
  ): string | null {
    if (status === 'dormant') {
      return `Reach out to ${metrics.entity_id} - no contact in ${Math.floor((new Date().getTime() - new Date(metrics.last_interaction!).getTime()) / (1000 * 60 * 60 * 24))} days`;
    }

    if (status === 'at_risk') {
      if (metrics.pending_commitments > 0) {
        return `Follow up on ${metrics.pending_commitments} pending commitment(s)`;
      }
      return 'Schedule a check-in call';
    }

    if (status === 'attention_needed') {
      if (commitmentScore < 0.7) {
        return 'Review and complete pending commitments';
      }
      return 'Send a quick update or check-in';
    }

    return null;
  }

  /**
   * Get commitment statistics
   */
  private async getCommitmentStats(
    userId: string,
    entityId: string
  ): Promise<{
    total: number;
    pending: number;
    completed: number;
    overdue: number;
    completion_rate: number;
  }> {
    const result = await this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue
         FROM commitments
         WHERE user_id = ? AND to_entity_id = ?`
      )
      .bind(userId, entityId)
      .first<{
        total: number;
        pending: number;
        completed: number;
        overdue: number;
      }>();

    const total = result?.total || 0;
    const completed = result?.completed || 0;
    const completionRate = total > 0 ? completed / total : 0;

    return {
      total,
      pending: result?.pending || 0,
      completed,
      overdue: result?.overdue || 0,
      completion_rate: completionRate,
    };
  }
}

/**
 * Helper function to score relationship
 */
export async function scoreRelationshipHealth(
  db: D1Database,
  userId: string,
  entityId: string
): Promise<RelationshipHealth> {
  const scorer = new RelationshipHealthScorer(db);
  return scorer.scoreRelationship(userId, entityId);
}
