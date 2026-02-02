/**
 * Proactive Nudge Generator
 *
 * Generates comprehensive, actionable nudges based on:
 * - Relationship health (5-factor scoring)
 * - Commitment tracking (overdue, due soon)
 * - Interaction patterns (recency, frequency)
 * - Sentiment analysis (declining trends)
 * - Follow-up indicators (keywords in memories)
 *
 * Nudge Types:
 * - follow_up: Recent memory indicates follow-up needed
 * - relationship_maintenance: Regular maintenance (recency-based)
 * - commitment_due: Deadline approaching or overdue
 * - dormant_relationship: Relationship at-risk or dormant
 *
 * Uses EnhancedRelationshipHealthScorer for comprehensive health analysis.
 */

import { nanoid } from 'nanoid';
import type {
  ProactiveNudge,
  NudgeGenerationResult,
  NudgeType,
  NudgePriority,
} from './types';
import { NudgeGenerationError } from './types';
import {
  EnhancedRelationshipHealthScorer,
  type RelationshipHealth
} from './enhanced-health-scorer';

export class ProactiveNudgeGenerator {
  private db: D1Database;
  private ai: any;
  private userId: string;
  private containerTag: string;
  private healthScorer: EnhancedRelationshipHealthScorer;

  // Nudge configuration
  private static readonly MAX_NUDGES_PER_RUN = 20;
  private static readonly NUDGE_EXPIRY_DAYS = 7;

  constructor(
    db: D1Database,
    ai: any,
    userId: string,
    containerTag: string = 'default'
  ) {
    this.db = db;
    this.ai = ai;
    this.userId = userId;
    this.containerTag = containerTag;
    this.healthScorer = new EnhancedRelationshipHealthScorer(
      db,
      ai,
      userId,
      containerTag
    );
  }

  /**
   * Generate all nudges for the user
   */
  async generateNudges(entityId?: string): Promise<NudgeGenerationResult> {
    const startTime = Date.now();
    const nudges: ProactiveNudge[] = [];

    try {
      console.log(`[NudgeGenerator] Generating nudges for user ${this.userId}`);

      // Get entities to analyze (all or specific)
      const entities = await this.getEntities(entityId);
      console.log(`[NudgeGenerator] Analyzing ${entities.length} entities`);

      // Generate nudges for each entity
      for (const entity of entities) {
        try {
          const entityNudges = await this.generateEntityNudges(entity);
          nudges.push(...entityNudges);
        } catch (error: any) {
          console.error(`[NudgeGenerator] Failed to generate nudges for entity ${entity.id}:`, error);
        }
      }

      // Sort by priority and confidence
      const sortedNudges = this.prioritizeNudges(nudges).slice(
        0,
        ProactiveNudgeGenerator.MAX_NUDGES_PER_RUN
      );

      const highPriorityCount = sortedNudges.filter(
        (n) => n.priority === 'urgent' || n.priority === 'high'
      ).length;

      console.log(
        `[NudgeGenerator] Generated ${sortedNudges.length} nudges (${highPriorityCount} high priority)`
      );

      return {
        nudges: sortedNudges,
        generation_metadata: {
          total_generated: sortedNudges.length,
          high_priority_count: highPriorityCount,
          processing_time_ms: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      console.error('[NudgeGenerator] Generation failed:', error);
      throw new NudgeGenerationError(
        `Nudge generation failed: ${error.message}`,
        true,
        { user_id: this.userId }
      );
    }
  }

  /**
   * Generate comprehensive nudges for a specific entity
   */
  private async generateEntityNudges(entity: any): Promise<ProactiveNudge[]> {
    const nudges: ProactiveNudge[] = [];

    // Get health score for entity
    const health = await this.healthScorer.computeHealthScore(
      this.userId,
      entity.id,
      this.containerTag
    );

    // 1. Recency-based maintenance nudges
    const recencyNudge = this.generateRecencyNudge(entity, health);
    if (recencyNudge) nudges.push(recencyNudge);

    // 2. At-risk relationship nudges
    const atRiskNudge = this.generateAtRiskNudge(entity, health);
    if (atRiskNudge) nudges.push(atRiskNudge);

    // 3. Commitment nudges (overdue + due soon)
    const commitmentNudges = await this.generateCommitmentNudges(entity);
    nudges.push(...commitmentNudges);

    // 4. Follow-up nudges (from memory keywords)
    const followUpNudges = await this.generateFollowUpNudges(entity);
    nudges.push(...followUpNudges);

    // 5. Sentiment decline nudges
    const sentimentNudge = this.generateSentimentNudge(entity, health);
    if (sentimentNudge) nudges.push(sentimentNudge);

    return nudges;
  }

  /**
   * Generate recency-based maintenance nudge
   */
  private generateRecencyNudge(entity: any, health: RelationshipHealth): ProactiveNudge | null {
    const daysSince = health.factors.recency.days_since;

    // No nudge if recently contacted (< 14 days)
    if (daysSince < 14) return null;

    // Determine priority based on days since contact
    let priority: NudgePriority;
    let message: string;

    if (daysSince >= 90) {
      priority = 'high';
      message = `It's been ${daysSince} days since your last interaction. This relationship may be at risk.`;
    } else if (daysSince >= 30) {
      priority = 'medium';
      message = `It's been ${daysSince} days since your last interaction. Consider reaching out.`;
    } else {
      priority = 'low';
      message = `It's been ${daysSince} days since your last interaction. A quick check-in would be good.`;
    }

    return this.createNudge({
      nudge_type: 'relationship_maintenance',
      priority,
      title: `Haven't connected with ${entity.name} recently`,
      message,
      entity_id: entity.id,
      entity_name: entity.name,
      suggested_action: `Send a message or schedule a call with ${entity.name}`,
      confidence_score: 0.85,
    });
  }

  /**
   * Generate at-risk relationship nudge
   */
  private generateAtRiskNudge(entity: any, health: RelationshipHealth): ProactiveNudge | null {
    // Only generate if health is at-risk or dormant
    if (health.health_status !== 'at_risk' && health.health_status !== 'dormant') {
      return null;
    }

    const priority: NudgePriority = health.health_status === 'dormant' ? 'urgent' : 'high';
    const healthPercent = (health.health_score * 100).toFixed(0);

    return this.createNudge({
      nudge_type: 'dormant_relationship',
      priority,
      title: `Relationship with ${entity.name} needs attention`,
      message: `Health score: ${healthPercent}%. ${health.risk_factors.join('. ')}`,
      entity_id: entity.id,
      entity_name: entity.name,
      suggested_action: health.recommendations[0] || `Reach out to ${entity.name}`,
      confidence_score: 0.9,
    });
  }

  /**
   * Generate commitment nudges (overdue + due soon)
   */
  private async generateCommitmentNudges(entity: any): Promise<ProactiveNudge[]> {
    const nudges: ProactiveNudge[] = [];

    // Get commitments related to this entity
    const commitmentsResult = await this.db.prepare(`
      SELECT c.*, ce.role
      FROM commitments c
      LEFT JOIN commitment_entities ce ON ce.commitment_id = c.id AND ce.entity_id = ?
      WHERE c.user_id = ?
        AND c.container_tag = ?
        AND c.status IN ('pending', 'overdue')
        AND (
          ce.entity_id = ?
          OR c.context LIKE '%' || ? || '%'
        )
      ORDER BY c.due_date ASC
      LIMIT 20
    `).bind(
      entity.id,
      this.userId,
      this.containerTag,
      entity.id,
      entity.name
    ).all();

    const commitments = commitmentsResult.results as any[];

    for (const commitment of commitments) {
      const now = new Date();
      const dueDate = new Date(commitment.due_date);
      const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let priority: NudgePriority;
      let nudgeType: NudgeType;
      let message: string;

      if (commitment.status === 'overdue' || daysUntilDue < 0) {
        const daysOverdue = Math.abs(daysUntilDue);
        priority = daysOverdue > 7 ? 'urgent' : 'high';
        nudgeType = 'overdue_commitment';
        message = `This commitment is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue.`;
      } else if (daysUntilDue === 0) {
        priority = 'urgent';
        nudgeType = 'deadline_approaching';
        message = `This commitment is due today.`;
      } else if (daysUntilDue <= 2) {
        priority = 'high';
        nudgeType = 'deadline_approaching';
        message = `This commitment is due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}.`;
      } else if (daysUntilDue <= 7) {
        priority = 'medium';
        nudgeType = 'commitment_due';
        message = `This commitment is due in ${daysUntilDue} days.`;
      } else {
        // Don't create nudges for commitments due in 8+ days
        continue;
      }

      nudges.push(this.createNudge({
        nudge_type: nudgeType,
        priority,
        title: `${entity.name}: "${commitment.title}"`,
        message,
        entity_id: entity.id,
        entity_name: entity.name,
        commitment_id: commitment.id,
        suggested_action: commitment.suggested_action || 'Complete this commitment',
        confidence_score: 0.9,
      }));
    }

    return nudges;
  }

  /**
   * Generate follow-up nudges from memory keywords
   */
  private async generateFollowUpNudges(entity: any): Promise<ProactiveNudge[]> {
    const nudges: ProactiveNudge[] = [];

    // Get recent memories (last 14 days) mentioning entity
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const memoriesResult = await this.db.prepare(`
      SELECT m.id, m.content, m.created_at
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ?
        AND m.user_id = ?
        AND m.container_tag = ?
        AND m.created_at >= ?
        AND m.is_forgotten = 0
      ORDER BY m.created_at DESC
      LIMIT 10
    `).bind(
      entity.id,
      this.userId,
      this.containerTag,
      twoWeeksAgo.toISOString()
    ).all();

    const memories = memoriesResult.results as any[];

    // Look for follow-up indicators
    const followUpKeywords = [
      'follow up',
      'will send',
      'will share',
      'promised to',
      'need to send',
      'will get back',
      'will reach out',
      'schedule',
      'call back',
      'need to call',
      'remind me',
    ];

    for (const memory of memories) {
      const content = memory.content.toLowerCase();
      const matchedKeyword = followUpKeywords.find(kw => content.includes(kw));

      if (matchedKeyword) {
        const daysSince = Math.ceil(
          (new Date().getTime() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only create nudge if 3+ days have passed
        if (daysSince >= 3) {
          const priority: NudgePriority = daysSince >= 7 ? 'high' : 'medium';

          nudges.push(this.createNudge({
            nudge_type: 'follow_up',
            priority,
            title: `Follow up with ${entity.name}`,
            message: `${daysSince} days ago: "${memory.content.substring(0, 100)}${memory.content.length > 100 ? '...' : ''}"`,
            entity_id: entity.id,
            entity_name: entity.name,
            memory_id: memory.id,
            suggested_action: `Complete the follow-up action with ${entity.name}`,
            confidence_score: 0.8,
          }));

          // Only one follow-up nudge per entity
          break;
        }
      }
    }

    return nudges;
  }

  /**
   * Generate sentiment decline nudge
   */
  private generateSentimentNudge(entity: any, health: RelationshipHealth): ProactiveNudge | null {
    // Only generate if sentiment is declining
    if (health.factors.sentiment.trend !== 'declining') {
      return null;
    }

    // Only generate if sentiment score is below 0.5
    if (health.factors.sentiment.score >= 0.5) {
      return null;
    }

    const sentimentPercent = (health.factors.sentiment.avg_sentiment * 100).toFixed(0);

    return this.createNudge({
      nudge_type: 'relationship_maintenance',
      priority: 'medium',
      title: `Sentiment with ${entity.name} declining`,
      message: `Recent interactions seem less positive. Average sentiment: ${sentimentPercent}%.`,
      entity_id: entity.id,
      entity_name: entity.name,
      suggested_action: `Have an open conversation with ${entity.name}`,
      confidence_score: 0.75,
    });
  }

  /**
   * Get entities for analysis (all or specific)
   */
  private async getEntities(entityId?: string): Promise<any[]> {
    let query = `
      SELECT id, name, entity_type, importance_score
      FROM entities
      WHERE user_id = ? AND container_tag = ?
    `;
    const params: any[] = [this.userId, this.containerTag];

    if (entityId) {
      query += ' AND id = ?';
      params.push(entityId);
    } else {
      // Only generate for important entities (importance >= 0.3)
      query += ' AND importance_score >= 0.3';
      // Limit to top 50 entities by importance
      query += ' ORDER BY importance_score DESC LIMIT 50';
    }

    const result = await this.db.prepare(query).bind(...params).all();
    return result.results as any[];
  }

  /**
   * Create nudge object
   */
  private createNudge(
    partial: Partial<ProactiveNudge> & {
      nudge_type: NudgeType;
      priority: NudgePriority;
      title: string;
      message: string;
      confidence_score: number;
    }
  ): ProactiveNudge {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        ProactiveNudgeGenerator.NUDGE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    return {
      id: nanoid(),
      user_id: this.userId,
      nudge_type: partial.nudge_type,
      priority: partial.priority,
      title: partial.title,
      message: partial.message,
      entity_id: partial.entity_id || null,
      entity_name: partial.entity_name || null,
      commitment_id: partial.commitment_id || null,
      memory_id: partial.memory_id || null,
      suggested_action: partial.suggested_action || null,
      action_url: partial.action_url || null,
      scheduled_for: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'pending',
      sent_at: null,
      dismissed_at: null,
      acted_on_at: null,
      confidence_score: partial.confidence_score,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
  }

  /**
   * Prioritize nudges
   */
  private prioritizeNudges(nudges: ProactiveNudge[]): ProactiveNudge[] {
    // Sort by: priority first, then confidence
    const priorityOrder: Record<NudgePriority, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    return nudges.sort((a, b) => {
      // Priority
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Confidence
      return b.confidence_score - a.confidence_score;
    });
  }

  /**
   * Get urgent nudges only (high priority)
   */
  async getUrgentNudges(): Promise<ProactiveNudge[]> {
    const result = await this.generateNudges();
    return result.nudges.filter(n => n.priority === 'urgent' || n.priority === 'high');
  }

  /**
   * Get nudges for specific entity
   */
  async getEntityNudges(entityId: string): Promise<ProactiveNudge[]> {
    const result = await this.generateNudges(entityId);
    return result.nudges;
  }

  /**
   * Get nudge counts by type and priority
   */
  async getNudgeCounts(): Promise<{
    total: number;
    by_priority: Record<NudgePriority, number>;
    by_type: Record<string, number>;
  }> {
    const result = await this.generateNudges();
    const nudges = result.nudges;

    const byPriority: Record<NudgePriority, number> = {
      urgent: nudges.filter(n => n.priority === 'urgent').length,
      high: nudges.filter(n => n.priority === 'high').length,
      medium: nudges.filter(n => n.priority === 'medium').length,
      low: nudges.filter(n => n.priority === 'low').length,
    };

    const byType: Record<string, number> = {};
    for (const nudge of nudges) {
      byType[nudge.nudge_type] = (byType[nudge.nudge_type] || 0) + 1;
    }

    return {
      total: nudges.length,
      by_priority: byPriority,
      by_type: byType,
    };
  }
}

/**
 * Helper function to generate nudges
 */
export async function generateProactiveNudges(
  db: D1Database,
  ai: any,
  userId: string,
  containerTag: string = 'default'
): Promise<NudgeGenerationResult> {
  const generator = new ProactiveNudgeGenerator(db, ai, userId, containerTag);
  return generator.generateNudges();
}
