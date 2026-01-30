/**
 * Cortex Edge API - Cloudflare Workers
 * Fast, global, simple
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { jwt } from 'hono/jwt';

type Bindings = {
  DB: D1Database;
  VECTORIZE: Vectorize;
  MEDIA: R2Bucket;
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  COMPOSIO_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (public)
app.post('/auth/apple', async (c) => {
  // Apple Sign In
  return c.json({ message: 'Apple auth not implemented yet' }, 501);
});

app.post('/auth/google', async (c) => {
  // Google Sign In
  return c.json({ message: 'Google auth not implemented yet' }, 501);
});

// Protected routes
app.use('/api/*', jwt({ secret: (c) => c.env.JWT_SECRET }));

// Memory routes
app.get('/api/memories', async (c) => {
  const userId = c.get('jwtPayload').sub;

  // Query D1
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(userId).all();

  return c.json({ memories: results });
});

app.post('/api/memories', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const body = await c.json();

  // Create memory
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO memories (id, user_id, content, created_at) VALUES (?, ?, ?, ?)'
  ).bind(id, userId, body.content, new Date().toISOString()).run();

  return c.json({ id, message: 'Memory created' }, 201);
});

// Search route
app.post('/api/search', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { query } = await c.json();

  // Will implement vector search with Vectorize
  return c.json({ results: [], message: 'Search not implemented yet' }, 501);
});

// Chat route
app.post('/api/chat', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { message } = await c.json();

  // Will implement chat with memory context
  return c.json({ response: 'Chat not implemented yet' }, 501);
});

export default app;
