/**
 * Outcome Repository
 *
 * Data access layer for outcomes and their sources.
 */

import type { D1Database } from '@cloudflare/workers-types';

import type {
  Outcome,
  OutcomeRow,
  OutcomeSourceRecord,
  OutcomeSourceRow,
  OutcomeSignal,
  OutcomeSource,
  ActionType,
  SourceType,
  RecordOutcomeInput,
  RecordFeedbackInput,
  OutcomeQueryOptions,
  OutcomeWithSources,
  OutcomeStats,
  SourceEffectiveness,
  ReasoningTrace,
} from './types';

// ============================================
// ROW CONVERTERS
// ============================================

function parseJSON<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToOutcome(row: OutcomeRow): Outcome {
  return {
    id: row.id,
    userId: row.user_id,
    actionType: row.action_type as ActionType,
    actionContent: row.action_content,
    actionContext: parseJSON(row.action_context),
    reasoningTrace: parseJSON<ReasoningTrace>(row.reasoning_trace),
    outcomeSignal: row.outcome_signal as OutcomeSignal,
    outcomeSource: row.outcome_source as OutcomeSource | null,
    outcomeDetails: parseJSON(row.outcome_details),
    actionAt: new Date(row.action_at),
    outcomeAt: row.outcome_at ? new Date(row.outcome_at) : null,
    feedbackPropagated: row.feedback_propagated === 1,
    propagatedAt: row.propagated_at ? new Date(row.propagated_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToSource(row: OutcomeSourceRow): OutcomeSourceRecord {
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    sourceType: row.source_type as SourceType,
    sourceId: row.source_id,
    contributionWeight: row.contribution_weight,
    createdAt: new Date(row.created_at),
  };
}

// ============================================
// REPOSITORY CLASS
// ============================================

export class OutcomeRepository {
  constructor(private readonly db: D1Database) {}

  // ------------------------------------------
  // CREATE OPERATIONS
  // ------------------------------------------

  /**
   * Record a new outcome
   */
  async recordOutcome(input: RecordOutcomeInput): Promise<Outcome> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO outcomes (
          id, user_id, action_type, action_content, action_context,
          reasoning_trace, action_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.userId,
        input.actionType,
        input.actionContent,
        input.actionContext ? JSON.stringify(input.actionContext) : null,
        input.reasoningTrace ? JSON.stringify(input.reasoningTrace) : null,
        now,
        now,
        now
      )
      .run();

    // Record sources
    if (input.sources.length > 0) {
      const sourceStatements = input.sources.map((source) =>
        this.db
          .prepare(
            `INSERT INTO outcome_sources (
              id, outcome_id, source_type, source_id, contribution_weight, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            id,
            source.sourceType,
            source.sourceId,
            source.contributionWeight ?? 1.0,
            now
          )
      );
      await this.db.batch(sourceStatements);
    }

    const outcome = await this.getOutcomeById(id, input.userId);
    if (!outcome) {
      throw new Error('Failed to record outcome');
    }
    return outcome;
  }

  /**
   * Record feedback for an outcome
   */
  async recordFeedback(input: RecordFeedbackInput): Promise<Outcome | null> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE outcomes
        SET
          outcome_signal = ?,
          outcome_source = ?,
          outcome_details = ?,
          outcome_at = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ?`
      )
      .bind(
        input.signal,
        input.source,
        input.details ? JSON.stringify(input.details) : null,
        now,
        now,
        input.outcomeId,
        input.userId
      )
      .run();

    return this.getOutcomeById(input.outcomeId, input.userId);
  }

  /**
   * Mark outcome as propagated
   */
  async markPropagated(outcomeId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE outcomes
        SET feedback_propagated = 1, propagated_at = ?, updated_at = ?
        WHERE id = ?`
      )
      .bind(now, now, outcomeId)
      .run();
  }

  // ------------------------------------------
  // READ OPERATIONS
  // ------------------------------------------

  /**
   * Get outcome by ID
   */
  async getOutcomeById(id: string, userId: string): Promise<Outcome | null> {
    const row = await this.db
      .prepare('SELECT * FROM outcomes WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<OutcomeRow>();

    return row ? rowToOutcome(row) : null;
  }

  /**
   * Get outcome with its sources
   */
  async getOutcomeWithSources(
    id: string,
    userId: string
  ): Promise<OutcomeWithSources | null> {
    const outcome = await this.getOutcomeById(id, userId);
    if (!outcome) return null;

    const sources = await this.getSourcesForOutcome(id);
    return { ...outcome, sources };
  }

  /**
   * Get sources for an outcome
   */
  async getSourcesForOutcome(outcomeId: string): Promise<OutcomeSourceRecord[]> {
    const result = await this.db
      .prepare('SELECT * FROM outcome_sources WHERE outcome_id = ?')
      .bind(outcomeId)
      .all<OutcomeSourceRow>();

    return (result.results ?? []).map(rowToSource);
  }

  /**
   * Query outcomes with filters
   */
  async queryOutcomes(options: OutcomeQueryOptions): Promise<Outcome[]> {
    const conditions: string[] = ['user_id = ?'];
    const params: (string | number)[] = [options.userId];

    if (options.actionTypes && options.actionTypes.length > 0) {
      const placeholders = options.actionTypes.map(() => '?').join(', ');
      conditions.push(`action_type IN (${placeholders})`);
      params.push(...options.actionTypes);
    }

    if (options.outcomeSignals && options.outcomeSignals.length > 0) {
      const placeholders = options.outcomeSignals.map(() => '?').join(', ');
      conditions.push(`outcome_signal IN (${placeholders})`);
      params.push(...options.outcomeSignals);
    }

    if (options.fromDate) {
      conditions.push('action_at >= ?');
      params.push(options.fromDate.toISOString());
    }

    if (options.toDate) {
      conditions.push('action_at <= ?');
      params.push(options.toDate.toISOString());
    }

    if (options.feedbackPropagated !== undefined) {
      conditions.push('feedback_propagated = ?');
      params.push(options.feedbackPropagated ? 1 : 0);
    }

    const orderBy = options.orderBy ?? 'action_at';
    const orderDirection = options.orderDirection ?? 'desc';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const sql = `
      SELECT *
      FROM outcomes
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy} ${orderDirection.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<OutcomeRow>();

    return (result.results ?? []).map(rowToOutcome);
  }

  /**
   * Get outcomes pending propagation
   */
  async getPendingPropagation(limit: number = 100): Promise<OutcomeWithSources[]> {
    const result = await this.db
      .prepare(
        `SELECT *
        FROM outcomes
        WHERE feedback_propagated = 0 AND outcome_signal != 'unknown'
        ORDER BY outcome_at ASC
        LIMIT ?`
      )
      .bind(limit)
      .all<OutcomeRow>();

    const outcomes = (result.results ?? []).map(rowToOutcome);

    // Fetch sources for each outcome
    const withSources: OutcomeWithSources[] = [];
    for (const outcome of outcomes) {
      const sources = await this.getSourcesForOutcome(outcome.id);
      withSources.push({ ...outcome, sources });
    }

    return withSources;
  }

  /**
   * Get recent outcomes for a source
   */
  async getOutcomesForSource(
    sourceType: SourceType,
    sourceId: string,
    limit: number = 20
  ): Promise<Outcome[]> {
    const result = await this.db
      .prepare(
        `SELECT o.*
        FROM outcomes o
        JOIN outcome_sources os ON o.id = os.outcome_id
        WHERE os.source_type = ? AND os.source_id = ?
        ORDER BY o.action_at DESC
        LIMIT ?`
      )
      .bind(sourceType, sourceId, limit)
      .all<OutcomeRow>();

    return (result.results ?? []).map(rowToOutcome);
  }

  // ------------------------------------------
  // ANALYTICS
  // ------------------------------------------

  /**
   * Get outcome statistics for a user
   */
  async getStats(userId: string): Promise<OutcomeStats> {
    const totals = await this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN outcome_signal = 'positive' THEN 1 ELSE 0 END) as positive,
          SUM(CASE WHEN outcome_signal = 'negative' THEN 1 ELSE 0 END) as negative,
          SUM(CASE WHEN outcome_signal = 'neutral' THEN 1 ELSE 0 END) as neutral,
          SUM(CASE WHEN outcome_signal = 'unknown' THEN 1 ELSE 0 END) as unknown_count
        FROM outcomes
        WHERE user_id = ?`
      )
      .bind(userId)
      .first<{
        total: number;
        positive: number;
        negative: number;
        neutral: number;
        unknown_count: number;
      }>();

    const byActionType = await this.db
      .prepare(
        `SELECT action_type, COUNT(*) as count
        FROM outcomes
        WHERE user_id = ?
        GROUP BY action_type`
      )
      .bind(userId)
      .all<{ action_type: string; count: number }>();

    const avgSources = await this.db
      .prepare(
        `SELECT AVG(source_count) as avg
        FROM (
          SELECT o.id, COUNT(os.id) as source_count
          FROM outcomes o
          LEFT JOIN outcome_sources os ON o.id = os.outcome_id
          WHERE o.user_id = ?
          GROUP BY o.id
        )`
      )
      .bind(userId)
      .first<{ avg: number }>();

    const total = totals?.total ?? 0;
    const feedbackCount = total - (totals?.unknown_count ?? 0);

    return {
      total,
      bySignal: {
        positive: totals?.positive ?? 0,
        negative: totals?.negative ?? 0,
        neutral: totals?.neutral ?? 0,
        unknown: totals?.unknown_count ?? 0,
      },
      byActionType: Object.fromEntries(
        (byActionType.results ?? []).map((r) => [r.action_type, r.count])
      ) as Record<ActionType, number>,
      feedbackRate: total > 0 ? feedbackCount / total : 0,
      positiveRate: feedbackCount > 0 ? (totals?.positive ?? 0) / feedbackCount : 0,
      avgSourcesPerOutcome: avgSources?.avg ?? 0,
    };
  }

  /**
   * Get effectiveness stats for sources
   */
  async getSourceEffectiveness(userId: string): Promise<SourceEffectiveness[]> {
    const result = await this.db
      .prepare(
        `SELECT
          os.source_type,
          COUNT(DISTINCT os.source_id) as unique_sources,
          COUNT(*) as total_uses,
          SUM(CASE WHEN o.outcome_signal = 'positive' THEN 1 ELSE 0 END) as positive,
          SUM(CASE WHEN o.outcome_signal = 'negative' THEN 1 ELSE 0 END) as negative
        FROM outcome_sources os
        JOIN outcomes o ON os.outcome_id = o.id
        WHERE o.user_id = ? AND o.outcome_signal != 'unknown'
        GROUP BY os.source_type`
      )
      .bind(userId)
      .all<{
        source_type: string;
        unique_sources: number;
        total_uses: number;
        positive: number;
        negative: number;
      }>();

    return (result.results ?? []).map((row) => ({
      sourceType: row.source_type as SourceType,
      totalUses: row.total_uses,
      positiveOutcomes: row.positive,
      negativeOutcomes: row.negative,
      effectivenessRate:
        row.positive + row.negative > 0
          ? row.positive / (row.positive + row.negative)
          : 0,
    }));
  }
}
