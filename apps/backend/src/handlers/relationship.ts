/**
 * Relationship Intelligence API Handlers
 *
 * Endpoints:
 * - GET /v3/relationships/health - Get relationship health scores (enhanced with sentiment)
 * - GET /v3/relationships/:entityId/health - Get health for specific entity
 * - GET /v3/nudges - Get proactive nudges
 * - POST /v3/nudges/generate - Generate new nudges
 * - POST /v3/nudges/:id/dismiss - Dismiss a nudge
 * - POST /v3/nudges/:id/action - Mark nudge as acted upon
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  RelationshipHealthScorer,
  EnhancedRelationshipHealthScorer,
  ProactiveNudgeGenerator,
} from '../lib/relationship';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/relationships/health
 * Get relationship health scores for all entities (with sentiment analysis)
 */
app.get('/health', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;
  const useEnhanced = c.req.query('enhanced') !== 'false';

  try {
    if (useEnhanced && c.env.AI) {
      // Use enhanced scorer with sentiment analysis
      const scorer = new EnhancedRelationshipHealthScorer(c.env.DB, c.env.AI);

      // Get all person/company entities for user
      const entities = await c.env.DB
        .prepare(`
          SELECT DISTINCT e.id
          FROM entities e
          INNER JOIN memory_entities me ON e.id = me.entity_id
          INNER JOIN memories m ON me.memory_id = m.id
          WHERE m.user_id = ?
            AND m.container_tag = ?
            AND e.entity_type IN ('person', 'company')
          ORDER BY e.importance_score DESC
          LIMIT 50
        `)
        .bind(userId, containerTag)
        .all<{ id: string }>();

      const entityIds = (entities.results || []).map(e => e.id);
      const health = await scorer.computeBatchHealthScores(userId, entityIds, containerTag);

      // Sort by health status priority
      const statusPriority: Record<string, number> = {
        at_risk: 4,
        attention_needed: 3,
        dormant: 2,
        healthy: 1,
      };

      health.sort(
        (a, b) =>
          (statusPriority[b.health_status] || 0) -
          (statusPriority[a.health_status] || 0)
      );

      return c.json({
        relationships: health,
        total: health.length,
        enhanced: true,
        summary: {
          healthy: health.filter((h) => h.health_status === 'healthy').length,
          attention_needed: health.filter(
            (h) => h.health_status === 'attention_needed'
          ).length,
          at_risk: health.filter((h) => h.health_status === 'at_risk').length,
          dormant: health.filter((h) => h.health_status === 'dormant').length,
        },
      });
    }

    // Fallback to basic scorer (no AI/sentiment)
    const scorer = new RelationshipHealthScorer(c.env.DB);
    const health = await scorer.scoreAllRelationships(userId);

    // Sort by health status priority
    const statusPriority: Record<string, number> = {
      at_risk: 4,
      attention_needed: 3,
      dormant: 2,
      healthy: 1,
    };

    health.sort(
      (a, b) =>
        (statusPriority[b.health_status] || 0) -
        (statusPriority[a.health_status] || 0)
    );

    return c.json({
      relationships: health,
      total: health.length,
      enhanced: false,
      summary: {
        healthy: health.filter((h) => h.health_status === 'healthy').length,
        attention_needed: health.filter(
          (h) => h.health_status === 'attention_needed'
        ).length,
        at_risk: health.filter((h) => h.health_status === 'at_risk').length,
        dormant: health.filter((h) => h.health_status === 'dormant').length,
      },
    });
  } catch (error: any) {
    console.error('[Relationship] Health scoring failed:', error);
    return c.json(
      {
        error: 'Failed to score relationships',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/relationships/:entityId/health
 * Get relationship health for specific entity (with sentiment analysis)
 */
app.get('/:entityId/health', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { entityId } = c.req.param();
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;
  const useEnhanced = c.req.query('enhanced') !== 'false';

  try {
    if (useEnhanced && c.env.AI) {
      // Use enhanced scorer with sentiment analysis
      const scorer = new EnhancedRelationshipHealthScorer(c.env.DB, c.env.AI);
      const health = await scorer.computeHealthScore(userId, entityId, containerTag);
      return c.json({ ...health, enhanced: true });
    }

    // Fallback to basic scorer
    const scorer = new RelationshipHealthScorer(c.env.DB);
    const health = await scorer.scoreRelationship(userId, entityId);

    return c.json({ ...health, enhanced: false });
  } catch (error: any) {
    console.error('[Relationship] Health scoring failed:', error);

    if (error.message.includes('not found')) {
      return c.json({ error: 'Entity not found' }, 404);
    }

    return c.json(
      {
        error: 'Failed to score relationship',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/nudges
 * Get cached nudges (lightweight - no AI generation on every call)
 * Use POST /v3/nudges/generate to force fresh generation
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    // Return cached/stored nudges instead of generating fresh ones each time
    // This prevents resource exhaustion from AI calls on every request
    const cached = await c.env.DB
      .prepare(`
        SELECT id, nudge_type, title, message, entity_id, priority, suggested_action, created_at
        FROM proactive_nudges
        WHERE user_id = ? AND dismissed = 0 AND acted = 0
        ORDER BY priority DESC, created_at DESC
        LIMIT 10
      `)
      .bind(userId)
      .all();

    return c.json({
      nudges: cached.results || [],
      cached: true,
      message: 'Use POST /v3/nudges/generate to generate fresh nudges',
    });
  } catch (error: any) {
    console.error('[Nudges] Fetch failed:', error);
    // Return empty array instead of error to prevent client-side crashes
    return c.json({
      nudges: [],
      cached: true,
      error: error.message,
    });
  }
});

/**
 * POST /v3/nudges/generate
 * Force generation of new nudges
 */
app.post('/generate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;

  try {
    const generator = new ProactiveNudgeGenerator(c.env.DB, c.env.AI, userId, containerTag);
    const result = await generator.generateNudges();

    return c.json({
      nudges: result.nudges,
      metadata: result.generation_metadata,
    });
  } catch (error: any) {
    console.error('[Nudges] Generation failed:', error);
    return c.json(
      {
        error: 'Failed to generate nudges',
        message: error.message,
      },
      500
    );
  }
});

export default app;
