/**
 * Search Handlers - Supermemory++ Phase 2
 *
 * Exposes:
 * - POST /v3/search - Hybrid search with explainable ranking
 * - GET /v3/timeline - Chronological event timeline
 * - GET /v3/profiles - User profile facts
 * - PATCH /v3/profiles - Update profile facts
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { hybridSearch, timelineSearch } from '../lib/search/hybrid-search';
import {
  gateRetrieval,
  callGroundedLLM,
  GATING_CONFIG,
} from '../lib/search/grounded-response';
import { nanoid } from 'nanoid';

/**
 * POST /v3/search
 *
 * Hybrid search with vector + keyword + temporal + profile ranking.
 * Returns explainable results with score breakdown.
 */
export async function searchHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };

  try {
    const body = await c.req.json();
    const {
      query,
      k = 10,
      layers,
      startDate,
      endDate,
      includeRelationships = true,
      useProfiles = true,
    } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return c.json({ error: 'Query is required' }, 400);
    }

    const result = await hybridSearch(
      {
        db: c.env.DB,
        vectorize: c.env.VECTORIZE,
        ai: c.env.AI,
      },
      {
        query: query.trim(),
        userId,
        containerTag: tenantScope.containerTag,
        topK: Math.min(k, 50), // Cap at 50
        layers,
        timeRange: (startDate || endDate) ? { start: startDate, end: endDate } : undefined,
        includeRelationships,
        useProfiles,
      }
    );

    // Log search for analytics
    console.log(`[Search] query="${query.slice(0, 50)}" user=${userId} results=${result.results.length} time=${result.timings.totalMs}ms`);

    return c.json({
      query: result.query,
      results: result.results.map(r => ({
        memoryId: r.memoryId,
        score: Math.round(r.score * 1000) / 1000,
        contributions: {
          vector: Math.round(r.contributions.vector * 1000) / 1000,
          keyword: Math.round(r.contributions.keyword * 1000) / 1000,
          temporal: Math.round(r.contributions.temporal * 1000) / 1000,
          profile: Math.round(r.contributions.profile * 1000) / 1000,
          importance: Math.round(r.contributions.importance * 1000) / 1000,
        },
        snippet: r.snippet,
        eventDates: r.eventDates,
        layer: r.layer,
        relationshipPath: r.relationshipPath,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
      meta: {
        totalCandidates: result.totalCandidates,
        profilesUsed: result.profilesApplied.length,
        timings: result.timings,
      },
    });
  } catch (error: any) {
    console.error('[Search] Error:', error);
    return c.json({ error: 'Search failed', message: error.message }, 500);
  }
}

/**
 * GET /v3/timeline
 *
 * Get chronological timeline of events.
 * Query params: start, end, entity, limit
 */
export async function timelineHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };

  try {
    const start = c.req.query('start');
    const end = c.req.query('end');
    const entity = c.req.query('entity');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const result = await timelineSearch(
      {
        db: c.env.DB,
        ai: c.env.AI,
      },
      {
        userId,
        containerTag: tenantScope.containerTag,
        start: start || undefined,
        end: end || undefined,
        entityFilter: entity || undefined,
        limit: Math.min(limit, 100),
      }
    );

    return c.json({
      timeRange: { start, end },
      eventCount: result.events.length,
      events: result.events,
      summary: result.summary,
    });
  } catch (error: any) {
    console.error('[Timeline] Error:', error);
    return c.json({ error: 'Timeline query failed', message: error.message }, 500);
  }
}

/**
 * GET /v3/profiles
 *
 * Get user profile facts.
 */
export async function getProfilesHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };

  try {
    const category = c.req.query('category');

    let sql = `
      SELECT id, category, key, value, confidence, source, evidence_count, updated_at
      FROM profiles
      WHERE user_id = ? AND container_tag = ?
        AND (valid_to IS NULL OR valid_to > datetime('now'))
    `;
    const params: any[] = [userId, tenantScope.containerTag];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }

    sql += ` ORDER BY category, confidence DESC`;

    const result = await c.env.DB.prepare(sql).bind(...params).all();

    const profiles = (result.results as any[]).map(row => ({
      id: row.id,
      category: row.category,
      key: row.key,
      value: JSON.parse(row.value),
      confidence: row.confidence,
      source: row.source,
      evidenceCount: row.evidence_count,
      updatedAt: row.updated_at,
    }));

    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const p of profiles) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    }

    return c.json({
      userId,
      profiles: grouped,
      totalFacts: profiles.length,
    });
  } catch (error: any) {
    console.error('[Profiles] Error:', error);
    return c.json({ error: 'Failed to fetch profiles', message: error.message }, 500);
  }
}

/**
 * PATCH /v3/profiles
 *
 * Update or create profile facts.
 * Body: { facts: [{ category, key, value }] }
 */
export async function updateProfilesHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };

  try {
    const body = await c.req.json();
    const { facts } = body;

    if (!Array.isArray(facts) || facts.length === 0) {
      return c.json({ error: 'facts array is required' }, 400);
    }

    const results: { key: string; action: 'created' | 'updated' }[] = [];

    for (const fact of facts) {
      const { category, key, value } = fact;

      if (!category || !key || value === undefined) {
        continue;
      }

      // Upsert profile fact
      await c.env.DB.prepare(`
        INSERT INTO profiles (id, user_id, container_tag, category, key, value, confidence, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1.0, 'user', datetime('now'))
        ON CONFLICT(user_id, container_tag, key) DO UPDATE SET
          category = excluded.category,
          value = excluded.value,
          confidence = 1.0,
          source = 'user',
          updated_at = datetime('now')
      `).bind(
        nanoid(),
        userId,
        tenantScope.containerTag,
        category,
        key,
        JSON.stringify(value)
      ).run();

      results.push({ key, action: 'updated' });
    }

    return c.json({
      success: true,
      updated: results.length,
      results,
    });
  } catch (error: any) {
    console.error('[Profiles] Update error:', error);
    return c.json({ error: 'Failed to update profiles', message: error.message }, 500);
  }
}

/**
 * DELETE /v3/profiles/:key
 *
 * Delete a profile fact.
 */
export async function deleteProfileHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const key = c.req.param('key');

  try {
    const result = await c.env.DB.prepare(`
      DELETE FROM profiles
      WHERE user_id = ? AND container_tag = ? AND key = ?
    `).bind(userId, tenantScope.containerTag, key).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Profile fact not found' }, 404);
    }

    return c.json({ success: true, deleted: key });
  } catch (error: any) {
    console.error('[Profiles] Delete error:', error);
    return c.json({ error: 'Failed to delete profile', message: error.message }, 500);
  }
}

/**
 * POST /v3/ask
 *
 * Guarded search with LLM grounding.
 * Gates LLM calls based on retrieval confidence.
 * Returns INSUFFICIENT_EVIDENCE when retrieval is weak.
 */
export async function guardedSearchHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };

  try {
    const body = await c.req.json();
    const {
      query,
      k = 10,
      layers,
      startDate,
      endDate,
      includeRelationships = true,
      useProfiles = true,
      generateAnswer = true,
    } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return c.json({ error: 'Query is required' }, 400);
    }

    // Step 1: Hybrid retrieval
    const result = await hybridSearch(
      {
        db: c.env.DB,
        vectorize: c.env.VECTORIZE,
        ai: c.env.AI,
      },
      {
        query: query.trim(),
        userId,
        containerTag: tenantScope.containerTag,
        topK: Math.min(k, 50),
        layers,
        timeRange: (startDate || endDate) ? { start: startDate, end: endDate } : undefined,
        includeRelationships,
        useProfiles,
      }
    );

    // Step 2: Gate retrieval (pass query for actionable suggestions)
    const { safe, result: gatedResult } = gateRetrieval(result.results, query.trim());

    console.log(`[GuardedSearch] query="${query.slice(0, 50)}" user=${userId} safe=${safe} status=${gatedResult.status}`);

    // Step 3: If not safe, return ACTIONABLE_UNCERTAINTY with guidance
    if (!safe || !generateAnswer) {
      // Telemetry: track uncertainty states for learning loop
      const telemetry = {
        event: 'ACTIONABLE_UNCERTAINTY',
        userId,
        containerTag: tenantScope.containerTag,
        query: query.slice(0, 100),
        reason: gatedResult.reason,
        compositeScore: gatedResult.compositeScore,
        supportCount: gatedResult.supportCount,
        missingSignals: gatedResult.missingSignals?.map(s => s.signal) || [],
        suggestedActions: gatedResult.suggestedActions?.map(a => a.action) || [],
        timestamp: new Date().toISOString(),
      };
      console.log(`[Telemetry] ${JSON.stringify(telemetry)}`);

      // Store telemetry async (don't block response)
      c.executionCtx.waitUntil(
        c.env.DB.prepare(`
          INSERT INTO feedback (id, user_id, query, memory_ids, helpful, correction, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          `unc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId,
          query.slice(0, 500),
          JSON.stringify({ type: 'ACTIONABLE_UNCERTAINTY', ...telemetry }),
          0, // Not helpful yet - user needs to act
          null
        ).run().catch(err => console.warn('[Telemetry] Store failed:', err))
      );

      return c.json({
        query: result.query,
        status: gatedResult.status,
        reason: gatedResult.reason,
        message: gatedResult.message,
        compositeScore: gatedResult.compositeScore,
        supportCount: gatedResult.supportCount,
        evidence: gatedResult.evidence,
        // Actionable uncertainty fields - the key differentiator
        missingSignals: gatedResult.missingSignals,
        suggestedActions: gatedResult.suggestedActions,
        meta: {
          gatingConfig: GATING_CONFIG,
          totalCandidates: result.totalCandidates,
          timings: result.timings,
        },
      });
    }

    // Step 4: Safe - call LLM with grounded evidence
    const llmResult = await callGroundedLLM(
      c.env.AI,
      query.trim(),
      gatedResult.evidence
    );

    // Telemetry: track grounded responses for success metrics
    console.log(`[Telemetry] ${JSON.stringify({
      event: 'GROUNDED',
      userId,
      query: query.slice(0, 100),
      compositeScore: gatedResult.compositeScore,
      supportCount: gatedResult.supportCount,
      citationCount: llmResult.citations?.length || 0,
      timestamp: new Date().toISOString(),
    })}`);

    return c.json({
      query: result.query,
      status: llmResult.status,
      answer: llmResult.answer,
      citations: llmResult.citations,
      compositeScore: gatedResult.compositeScore,
      supportCount: gatedResult.supportCount,
      evidence: llmResult.evidence,
      meta: {
        gatingConfig: GATING_CONFIG,
        totalCandidates: result.totalCandidates,
        timings: result.timings,
      },
    });
  } catch (error: any) {
    console.error('[GuardedSearch] Error:', error);
    return c.json({ error: 'Search failed', message: error.message }, 500);
  }
}

/**
 * POST /v3/feedback
 *
 * Submit feedback on search results.
 * Used for future learning loop improvements.
 */
export async function feedbackHandler(c: Context<{ Bindings: Bindings }>) {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();
    const { query, memoryId, helpful, correction } = body;

    if (!query || !memoryId) {
      return c.json({ error: 'query and memoryId are required' }, 400);
    }

    // Store feedback for learning loop
    await c.env.DB.prepare(`
      INSERT INTO feedback (id, user_id, query, memory_ids, helpful, correction, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      nanoid(),
      userId,
      query,
      JSON.stringify([memoryId]),
      helpful ? 1 : 0,
      correction || null
    ).run();

    // If unhelpful, potentially adjust memory importance
    if (!helpful) {
      await c.env.DB.prepare(`
        UPDATE memories
        SET importance_score = MAX(0, importance_score - 0.05)
        WHERE id = ?
      `).bind(memoryId).run();
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error('[Feedback] Error:', error);
    return c.json({ error: 'Failed to save feedback', message: error.message }, 500);
  }
}
