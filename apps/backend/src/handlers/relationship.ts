/**
 * Relationship Intelligence API Handlers
 *
 * Endpoints:
 * - GET /v3/relationships/health - Get relationship health scores
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
  ProactiveNudgeGenerator,
} from '../lib/relationship';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/relationships/health
 * Get relationship health scores for all entities
 */
app.get('/health', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
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
 * Get relationship health for specific entity
 */
app.get('/:entityId/health', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { entityId } = c.req.param();

  try {
    const scorer = new RelationshipHealthScorer(c.env.DB);
    const health = await scorer.scoreRelationship(userId, entityId);

    return c.json(health);
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
 * Get proactive nudges (generates fresh nudges)
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const generator = new ProactiveNudgeGenerator(c.env.DB);
    const result = await generator.generateNudges(userId);

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

/**
 * POST /v3/nudges/generate
 * Force generation of new nudges
 */
app.post('/generate', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const generator = new ProactiveNudgeGenerator(c.env.DB);
    const result = await generator.generateNudges(userId);

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
