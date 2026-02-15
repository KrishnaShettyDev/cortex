/**
 * Enhanced Relationship Health Scorer
 *
 * Comprehensive 5-factor health scoring:
 * 1. Recency - exponential decay (30% weight)
 * 2. Frequency - log-scaled interaction count (25% weight)
 * 3. Sentiment - LLM-analyzed with trend (20% weight)
 * 4. Commitment Health - completion rate (15% weight)
 * 5. Engagement Depth - message length + topic diversity (10% weight)
 */

export interface RelationshipHealth {
  entity_id: string;
  entity_name: string;
  entity_type: string;

  health_score: number; // 0-1 composite score
  health_status: 'healthy' | 'attention_needed' | 'at_risk' | 'dormant';

  factors: {
    recency: RecencyScore;
    frequency: FrequencyScore;
    sentiment: SentimentScore;
    commitment_health: CommitmentHealthScore;
    engagement_depth: EngagementScore;
  };

  recommendations: string[];
  risk_factors: string[];

  calculated_at: string;
}

export interface RecencyScore {
  score: number; // 0-1
  last_interaction_date: string;
  days_since: number;
}

export interface FrequencyScore {
  score: number; // 0-1
  interaction_count: number;
  avg_days_between: number;
}

export interface SentimentScore {
  score: number; // 0-1 (normalized from -1 to +1)
  avg_sentiment: number; // -1 (negative) to +1 (positive)
  trend: 'improving' | 'stable' | 'declining';
}

export interface CommitmentHealthScore {
  score: number; // 0-1
  pending: number;
  completed: number;
  overdue: number;
  completion_rate: number;
}

export interface EngagementScore {
  score: number; // 0-1
  avg_memory_length: number;
  topics_discussed: number;
}

export class EnhancedRelationshipHealthScorer {
  // Scoring weights
  static readonly WEIGHTS = {
    recency: 0.30,
    frequency: 0.25,
    sentiment: 0.20,
    commitments: 0.15,
    engagement: 0.10,
  };

  // Recency thresholds (days)
  static readonly RECENCY_THRESHOLDS = {
    healthy: 7,
    attention: 30,
    at_risk: 60,
    dormant: 90,
  };

  constructor(
    private db: D1Database,
    private ai?: any
  ) {}

  /**
   * Compute comprehensive health score for an entity
   */
  async computeHealthScore(
    userId: string,
    entityId: string,
    containerTag: string = 'default'
  ): Promise<RelationshipHealth> {
    // Get entity details
    const entity = await this.db.prepare(`
      SELECT id, name, entity_type
      FROM entities
      WHERE id = ? AND user_id = ? AND container_tag = ?
    `).bind(entityId, userId, containerTag).first<any>();

    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }

    // Compute all factors in parallel
    const [recency, frequency, sentiment, commitments, engagement] = await Promise.all([
      this.scoreRecency(userId, entityId, containerTag),
      this.scoreFrequency(userId, entityId, containerTag),
      this.scoreSentiment(userId, entityId, containerTag),
      this.scoreCommitments(userId, entityId, containerTag),
      this.scoreEngagement(userId, entityId, containerTag),
    ]);

    // Weighted composite score
    const healthScore =
      recency.score * EnhancedRelationshipHealthScorer.WEIGHTS.recency +
      frequency.score * EnhancedRelationshipHealthScorer.WEIGHTS.frequency +
      sentiment.score * EnhancedRelationshipHealthScorer.WEIGHTS.sentiment +
      commitments.score * EnhancedRelationshipHealthScorer.WEIGHTS.commitments +
      engagement.score * EnhancedRelationshipHealthScorer.WEIGHTS.engagement;

    // Determine status
    const status = this.determineStatus(healthScore, recency.days_since);

    // Generate recommendations and identify risks
    const recommendations = this.generateRecommendations(
      recency,
      frequency,
      sentiment,
      commitments
    );
    const riskFactors = this.identifyRiskFactors(
      recency,
      frequency,
      sentiment,
      commitments
    );

    return {
      entity_id: entityId,
      entity_name: entity.name,
      entity_type: entity.entity_type,
      health_score: healthScore,
      health_status: status,
      factors: {
        recency,
        frequency,
        sentiment,
        commitment_health: commitments,
        engagement_depth: engagement,
      },
      recommendations,
      risk_factors: riskFactors,
      calculated_at: new Date().toISOString(),
    };
  }

  /**
   * Factor 1: Recency Score (exponential decay)
   * score = e^(-days / 14)
   */
  private async scoreRecency(
    userId: string,
    entityId: string,
    containerTag: string
  ): Promise<RecencyScore> {
    const result = await this.db.prepare(`
      SELECT MAX(m.created_at) as last_interaction
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ?
        AND m.user_id = ?
        AND m.container_tag = ?
        AND m.is_forgotten = 0
    `).bind(entityId, userId, containerTag).first<{ last_interaction: string }>();

    if (!result?.last_interaction) {
      return {
        score: 0,
        last_interaction_date: '',
        days_since: 999,
      };
    }

    const daysSince = (Date.now() - new Date(result.last_interaction).getTime()) /
      (1000 * 60 * 60 * 24);

    // Exponential decay: e^(-days / 14)
    // Healthy: < 7 days → 0.6+
    // Attention: 7-30 days → 0.1-0.6
    // At-risk: 30-90 days → 0.01-0.1
    // Dormant: 90+ days → < 0.01
    const score = Math.exp(-daysSince / 14);

    return {
      score,
      last_interaction_date: result.last_interaction,
      days_since: Math.floor(daysSince),
    };
  }

  /**
   * Factor 2: Frequency Score (log-scaled)
   * score = log10(count + 1) / log10(20)
   */
  private async scoreFrequency(
    userId: string,
    entityId: string,
    containerTag: string
  ): Promise<FrequencyScore> {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count, MIN(m.created_at) as first_interaction
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ?
        AND m.user_id = ?
        AND m.container_tag = ?
        AND m.is_forgotten = 0
        AND m.created_at >= datetime('now', '-90 days')
    `).bind(entityId, userId, containerTag).first<{ count: number; first_interaction: string }>();

    const count = result?.count || 0;

    if (count === 0) {
      return {
        score: 0,
        interaction_count: 0,
        avg_days_between: 90,
      };
    }

    // Calculate average days between interactions
    const daysSinceFirst = result?.first_interaction
      ? (Date.now() - new Date(result.first_interaction).getTime()) / (1000 * 60 * 60 * 24)
      : 90;
    const avgDaysBetween = count > 1 ? daysSinceFirst / count : daysSinceFirst;

    // Log-scaled frequency score
    // 1 interaction → 0.10
    // 5 interactions → 0.54
    // 10 interactions → 0.77
    // 20+ interactions → 1.0
    const score = Math.min(1, Math.log10(count + 1) / Math.log10(20));

    return {
      score,
      interaction_count: count,
      avg_days_between: Math.floor(avgDaysBetween),
    };
  }

  /**
   * Factor 3: Sentiment Score (LLM-analyzed with trend)
   */
  private async scoreSentiment(
    userId: string,
    entityId: string,
    containerTag: string
  ): Promise<SentimentScore> {
    // Get recent memories mentioning this entity
    const result = await this.db.prepare(`
      SELECT m.id, m.content, m.created_at
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ?
        AND m.user_id = ?
        AND m.container_tag = ?
        AND m.is_forgotten = 0
        AND m.created_at >= datetime('now', '-90 days')
      ORDER BY m.created_at DESC
      LIMIT 20
    `).bind(entityId, userId, containerTag).all();

    if (result.results.length === 0) {
      return {
        score: 0.5, // Neutral
        avg_sentiment: 0,
        trend: 'stable',
      };
    }

    // Analyze sentiment using AI (if available)
    let sentiments: number[];

    if (this.ai) {
      sentiments = await this.analyzeSentimentBatch(result.results as any[]);
    } else {
      // Fallback: neutral sentiment
      sentiments = result.results.map(() => 0);
    }

    // Calculate average sentiment
    const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;

    // Normalize to 0-1: (sentiment + 1) / 2
    const score = (avgSentiment + 1) / 2;

    // Trend analysis: compare last 30 days vs previous 60 days
    const splitIndex = Math.floor(sentiments.length / 3);
    const recentSentiments = sentiments.slice(0, splitIndex); // Most recent
    const olderSentiments = sentiments.slice(splitIndex);

    const recentAvg = recentSentiments.length > 0
      ? recentSentiments.reduce((sum, s) => sum + s, 0) / recentSentiments.length
      : avgSentiment;
    const olderAvg = olderSentiments.length > 0
      ? olderSentiments.reduce((sum, s) => sum + s, 0) / olderSentiments.length
      : avgSentiment;

    const trend = recentAvg > olderAvg + 0.1 ? 'improving' :
                  recentAvg < olderAvg - 0.1 ? 'declining' : 'stable';

    return {
      score,
      avg_sentiment: avgSentiment,
      trend,
    };
  }

  /**
   * Batch sentiment analysis using LLM
   */
  private async analyzeSentimentBatch(memories: any[]): Promise<number[]> {
    if (memories.length === 0) return [];

    const prompt = `Analyze the sentiment of each memory about an entity. Return sentiment scores from -1 (very negative) to +1 (very positive).

Memories:
${memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}

Return ONLY a JSON array of numbers, one for each memory:
[-0.2, 0.5, 0.8, ...]`;

    try {
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt,
        max_tokens: 200,
        temperature: 0.1,
      });

      const text = response.response || '';
      const jsonMatch = text.match(/\[([-0-9.,\s]+)\]/);

      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        return scores.map((s: number) => Math.max(-1, Math.min(1, s)));
      }
    } catch (error) {
      console.warn('[HealthScorer] Sentiment analysis failed:', error);
    }

    // Fallback: neutral sentiments
    return memories.map(() => 0);
  }

  /**
   * Factor 4: Commitment Health Score
   */
  private async scoreCommitments(
    userId: string,
    entityId: string,
    containerTag: string
  ): Promise<CommitmentHealthScore> {
    const result = await this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue
      FROM commitments
      WHERE (to_entity_id = ? OR from_entity_id = ?)
        AND user_id = ?
    `).bind(entityId, entityId, userId).first<{
      pending: number;
      completed: number;
      overdue: number;
    }>();

    const pending = result?.pending || 0;
    const completed = result?.completed || 0;
    const overdue = result?.overdue || 0;

    const total = completed + overdue;
    const completionRate = total > 0 ? completed / total : 1.0;

    // Score = completion_rate * (1 - overdue_penalty)
    // Overdue penalty: -10% per overdue commitment
    const score = Math.max(0, completionRate * (1 - overdue * 0.1));

    return {
      score,
      pending,
      completed,
      overdue,
      completion_rate: completionRate,
    };
  }

  /**
   * Factor 5: Engagement Depth Score
   */
  private async scoreEngagement(
    userId: string,
    entityId: string,
    containerTag: string
  ): Promise<EngagementScore> {
    const result = await this.db.prepare(`
      SELECT m.id, m.content, m.metadata
      FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ?
        AND m.user_id = ?
        AND m.container_tag = ?
        AND m.is_forgotten = 0
    `).bind(entityId, userId, containerTag).all();

    if (result.results.length === 0) {
      return {
        score: 0,
        avg_memory_length: 0,
        topics_discussed: 0,
      };
    }

    const memories = result.results as any[];

    // Average memory length (more detail = deeper engagement)
    const avgLength = memories.reduce((sum, m) => sum + m.content.length, 0) / memories.length;

    // Normalize: 500+ chars = 1.0
    const lengthScore = Math.min(1, avgLength / 500);

    // Topic diversity: count unique entities co-mentioned
    const coMentionedEntities = new Set<string>();
    for (const memory of memories) {
      if (memory.metadata) {
        const metadata = JSON.parse(memory.metadata);
        if (metadata.entities) {
          for (const entity of metadata.entities) {
            coMentionedEntities.add(entity);
          }
        }
      }
    }

    const topicDiversity = Math.min(1, coMentionedEntities.size / 10);

    // Combined score
    const score = (lengthScore + topicDiversity) / 2;

    return {
      score,
      avg_memory_length: Math.floor(avgLength),
      topics_discussed: coMentionedEntities.size,
    };
  }

  /**
   * Determine overall health status
   */
  private determineStatus(
    healthScore: number,
    daysSince: number
  ): 'healthy' | 'attention_needed' | 'at_risk' | 'dormant' {
    if (daysSince >= EnhancedRelationshipHealthScorer.RECENCY_THRESHOLDS.dormant) {
      return 'dormant';
    }

    if (healthScore >= 0.7) return 'healthy';
    if (healthScore >= 0.5) return 'attention_needed';
    if (healthScore >= 0.3) return 'at_risk';
    return 'dormant';
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    recency: RecencyScore,
    frequency: FrequencyScore,
    sentiment: SentimentScore,
    commitments: CommitmentHealthScore
  ): string[] {
    const recommendations: string[] = [];

    // Recency recommendations
    if (recency.days_since > 30) {
      recommendations.push(`Reach out soon - it's been ${recency.days_since} days since last contact`);
    } else if (recency.days_since > 14) {
      recommendations.push(`Consider checking in - approaching 30 days without contact`);
    }

    // Frequency recommendations
    if (frequency.interaction_count < 3) {
      recommendations.push('Build rapport through more frequent interactions');
    }

    // Sentiment recommendations
    if (sentiment.trend === 'declining') {
      recommendations.push('Address declining sentiment - have an open conversation');
    } else if (sentiment.avg_sentiment < 0) {
      recommendations.push('Work on improving relationship positivity');
    }

    // Commitment recommendations
    if (commitments.overdue > 0) {
      recommendations.push(`Follow up on ${commitments.overdue} overdue commitment(s)`);
    } else if (commitments.completion_rate < 0.7) {
      recommendations.push('Improve commitment follow-through rate');
    }

    if (recommendations.length === 0) {
      recommendations.push('Relationship is healthy - maintain current engagement level');
    }

    return recommendations;
  }

  /**
   * Identify risk factors
   */
  private identifyRiskFactors(
    recency: RecencyScore,
    frequency: FrequencyScore,
    sentiment: SentimentScore,
    commitments: CommitmentHealthScore
  ): string[] {
    const risks: string[] = [];

    if (recency.days_since > 60) {
      risks.push(`No contact in ${recency.days_since} days`);
    }

    if (frequency.interaction_count < 2) {
      risks.push('Very low interaction frequency');
    }

    if (sentiment.trend === 'declining') {
      risks.push('Declining sentiment trend');
    }

    if (commitments.overdue > 2) {
      risks.push(`${commitments.overdue} overdue commitments`);
    }

    if (commitments.completion_rate < 0.5) {
      risks.push('Poor commitment follow-through');
    }

    return risks;
  }

  /**
   * Batch compute health scores for multiple entities
   */
  async computeBatchHealthScores(
    userId: string,
    entityIds: string[],
    containerTag: string = 'default'
  ): Promise<RelationshipHealth[]> {
    const results = await Promise.allSettled(
      entityIds.map(entityId => this.computeHealthScore(userId, entityId, containerTag))
    );

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<RelationshipHealth>).value);
  }
}
