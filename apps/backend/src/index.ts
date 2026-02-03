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
import consolidationRouter from './handlers/consolidation';
import commitmentsRouter from './handlers/commitments';
import relationshipRouter from './handlers/relationship';
import performanceRouter from './handlers/performance';
import learningsRouter from './handlers/learnings';
import beliefsRouter from './handlers/beliefs';
import outcomesRouter from './handlers/outcomes';
import sleepRouter from './handlers/sleep';
import briefingRouter from './handlers/briefing';
import { SyncOrchestrator } from './lib/sync/orchestrator';
import { handleSleepComputeCron } from './lib/cognitive/sleep/cron';
import { ConsolidationPipeline } from './lib/consolidation/consolidation-pipeline';
import { tenantScopeMiddleware, tenantAuditMiddleware, tenantRateLimitMiddleware } from './lib/multi-tenancy/middleware';
import { PerformanceTimer, logPerformance, trackPerformanceMetrics } from './lib/monitoring/performance';
import { handleUncaughtError } from './lib/monitoring/errors';
import { handleQueueBatch, type QueueEnv } from './lib/queue/consumer';
import type { QueueMessage } from './lib/queue/producer';
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
    ];
    // Allow localhost only in development (check ENVIRONMENT variable)
    if (origin && allowedOrigins.includes(origin)) {
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
        generate_api_key: '/auth/api-key (POST, requires auth)',
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
        learnings: {
          list: '/v3/learnings',
          get: '/v3/learnings/:id',
          profile: '/v3/learnings/profile',
          categories: '/v3/learnings/categories',
          validate: '/v3/learnings/:id/validate',
          invalidate: '/v3/learnings/:id/invalidate',
          backfill: '/v3/learnings/backfill (POST to start, GET for progress)',
          backfill_pause: '/v3/learnings/backfill/pause',
        },
        beliefs: {
          list: '/v3/beliefs',
          get: '/v3/beliefs/:id',
          stats: '/v3/beliefs/stats',
          conflicts: '/v3/beliefs/conflicts',
          form: '/v3/beliefs/form (POST - form beliefs from learnings)',
          add_evidence: '/v3/beliefs/:id/evidence (POST)',
          update: '/v3/beliefs/:id/update (POST - Bayesian update)',
          invalidate: '/v3/beliefs/:id/invalidate (POST)',
          resolve_conflict: '/v3/beliefs/conflicts/:id/resolve (POST)',
        },
        outcomes: {
          intelligent_recall: '/v3/recall/intelligent (POST - recall with tracking)',
          list: '/v3/outcomes',
          get: '/v3/outcomes/:id',
          stats: '/v3/outcomes/stats',
          reasoning: '/v3/outcomes/:id/reasoning',
          feedback: '/v3/outcomes/:id/feedback (POST)',
          propagate: '/v3/outcomes/:id/propagate (POST)',
          propagate_pending: '/v3/outcomes/propagate-pending (POST)',
        },
        sleep: {
          run: '/v3/sleep/run (POST - trigger sleep compute manually)',
          jobs: '/v3/sleep/jobs',
          job_detail: '/v3/sleep/jobs/:id',
          context: '/v3/sleep/context (pre-computed session context)',
          stats: '/v3/sleep/stats',
        },
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

// API key generation (protected)
app.use('/auth/api-key', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});
app.post('/auth/api-key', authHandlers.generateApiKey);

// Account deletion (protected) - App Store compliance
app.use('/auth/account', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});
app.delete('/auth/account', authHandlers.deleteAccount);

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

// Protected middleware
app.use('/api/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

app.use('/integrations/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

// Protected routes - Memories
app.get('/api/memories', memoryHandlers.listMemories);
app.get('/api/memories/:id', memoryHandlers.getMemoryById);
app.post('/api/memories', memoryHandlers.createNewMemory);
app.patch('/api/memories/:id', memoryHandlers.updateExistingMemory);
app.delete('/api/memories/:id', memoryHandlers.deleteExistingMemory);
app.post('/api/search', memoryHandlers.search);
app.post('/api/chat', memoryHandlers.chatWithMemories);

// Protected routes - Integrations
app.get('/integrations/status', integrationHandlers.getIntegrationStatus);
app.post('/integrations/gmail/connect', integrationHandlers.connectGmail);
app.post('/integrations/calendar/connect', integrationHandlers.connectCalendar);
app.get('/integrations/gmail/callback', integrationHandlers.gmailCallback);
app.get('/integrations/calendar/callback', integrationHandlers.calendarCallback);
app.post('/integrations/gmail/sync', integrationHandlers.triggerGmailSync);
app.post('/integrations/calendar/sync', integrationHandlers.triggerCalendarSync);
app.delete('/integrations/:provider', integrationHandlers.disconnectIntegration);

// v3 API - Context Cloud (Supermemory-style)
app.use('/v3/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  await jwtMiddleware(c, next);
});

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
app.post('/v3/search', validateBody(searchSchema), contextHandlers.search);
app.post('/v3/recall', validateBody(recallSchema), contextHandlers.recall);
app.get('/v3/profile', contextHandlers.getProfile);

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

// Cognitive layer endpoints (learnings)
app.route('/v3/learnings', learningsRouter);

// Cognitive layer endpoints (beliefs - Bayesian system)
app.route('/v3/beliefs', beliefsRouter);

// Cognitive layer endpoints (outcomes - learning loop)
app.route('/v3/outcomes', outcomesRouter);
app.route('/v3/recall', outcomesRouter);

// Sleep compute endpoints
app.route('/v3/sleep', sleepRouter);

// Briefing endpoint (consolidated mobile home screen data)
app.route('/v3/briefing', briefingRouter);

// Upload endpoints (audio transcription, text)
app.post('/v3/upload/audio', uploadHandlers.uploadAudio);
app.post('/v3/upload/text', uploadHandlers.uploadText);

// Sync infrastructure endpoints
app.get('/v3/sync/connections', syncHandlers.listSyncConnectionsHandler);
app.post('/v3/sync/connections', syncHandlers.createSyncConnectionHandler);
app.patch('/v3/sync/connections/:id', syncHandlers.updateSyncConnectionHandler);
app.delete('/v3/sync/connections/:id', syncHandlers.deleteSyncConnectionHandler);
app.post('/v3/sync/connections/:id/sync', syncHandlers.triggerManualSyncHandler);
app.get('/v3/sync/connections/:id/logs', syncHandlers.getSyncLogsHandler);
app.get('/v3/sync/status', syncHandlers.getSyncStatusHandler);

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
      // Run scheduled syncs (every 5 minutes for realtime, hourly for others)
      if (event.cron === '*/5 * * * *') {
        const orchestrator = new SyncOrchestrator(env);
        const results = await orchestrator.runScheduledSyncs();
        console.log(`[Scheduled] Syncs completed: ${results.synced} synced, ${results.failed} failed`);
      }

      // Run sleep compute (3am, 9am, 3pm, 9pm UTC)
      if (['0 3 * * *', '0 9 * * *', '0 15 * * *', '0 21 * * *'].includes(event.cron)) {
        console.log('[Scheduled] Running sleep compute');
        await handleSleepComputeCron(env);
      }

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
