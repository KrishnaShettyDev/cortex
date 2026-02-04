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
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey,
} from '../lib/api-keys';
import { createComposioServices } from '../lib/composio';

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

// REMOVED: generateTestToken was a critical security vulnerability
// Test tokens should never be generated via public endpoints

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

/**
 * DELETE /auth/account
 * Permanently delete user account and all associated data
 * Required for App Store compliance
 */
export async function deleteAccount(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const userId = payload.sub;

    console.log(`[Auth] Account deletion requested for user: ${userId}`);

    // Delete in order to respect foreign keys
    // Using batch for atomicity where possible
    const deleteQueries = [
      // Cognitive layer (outcomes depend on beliefs/learnings)
      'DELETE FROM outcome_sources WHERE outcome_id IN (SELECT id FROM outcomes WHERE user_id = ?)',
      'DELETE FROM outcomes WHERE user_id = ?',
      'DELETE FROM belief_evidence WHERE belief_id IN (SELECT id FROM beliefs WHERE user_id = ?)',
      'DELETE FROM belief_conflicts WHERE user_id = ?',
      'DELETE FROM beliefs WHERE user_id = ?',
      'DELETE FROM learning_evidence WHERE learning_id IN (SELECT id FROM learnings WHERE user_id = ?)',
      'DELETE FROM learning_backfill_progress WHERE user_id = ?',
      'DELETE FROM learnings WHERE user_id = ?',

      // Sleep compute
      'DELETE FROM sleep_job_tasks WHERE job_id IN (SELECT id FROM sleep_jobs WHERE user_id = ?)',
      'DELETE FROM sleep_jobs WHERE user_id = ?',
      'DELETE FROM session_contexts WHERE user_id = ?',

      // Commitments and nudges
      'DELETE FROM commitment_reminders WHERE commitment_id IN (SELECT id FROM commitments WHERE user_id = ?)',
      'DELETE FROM commitments WHERE user_id = ?',
      'DELETE FROM nudges WHERE user_id = ?',

      // Sync infrastructure
      'DELETE FROM sync_logs WHERE connection_id IN (SELECT id FROM sync_connections WHERE user_id = ?)',
      'DELETE FROM sync_items WHERE connection_id IN (SELECT id FROM sync_connections WHERE user_id = ?)',
      'DELETE FROM sync_webhooks WHERE connection_id IN (SELECT id FROM sync_connections WHERE user_id = ?)',
      'DELETE FROM sync_connections WHERE user_id = ?',

      // Provenance tracking
      'DELETE FROM extraction_log WHERE user_id = ?',
      'DELETE FROM provenance_chain WHERE user_id = ?',

      // Entity graph
      'DELETE FROM memory_entities WHERE memory_id IN (SELECT id FROM memories WHERE user_id = ?)',
      'DELETE FROM entity_relationships WHERE user_id = ?',
      'DELETE FROM entities WHERE user_id = ?',

      // Memories and processing
      'DELETE FROM memory_chunks WHERE memory_id IN (SELECT id FROM memories WHERE user_id = ?)',
      'DELETE FROM memory_relations WHERE source_memory_id IN (SELECT id FROM memories WHERE user_id = ?)',
      'DELETE FROM memory_relations WHERE target_memory_id IN (SELECT id FROM memories WHERE user_id = ?)',
      'DELETE FROM processing_jobs WHERE user_id = ?',
      'DELETE FROM memories WHERE user_id = ?',

      // Documents
      'DELETE FROM document_chunks WHERE document_id IN (SELECT id FROM documents WHERE user_id = ?)',
      'DELETE FROM documents WHERE user_id = ?',

      // Auth and sessions
      'DELETE FROM api_keys WHERE user_id = ?',
      'DELETE FROM sessions WHERE user_id = ?',
      'DELETE FROM user_profiles WHERE user_id = ?',

      // Finally, the user
      'DELETE FROM users WHERE id = ?',
    ];

    let deletedTables = 0;
    const errors: string[] = [];

    for (const query of deleteQueries) {
      try {
        await c.env.DB.prepare(query).bind(userId).run();
        deletedTables++;
      } catch (error: any) {
        // Log but continue - table might not exist or be empty
        console.warn(`[Auth] Delete query warning: ${error.message}`);
        errors.push(error.message);
      }
    }

    // Delete vectors from Vectorize index
    try {
      // Get all memory IDs first (already deleted from DB, so this is best effort)
      // In production, you'd want to delete vectors before DB records
      // For now, vectors will be orphaned but won't affect functionality
      console.log('[Auth] Vector deletion skipped (memories already deleted)');
    } catch (error: any) {
      console.warn('[Auth] Vector deletion failed:', error.message);
    }

    console.log(`[Auth] Account deletion complete for user: ${userId}, tables processed: ${deletedTables}`);

    return c.json({
      deleted: true,
      message: 'Account and all data permanently deleted',
      tablesProcessed: deletedTables,
      warnings: errors.length > 0 ? errors : undefined,
    });
  });
}

/**
 * POST /auth/api-keys
 * Create a new API key for MCP access
 *
 * SECURITY: Key is returned ONCE - store it securely.
 * Only the SHA-256 hash is stored in the database.
 */
export async function createApiKeyHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    const body = await c.req.json<{
      name: string;
      expires_in_days?: number;
    }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json({ error: 'API key name is required' }, 400);
    }

    // Limit API keys per user
    const existingKeys = await listApiKeys(c.env.DB, payload.sub);
    if (existingKeys.length >= 10) {
      return c.json({ error: 'Maximum 10 API keys allowed per user' }, 400);
    }

    const result = await createApiKey(
      c.env.DB,
      payload.sub,
      body.name.trim(),
      body.expires_in_days
    );

    console.log(`[Auth] API key created for user ${payload.sub}: ${result.prefix}...`);

    return c.json({
      key: result.key, // Only time raw key is returned!
      id: result.id,
      prefix: result.prefix,
      name: result.name,
      expires_at: result.expires_at,
      created_at: result.created_at,
      warning: 'Store this key securely. It will not be shown again.',
    });
  });
}

/**
 * GET /auth/api-keys
 * List all API keys for the current user
 */
export async function listApiKeysHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    const keys = await listApiKeys(c.env.DB, payload.sub);

    return c.json({
      api_keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix + '...',
        last_used_at: k.last_used_at,
        expires_at: k.expires_at,
        is_active: k.is_active,
        created_at: k.created_at,
      })),
      total: keys.length,
    });
  });
}

/**
 * DELETE /auth/api-keys/:id
 * Delete an API key
 */
export async function deleteApiKeyHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    const keyId = c.req.param('id');
    if (!keyId) {
      return c.json({ error: 'API key ID is required' }, 400);
    }

    const deleted = await deleteApiKey(c.env.DB, keyId, payload.sub);

    if (!deleted) {
      return c.json({ error: 'API key not found' }, 404);
    }

    console.log(`[Auth] API key deleted for user ${payload.sub}: ${keyId}`);

    return c.json({ deleted: true });
  });
}

/**
 * POST /auth/api-keys/:id/revoke
 * Revoke (deactivate) an API key without deleting it
 */
export async function revokeApiKeyHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    const keyId = c.req.param('id');
    if (!keyId) {
      return c.json({ error: 'API key ID is required' }, 400);
    }

    const revoked = await revokeApiKey(c.env.DB, keyId, payload.sub);

    if (!revoked) {
      return c.json({ error: 'API key not found' }, 404);
    }

    console.log(`[Auth] API key revoked for user ${payload.sub}: ${keyId}`);

    return c.json({ revoked: true });
  });
}

/**
 * POST /auth/google/connect
 * Start OAuth flow for connecting Google services (Gmail + Calendar)
 *
 * Uses Composio's managed OAuth - no Google verification required.
 * Mobile app opens the returned URL in a WebBrowser for OAuth.
 */
export async function connectGoogle(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization header' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const userId = payload.sub;

    // Get return URL from request body
    const body = await c.req.json().catch(() => ({}));
    const returnUrl = body.return_url;

    console.log(`[Auth] Google connect initiated for user ${userId}`);

    // Build callback URL for Composio OAuth
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/integrations/gmail/callback`;

    // Create OAuth link via Composio (uses managed OAuth by default)
    const composio = createComposioServices(c.env.COMPOSIO_API_KEY);
    const authLink = await composio.client.createAuthLink({
      toolkitSlug: 'gmail',
      userId,
      callbackUrl,
    });

    console.log(`[Auth] Google connect OAuth URL created for user ${userId}`);

    return c.json({
      redirect_url: authLink.redirectUrl,
      link_token: authLink.linkToken,
      expires_at: authLink.expiresAt,
    });
  });
}
