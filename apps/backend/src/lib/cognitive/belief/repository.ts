/**
 * Belief Repository
 *
 * Database operations for beliefs, evidence, and conflicts.
 * Includes Bayesian confidence updates.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  Belief,
  BeliefRow,
  BeliefEvidence,
  BeliefEvidenceRow,
  BeliefConflict,
  BeliefConflictRow,
  BeliefType,
  BeliefStatus,
  BeliefEvidenceType,
  CreateBeliefInput,
  AddBeliefEvidenceInput,
  BayesianUpdateInput,
  BeliefQueryOptions,
  BeliefWithEvidence,
  ConfidenceHistoryEntry,
} from './types';
import {
  bayesianUpdate,
  createHistoryEntry,
  appendToHistory,
  shouldTransitionStatus,
  getDefaultEvidenceStrength,
} from './bayesian';

// ============================================
// ROW TO MODEL CONVERTERS
// ============================================

function rowToBelief(row: BeliefRow): Belief {
  return {
    id: row.id,
    userId: row.user_id,
    proposition: row.proposition,
    beliefType: row.belief_type as BeliefType,
    domain: row.domain,
    priorConfidence: row.prior_confidence,
    currentConfidence: row.current_confidence,
    confidenceHistory: row.confidence_history
      ? JSON.parse(row.confidence_history)
      : [],
    supportingCount: row.supporting_count,
    contradictingCount: row.contradicting_count,
    validFrom: row.valid_from ? new Date(row.valid_from) : null,
    validTo: row.valid_to ? new Date(row.valid_to) : null,
    dependsOn: row.depends_on ? JSON.parse(row.depends_on) : [],
    derivedFromLearning: row.derived_from_learning,
    status: row.status as BeliefStatus,
    supersededBy: row.superseded_by,
    invalidationReason: row.invalidation_reason,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToEvidence(row: BeliefEvidenceRow): BeliefEvidence {
  return {
    id: row.id,
    beliefId: row.belief_id,
    memoryId: row.memory_id,
    learningId: row.learning_id,
    evidenceType: row.evidence_type as BeliefEvidenceType,
    supports: row.supports === 1,
    strength: row.strength,
    notes: row.notes,
    createdAt: new Date(row.created_at),
  };
}

function rowToConflict(row: BeliefConflictRow): BeliefConflict {
  return {
    id: row.id,
    beliefAId: row.belief_a_id,
    beliefBId: row.belief_b_id,
    conflictType: row.conflict_type as 'contradiction' | 'overlap' | 'temporal',
    description: row.description,
    resolved: row.resolved === 1,
    resolution: row.resolution,
    winnerId: row.winner_id,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
  };
}

// ============================================
// REPOSITORY CLASS
// ============================================

export class BeliefRepository {
  constructor(private db: D1Database) {}

  // ============================================
  // BELIEF CRUD
  // ============================================

  /**
   * Create a new belief
   */
  async createBelief(input: CreateBeliefInput): Promise<Belief> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const priorConfidence = input.priorConfidence ?? 0.5;

    // Initial confidence history
    const historyEntry = createHistoryEntry(priorConfidence, 'Belief created');
    const confidenceHistory = JSON.stringify([historyEntry]);

    await this.db
      .prepare(
        `INSERT INTO beliefs (
          id, user_id, proposition, belief_type, domain,
          prior_confidence, current_confidence, confidence_history,
          supporting_count, contradicting_count,
          valid_from, valid_to, depends_on, derived_from_learning,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.userId,
        input.proposition,
        input.beliefType,
        input.domain ?? null,
        priorConfidence,
        priorConfidence,
        confidenceHistory,
        0,
        0,
        input.validFrom?.toISOString() ?? null,
        input.validTo?.toISOString() ?? null,
        input.dependsOn ? JSON.stringify(input.dependsOn) : null,
        input.derivedFromLearning ?? null,
        'active',
        now,
        now
      )
      .run();

    // If there's source evidence, add it
    if (input.sourceMemoryId || input.sourceLearningId) {
      await this.addEvidence({
        beliefId: id,
        memoryId: input.sourceMemoryId,
        learningId: input.sourceLearningId,
        evidenceType: input.sourceLearningId ? 'learned' : 'direct',
        supports: true,
        strength: 0.7,
      });
    }

    return this.getBelief(id) as Promise<Belief>;
  }

  /**
   * Get a belief by ID
   */
  async getBelief(id: string): Promise<Belief | null> {
    const result = await this.db
      .prepare('SELECT * FROM beliefs WHERE id = ?')
      .bind(id)
      .first<BeliefRow>();

    return result ? rowToBelief(result) : null;
  }

  /**
   * Get a belief with all its evidence
   */
  async getBeliefWithEvidence(id: string): Promise<BeliefWithEvidence | null> {
    const belief = await this.getBelief(id);
    if (!belief) return null;

    const evidence = await this.getEvidenceForBelief(id);

    return {
      ...belief,
      evidence,
    };
  }

  /**
   * Query beliefs with filters
   */
  async queryBeliefs(options: BeliefQueryOptions): Promise<{
    beliefs: Belief[];
    total: number;
  }> {
    const conditions: string[] = ['user_id = ?'];
    const params: (string | number)[] = [options.userId];

    if (options.status && options.status.length > 0) {
      const placeholders = options.status.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...options.status);
    }

    if (options.beliefTypes && options.beliefTypes.length > 0) {
      const placeholders = options.beliefTypes.map(() => '?').join(', ');
      conditions.push(`belief_type IN (${placeholders})`);
      params.push(...options.beliefTypes);
    }

    if (options.domain) {
      conditions.push('domain = ?');
      params.push(options.domain);
    }

    if (options.minConfidence !== undefined) {
      conditions.push('current_confidence >= ?');
      params.push(options.minConfidence);
    }

    if (options.validAt) {
      const dateStr = options.validAt.toISOString();
      conditions.push(
        '(valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)'
      );
      params.push(dateStr, dateStr);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM beliefs WHERE ${whereClause}`)
      .bind(...params)
      .first<{ count: number }>();

    const total = countResult?.count ?? 0;

    // Get paginated results
    const orderBy = options.orderBy || 'created_at';
    const orderDir = options.orderDirection || 'desc';
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const orderColumn =
      orderBy === 'confidence' ? 'current_confidence' : orderBy;

    const results = await this.db
      .prepare(
        `SELECT * FROM beliefs
         WHERE ${whereClause}
         ORDER BY ${orderColumn} ${orderDir.toUpperCase()}
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all<BeliefRow>();

    return {
      beliefs: (results.results || []).map(rowToBelief),
      total,
    };
  }

  /**
   * Find beliefs similar to a proposition (for deduplication)
   */
  async findSimilarBeliefs(
    userId: string,
    proposition: string,
    beliefType?: BeliefType
  ): Promise<Belief[]> {
    // Simple substring match for now
    // In production, use vector similarity or fuzzy matching
    const words = proposition.toLowerCase().split(/\s+/).slice(0, 5);

    let query = `SELECT * FROM beliefs WHERE user_id = ? AND status = 'active'`;
    const params: string[] = [userId];

    if (beliefType) {
      query += ' AND belief_type = ?';
      params.push(beliefType);
    }

    // Match any significant word
    const wordConditions = words
      .filter((w) => w.length > 3)
      .map(() => 'LOWER(proposition) LIKE ?');

    if (wordConditions.length > 0) {
      query += ` AND (${wordConditions.join(' OR ')})`;
      words
        .filter((w) => w.length > 3)
        .forEach((w) => params.push(`%${w}%`));
    }

    query += ' LIMIT 10';

    const results = await this.db
      .prepare(query)
      .bind(...params)
      .all<BeliefRow>();

    return (results.results || []).map(rowToBelief);
  }

  /**
   * Update belief status
   */
  async updateBeliefStatus(
    id: string,
    status: BeliefStatus,
    reason?: string,
    supersededBy?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE beliefs SET
          status = ?,
          invalidation_reason = COALESCE(?, invalidation_reason),
          superseded_by = COALESCE(?, superseded_by),
          updated_at = ?
        WHERE id = ?`
      )
      .bind(status, reason ?? null, supersededBy ?? null, now, id)
      .run();
  }

  // ============================================
  // BAYESIAN UPDATES
  // ============================================

  /**
   * Apply Bayesian update to a belief's confidence
   */
  async applyBayesianUpdate(input: BayesianUpdateInput): Promise<Belief> {
    const belief = await this.getBelief(input.beliefId);
    if (!belief) {
      throw new Error(`Belief not found: ${input.beliefId}`);
    }

    if (belief.userId !== input.userId) {
      throw new Error('Not authorized to update this belief');
    }

    // Calculate new confidence
    const result = bayesianUpdate({
      priorConfidence: belief.currentConfidence,
      evidenceStrength: input.evidenceStrength,
      supports: input.supports,
    });

    // Update confidence history
    const historyEntry = createHistoryEntry(
      result.posteriorConfidence,
      input.reason,
      input.evidenceId
    );
    const newHistory = appendToHistory(belief.confidenceHistory, historyEntry);

    // Update evidence counts
    const supportingCount = input.supports
      ? belief.supportingCount + 1
      : belief.supportingCount;
    const contradictingCount = input.supports
      ? belief.contradictingCount
      : belief.contradictingCount + 1;

    // Check if status should change
    const statusTransition = shouldTransitionStatus(
      belief.status,
      result.posteriorConfidence,
      supportingCount,
      contradictingCount
    );

    const newStatus = statusTransition?.newStatus ?? belief.status;
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE beliefs SET
          current_confidence = ?,
          confidence_history = ?,
          supporting_count = ?,
          contradicting_count = ?,
          status = ?,
          invalidation_reason = CASE WHEN ? = 'invalidated' THEN ? ELSE invalidation_reason END,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(
        result.posteriorConfidence,
        JSON.stringify(newHistory),
        supportingCount,
        contradictingCount,
        newStatus,
        newStatus,
        statusTransition?.reason ?? null,
        now,
        input.beliefId
      )
      .run();

    return this.getBelief(input.beliefId) as Promise<Belief>;
  }

  // ============================================
  // EVIDENCE MANAGEMENT
  // ============================================

  /**
   * Add evidence to a belief
   */
  async addEvidence(input: AddBeliefEvidenceInput): Promise<BeliefEvidence> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const strength =
      input.strength ?? getDefaultEvidenceStrength(input.evidenceType);

    await this.db
      .prepare(
        `INSERT INTO belief_evidence (
          id, belief_id, memory_id, learning_id,
          evidence_type, supports, strength, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.beliefId,
        input.memoryId ?? null,
        input.learningId ?? null,
        input.evidenceType,
        input.supports ? 1 : 0,
        strength,
        input.notes ?? null,
        now
      )
      .run();

    return {
      id,
      beliefId: input.beliefId,
      memoryId: input.memoryId ?? null,
      learningId: input.learningId ?? null,
      evidenceType: input.evidenceType,
      supports: input.supports,
      strength,
      notes: input.notes ?? null,
      createdAt: new Date(now),
    };
  }

  /**
   * Get all evidence for a belief
   */
  async getEvidenceForBelief(beliefId: string): Promise<BeliefEvidence[]> {
    const results = await this.db
      .prepare(
        'SELECT * FROM belief_evidence WHERE belief_id = ? ORDER BY created_at DESC'
      )
      .bind(beliefId)
      .all<BeliefEvidenceRow>();

    return (results.results || []).map(rowToEvidence);
  }

  // ============================================
  // CONFLICT MANAGEMENT
  // ============================================

  /**
   * Record a conflict between two beliefs
   */
  async recordConflict(
    beliefAId: string,
    beliefBId: string,
    conflictType: 'contradiction' | 'overlap' | 'temporal',
    description: string
  ): Promise<BeliefConflict> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Ensure consistent ordering (smaller ID first)
    const [firstId, secondId] =
      beliefAId < beliefBId ? [beliefAId, beliefBId] : [beliefBId, beliefAId];

    // Check if conflict already exists
    const existing = await this.db
      .prepare(
        `SELECT * FROM belief_conflicts
         WHERE belief_a_id = ? AND belief_b_id = ? AND resolved = 0`
      )
      .bind(firstId, secondId)
      .first<BeliefConflictRow>();

    if (existing) {
      return rowToConflict(existing);
    }

    await this.db
      .prepare(
        `INSERT INTO belief_conflicts (
          id, belief_a_id, belief_b_id, conflict_type,
          description, resolved, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(id, firstId, secondId, conflictType, description, now)
      .run();

    return {
      id,
      beliefAId: firstId,
      beliefBId: secondId,
      conflictType,
      description,
      resolved: false,
      resolution: null,
      winnerId: null,
      createdAt: new Date(now),
      resolvedAt: null,
    };
  }

  /**
   * Get unresolved conflicts for a user
   */
  async getUnresolvedConflicts(userId: string): Promise<BeliefConflict[]> {
    const results = await this.db
      .prepare(
        `SELECT bc.* FROM belief_conflicts bc
         JOIN beliefs b ON bc.belief_a_id = b.id
         WHERE b.user_id = ? AND bc.resolved = 0
         ORDER BY bc.created_at DESC`
      )
      .bind(userId)
      .all<BeliefConflictRow>();

    return (results.results || []).map(rowToConflict);
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    conflictId: string,
    resolution: string,
    winnerId?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE belief_conflicts SET
          resolved = 1,
          resolution = ?,
          winner_id = ?,
          resolved_at = ?
        WHERE id = ?`
      )
      .bind(resolution, winnerId ?? null, now, conflictId)
      .run();

    // If there's a loser, mark it as superseded
    if (winnerId) {
      const conflict = await this.db
        .prepare('SELECT * FROM belief_conflicts WHERE id = ?')
        .bind(conflictId)
        .first<BeliefConflictRow>();

      if (conflict) {
        const loserId =
          conflict.belief_a_id === winnerId
            ? conflict.belief_b_id
            : conflict.belief_a_id;

        await this.updateBeliefStatus(
          loserId,
          'superseded',
          `Superseded by belief ${winnerId}`,
          winnerId
        );
      }
    }
  }

  // ============================================
  // ANALYTICS
  // ============================================

  /**
   * Get belief statistics for a user
   */
  async getBeliefStats(userId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    averageConfidence: number;
    unresolvedConflicts: number;
  }> {
    // Count by status
    const statusResults = await this.db
      .prepare(
        `SELECT status, COUNT(*) as count FROM beliefs
         WHERE user_id = ? GROUP BY status`
      )
      .bind(userId)
      .all<{ status: string; count: number }>();

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusResults.results || []) {
      byStatus[row.status] = row.count;
      total += row.count;
    }

    // Count by type
    const typeResults = await this.db
      .prepare(
        `SELECT belief_type, COUNT(*) as count FROM beliefs
         WHERE user_id = ? AND status = 'active' GROUP BY belief_type`
      )
      .bind(userId)
      .all<{ belief_type: string; count: number }>();

    const byType: Record<string, number> = {};
    for (const row of typeResults.results || []) {
      byType[row.belief_type] = row.count;
    }

    // Average confidence for active beliefs
    const avgResult = await this.db
      .prepare(
        `SELECT AVG(current_confidence) as avg FROM beliefs
         WHERE user_id = ? AND status = 'active'`
      )
      .bind(userId)
      .first<{ avg: number | null }>();

    // Unresolved conflicts
    const conflictResult = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM belief_conflicts bc
         JOIN beliefs b ON bc.belief_a_id = b.id
         WHERE b.user_id = ? AND bc.resolved = 0`
      )
      .bind(userId)
      .first<{ count: number }>();

    return {
      total,
      byStatus,
      byType,
      averageConfidence: avgResult?.avg ?? 0,
      unresolvedConflicts: conflictResult?.count ?? 0,
    };
  }

  /**
   * Get beliefs derived from a specific learning
   */
  async getBeliefsFromLearning(learningId: string): Promise<Belief[]> {
    const results = await this.db
      .prepare(
        `SELECT * FROM beliefs WHERE derived_from_learning = ? ORDER BY created_at DESC`
      )
      .bind(learningId)
      .all<BeliefRow>();

    return (results.results || []).map(rowToBelief);
  }

  /**
   * Get dependent beliefs (beliefs that depend on a given belief)
   */
  async getDependentBeliefs(beliefId: string): Promise<Belief[]> {
    const results = await this.db
      .prepare(
        `SELECT * FROM beliefs
         WHERE depends_on LIKE ? AND status = 'active'`
      )
      .bind(`%"${beliefId}"%`)
      .all<BeliefRow>();

    return (results.results || []).map(rowToBelief);
  }
}
