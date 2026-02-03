/**
 * Learning Repository
 *
 * Data access layer for learnings. Handles:
 * - CRUD operations for learnings
 * - Evidence management
 * - Conflict detection and resolution
 * - Profile aggregation
 */

import { nanoid } from 'nanoid';
import type {
  Learning,
  LearningEvidence,
  LearningCategory,
  LearningStatus,
  LearningStrength,
  ExtractedLearning,
  LearningConflict,
  UserCognitiveProfile,
  LearningSummary,
  ListLearningsQuery,
} from '../types';

export class LearningRepository {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create a new learning
   */
  async createLearning(
    userId: string,
    containerTag: string,
    extracted: ExtractedLearning,
    memoryId: string
  ): Promise<Learning> {
    const id = nanoid();
    const now = new Date().toISOString();

    const learning: Learning = {
      id,
      user_id: userId,
      container_tag: containerTag,
      category: extracted.category,
      statement: extracted.statement,
      reasoning: extracted.reasoning,
      strength: this.calculateStrength(extracted.confidence, 1),
      confidence: extracted.confidence,
      evidence_count: 1,
      status: 'active',
      invalidated_by: null,
      superseded_by: null,
      first_observed: now,
      last_reinforced: now,
      valid_from: now,
      valid_to: null,
      created_at: now,
      updated_at: now,
    };

    await this.db
      .prepare(
        `INSERT INTO learnings (
          id, user_id, container_tag, category, statement, reasoning,
          strength, confidence, evidence_count, status,
          invalidated_by, superseded_by, first_observed, last_reinforced,
          valid_from, valid_to, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId,
        containerTag,
        learning.category,
        learning.statement,
        learning.reasoning,
        learning.strength,
        learning.confidence,
        learning.evidence_count,
        learning.status,
        null,
        null,
        now,
        now,
        now,
        null,
        now,
        now
      )
      .run();

    // Create evidence link
    await this.addEvidence(id, memoryId, 'supports', extracted.excerpt, extracted.confidence);

    return learning;
  }

  /**
   * Add evidence to an existing learning
   */
  async addEvidence(
    learningId: string,
    memoryId: string,
    evidenceType: 'supports' | 'contradicts' | 'neutral',
    excerpt: string,
    confidence: number
  ): Promise<LearningEvidence> {
    const id = nanoid();
    const now = new Date().toISOString();

    const evidence: LearningEvidence = {
      id,
      learning_id: learningId,
      memory_id: memoryId,
      evidence_type: evidenceType,
      excerpt,
      confidence,
      created_at: now,
    };

    await this.db
      .prepare(
        `INSERT INTO learning_evidence (
          id, learning_id, memory_id, evidence_type, excerpt, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(learning_id, memory_id) DO UPDATE SET
          evidence_type = excluded.evidence_type,
          excerpt = excluded.excerpt,
          confidence = excluded.confidence`
      )
      .bind(id, learningId, memoryId, evidenceType, excerpt, confidence, now)
      .run();

    return evidence;
  }

  /**
   * Reinforce an existing learning with new evidence
   */
  async reinforceLearning(
    learningId: string,
    memoryId: string,
    excerpt: string,
    confidence: number
  ): Promise<Learning | null> {
    const now = new Date().toISOString();

    // Get current learning
    const learning = await this.getLearning(learningId);
    if (!learning) return null;

    // Update evidence count and recalculate strength
    const newEvidenceCount = learning.evidence_count + 1;
    const newConfidence = this.recalculateConfidence(learning.confidence, confidence, newEvidenceCount);
    const newStrength = this.calculateStrength(newConfidence, newEvidenceCount);

    await this.db
      .prepare(
        `UPDATE learnings SET
          evidence_count = ?,
          confidence = ?,
          strength = ?,
          last_reinforced = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(newEvidenceCount, newConfidence, newStrength, now, now, learningId)
      .run();

    // Add evidence
    await this.addEvidence(learningId, memoryId, 'supports', excerpt, confidence);

    return this.getLearning(learningId);
  }

  /**
   * Invalidate a learning (user says it's wrong)
   */
  async invalidateLearning(
    learningId: string,
    invalidatingMemoryId?: string,
    reason?: string
  ): Promise<Learning | null> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE learnings SET
          status = 'invalidated',
          invalidated_by = ?,
          valid_to = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(invalidatingMemoryId || null, now, now, learningId)
      .run();

    return this.getLearning(learningId);
  }

  /**
   * Supersede a learning with a new one
   */
  async supersedeLearning(
    oldLearningId: string,
    newLearningId: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE learnings SET
          status = 'superseded',
          superseded_by = ?,
          valid_to = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(newLearningId, now, now, oldLearningId)
      .run();
  }

  /**
   * Get a learning by ID
   */
  async getLearning(learningId: string): Promise<Learning | null> {
    const result = await this.db
      .prepare(
        `SELECT id, user_id, container_tag, category, statement, reasoning,
                strength, confidence, evidence_count, status,
                invalidated_by, superseded_by, first_observed, last_reinforced,
                valid_from, valid_to, created_at, updated_at
         FROM learnings WHERE id = ?`
      )
      .bind(learningId)
      .first<Learning>();

    return result || null;
  }

  /**
   * Get evidence for a learning
   */
  async getEvidence(learningId: string): Promise<LearningEvidence[]> {
    const result = await this.db
      .prepare(
        `SELECT id, learning_id, memory_id, evidence_type, excerpt, confidence, created_at
         FROM learning_evidence WHERE learning_id = ?
         ORDER BY created_at DESC`
      )
      .bind(learningId)
      .all<LearningEvidence>();

    return result.results || [];
  }

  /**
   * List learnings with filters
   */
  async listLearnings(
    userId: string,
    query: ListLearningsQuery = {}
  ): Promise<{ learnings: Learning[]; total: number }> {
    const { category, status = 'active', strength, limit = 50, offset = 0 } = query;

    let sql = `SELECT id, user_id, container_tag, category, statement, reasoning,
                      strength, confidence, evidence_count, status,
                      invalidated_by, superseded_by, first_observed, last_reinforced,
                      valid_from, valid_to, created_at, updated_at
               FROM learnings WHERE user_id = ?`;
    const params: (string | number)[] = [userId];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }

    if (strength) {
      sql += ` AND strength = ?`;
      params.push(strength);
    }

    sql += ` ORDER BY confidence DESC, last_reinforced DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<Learning>();

    // Get total count
    let countSql = `SELECT COUNT(*) as count FROM learnings WHERE user_id = ?`;
    const countParams: (string | number)[] = [userId];

    if (status) {
      countSql += ` AND status = ?`;
      countParams.push(status);
    }

    if (category) {
      countSql += ` AND category = ?`;
      countParams.push(category);
    }

    if (strength) {
      countSql += ` AND strength = ?`;
      countParams.push(strength);
    }

    const countResult = await this.db
      .prepare(countSql)
      .bind(...countParams)
      .first<{ count: number }>();

    return {
      learnings: result.results || [],
      total: countResult?.count || 0,
    };
  }

  /**
   * Find similar learnings (for deduplication/conflict detection)
   */
  async findSimilarLearnings(
    userId: string,
    category: LearningCategory,
    statement: string,
    containerTag?: string
  ): Promise<Learning[]> {
    // Simple keyword-based matching for now
    // TODO: Use embeddings for semantic similarity
    const keywords = statement.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    let sql = `SELECT id, user_id, container_tag, category, statement, reasoning,
                      strength, confidence, evidence_count, status,
                      invalidated_by, superseded_by, first_observed, last_reinforced,
                      valid_from, valid_to, created_at, updated_at
               FROM learnings
               WHERE user_id = ? AND category = ? AND status = 'active'`;
    const params: string[] = [userId, category];

    if (containerTag) {
      sql += ` AND container_tag = ?`;
      params.push(containerTag);
    }

    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<Learning>();

    // Filter by keyword overlap
    const similarLearnings = (result.results || []).filter(learning => {
      const learningKeywords = learning.statement.toLowerCase().split(/\s+/);
      const overlap = keywords.filter(k => learningKeywords.some(lk => lk.includes(k)));
      return overlap.length >= 2; // At least 2 keyword matches
    });

    return similarLearnings;
  }

  /**
   * Get user's cognitive profile
   */
  async getUserProfile(userId: string): Promise<UserCognitiveProfile> {
    const categories: LearningCategory[] = [
      'preference', 'habit', 'relationship', 'work_pattern',
      'interest', 'value', 'goal',
    ];

    const profile: UserCognitiveProfile = {
      user_id: userId,
      preferences: [],
      habits: [],
      relationships: [],
      work_patterns: [],
      interests: [],
      values: [],
      goals: [],
      total_learnings: 0,
      strong_learnings: 0,
      recent_learnings: 0,
      profile_version: '1.0',
      last_updated: new Date().toISOString(),
    };

    // Get learnings by category
    for (const category of categories) {
      const { learnings } = await this.listLearnings(userId, {
        category,
        status: 'active',
        limit: 10,
      });

      const summaries: LearningSummary[] = learnings.map(l => ({
        statement: l.statement,
        strength: l.strength as LearningStrength,
        confidence: l.confidence,
        evidence_count: l.evidence_count,
        last_reinforced: l.last_reinforced,
      }));

      switch (category) {
        case 'preference':
          profile.preferences = summaries;
          break;
        case 'habit':
          profile.habits = summaries;
          break;
        case 'relationship':
          profile.relationships = summaries;
          break;
        case 'work_pattern':
          profile.work_patterns = summaries;
          break;
        case 'interest':
          profile.interests = summaries;
          break;
        case 'value':
          profile.values = summaries;
          break;
        case 'goal':
          profile.goals = summaries;
          break;
      }
    }

    // Get stats
    const statsResult = await this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN strength IN ('strong', 'definitive') THEN 1 ELSE 0 END) as strong,
          SUM(CASE WHEN last_reinforced > datetime('now', '-7 days') THEN 1 ELSE 0 END) as recent
         FROM learnings
         WHERE user_id = ? AND status = 'active'`
      )
      .bind(userId)
      .first<{ total: number; strong: number; recent: number }>();

    profile.total_learnings = statsResult?.total || 0;
    profile.strong_learnings = statsResult?.strong || 0;
    profile.recent_learnings = statsResult?.recent || 0;

    return profile;
  }

  /**
   * Calculate strength based on confidence and evidence count
   */
  private calculateStrength(confidence: number, evidenceCount: number): LearningStrength {
    const score = confidence * Math.min(evidenceCount / 3, 1.5);

    if (score >= 0.9) return 'definitive';
    if (score >= 0.7) return 'strong';
    if (score >= 0.4) return 'moderate';
    return 'weak';
  }

  /**
   * Recalculate confidence with new evidence
   */
  private recalculateConfidence(
    currentConfidence: number,
    newConfidence: number,
    totalEvidence: number
  ): number {
    // Weighted average with slight boost for more evidence
    const weight = Math.min(totalEvidence / 5, 1);
    const baseConfidence = (currentConfidence + newConfidence) / 2;
    return Math.min(1, baseConfidence + (weight * 0.1));
  }
}
