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

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes
app.post('/auth/apple', authHandlers.appleLogin);
app.post('/auth/google', authHandlers.googleLogin);
app.post('/auth/refresh', authHandlers.refreshToken);
app.get('/auth/me', authHandlers.getCurrentUser);

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
app.get('/integrations/google/connect', integrationHandlers.connectGoogle);

export default app;
