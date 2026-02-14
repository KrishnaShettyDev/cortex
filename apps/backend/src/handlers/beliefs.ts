/**
 * Beliefs Handler
 *
 * Manages the cognitive layer - synthesized beliefs, values, and patterns
 * derived from user memories and interactions.
 */

import { Context } from 'hono';
import { Bindings } from '../types';

interface Belief {
  id: string;
  user_id: string;
  belief: string;
  category: string | null;
  confidence: number;
  evidence_count: number;
  first_observed_at: number;
  last_reinforced_at: number;
  created_at: number;
}

interface BeliefEvidence {
  memory_id: string;
  strength: number;
  created_at: number;
  // Joined from memories table
  content?: string;
  memory_type?: string;
}

/**
 * Get all beliefs for a user, ordered by confidence
 */
export async function getBeliefs(
  c: Context<{ Bindings: Bindings }>
): Promise<Response> {
  const userId = c.get('jwtPayload').sub;
  const category = c.req.query('category');
  const minConfidence = parseFloat(c.req.query('min_confidence') || '0');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  try {
    let query = `
      SELECT id, belief, category, confidence, evidence_count,
             first_observed_at, last_reinforced_at, created_at
      FROM beliefs
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (minConfidence > 0) {
      query += ' AND confidence >= ?';
      params.push(minConfidence);
    }

    query += ' ORDER BY confidence DESC, evidence_count DESC LIMIT ?';
    params.push(limit);

    const stmt = c.env.DB.prepare(query);
    const result = await stmt.bind(...params).all<Belief>();

    return c.json({
      beliefs: result.results || [],
      count: result.results?.length || 0,
    });
  } catch (error) {
    console.error('[Beliefs] Error fetching beliefs:', error);
    return c.json({ error: 'Failed to fetch beliefs' }, 500);
  }
}

/**
 * Get a specific belief with its supporting evidence
 */
export async function getBeliefWithEvidence(
  c: Context<{ Bindings: Bindings }>
): Promise<Response> {
  const userId = c.get('jwtPayload').sub;
  const beliefId = c.req.param('id');

  try {
    // Get the belief
    const belief = await c.env.DB.prepare(`
      SELECT id, belief, category, confidence, evidence_count,
             first_observed_at, last_reinforced_at, created_at
      FROM beliefs
      WHERE id = ? AND user_id = ?
    `)
      .bind(beliefId, userId)
      .first<Belief>();

    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }

    // Get supporting evidence with memory details
    const evidence = await c.env.DB.prepare(`
      SELECT be.memory_id, be.strength, be.created_at,
             m.content, m.type as memory_type
      FROM belief_evidence be
      LEFT JOIN memories m ON be.memory_id = m.id
      WHERE be.belief_id = ?
      ORDER BY be.strength DESC, be.created_at DESC
      LIMIT 20
    `)
      .bind(beliefId)
      .all<BeliefEvidence>();

    return c.json({
      belief,
      evidence: evidence.results || [],
    });
  } catch (error) {
    console.error('[Beliefs] Error fetching belief with evidence:', error);
    return c.json({ error: 'Failed to fetch belief' }, 500);
  }
}

/**
 * Create or reinforce a belief
 * Used internally by the belief synthesis cron job
 */
export async function upsertBelief(
  db: D1Database,
  userId: string,
  belief: string,
  category: string,
  confidence: number,
  memoryIds: string[]
): Promise<string> {
  const beliefId = `belief_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

  // Try to find existing belief
  const existing = await db
    .prepare('SELECT id, evidence_count, confidence FROM beliefs WHERE user_id = ? AND belief = ?')
    .bind(userId, belief)
    .first<{ id: string; evidence_count: number; confidence: number }>();

  if (existing) {
    // Reinforce existing belief
    const newConfidence = Math.min(1.0, existing.confidence + 0.1);
    const newEvidenceCount = existing.evidence_count + memoryIds.length;

    await db
      .prepare(`
        UPDATE beliefs
        SET confidence = ?, evidence_count = ?, last_reinforced_at = unixepoch()
        WHERE id = ?
      `)
      .bind(newConfidence, newEvidenceCount, existing.id)
      .run();

    // Add new evidence links
    for (const memoryId of memoryIds) {
      await db
        .prepare(`
          INSERT OR IGNORE INTO belief_evidence (belief_id, memory_id, strength)
          VALUES (?, ?, 1.0)
        `)
        .bind(existing.id, memoryId)
        .run();
    }

    return existing.id;
  } else {
    // Create new belief
    await db
      .prepare(`
        INSERT INTO beliefs (id, user_id, belief, category, confidence, evidence_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(beliefId, userId, belief, category, confidence, memoryIds.length)
      .run();

    // Add evidence links
    for (const memoryId of memoryIds) {
      await db
        .prepare(`
          INSERT INTO belief_evidence (belief_id, memory_id, strength)
          VALUES (?, ?, 1.0)
        `)
        .bind(beliefId, memoryId)
        .run();
    }

    return beliefId;
  }
}

/**
 * Get beliefs for context injection (used by chat handler)
 */
export async function getBeliefsForContext(
  db: D1Database,
  userId: string,
  limit: number = 10
): Promise<string[]> {
  const result = await db
    .prepare(`
      SELECT belief, category, confidence
      FROM beliefs
      WHERE user_id = ? AND confidence >= 0.6
      ORDER BY confidence DESC, last_reinforced_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all<{ belief: string; category: string; confidence: number }>();

  return (result.results || []).map(
    (b) => `[${b.category || 'general'}] ${b.belief} (confidence: ${(b.confidence * 100).toFixed(0)}%)`
  );
}

/**
 * Decay beliefs that haven't been reinforced recently
 * Called periodically by cron
 */
export async function decayStaleBeliefs(db: D1Database): Promise<number> {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

  // Reduce confidence of stale beliefs
  const result = await db
    .prepare(`
      UPDATE beliefs
      SET confidence = MAX(0.1, confidence - 0.05)
      WHERE last_reinforced_at < ? AND confidence > 0.1
    `)
    .bind(thirtyDaysAgo)
    .run();

  // Delete very low confidence beliefs
  await db
    .prepare(`
      DELETE FROM beliefs
      WHERE confidence <= 0.1 AND last_reinforced_at < ?
    `)
    .bind(thirtyDaysAgo)
    .run();

  return result.meta.changes || 0;
}
