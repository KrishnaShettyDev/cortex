/**
 * Cortex Edge API - Cloudflare Workers
 * Fast, global, simple
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { jwt } from 'hono/jwt';
import {
  verifyAppleToken,
  verifyGoogleToken,
  getOrCreateUser,
  generateTokens,
  storeRefreshToken,
  verifyToken,
} from './auth';
import {
  createMemory,
  getMemory,
  getMemories,
  updateMemory,
  deleteMemory,
  searchMemories,
} from './memory';
import { chat, chatWithHistory } from './chat';

type Bindings = {
  DB: D1Database;
  VECTORIZE: Vectorize;
  MEDIA: R2Bucket;
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  COMPOSIO_API_KEY: string;
  GOOGLE_CLIENT_ID?: string;
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
  try {
    const body = await c.req.json();
    const { identityToken, user: appleUser } = body;

    if (!identityToken) {
      return c.json({ error: 'Identity token is required' }, 400);
    }

    // Verify Apple ID token
    const { sub: appleSub, email } = await verifyAppleToken(identityToken);

    // Extract name from Apple user object (only provided on first sign-in)
    let name: string | undefined;
    if (appleUser?.name) {
      const { givenName, familyName } = appleUser.name;
      name = [givenName, familyName].filter(Boolean).join(' ');
    }

    // Create or get user
    const user = await getOrCreateUser(
      c.env.DB,
      'apple',
      appleSub,
      email,
      name
    );

    // Generate JWT tokens
    const tokens = await generateTokens(
      user.id,
      user.email,
      user.name,
      c.env.JWT_SECRET
    );

    // Store refresh token
    await storeRefreshToken(c.env.DB, user.id, tokens.refresh_token);

    return c.json({
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Apple auth error:', error);
    return c.json(
      { error: 'Authentication failed', details: error instanceof Error ? error.message : 'Unknown error' },
      401
    );
  }
});

app.post('/auth/google', async (c) => {
  try {
    const body = await c.req.json();
    const { idToken } = body;

    if (!idToken) {
      return c.json({ error: 'ID token is required' }, 400);
    }

    // Get Google client ID from environment or use default iOS client ID
    const googleClientId =
      c.env.GOOGLE_CLIENT_ID ||
      '266293132252-ks0f0m30egbekl2jhtqnqv8r8olfub4q.apps.googleusercontent.com';

    // Verify Google ID token
    const { sub: googleSub, email, name } = await verifyGoogleToken(
      idToken,
      googleClientId
    );

    // Create or get user
    const user = await getOrCreateUser(
      c.env.DB,
      'google',
      googleSub,
      email,
      name
    );

    // Generate JWT tokens
    const tokens = await generateTokens(
      user.id,
      user.email,
      user.name,
      c.env.JWT_SECRET
    );

    // Store refresh token
    await storeRefreshToken(c.env.DB, user.id, tokens.refresh_token);

    return c.json({
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return c.json(
      { error: 'Authentication failed', details: error instanceof Error ? error.message : 'Unknown error' },
      401
    );
  }
});

// Refresh token endpoint
app.post('/auth/refresh', async (c) => {
  try {
    const body = await c.req.json();
    const { refresh_token } = body;

    if (!refresh_token) {
      return c.json({ error: 'Refresh token is required' }, 400);
    }

    // Verify refresh token
    const payload = await verifyToken(refresh_token, c.env.JWT_SECRET);

    if (payload.type !== 'refresh') {
      return c.json({ error: 'Invalid token type' }, 401);
    }

    // Check if refresh token exists in database
    const session = await c.env.DB.prepare(
      'SELECT s.*, u.email, u.name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.refresh_token = ? AND s.expires_at > ?'
    )
      .bind(refresh_token, new Date().toISOString())
      .first();

    if (!session) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    // Generate new access token
    const tokens = await generateTokens(
      session.user_id as string,
      session.email as string,
      session.name as string | undefined,
      c.env.JWT_SECRET
    );

    return c.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return c.json(
      { error: 'Token refresh failed', details: error instanceof Error ? error.message : 'Unknown error' },
      401
    );
  }
});

// Get current user (used by mobile app)
app.get('/auth/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // Get user from database
    const user = await c.env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .bind(payload.sub)
      .first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
    });
  } catch (error) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
});

// Protected routes
app.use('/api/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

// Legacy endpoints for mobile app compatibility
app.use('/chat/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

app.use('/integrations/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

// Memory routes
app.get('/api/memories', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const source = c.req.query('source');

    const result = await getMemories(c.env.DB, userId, {
      limit,
      offset,
      source: source || undefined,
    });

    return c.json(result);
  } catch (error) {
    console.error('Get memories error:', error);
    return c.json(
      { error: 'Failed to fetch memories', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

app.get('/api/memories/:id', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');

    const memory = await getMemory(c.env.DB, memoryId, userId);

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    return c.json(memory);
  } catch (error) {
    console.error('Get memory error:', error);
    return c.json(
      { error: 'Failed to fetch memory', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

app.post('/api/memories', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json();

    const memory = await createMemory(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.OPENAI_API_KEY
    );

    return c.json(memory, 201);
  } catch (error) {
    console.error('Create memory error:', error);
    return c.json(
      { error: 'Failed to create memory', details: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

app.patch('/api/memories/:id', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');
    const body = await c.req.json();

    const memory = await updateMemory(
      c.env.DB,
      c.env.VECTORIZE,
      memoryId,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.OPENAI_API_KEY
    );

    return c.json(memory);
  } catch (error) {
    console.error('Update memory error:', error);
    return c.json(
      { error: 'Failed to update memory', details: error instanceof Error ? error.message : 'Unknown error' },
      error instanceof Error && error.message === 'Memory not found' ? 404 : 400
    );
  }
});

app.delete('/api/memories/:id', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const memoryId = c.req.param('id');

    await deleteMemory(c.env.DB, c.env.VECTORIZE, memoryId, userId);

    return c.json({ message: 'Memory deleted successfully' });
  } catch (error) {
    console.error('Delete memory error:', error);
    return c.json(
      { error: 'Failed to delete memory', details: error instanceof Error ? error.message : 'Unknown error' },
      error instanceof Error && error.message === 'Memory not found' ? 404 : 500
    );
  }
});

// Search route
app.post('/api/search', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const { query, limit, source } = await c.req.json();

    if (!query || query.trim().length === 0) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    const results = await searchMemories(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      query,
      c.env.OPENAI_API_KEY,
      {
        limit: limit || 10,
        source: source || undefined,
      }
    );

    return c.json({ results, count: results.length });
  } catch (error) {
    console.error('Search error:', error);
    return c.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

// Chat route
app.post('/api/chat', async (c) => {
  try {
    const userId = c.get('jwtPayload').sub;
    const { message, history, model, contextLimit } = await c.req.json();

    if (!message || message.trim().length === 0) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // Use chatWithHistory if history is provided, otherwise use simple chat
    const result = history
      ? await chatWithHistory(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          history,
          c.env.OPENAI_API_KEY,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
          }
        )
      : await chat(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          c.env.OPENAI_API_KEY,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
          }
        );

    return c.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    return c.json(
      { error: 'Chat failed', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

// Legacy chat endpoints (stub responses for mobile app compatibility)
app.get('/chat/greeting', async (c) => {
  return c.json({
    greeting: "Welcome back!",
    contextual_message: null,
  });
});

app.get('/chat/suggestions', async (c) => {
  return c.json({
    suggestions: [],
  });
});

app.get('/chat/insights', async (c) => {
  return c.json({
    total_attention_needed: 0,
    urgent_emails: 0,
    pending_commitments: 0,
    important_dates: 0,
  });
});

app.get('/chat/briefing', async (c) => {
  return c.json({
    summary: "Your day looks good!",
    sections: [],
  });
});

// Integrations endpoints
app.get('/integrations/status', async (c) => {
  const userId = c.get('jwtPayload').sub;

  const integrations = await c.env.DB.prepare(
    'SELECT provider, connected, email, last_sync FROM integrations WHERE user_id = ?'
  )
    .bind(userId)
    .all();

  return c.json({
    google: integrations.results?.find((i: any) => i.provider === 'google') || {
      connected: false,
      email: null,
      last_sync: null,
    },
    apple: integrations.results?.find((i: any) => i.provider === 'apple') || {
      connected: false,
      email: null,
      last_sync: null,
    },
  });
});

app.get('/integrations/google/connect', async (c) => {
  // TODO: Implement OAuth flow with Composio
  return c.json({ error: 'Integration not yet implemented' }, 501);
});

export default app;
