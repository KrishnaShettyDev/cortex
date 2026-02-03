/**
 * Outcome API Handlers
 *
 * Endpoints:
 * - POST /v3/recall/intelligent - Intelligent recall with outcome tracking
 * - GET /v3/outcomes - List recent outcomes
 * - GET /v3/outcomes/stats - Get outcome statistics
 * - GET /v3/outcomes/:id - Get outcome with sources
 * - GET /v3/outcomes/:id/reasoning - Get reasoning trace
 * - POST /v3/outcomes/:id/feedback - Record feedback
 * - POST /v3/outcomes/:id/propagate - Propagate feedback
 * - POST /v3/outcomes/propagate-pending - Process all pending propagations
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { OutcomeRepository } from '../lib/cognitive/outcome/repository';
import { FeedbackPropagator } from '../lib/cognitive/outcome/propagator';
import { IntelligentRecall } from '../lib/cognitive/outcome/intelligent-recall';
import { LearningRepository } from '../lib/cognitive/learning/repository';
import { BeliefRepository } from '../lib/cognitive/belief/repository';
import type { OutcomeSignal, OutcomeSource } from '../lib/cognitive/outcome/types';

const app = new Hono<{ Bindings: Bindings }>();

// ============================================
// INTELLIGENT RECALL
// ============================================

/**
 * POST /intelligent
 * Intelligent recall with outcome tracking
 * (Mounted at /v3/recall, so full path is /v3/recall/intelligent)
 */
app.post('/intelligent', async (c) => {
  const userId = c.get('jwtPayload').sub;

  let body: {
    query: string;
    context?: string;
    limit?: number;
    includeBeliefs?: boolean;
    includeLearnings?: boolean;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.query || typeof body.query !== 'string') {
    return c.json({ error: 'query is required' }, 400);
  }

  try {
    const outcomeRepository = new OutcomeRepository(c.env.DB);
    const learningRepository = new LearningRepository(c.env.DB);
    const beliefRepository = new BeliefRepository(c.env.DB);

    const recall = new IntelligentRecall(
      c.env.DB,
      c.env.AI,
      c.env.VECTORIZE,
      learningRepository,
      beliefRepository,
      outcomeRepository
    );

    const result = await recall.recall({
      userId,
      query: body.query,
      context: body.context,
      limit: body.limit,
      includeBeliefs: body.includeBeliefs,
      includeLearnings: body.includeLearnings,
    });

    return c.json({
      response: result.response,
      outcomeId: result.outcomeId,
      sources: {
        memories: result.memories.length,
        learnings: result.learnings.length,
        beliefs: result.beliefs.length,
      },
      processingTimeMs: result.processingTimeMs,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Intelligent recall failed:', error);
    return c.json(
      {
        error: 'Failed to perform intelligent recall',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// OUTCOME QUERIES
// ============================================

/**
 * GET /v3/outcomes
 * List recent outcomes
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const query = c.req.query();

  try {
    const repository = new OutcomeRepository(c.env.DB);

    const outcomes = await repository.queryOutcomes({
      userId,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
      orderBy: 'action_at',
      orderDirection: 'desc',
    });

    return c.json({ outcomes, total: outcomes.length });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] List failed:', error);
    return c.json(
      {
        error: 'Failed to list outcomes',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/outcomes/stats
 * Get outcome statistics
 */
app.get('/stats', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const repository = new OutcomeRepository(c.env.DB);
    const stats = await repository.getStats(userId);
    const effectiveness = await repository.getSourceEffectiveness(userId);

    return c.json({
      stats,
      sourceEffectiveness: effectiveness,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Stats failed:', error);
    return c.json(
      {
        error: 'Failed to get outcome statistics',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/outcomes/:id
 * Get outcome with full details
 */
app.get('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const outcomeId = c.req.param('id');

  if (!outcomeId) {
    return c.json({ error: 'Outcome ID required' }, 400);
  }

  try {
    const repository = new OutcomeRepository(c.env.DB);
    const outcome = await repository.getOutcomeWithSources(outcomeId, userId);

    if (!outcome) {
      return c.json({ error: 'Outcome not found' }, 404);
    }

    return c.json({ outcome });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Get failed:', error);
    return c.json(
      {
        error: 'Failed to get outcome',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/outcomes/:id/reasoning
 * Get reasoning trace for an outcome
 */
app.get('/:id/reasoning', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const outcomeId = c.req.param('id');

  if (!outcomeId) {
    return c.json({ error: 'Outcome ID required' }, 400);
  }

  try {
    const repository = new OutcomeRepository(c.env.DB);
    const outcome = await repository.getOutcomeById(outcomeId, userId);

    if (!outcome) {
      return c.json({ error: 'Outcome not found' }, 404);
    }

    return c.json({
      outcomeId,
      reasoningTrace: outcome.reasoningTrace,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Get reasoning failed:', error);
    return c.json(
      {
        error: 'Failed to get reasoning trace',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// FEEDBACK
// ============================================

/**
 * POST /v3/outcomes/:id/feedback
 * Record feedback for an outcome
 */
app.post('/:id/feedback', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const outcomeId = c.req.param('id');

  if (!outcomeId) {
    return c.json({ error: 'Outcome ID required' }, 400);
  }

  let body: {
    signal: OutcomeSignal;
    source?: OutcomeSource;
    details?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.signal || !['positive', 'negative', 'neutral'].includes(body.signal)) {
    return c.json({ error: 'signal must be positive, negative, or neutral' }, 400);
  }

  try {
    const repository = new OutcomeRepository(c.env.DB);

    // Verify outcome exists
    const existing = await repository.getOutcomeById(outcomeId, userId);
    if (!existing) {
      return c.json({ error: 'Outcome not found' }, 404);
    }

    const outcome = await repository.recordFeedback({
      outcomeId,
      userId,
      signal: body.signal,
      source: body.source ?? 'explicit_feedback',
      details: body.details,
    });

    console.log('[Outcomes] Feedback recorded', {
      outcomeId,
      userId,
      signal: body.signal,
    });

    return c.json({ outcome });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Feedback failed:', error);
    return c.json(
      {
        error: 'Failed to record feedback',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// PROPAGATION
// ============================================

/**
 * POST /v3/outcomes/:id/propagate
 * Propagate feedback to update confidence scores
 */
app.post('/:id/propagate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const outcomeId = c.req.param('id');

  if (!outcomeId) {
    return c.json({ error: 'Outcome ID required' }, 400);
  }

  try {
    const outcomeRepository = new OutcomeRepository(c.env.DB);
    const learningRepository = new LearningRepository(c.env.DB);
    const beliefRepository = new BeliefRepository(c.env.DB);

    // Get outcome with sources
    const outcome = await outcomeRepository.getOutcomeWithSources(outcomeId, userId);
    if (!outcome) {
      return c.json({ error: 'Outcome not found' }, 404);
    }

    if (outcome.feedbackPropagated) {
      return c.json({ error: 'Feedback already propagated' }, 400);
    }

    if (outcome.outcomeSignal === 'unknown') {
      return c.json({ error: 'No feedback to propagate' }, 400);
    }

    const propagator = new FeedbackPropagator(
      c.env.DB,
      outcomeRepository,
      learningRepository,
      beliefRepository
    );

    const result = await propagator.propagateOutcome(outcome);

    return c.json({ result });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Propagate failed:', error);
    return c.json(
      {
        error: 'Failed to propagate feedback',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/outcomes/propagate-pending
 * Process all pending propagations (batch)
 */
app.post('/propagate-pending', async (c) => {
  const userId = c.get('jwtPayload').sub;

  let body: { limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body, use defaults
  }

  try {
    const outcomeRepository = new OutcomeRepository(c.env.DB);
    const learningRepository = new LearningRepository(c.env.DB);
    const beliefRepository = new BeliefRepository(c.env.DB);

    const propagator = new FeedbackPropagator(
      c.env.DB,
      outcomeRepository,
      learningRepository,
      beliefRepository
    );

    const result = await propagator.processPendingPropagations(body.limit ?? 50);

    return c.json({
      processed: result.processed,
      totalLearningsUpdated: result.results.reduce(
        (sum, r) => sum + r.learningsUpdated.length,
        0
      ),
      totalBeliefsUpdated: result.results.reduce(
        (sum, r) => sum + r.beliefsUpdated.length,
        0
      ),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Outcomes] Propagate pending failed:', error);
    return c.json(
      {
        error: 'Failed to propagate pending feedback',
        message: errorMessage,
      },
      500
    );
  }
});

export default app;
