/**
 * API Key Management
 *
 * Secure API key generation and verification using SHA-256 hashing.
 * Keys are generated, returned to user ONCE, then only the hash is stored.
 *
 * Format: ctx_<random32chars>
 * Example: ctx_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 */

import { nanoid } from 'nanoid';

const API_KEY_PREFIX = 'ctx_';
const API_KEY_LENGTH = 32; // 32 chars after prefix

/**
 * Generate a cryptographically secure random API key
 */
export function generateApiKey(): string {
  // nanoid uses crypto.getRandomValues which is cryptographically secure
  const randomPart = nanoid(API_KEY_LENGTH);
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Hash an API key using SHA-256
 * Uses Web Crypto API (available in Cloudflare Workers)
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Get the display prefix for an API key (for showing in UI)
 * Returns first 8 characters: "ctx_a1b2..."
 */
export function getKeyPrefix(key: string): string {
  return key.substring(0, 8);
}

/**
 * Create a new API key and store it in the database
 * Returns the raw key (shown to user ONCE) and the stored record
 */
export async function createApiKey(
  db: D1Database,
  userId: string,
  name: string,
  expiresInDays?: number
): Promise<{
  key: string; // Raw key - return to user ONCE
  id: string;
  prefix: string;
  name: string;
  expires_at: string | null;
  created_at: string;
}> {
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  const prefix = getKeyPrefix(rawKey);
  const id = nanoid();
  const now = new Date().toISOString();

  let expiresAt: string | null = null;
  if (expiresInDays) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expiresInDays);
    expiresAt = expiry.toISOString();
  }

  await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, name, prefix, expires_at, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(id, userId, keyHash, name, prefix, expiresAt, now)
    .run();

  return {
    key: rawKey, // This is the only time the raw key is available
    id,
    prefix,
    name,
    expires_at: expiresAt,
    created_at: now,
  };
}

/**
 * Verify an API key and return the associated user
 * Hashes the input and compares against stored hash
 */
export async function verifyApiKey(
  db: D1Database,
  rawKey: string
): Promise<{
  valid: boolean;
  userId?: string;
  keyId?: string;
  error?: string;
}> {
  // Basic format validation
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: 'Invalid key format' };
  }

  // Hash the input key
  const keyHash = await hashApiKey(rawKey);

  // Look up by hash
  const keyRecord = await db
    .prepare(
      `SELECT id, user_id, expires_at, is_active
       FROM api_keys
       WHERE key_hash = ?`
    )
    .bind(keyHash)
    .first<{
      id: string;
      user_id: string;
      expires_at: string | null;
      is_active: number;
    }>();

  if (!keyRecord) {
    return { valid: false, error: 'Key not found' };
  }

  if (!keyRecord.is_active) {
    return { valid: false, error: 'Key is deactivated' };
  }

  // Check expiration
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return { valid: false, error: 'Key has expired' };
  }

  // Update last_used_at (fire-and-forget)
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), keyRecord.id)
    .run()
    .catch(() => {}); // Ignore errors

  return {
    valid: true,
    userId: keyRecord.user_id,
    keyId: keyRecord.id,
  };
}

/**
 * List API keys for a user (without exposing hashes)
 */
export async function listApiKeys(
  db: D1Database,
  userId: string
): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    last_used_at: string | null;
    expires_at: string | null;
    is_active: boolean;
    created_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT id, name, prefix, last_used_at, expires_at, is_active, created_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      prefix: string;
      last_used_at: string | null;
      expires_at: string | null;
      is_active: number;
      created_at: string;
    }>();

  return (result.results || []).map((k) => ({
    ...k,
    is_active: k.is_active === 1,
  }));
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  db: D1Database,
  keyId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE api_keys SET is_active = 0 WHERE id = ? AND user_id = ?')
    .bind(keyId, userId)
    .run();

  return (result.meta?.changes || 0) > 0;
}

/**
 * Delete an API key permanently
 */
export async function deleteApiKey(
  db: D1Database,
  keyId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?')
    .bind(keyId, userId)
    .run();

  return (result.meta?.changes || 0) > 0;
}
