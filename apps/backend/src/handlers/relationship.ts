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
 * Force generation of new nudges - saves to DB and queues notifications
 */
app.post('/generate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const tenantScope = c.get('tenantScope') || { containerTag: 'default' };
  const containerTag = tenantScope.containerTag;

  try {
    const generator = new ProactiveNudgeGenerator(c.env.DB, c.env.AI, userId, containerTag);
    const result = await generator.generateNudges();

    // Map string priority to integer for database
    const priorityToInt: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    // Clear old pending nudges (keep dismissed/acted for history)
    await c.env.DB
      .prepare(`DELETE FROM proactive_nudges WHERE user_id = ? AND dismissed = 0 AND acted = 0`)
      .bind(userId)
      .run();

    // Save new nudges to database
    const now = new Date().toISOString();
    let savedCount = 0;
    let notificationsQueued = 0;

    for (const nudge of result.nudges) {
      try {
        await c.env.DB
          .prepare(`
            INSERT INTO proactive_nudges (
              id, user_id, nudge_type, title, message, entity_id,
              priority, suggested_action, dismissed, acted, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
          `)
          .bind(
            nudge.id,
            userId,
            nudge.nudge_type,
            nudge.title,
            nudge.message,
            nudge.entity_id || null,
            priorityToInt[nudge.priority] || 2,
            nudge.suggested_action || null,
            now
          )
          .run();
        savedCount++;

        // Queue push notification for urgent/high priority nudges
        if (nudge.priority === 'urgent' || nudge.priority === 'high') {
          // Get user's push token
          const tokenResult = await c.env.DB
            .prepare(`SELECT push_token FROM users WHERE id = ? AND push_token IS NOT NULL`)
            .bind(userId)
            .first<{ push_token: string }>();

          if (tokenResult?.push_token) {
            await c.env.DB
              .prepare(`
                INSERT INTO scheduled_notifications (
                  id, user_id, notification_type, title, body, data, channel_id,
                  scheduled_for_utc, user_local_time, timezone, status, created_at, updated_at
                ) VALUES (?, ?, 'nudge', ?, ?, ?, 'nudges', ?, ?, 'UTC', 'pending', ?, ?)
              `)
              .bind(
                `notif_${nudge.id}`,
                userId,
                nudge.title,
                nudge.message.slice(0, 200),
                JSON.stringify({
                  nudgeId: nudge.id,
                  nudgeType: nudge.nudge_type,
                  entityId: nudge.entity_id,
                  priority: nudge.priority,
                  pushToken: tokenResult.push_token,
                }),
                now,
                now,
                now,
                now
              )
              .run();
            notificationsQueued++;
          }
        }
      } catch (saveError: any) {
        console.error(`[Nudges] Failed to save nudge ${nudge.id}:`, saveError);
      }
    }

    console.log(`[Nudges] Saved ${savedCount} nudges, queued ${notificationsQueued} notifications`);

    return c.json({
      nudges: result.nudges,
      metadata: {
        ...result.generation_metadata,
        saved_to_db: savedCount,
        notifications_queued: notificationsQueued,
      },
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
 * POST /v3/nudges/:id/dismiss
 * Dismiss a nudge
 */
app.post('/:id/dismiss', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const result = await c.env.DB
      .prepare(`
        UPDATE proactive_nudges
        SET dismissed = 1, dismissed_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `)
      .bind(id, userId)
      .run();

    if (result.meta?.changes === 0) {
      return c.json({ error: 'Nudge not found' }, 404);
    }

    return c.json({ success: true, dismissed: true });
  } catch (error: any) {
    console.error('[Nudges] Dismiss failed:', error);
    return c.json({ error: 'Failed to dismiss nudge', message: error.message }, 500);
  }
});

/**
 * POST /v3/nudges/:id/action
 * Mark nudge as acted upon
 */
app.post('/:id/action', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const result = await c.env.DB
      .prepare(`
        UPDATE proactive_nudges
        SET acted = 1, acted_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `)
      .bind(id, userId)
      .run();

    if (result.meta?.changes === 0) {
      return c.json({ error: 'Nudge not found' }, 404);
    }

    return c.json({ success: true, acted: true });
  } catch (error: any) {
    console.error('[Nudges] Action failed:', error);
    return c.json({ error: 'Failed to mark nudge as acted', message: error.message }, 500);
  }
});

export default app;
