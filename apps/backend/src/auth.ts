/**
 * Auth utilities for Apple Sign In and Google Sign In
 */

import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

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

// Apple's JWKS endpoint for cryptographic verification
const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys')
);

// Valid Apple bundle IDs for your app
const APPLE_VALID_AUDIENCES = [
  'in.plutas.cortex',
  'com.plutas.cortex',
];

/**
 * Verify Apple ID token with REAL cryptographic signature verification
 * Uses Apple's public keys from https://appleid.apple.com/auth/keys
 */
export async function verifyAppleToken(identityToken: string): Promise<{
  sub: string;
  email: string;
}> {
  try {
    // Verify the token signature using Apple's public keys
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: APPLE_VALID_AUDIENCES,
    });

    // Validate required claims
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Missing or invalid sub claim');
    }
    if (!payload.email || typeof payload.email !== 'string') {
      throw new Error('Missing or invalid email claim');
    }

    // Additional security: check token age (auth_time)
    const authTime = payload.auth_time as number | undefined;
    if (authTime) {
      const now = Math.floor(Date.now() / 1000);
      const maxAge = 24 * 60 * 60; // 24 hours
      if (now - authTime > maxAge) {
        throw new Error('Token auth_time too old');
      }
    }

    return {
      sub: payload.sub,
      email: payload.email,
    };
  } catch (error: any) {
    // Log for debugging but don't expose internal details
    console.error('Apple token verification failed:', error.message);
    throw new Error('Invalid Apple identity token');
  }
}

// Google's JWKS endpoint for cryptographic verification
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

// Valid Google OAuth client IDs (should be environment variables in production)
const GOOGLE_VALID_CLIENT_IDS = [
  '266293132252-ks0f0m30egbekl2jhtqnqv8r8olfub4q.apps.googleusercontent.com', // iOS
  '266293132252-ce19t4pktv5t8o5k34rito52r4opi7rk.apps.googleusercontent.com', // Web
  '266293132252-tu55j8qrfi96n15jntgbinpnj3cnh9si.apps.googleusercontent.com', // Android
];

/**
 * Verify Google ID token with REAL cryptographic signature verification
 * Uses Google's public keys from https://www.googleapis.com/oauth2/v3/certs
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
  try {
    // Build valid audience list including provided clientId
    const validAudiences = [...new Set([clientId, ...GOOGLE_VALID_CLIENT_IDS])];

    // Verify the token signature using Google's public keys
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: validAudiences,
    });

    // Validate required claims
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Missing or invalid sub claim');
    }
    if (!payload.email || typeof payload.email !== 'string') {
      throw new Error('Missing or invalid email claim');
    }

    // Verify email is verified (important security check)
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      throw new Error('Google email not verified');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
    };
  } catch (error: any) {
    // Log for debugging but don't expose internal details
    console.error('Google token verification failed:', error.message);
    throw new Error('Invalid Google identity token');
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
