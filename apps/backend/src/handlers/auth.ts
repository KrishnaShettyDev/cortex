/**
 * Authentication route handlers
 */

import type { Context } from 'hono';
import type { Bindings, AuthResponse, UserResponse } from '../types';
import {
  verifyAppleToken,
  verifyGoogleToken,
  getOrCreateUser,
  generateTokens,
  storeRefreshToken,
  verifyToken,
} from '../auth';
import { handleError } from '../utils/errors';

/**
 * Shared OAuth authentication flow
 */
async function handleOAuthLogin(
  c: Context<{ Bindings: Bindings }>,
  provider: 'apple' | 'google',
  verifyFn: (token: string, ...args: any[]) => Promise<{
    sub: string;
    email: string;
    name?: string;
  }>
): Promise<Response> {
  const body = await c.req.json();
  const token = provider === 'apple' ? body.identityToken : body.idToken;

  if (!token) {
    return c.json({ error: `${provider} token is required` }, 400);
  }

  // Verify token
  const verified =
    provider === 'google'
      ? await verifyFn(token, c.env.GOOGLE_CLIENT_ID || '266293132252-ks0f0m30egbekl2jhtqnqv8r8olfub4q.apps.googleusercontent.com')
      : await verifyFn(token);

  // Extract name for Apple (only on first sign-in)
  let name = verified.name;
  if (provider === 'apple' && body.user?.name) {
    const { givenName, familyName } = body.user.name;
    name = [givenName, familyName].filter(Boolean).join(' ');
  }

  // Get or create user
  const user = await getOrCreateUser(
    c.env.DB,
    provider,
    verified.sub,
    verified.email,
    name
  );

  // Generate tokens
  const tokens = await generateTokens(
    user.id,
    user.email,
    user.name,
    c.env.JWT_SECRET
  );

  // Store refresh token
  await storeRefreshToken(c.env.DB, user.id, tokens.refresh_token);

  const response: AuthResponse = {
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };

  return c.json(response);
}

export async function appleLogin(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, () =>
    handleOAuthLogin(c, 'apple', verifyAppleToken)
  );
}

export async function googleLogin(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, () =>
    handleOAuthLogin(c, 'google', verifyGoogleToken)
  );
}

export async function refreshToken(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
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

    // Check database
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
  });
}

/**
 * TEMPORARY: Generate a test token for development
 * WARNING: This is a convenience endpoint for testing. Remove in production.
 */
export async function generateTestToken(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    // Use existing plutaslab user
    const testUserId = '79f149ea-6c24-45df-a029-fc1483fe1192';
    const testEmail = 'plutaslab@gmail.com';
    const testName = 'Plutas Lab';

    // Generate 24h access token
    const tokens = await generateTokens(
      testUserId,
      testEmail,
      testName,
      c.env.JWT_SECRET
    );

    return c.json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      user: {
        id: testUserId,
        email: testEmail,
        name: testName,
      },
      note: 'DEVELOPMENT ONLY: Use this token to generate a long-lived API key via POST /auth/api-key',
      warning: 'This endpoint should be removed before public launch',
    });
  });
}

/**
 * Generate a long-lived API key for testing/development
 */
export async function generateApiKey(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // Generate a long-lived token (1 year)
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);

    const apiKey = await new SignJWT({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      type: 'api_key',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1y')
      .sign(secret);

    return c.json({
      api_key: apiKey,
      expires_in: 31536000, // 1 year in seconds
      note: 'This is a long-lived API key for testing. Keep it secure.',
    });
  });
}

export async function getCurrentUser(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    const user = await c.env.DB.prepare(
      'SELECT id, email, name, created_at FROM users WHERE id = ?'
    )
      .bind(payload.sub)
      .first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const response: UserResponse = {
      id: user.id as string,
      email: user.email as string,
      name: user.name as string | undefined,
      created_at: user.created_at as string,
    };

    return c.json(response);
  });
}
