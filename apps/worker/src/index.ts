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

// Protected routes
app.use('/api/*', async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' });
  return jwtMiddleware(c, next);
});

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
  const body = await c.req.json();

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
  const { query } = await c.req.json();

  // Will implement vector search with Vectorize
  return c.json({ results: [], message: 'Search not implemented yet' }, 501);
});

// Chat route
app.post('/api/chat', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { message } = await c.req.json();

  // Will implement chat with memory context
  return c.json({ response: 'Chat not implemented yet' }, 501);
});

export default app;
