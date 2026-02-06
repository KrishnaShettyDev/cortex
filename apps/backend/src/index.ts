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
import { SyncOrchestrator } from './lib/sync/orchestrator';
// DELETED: handleSleepComputeCron - cognitive layer purged
import { ConsolidationPipeline } from './lib/consolidation/consolidation-pipeline';
import { notificationHandlers } from './handlers/notifications';
import { processScheduledNotifications } from './lib/notifications/scheduler';
import { tenantScopeMiddleware, tenantAuditMiddleware, tenantRateLimitMiddleware } from './lib/multi-tenancy/middleware';
import { PerformanceTimer, logPerformance, trackPerformanceMetrics } from './lib/monitoring/performance';
import { handleUncaughtError } from './lib/monitoring/errors';
import { handleQueueBatch, type QueueEnv } from './lib/queue/consumer';
import type { QueueMessage } from './lib/queue/producer';
import { ComposioClient } from './lib/composio';
import { reconcileTriggers } from './lib/triggers';
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
    base_url: 'https://askcortex.plutas.in',
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
app.get('/autonomous-actions', (c) => c.json([]));

// PUBLIC: OAuth callback routes (no auth required - Composio redirects here)
app.get('/integrations/gmail/callback', integrationHandlers.gmailCallback);
app.get('/integrations/calendar/callback', integrationHandlers.calendarCallback);

// Protected middleware
app.use('/api/*', authenticateWithJwt);
app.use('/integrations/*', authenticateWithJwt);

// Protected routes - Memories
app.get('/api/memories', memoryHandlers.listMemories);
app.get('/api/memories/:id', memoryHandlers.getMemoryById);
app.post('/api/memories', memoryHandlers.createNewMemory);
app.patch('/api/memories/:id', memoryHandlers.updateExistingMemory);
app.delete('/api/memories/:id', memoryHandlers.deleteExistingMemory);
app.post('/api/search', memoryHandlers.search);
app.post('/api/chat', memoryHandlers.chatWithMemories);

// Protected routes - Integrations (callbacks are public, defined above)
app.get('/integrations/status', integrationHandlers.getIntegrationStatus);
app.post('/integrations/gmail/connect', integrationHandlers.connectGmail);
app.post('/integrations/calendar/connect', integrationHandlers.connectCalendar);
app.post('/integrations/gmail/sync', integrationHandlers.triggerGmailSync);
app.post('/integrations/calendar/sync', integrationHandlers.triggerCalendarSync);
app.delete('/integrations/:provider', integrationHandlers.disconnectIntegration);

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

// MCP Server (Model Context Protocol for AI clients)
app.route('/mcp', mcpRouter);

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
   */
  async scheduled(event: ScheduledEvent, env: any) {
    console.log(`[Scheduled] Cron triggered: ${event.cron}`);

    try {
      // Run trigger reconciliation every 6 hours
      // This ensures triggers are set up correctly and catches any missed events
      if (event.cron === '0 */6 * * *') {
        console.log('[Scheduled] Running trigger reconciliation (6-hourly)');

        // Reconcile Composio triggers
        if (env.COMPOSIO_API_KEY) {
          const client = new ComposioClient({ apiKey: env.COMPOSIO_API_KEY });
          const triggerResults = await reconcileTriggers(client, env.DB);
          console.log(
            `[Scheduled] Trigger reconciliation: ${triggerResults.checked} checked, ` +
            `${triggerResults.created} created, ${triggerResults.removed} removed, ` +
            `${triggerResults.errors.length} errors`
          );
        }

        // Run scheduled notifications (briefings, nudges based on user timezones)
        const notifResults = await processScheduledNotifications(env.DB, env.AI);
        console.log(`[Scheduled] Notifications: ${notifResults.sent} sent, ${notifResults.skipped} skipped, ${notifResults.failed} failed`);
      }

      // DELETED: Sleep compute cron - cognitive layer purged for Supermemory++

      // Run weekly consolidation (Sunday 2am)
      if (event.cron === '0 2 * * SUN') {
        console.log('[Scheduled] Running weekly consolidation');

        // Get active users
        const usersResult = await env.DB.prepare(`
          SELECT DISTINCT user_id FROM memories
          WHERE created_at >= datetime('now', '-7 days')
          LIMIT 100
        `).all();

        for (const user of usersResult.results as any[]) {
          try {
            const pipeline = new ConsolidationPipeline(
              {
                db: env.DB,
                ai: env.AI,
                vectorize: env.VECTORIZE,
                userId: user.user_id,
                containerTag: 'default',
              },
              {
                userId: user.user_id,
                containerTag: 'default',
                strategy: 'hybrid',
                importanceThreshold: 0.3,
                minAgeDays: 30,
                minClusterSize: 3,
              }
            );

            const result = await pipeline.run();
            console.log(
              `[Scheduled] Consolidation for user ${user.user_id}: ` +
              `${result.memories_consolidated} memories → ${result.semantic_facts_created} facts`
            );
          } catch (error) {
            console.error(`[Scheduled] Consolidation failed for user ${user.user_id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('[Scheduled] Cron job failed:', error);
    }
  },
};
