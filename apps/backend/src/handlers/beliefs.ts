/**
 * Belief API Handlers
 *
 * Endpoints:
 * - GET /v3/beliefs - List beliefs
 * - GET /v3/beliefs/stats - Get belief statistics
 * - GET /v3/beliefs/conflicts - Get unresolved conflicts
 * - POST /v3/beliefs/form - Form beliefs from learnings
 * - GET /v3/beliefs/:id - Get belief with evidence
 * - POST /v3/beliefs/:id/evidence - Add evidence to belief
 * - POST /v3/beliefs/:id/update - Apply Bayesian update
 * - POST /v3/beliefs/:id/invalidate - Invalidate a belief
 * - POST /v3/beliefs/conflicts/:id/resolve - Resolve a conflict
 * - DELETE /v3/beliefs/:id - Archive a belief
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { BeliefRepository } from '../lib/cognitive/belief/repository';
import { BeliefFormationEngine } from '../lib/cognitive/belief/formation';
import type {
  BeliefType,
  BeliefStatus,
  BeliefEvidenceType,
  BeliefQueryOptions,
} from '../lib/cognitive/belief/types';

const app = new Hono<{ Bindings: Bindings }>();

// ============================================
// LIST & QUERY ENDPOINTS
// ============================================

/**
 * GET /v3/beliefs
 * List beliefs for the current user with filters
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  // Parse query parameters
  const statusParam = c.req.query('status');
  const typeParam = c.req.query('type');
  const domain = c.req.query('domain');
  const minConfidence = c.req.query('minConfidence');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const orderBy = c.req.query('orderBy') as 'confidence' | 'created_at' | 'updated_at' | undefined;
  const orderDirection = c.req.query('orderDirection') as 'asc' | 'desc' | undefined;

  try {
    const repository = new BeliefRepository(c.env.DB);

    const options: BeliefQueryOptions = {
      userId,
      limit,
      offset,
      orderBy,
      orderDirection,
    };

    // Parse status filter (comma-separated)
    if (statusParam) {
      options.status = statusParam.split(',') as BeliefStatus[];
    } else {
      options.status = ['active']; // Default to active only
    }

    // Parse type filter (comma-separated)
    if (typeParam) {
      options.beliefTypes = typeParam.split(',') as BeliefType[];
    }

    if (domain) {
      options.domain = domain;
    }

    if (minConfidence) {
      options.minConfidence = parseFloat(minConfidence);
    }

    const { beliefs, total } = await repository.queryBeliefs(options);

    return c.json({
      beliefs,
      total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] List failed:', error);
    return c.json(
      {
        error: 'Failed to list beliefs',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/beliefs/stats
 * Get belief statistics for the current user
 */
app.get('/stats', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const repository = new BeliefRepository(c.env.DB);
    const stats = await repository.getBeliefStats(userId);

    return c.json({
      stats,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Stats failed:', error);
    return c.json(
      {
        error: 'Failed to get belief statistics',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * GET /v3/beliefs/conflicts
 * Get unresolved belief conflicts
 */
app.get('/conflicts', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const repository = new BeliefRepository(c.env.DB);
    const conflicts = await repository.getUnresolvedConflicts(userId);

    // Get the beliefs involved in conflicts
    const beliefIds = new Set<string>();
    for (const conflict of conflicts) {
      beliefIds.add(conflict.beliefAId);
      beliefIds.add(conflict.beliefBId);
    }

    const beliefs: Record<string, any> = {};
    for (const id of beliefIds) {
      const belief = await repository.getBelief(id);
      if (belief) {
        beliefs[id] = belief;
      }
    }

    return c.json({
      conflicts,
      beliefs,
      total: conflicts.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Conflicts failed:', error);
    return c.json(
      {
        error: 'Failed to get belief conflicts',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// BELIEF FORMATION
// ============================================

/**
 * POST /v3/beliefs/form
 * Form new beliefs from high-confidence learnings
 */
app.post('/form', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json<{
    minConfidence?: number;
    maxLearnings?: number;
    category?: string;
  }>().catch(() => ({}));

  try {
    const engine = new BeliefFormationEngine(c.env.DB, c.env.AI);
    const result = await engine.formBeliefsFromLearnings(userId, {
      minConfidence: body.minConfidence,
      maxLearnings: body.maxLearnings ?? 50,
      category: body.category,
    });

    return c.json({
      message: 'Belief formation complete',
      formed: result.formed.length,
      skipped: result.skipped.length,
      conflicts: result.conflicts.length,
      processingTimeMs: result.processingTimeMs,
      beliefs: result.formed,
      skippedDetails: result.skipped,
      conflictDetails: result.conflicts,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Formation failed:', error);
    return c.json(
      {
        error: 'Failed to form beliefs',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// SINGLE BELIEF OPERATIONS
// ============================================

/**
 * GET /v3/beliefs/:id
 * Get a belief with all its evidence
 */
app.get('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const repository = new BeliefRepository(c.env.DB);
    const belief = await repository.getBeliefWithEvidence(id);

    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }

    // Verify ownership
    if (belief.userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Get dependent beliefs
    const dependents = await repository.getDependentBeliefs(id);

    // Get beliefs this one depends on
    const dependencies: any[] = [];
    for (const depId of belief.dependsOn) {
      const dep = await repository.getBelief(depId);
      if (dep) {
        dependencies.push(dep);
      }
    }

    return c.json({
      belief,
      dependencies,
      dependents,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Get failed:', error);
    return c.json(
      {
        error: 'Failed to get belief',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/beliefs/:id/evidence
 * Add evidence to a belief
 */
app.post('/:id/evidence', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<{
    memoryId?: string;
    learningId?: string;
    evidenceType: BeliefEvidenceType;
    supports: boolean;
    strength?: number;
    notes?: string;
    applyBayesianUpdate?: boolean;
  }>();

  try {
    const repository = new BeliefRepository(c.env.DB);

    // Verify belief exists and user owns it
    const belief = await repository.getBelief(id);
    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }
    if (belief.userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Add evidence
    const evidence = await repository.addEvidence({
      beliefId: id,
      memoryId: body.memoryId,
      learningId: body.learningId,
      evidenceType: body.evidenceType,
      supports: body.supports,
      strength: body.strength,
      notes: body.notes,
    });

    // Optionally apply Bayesian update
    let updatedBelief = belief;
    if (body.applyBayesianUpdate !== false) {
      updatedBelief = await repository.applyBayesianUpdate({
        beliefId: id,
        userId,
        evidenceStrength: evidence.strength,
        supports: body.supports,
        reason: `Evidence added: ${body.evidenceType}`,
        evidenceId: evidence.id,
      });
    }

    return c.json({
      success: true,
      evidence,
      belief: updatedBelief,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Add evidence failed:', error);
    return c.json(
      {
        error: 'Failed to add evidence',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/beliefs/:id/update
 * Apply a Bayesian update to a belief's confidence
 */
app.post('/:id/update', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<{
    evidenceStrength: number;
    supports: boolean;
    reason: string;
  }>();

  try {
    const repository = new BeliefRepository(c.env.DB);

    // Verify belief exists and user owns it
    const belief = await repository.getBelief(id);
    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }
    if (belief.userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    const previousConfidence = belief.currentConfidence;

    const updatedBelief = await repository.applyBayesianUpdate({
      beliefId: id,
      userId,
      evidenceStrength: body.evidenceStrength,
      supports: body.supports,
      reason: body.reason,
    });

    return c.json({
      success: true,
      belief: updatedBelief,
      previousConfidence,
      newConfidence: updatedBelief.currentConfidence,
      delta: updatedBelief.currentConfidence - previousConfidence,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Update failed:', error);
    return c.json(
      {
        error: 'Failed to update belief',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /v3/beliefs/:id/invalidate
 * Invalidate a belief
 */
app.post('/:id/invalidate', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<{
    reason?: string;
  }>().catch(() => ({}));

  try {
    const repository = new BeliefRepository(c.env.DB);

    // Verify belief exists and user owns it
    const belief = await repository.getBelief(id);
    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }
    if (belief.userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    await repository.updateBeliefStatus(
      id,
      'invalidated',
      body.reason || 'User invalidated'
    );

    return c.json({
      success: true,
      message: 'Belief invalidated',
      beliefId: id,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Invalidate failed:', error);
    return c.json(
      {
        error: 'Failed to invalidate belief',
        message: errorMessage,
      },
      500
    );
  }
});

/**
 * DELETE /v3/beliefs/:id
 * Archive a belief (soft delete)
 */
app.delete('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();

  try {
    const repository = new BeliefRepository(c.env.DB);

    // Verify belief exists and user owns it
    const belief = await repository.getBelief(id);
    if (!belief) {
      return c.json({ error: 'Belief not found' }, 404);
    }
    if (belief.userId !== userId) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    await repository.updateBeliefStatus(id, 'archived', 'User archived');

    return c.json({
      success: true,
      message: 'Belief archived',
      beliefId: id,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Archive failed:', error);
    return c.json(
      {
        error: 'Failed to archive belief',
        message: errorMessage,
      },
      500
    );
  }
});

// ============================================
// CONFLICT RESOLUTION
// ============================================

/**
 * POST /v3/beliefs/conflicts/:id/resolve
 * Resolve a belief conflict
 */
app.post('/conflicts/:id/resolve', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { id } = c.req.param();
  const body = await c.req.json<{
    resolution: string;
    winnerId?: string;
  }>();

  try {
    const repository = new BeliefRepository(c.env.DB);

    // Verify the conflict exists and user owns the beliefs
    const conflicts = await repository.getUnresolvedConflicts(userId);
    const conflict = conflicts.find((c) => c.id === id);

    if (!conflict) {
      return c.json({ error: 'Conflict not found' }, 404);
    }

    // If winnerId provided, verify it's one of the beliefs in conflict
    if (body.winnerId) {
      if (body.winnerId !== conflict.beliefAId && body.winnerId !== conflict.beliefBId) {
        return c.json({ error: 'Winner must be one of the conflicting beliefs' }, 400);
      }
    }

    await repository.resolveConflict(id, body.resolution, body.winnerId);

    return c.json({
      success: true,
      message: 'Conflict resolved',
      conflictId: id,
      winnerId: body.winnerId,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Beliefs] Resolve conflict failed:', error);
    return c.json(
      {
        error: 'Failed to resolve conflict',
        message: errorMessage,
      },
      500
    );
  }
});

export default app;
