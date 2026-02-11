/**
 * Cortex Edge API - Cloudflare Workers
 * Clean, modular, production-ready
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { jwt } from 'hono/jwt';
import type { Bindings } from './types';
import * as authHandlers from './handlers/auth';
import * as memoryHandlers from './handlers/memories';
import * as integrationHandlers from './handlers/integrations';
import * as contextHandlers from './handlers/context';
import * as processingHandlers from './handlers/processing';
import * as entityHandlers from './handlers/entities';
import * as temporalHandlers from './handlers/temporal';
import * as provenanceHandlers from './handlers/provenance';
import * as syncHandlers from './handlers/sync';
import * as uploadHandlers from './handlers/upload';
import * as searchHandlers from './handlers/search';
import consolidationRouter from './handlers/consolidation';
import commitmentsRouter from './handlers/commitments';
import relationshipRouter from './handlers/relationship';
import performanceRouter from './handlers/performance';
// DELETED: learnings, beliefs, outcomes, sleep - cognitive layer purged for Supermemory++
import briefingRouter from './handlers/briefing';
import actionsRouter from './handlers/actions';
import webhooksRouter from './handlers/webhooks';
import mcpRouter from './handlers/mcp';
import proactiveRouter from './handlers/proactive';
import triggersRouter from './handlers/triggers';
import * as agentHandlers from './handlers/agents';
import { SyncOrchestrator } from './lib/sync/orchestrator';
// DELETED: handleSleepComputeCron - cognitive layer purged
import { notificationHandlers } from './handlers/notifications';
import { tenantScopeMiddleware, tenantAuditMiddleware, tenantRateLimitMiddleware } from './lib/multi-tenancy/middleware';
import { PerformanceTimer, logPerformance, trackPerformanceMetrics } from './lib/monitoring/performance';
import { handleUncaughtError } from './lib/monitoring/errors';
import { handleQueueBatch, type QueueEnv } from './lib/queue/consumer';
import type { QueueMessage } from './lib/queue/producer';
import { handleScheduledEvent } from './lib/cron';
import { allCronTasks } from './lib/cron/tasks';
import { validateBody } from './lib/validation/middleware';
import {
  appleAuthSchema,
  googleAuthSchema,
  refreshTokenSchema,
  createMemorySchema,
  searchSchema,
  recallSchema,
} from './lib/validation/schemas';

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    // Production origins
    const allowedOrigins = [
      'https://app.askcortex.plutas.in',
      'https://askcortex.plutas.in',
      'https://cortex-console.pages.dev',
      'https://console.askcortex.in',
    ];
    // Allow localhost for development
    if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:'))) {
      return origin;
    }
    // Return first allowed origin for requests without origin (like mobile apps)
    return allowedOrigins[0];
  },
  credentials: true,
}));

// Performance monitoring middleware
app.use('*', async (c, next) => {
  const timer = new PerformanceTimer(
    c.req.path,
    c.req.method,
    c.get('userId'),
    c.get('tenantScope')?.containerTag
  );

  await next();

  const metrics = timer.end(c.res.status);
  logPerformance(metrics);

  // Track in KV (async, don't block response)
  c.executionCtx.waitUntil(
    trackPerformanceMetrics(c.env.CACHE, metrics).catch((err) =>
      console.warn('Performance tracking failed:', err)
    )
  );
});

// Global error handler
app.onError((err, c) => {
  const categorized = handleUncaughtError(
    err,
    {
      userId: c.get('userId'),
      containerTag: c.get('tenantScope')?.containerTag,
      endpoint: c.req.path,
      method: c.req.method,
    },
    c.env.CACHE
  );

  // Return appropriate error response
  const statusCode = categorized.severity === 'critical' ? 500 : categorized.severity === 'high' ? 500 : 400;

  return c.json(
    {
      error: categorized.message,
      category: categorized.category,
      timestamp: categorized.context.timestamp,
    },
    statusCode
  );
});

// Root route
app.get('/', (c) =>
  c.json({
    name: 'Cortex API',
    version: '3.0.0',
    status: 'live',
    base_url: c.env.WEBHOOK_BASE_URL || 'https://askcortex.plutas.in',
    endpoints: {
      health: '/health',
      auth: {
        apple: '/auth/apple',
        google: '/auth/google',
        refresh: '/auth/refresh',
        me: '/auth/me',
        api_keys: {
          create: '/auth/api-keys (POST, requires auth)',
          list: '/auth/api-keys (GET, requires auth)',
          delete: '/auth/api-keys/:id (DELETE, requires auth)',
          revoke: '/auth/api-keys/:id/revoke (POST, requires auth)',
        },
        delete_account: '/auth/account (DELETE, requires auth)',
      },
      v3: {
        memories: '/v3/memories',
        search: '/v3/search',
        recall: '/v3/recall',
        profile: '/v3/profile',
        entities: '/v3/entities',
        graph: {
          search: '/v3/graph/search',
          stats: '/v3/graph/stats',
        },
        processing: {
          jobs: '/v3/processing/jobs',
          stats: '/v3/processing/stats',
        },
        temporal: {
          time_travel: '/v3/time-travel',
          memory_history: '/v3/memories/:id/history',
          current: '/v3/memories/current',
          superseded: '/v3/memories/superseded',
        },
        consolidation: {
          recalculate_importance: '/v3/memories/:id/recalculate-importance',
          decay_cycle: '/v3/memories/decay-cycle',
          stats: '/v3/memories/consolidation-stats',
        },
        commitments: {
          list: '/v3/commitments',
          get: '/v3/commitments/:id',
          complete: '/v3/commitments/:id/complete',
          cancel: '/v3/commitments/:id/cancel',
          overdue: '/v3/commitments/overdue',
          upcoming: '/v3/commitments/upcoming',
        },
        relationships: {
          health: '/v3/relationships/health',
          entity_health: '/v3/relationships/:entityId/health',
        },
        nudges: {
          list: '/v3/nudges',
          generate: '/v3/nudges/generate',
        },
        performance: {
          stats: '/v3/performance/stats',
          metrics: '/v3/performance/metrics',
        },
        // DEPRECATED: learnings, beliefs, outcomes, sleep endpoints removed
        provenance: {
          chain: '/v3/provenance/:artifactType/:artifactId',
          entity_sources: '/v3/provenance/entity/:entityId/sources',
          memory_extractions: '/v3/provenance/memory/:memoryId/extractions',
          entity_history: '/v3/provenance/entity/:entityId/history',
          memory_derivations: '/v3/provenance/memory/:memoryId/chain',
          relationship_sources: '/v3/provenance/relationship/:relationshipId/sources',
          stats: '/v3/provenance/stats',
        },
        sync: {
          connections: '/v3/sync/connections',
          connection_detail: '/v3/sync/connections/:id',
          trigger_sync: '/v3/sync/connections/:id/sync',
          sync_logs: '/v3/sync/connections/:id/logs',
          status: '/v3/sync/status',
        },
        briefing: '/v3/briefing (consolidated home screen data)',
        upload: {
          audio: '/v3/upload/audio (POST, multipart/form-data)',
          text: '/v3/upload/text (POST, JSON body)',
        },
      },
      proactive: {
        preferences: '/proactive/preferences (GET/PATCH)',
        vip_senders: '/proactive/vip-senders (GET/POST)',
        vip_sender_delete: '/proactive/vip-senders/:email (DELETE)',
        events: '/proactive/events (GET)',
        stats: '/proactive/stats (GET)',
        webhook: '/proactive/webhook/:provider (POST, public)',
      },
    },
    getting_started: {
      step_1: 'Sign in via /auth/apple or /auth/google',
      step_2: 'Use access_token for API calls (Header: Authorization: Bearer <token>)',
      step_3: 'For testing: Generate long-lived API key via /auth/api-key',
    },
  })
);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes with validation
app.post('/auth/apple', validateBody(appleAuthSchema), authHandlers.appleLogin);
app.post('/auth/google', validateBody(googleAuthSchema), authHandlers.googleLogin);
app.post('/auth/refresh', validateBody(refreshTokenSchema), authHandlers.refreshToken);
app.get('/auth/me', authHandlers.getCurrentUser);

// REMOVED: Test token endpoint was a critical security vulnerability
// Never expose test token generation in production

// Helper function for JWT auth with proper error handling
async function authenticateWithJwt(c: any, next: () => Promise<void>) {
  try {
    const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
    await jwtMiddleware(c, next);
  } catch (error: any) {
    const message = error.message || 'Unauthorized';

    if (message.includes('exp') || message.includes('expired') || message.includes('claim')) {
      return c.json(
        { error: 'Token expired', code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh your token.' },
        401
      );
    }

    if (message.includes('invalid') || message.includes('signature') || message.includes('malformed')) {
      return c.json(
        { error: 'Invalid token', code: 'TOKEN_INVALID', message: 'Access token is invalid. Please re-authenticate.' },
        401
      );
    }

    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED', message }, 401);
  }
}

// API key management (protected)
// - POST /auth/api-keys: Create new API key (returns raw key ONCE)
// - GET /auth/api-keys: List API keys (shows prefix only)
// - DELETE /auth/api-keys/:id: Delete an API key
// - POST /auth/api-keys/:id/revoke: Revoke (deactivate) an API key
app.use('/auth/api-keys', authenticateWithJwt);
app.use('/auth/api-keys/*', authenticateWithJwt);
app.post('/auth/api-keys', authHandlers.createApiKeyHandler);
app.get('/auth/api-keys', authHandlers.listApiKeysHandler);
app.delete('/auth/api-keys/:id', authHandlers.deleteApiKeyHandler);
app.post('/auth/api-keys/:id/revoke', authHandlers.revokeApiKeyHandler);

// Legacy API key endpoint (redirects to new endpoint)
app.use('/auth/api-key', authenticateWithJwt);
app.post('/auth/api-key', authHandlers.createApiKeyHandler);

// Account deletion (protected) - App Store compliance
app.use('/auth/account', authenticateWithJwt);
app.delete('/auth/account', authHandlers.deleteAccount);

// Google OAuth connect (protected) - Initiates Composio OAuth for Gmail/Calendar
app.use('/auth/google/connect', authenticateWithJwt);
app.post('/auth/google/connect', authHandlers.connectGoogle);

// Public stubs (mobile app compatibility)
app.get('/chat/greeting', (c) =>
  c.json({ greeting: 'Welcome back!', contextual_message: null })
);
app.get('/chat/suggestions', (c) => c.json({ suggestions: [] }));
app.get('/chat/insights', (c) =>
  c.json({
    total_attention_needed: 0,
    urgent_emails: 0,
    pending_commitments: 0,
    important_dates: 0,
  })
);
app.get('/chat/briefing', (c) =>
  c.json({ summary: 'Your day looks good!', sections: [] })
);
// Note: /autonomous-actions requires auth - moved to protected section below

// PUBLIC: OAuth callback routes (no auth required - Composio redirects here)
// New unified callbacks
app.get('/integrations/googlesuper/callback', integrationHandlers.googleCallback);
app.get('/integrations/slack/callback', integrationHandlers.slackCallback);
app.get('/integrations/notion/callback', integrationHandlers.notionCallback);
// Legacy callbacks (redirect to new handlers)
app.get('/integrations/gmail/callback', integrationHandlers.gmailCallback);
app.get('/integrations/calendar/callback', integrationHandlers.calendarCallback);

// Protected middleware
app.use('/api/*', authenticateWithJwt);
app.use('/integrations/*', authenticateWithJwt);
app.use('/autonomous-actions', authenticateWithJwt);
app.use('/actions/*', authenticateWithJwt);

// Protected routes - Memories
app.get('/api/memories', memoryHandlers.listMemories);
app.get('/api/memories/:id', memoryHandlers.getMemoryById);
app.post('/api/memories', memoryHandlers.createNewMemory);
app.patch('/api/memories/:id', memoryHandlers.updateExistingMemory);
app.delete('/api/memories/:id', memoryHandlers.deleteExistingMemory);
app.post('/api/search', memoryHandlers.search);
app.post('/api/chat', memoryHandlers.chatWithMemories);

// Action-enhanced chat (Iris/Poke-style)
app.post('/api/chat/actions', memoryHandlers.chatWithActionsHandler);
app.post('/api/actions/:id/confirm', memoryHandlers.confirmActionHandler);
app.post('/api/actions/:id/cancel', memoryHandlers.cancelActionHandler);

// Protected routes - Integrations (callbacks are public, defined above)
app.get('/integrations/status', integrationHandlers.getIntegrationStatus);

// New unified integration endpoints
app.post('/integrations/google/connect', integrationHandlers.connectGoogle);
app.post('/integrations/slack/connect', integrationHandlers.connectSlack);
app.post('/integrations/notion/connect', integrationHandlers.connectNotion);
app.delete('/integrations/google/disconnect', integrationHandlers.disconnectGoogle);
app.delete('/integrations/slack/disconnect', integrationHandlers.disconnectSlack);
app.delete('/integrations/notion/disconnect', integrationHandlers.disconnectNotion);

// Sync triggers
app.post('/integrations/:provider/sync', integrationHandlers.triggerSync);

// Legacy endpoints (mobile app compatibility)
app.post('/integrations/gmail/connect', integrationHandlers.connectGmail);
app.post('/integrations/calendar/connect', integrationHandlers.connectCalendar);

// Calendar events API
app.get('/integrations/google/calendar/events', integrationHandlers.getCalendarEvents);
app.post('/integrations/google/calendar/events', integrationHandlers.createCalendarEvent);
app.get('/integrations/google/calendar/available', integrationHandlers.getCalendarAvailability);

// Legacy autonomous actions endpoints (required by web app)
// GET /autonomous-actions - List pending actions in frontend format
app.get('/autonomous-actions', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const now = new Date().toISOString();

  try {
    // Query pending actions from database
    const pending = await c.env.DB.prepare(`
      SELECT id, action, parameters, confirmation_message, expires_at, created_at
      FROM pending_actions
      WHERE user_id = ? AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(userId, now).all();

    // Transform to frontend format
    const actions = (pending.results as any[]).map((p) => {
      const params = JSON.parse(p.parameters || '{}');

      // Determine action type from action name
      let actionType = 'reminder';
      if (p.action?.includes('email') || p.action?.includes('gmail')) {
        actionType = 'email_reply';
      } else if (p.action?.includes('calendar') || p.action?.includes('event')) {
        actionType = 'calendar_create';
      } else if (p.action?.includes('meeting')) {
        actionType = 'meeting_prep';
      }

      return {
        id: p.id,
        action_type: actionType,
        title: p.confirmation_message || p.action,
        description: p.confirmation_message || '',
        action_payload: params,
        reason: 'Suggested based on your activity',
        confidence_score: 0.8,
        priority_score: 50,
        source_type: 'pattern',
        created_at: p.created_at,
        expires_at: p.expires_at,
      };
    });

    return c.json(actions);
  } catch (error: any) {
    console.error('[AutonomousActions] Error:', error);
    return c.json([]);
  }
});

// POST /actions/approve - Approve and execute an action
app.post('/actions/approve', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();
    const { action_id, modifications } = body;

    if (!action_id) {
      return c.json({ error: 'action_id is required' }, 400);
    }

    // Get pending action
    const pending = await c.env.DB.prepare(`
      SELECT * FROM pending_actions
      WHERE id = ? AND user_id = ?
    `).bind(action_id, userId).first();

    if (!pending) {
      return c.json({ error: 'Action not found' }, 404);
    }

    // Check if expired
    if (new Date(pending.expires_at as string) < new Date()) {
      await c.env.DB.prepare('DELETE FROM pending_actions WHERE id = ?').bind(action_id).run();
      return c.json({ error: 'Action expired' }, 410);
    }

    // Execute the action (simplified - just mark as confirmed)
    // In production, this would call the action executor
    await c.env.DB.prepare('DELETE FROM pending_actions WHERE id = ?').bind(action_id).run();

    // Log the action
    await c.env.DB.prepare(`
      INSERT INTO action_log (id, user_id, action, parameters, status, created_at)
      VALUES (?, ?, ?, ?, 'completed', datetime('now'))
    `).bind(
      crypto.randomUUID(),
      userId,
      pending.action,
      pending.parameters
    ).run();

    return c.json({ success: true, message: 'Action approved and executed' });
  } catch (error: any) {
    console.error('[Actions] Approve error:', error);
    return c.json({ error: 'Failed to approve action', message: error.message }, 500);
  }
});

// POST /actions/dismiss - Dismiss an action
app.post('/actions/dismiss', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();
    const { action_id, reason } = body;

    if (!action_id) {
      return c.json({ error: 'action_id is required' }, 400);
    }

    const result = await c.env.DB.prepare(`
      DELETE FROM pending_actions
      WHERE id = ? AND user_id = ?
    `).bind(action_id, userId).run();

    if (!result.meta.changes) {
      return c.json({ error: 'Action not found' }, 404);
    }

    // Log dismissal
    await c.env.DB.prepare(`
      INSERT INTO action_log (id, user_id, action, parameters, status, error, created_at)
      VALUES (?, ?, 'dismissed', ?, 'dismissed', ?, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      userId,
      JSON.stringify({ action_id }),
      reason || null
    ).run();

    return c.json({ success: true });
  } catch (error: any) {
    console.error('[Actions] Dismiss error:', error);
    return c.json({ error: 'Failed to dismiss action', message: error.message }, 500);
  }
});

// v3 API - Context Cloud (Supermemory-style)
app.use('/v3/*', authenticateWithJwt);

// Extract userId from JWT payload
app.use('/v3/*', async (c, next) => {
  const payload = c.get('jwtPayload');
  if (payload && payload.sub) {
    c.set('userId', payload.sub);
  }
  await next();
});

// Multi-tenancy middleware for v3 API
app.use('/v3/*', tenantScopeMiddleware);
app.use('/v3/*', tenantAuditMiddleware);
app.use('/v3/*', tenantRateLimitMiddleware);

// Memory endpoints with validation
app.post('/v3/memories', validateBody(createMemorySchema), contextHandlers.addMemory);
app.post('/v3/memories/batch-contextual', contextHandlers.addContextualMemories);
app.get('/v3/memories', contextHandlers.listMemories);
app.put('/v3/memories/:id', contextHandlers.updateMemoryHandler);
app.delete('/v3/memories/:id', contextHandlers.deleteMemory);
// Supermemory++ Phase 2: Hybrid search with explainable ranking
app.post('/v3/search', searchHandlers.searchHandler);
app.post('/v3/recall', validateBody(recallSchema), contextHandlers.recall);

// Profile engine (Supermemory++ Phase 2)
app.get('/v3/profile', contextHandlers.getProfile);  // Legacy
app.get('/v3/profiles', searchHandlers.getProfilesHandler);
app.patch('/v3/profiles', searchHandlers.updateProfilesHandler);
app.delete('/v3/profiles/:key', searchHandlers.deleteProfileHandler);

// Timeline API (Supermemory++ Phase 2)
app.get('/v3/timeline', searchHandlers.timelineHandler);

// Feedback loop (Supermemory++ Phase 2)
app.post('/v3/feedback', searchHandlers.feedbackHandler);

// Guarded search with grounding (Supermemory++ Phase 3 - Zero Hallucination)
app.post('/v3/ask', searchHandlers.guardedSearchHandler);

// Processing pipeline endpoints
app.post('/v3/processing/jobs', processingHandlers.createProcessingJob);
app.get('/v3/processing/jobs/:jobId', processingHandlers.getJobStatus);
app.get('/v3/processing/jobs', processingHandlers.listProcessingJobs);
app.get('/v3/processing/stats', processingHandlers.getProcessingStats);

// Entity graph endpoints
app.get('/v3/entities', entityHandlers.listEntities);
app.get('/v3/entities/:id', entityHandlers.getEntity);
app.get('/v3/entities/:id/relationships', entityHandlers.getEntityRelationshipsHandler);
app.get('/v3/entities/:id/memories', entityHandlers.getEntityMemoriesHandler);
app.get('/v3/graph/search', entityHandlers.searchEntities);
app.get('/v3/graph/stats', entityHandlers.getGraphStats);

// Temporal query endpoints
app.post('/v3/time-travel', temporalHandlers.timeTravelHandler);
app.get('/v3/memories/:id/history', temporalHandlers.getMemoryHistoryHandler);
app.get('/v3/memories/current', temporalHandlers.getCurrentMemoriesHandler);
app.get('/v3/memories/superseded', temporalHandlers.getSupersededMemoriesHandler);
app.get('/v3/temporal/entity/:entityId/timeline', temporalHandlers.getEntityTimelineHandler);
app.get('/v3/temporal/timeline', temporalHandlers.getTimelineHandler);

// Provenance tracking endpoints
app.get('/v3/provenance/:artifactType/:artifactId', provenanceHandlers.getProvenanceChainHandler);
app.get('/v3/provenance/entity/:entityId/sources', provenanceHandlers.getEntitySourcesHandler);
app.get('/v3/provenance/memory/:memoryId/extractions', provenanceHandlers.getMemoryExtractionsHandler);
app.get('/v3/provenance/entity/:entityId/history', provenanceHandlers.getEntityHistoryHandler);
app.get('/v3/provenance/memory/:memoryId/chain', provenanceHandlers.getMemoryDerivationsHandler);
app.get('/v3/provenance/relationship/:relationshipId/sources', provenanceHandlers.getRelationshipSourcesHandler);
app.get('/v3/provenance/stats', provenanceHandlers.getProvenanceStatsHandler);

// Consolidation endpoints
app.route('/v3/memories', consolidationRouter);

// Commitment tracking endpoints
app.route('/v3/commitments', commitmentsRouter);

// Relationship intelligence endpoints
app.route('/v3/relationships', relationshipRouter);
app.route('/v3/nudges', relationshipRouter);

// Performance monitoring endpoints
app.route('/v3/performance', performanceRouter);

// DELETED: Cognitive layer (learnings, beliefs, outcomes, sleep) - purged for Supermemory++
// These over-engineered subsystems had 0 users and added complexity without value

// Briefing endpoint (consolidated mobile home screen data)
app.route('/v3/briefing', briefingRouter);

// Actions endpoint (action execution via Composio)
app.route('/v3/actions', actionsRouter);

// Upload endpoints (audio transcription, text)
app.post('/v3/upload/audio', uploadHandlers.uploadAudio);
app.post('/v3/upload/text', uploadHandlers.uploadText);

// Mobile app upload endpoints (different format expected)
app.post('/upload/audio-with-transcription', uploadHandlers.uploadAudioWithTranscription);
app.post('/upload/photo', uploadHandlers.uploadPhoto);
app.post('/upload/file', uploadHandlers.uploadFile);

// Sync infrastructure endpoints
app.get('/v3/sync/connections', syncHandlers.listSyncConnectionsHandler);
app.post('/v3/sync/connections', syncHandlers.createSyncConnectionHandler);
app.patch('/v3/sync/connections/:id', syncHandlers.updateSyncConnectionHandler);
app.delete('/v3/sync/connections/:id', syncHandlers.deleteSyncConnectionHandler);
app.post('/v3/sync/connections/:id/sync', syncHandlers.triggerManualSyncHandler);
app.get('/v3/sync/connections/:id/logs', syncHandlers.getSyncLogsHandler);
app.get('/v3/sync/status', syncHandlers.getSyncStatusHandler);

// Push notification endpoints (protected)
app.use('/notifications/*', authenticateWithJwt);
app.post('/notifications/register', notificationHandlers.registerPushToken);
app.post('/notifications/unregister', notificationHandlers.unregisterPushToken);
app.get('/notifications/preferences', notificationHandlers.getNotificationPreferences);
app.put('/notifications/preferences', notificationHandlers.updateNotificationPreferences);
app.post('/notifications/test', notificationHandlers.sendTestNotification);
app.get('/notifications/status', notificationHandlers.getNotificationStatus);

// Webhooks (public - no auth, verified by signature)
app.route('/webhooks', webhooksRouter);

// Proactive monitoring
// Public webhook endpoints - verified by signature, not JWT
const handleProactiveWebhook = async (c: any) => {
  const { handleWebhook } = await import('./lib/proactive');
  const rawBody = await c.req.text();
  const signature = c.req.header('x-composio-signature') || '';
  const secret = c.env.COMPOSIO_WEBHOOK_SECRET || '';

  const result = await handleWebhook(c.env.DB, rawBody, signature, secret);
  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ success: true, eventId: result.eventId });
};

// Generic and provider-specific webhook routes
app.post('/proactive/webhook', handleProactiveWebhook);
app.post('/proactive/webhook/:provider', handleProactiveWebhook);

// Protected proactive endpoints
app.use('/proactive/settings', authenticateWithJwt);
app.use('/proactive/vip', authenticateWithJwt);
app.use('/proactive/vip/*', authenticateWithJwt);
app.use('/proactive/events', authenticateWithJwt);
app.use('/proactive/messages', authenticateWithJwt);
app.use('/proactive/messages/*', authenticateWithJwt);
app.use('/proactive/cleanup', authenticateWithJwt);
app.use('/proactive/sync/*', authenticateWithJwt);
app.use('/proactive/health', authenticateWithJwt);
app.route('/proactive', proactiveRouter);

// MCP Server (Model Context Protocol for AI clients)
// /mcp/rpc and /mcp/sse use API key auth (for external AI clients)
// /mcp/integrations/* uses JWT auth (for mobile app)
app.use('/mcp/integrations', authenticateWithJwt);
app.use('/mcp/integrations/*', authenticateWithJwt);
app.route('/mcp', mcpRouter);

// User-defined triggers (natural language scheduling)
app.use('/v3/triggers', authenticateWithJwt);
app.use('/v3/triggers/*', authenticateWithJwt);
app.route('/v3/triggers', triggersRouter);

// Multi-agent orchestration endpoints
app.get('/v3/agents/status', agentHandlers.getAgentStatusHandler);
app.get('/v3/agents/stats', agentHandlers.getAgentStatsHandler);
app.get('/v3/agents/executions', agentHandlers.getAgentExecutionsHandler);
app.get('/v3/agents/executions/:requestId/trace', agentHandlers.getExecutionTraceHandler);
app.get('/v3/agents/configs', agentHandlers.getAgentConfigsHandler);
app.get('/v3/agents/configs/:agentType', agentHandlers.getAgentConfigHandler);
app.patch('/v3/agents/configs/:agentType', agentHandlers.updateAgentConfigHandler);
app.delete('/v3/agents/configs/:agentType', agentHandlers.deleteAgentConfigHandler);

// Admin reindex endpoint - re-embeds all manual memories into Vectorize
// SECURITY: Protected with JWT auth - only authenticated users can trigger reindex
app.use('/admin/*', authenticateWithJwt);
app.get('/admin/reindex', async (c) => {
  // Only allow reindexing the current user's memories for security
  const userId = c.get('jwtPayload').sub;

  const memories = await c.env.DB.prepare(`
    SELECT id, user_id, content, container_tag FROM memories
    WHERE user_id = ? AND source = 'manual' AND length(content) > 3
  `).bind(userId).all<{ id: string; user_id: string; content: string; container_tag: string }>();

  let success = 0;
  const errors: string[] = [];

  for (const m of memories.results || []) {
    try {
      const emb = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: m.content });
      if (emb?.data?.[0]) {
        await c.env.VECTORIZE.upsert([{
          id: m.id,
          values: emb.data[0],
          metadata: { user_id: m.user_id, container_tag: m.container_tag || 'default' },
        }]);
        success++;
      } else {
        errors.push(`No embedding for ${m.id}`);
      }
    } catch (e: any) {
      errors.push(`${m.id}: ${e.message}`);
    }
  }
  return c.json({ total: memories.results?.length, success, errors: errors.length > 0 ? errors : undefined });
});

// SECURITY: Test endpoints removed - they bypassed authentication and allowed
// access to any user's data. Use authenticated /api/chat/actions endpoint instead.

// SECURITY: /test/openai and /test/recall endpoints removed
// These endpoints bypassed authentication and exposed user data

export default {
  fetch: app.fetch,

  /**
   * Queue consumer - processes async jobs from queue
   */
  async queue(batch: MessageBatch<QueueMessage>, env: QueueEnv): Promise<void> {
    console.log(`[QUEUE CONSUMER] ========== INVOKED ==========`);
    console.log(`[QUEUE CONSUMER] Batch size: ${batch.messages.length}`);
    console.log(`[QUEUE CONSUMER] Queue: ${batch.queue}`);

    try {
      await handleQueueBatch(batch, env);
      console.log(`[QUEUE CONSUMER] ========== COMPLETED ==========`);
    } catch (error: any) {
      console.error(`[QUEUE CONSUMER] ========== FAILED ==========`);
      console.error(`[QUEUE CONSUMER] Error:`, error.message);
      throw error;
    }
  },

  /**
   * Scheduled worker - runs on cron schedule
   *
   * Uses the new task runner with:
   * - Per-task isolation (one failure doesn't kill others)
   * - Per-task timeouts
   * - LLM budget tracking via KV
   * - Cron overlap protection via KV locks
   * - Wall time awareness (25s limit)
   */
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    const proactiveEnabled = env.PROACTIVE_ENABLED !== 'false';

    if (!proactiveEnabled) {
      console.log('[Scheduled] Proactive system disabled, skipping cron');
      return;
    }

    // Use the new task runner with all production-grade features
    await handleScheduledEvent(event.cron, allCronTasks, env, ctx);
  },
};
