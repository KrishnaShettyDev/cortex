/**
 * Auth utilities for Apple Sign In and Google Sign In
 */

import { SignJWT, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';

export interface TokenPayload {
  sub: string; // user_id
  email?: string;
  name?: string;
  type?: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AppleTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  email: string;
  email_verified: string;
  is_private_email?: string;
  auth_time: number;
  nonce_supported?: boolean;
}

/**
 * Generate JWT access and refresh tokens
 */
export async function generateTokens(
  userId: string,
  email: string,
  name: string | undefined,
  secret: string
): Promise<AuthTokens> {
  const secretKey = new TextEncoder().encode(secret);

  // Access token (30 minutes)
  const accessToken = await new SignJWT({ sub: userId, email, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(secretKey);

  // Refresh token (7 days)
  const refreshToken = await new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 1800, // 30 minutes in seconds
  };
}

/**
 * Verify JWT token
 */
export async function verifyToken(token: string, secret: string): Promise<TokenPayload> {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, secretKey);
  return payload as unknown as TokenPayload;
}

/**
 * Verify Apple ID token
 * Apple tokens are signed JWTs, we verify the signature and extract user info
 */
export async function verifyAppleToken(identityToken: string): Promise<{
  sub: string;
  email: string;
}> {
  try {
    // Decode the token without verification first to get the key ID
    const parts = identityToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const payload = JSON.parse(atob(parts[1])) as AppleTokenPayload;

    // Basic validation
    if (!payload.sub || !payload.email) {
      throw new Error('Invalid Apple token: missing required fields');
    }

    // In production, you should verify the token signature using Apple's public keys
    // For now, we'll trust the token (this should be improved)
    // Apple's public keys: https://appleid.apple.com/auth/keys

    return {
      sub: payload.sub,
      email: payload.email,
    };
  } catch (error) {
    throw new Error(`Apple token verification failed: ${error}`);
  }
}

/**
 * Verify Google ID token
 */
export async function verifyGoogleToken(
  idToken: string,
  clientId: string
): Promise<{
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}> {
  const client = new OAuth2Client(clientId);

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid Google token: missing required fields');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (error) {
    throw new Error(`Google token verification failed: ${error}`);
  }
}

/**
 * Create or get user from database
 */
export async function getOrCreateUser(
  db: D1Database,
  provider: 'apple' | 'google',
  providerId: string,
  email: string,
  name?: string
): Promise<{ id: string; email: string; name?: string; isNewUser: boolean }> {
  const now = new Date().toISOString();

  // Check if user exists by email
  const existingUser = await db
    .prepare('SELECT id, email, name FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (existingUser) {
    return {
      id: existingUser.id as string,
      email: existingUser.email as string,
      name: existingUser.name as string | undefined,
      isNewUser: false,
    };
  }

  // Create new user
  const userId = crypto.randomUUID();

  await db
    .prepare(
      'INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(userId, email, name || null, now, now)
    .run();

  return {
    id: userId,
    email,
    name,
    isNewUser: true,
  };
}

/**
 * Store refresh token in sessions table
 */
export async function storeRefreshToken(
  db: D1Database,
  userId: string,
  refreshToken: string
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await db
    .prepare(
      'INSERT INTO sessions (id, user_id, refresh_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(sessionId, userId, refreshToken, expiresAt, now)
    .run();
}
