/**
 * AES-256-GCM Encryption for Sensitive Data at Rest
 *
 * Used for encrypting OAuth tokens, API keys, and other sensitive data
 * stored in D1. Key comes from Cloudflare Worker secret: ENCRYPTION_KEY
 *
 * Format: v1:base64(iv):base64(ciphertext)
 * - v1 = key version (for future key rotation)
 * - iv = 12-byte random initialization vector
 * - ciphertext = AES-256-GCM encrypted data with auth tag
 */

import type { D1Database } from '@cloudflare/workers-types';

const CURRENT_KEY_VERSION = 'v1';

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - The string to encrypt
 * @param key - 32-byte hex-encoded encryption key
 * @returns Encrypted string in format: v1:base64(iv):base64(ciphertext)
 */
export async function encrypt(plaintext: string, key: string): Promise<string> {
  const keyBytes = hexToBytes(key);
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  // Generate random 12-byte IV (96 bits, recommended for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  );

  // Format: version:iv:ciphertext (all base64)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ciphertextB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

  return `${CURRENT_KEY_VERSION}:${ivB64}:${ciphertextB64}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param encrypted - Encrypted string in format: v1:base64(iv):base64(ciphertext)
 * @param key - 32-byte hex-encoded encryption key
 * @returns Decrypted plaintext string
 */
export async function decrypt(encrypted: string, key: string): Promise<string> {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected v1:iv:ciphertext');
  }

  const [version, ivB64, ciphertextB64] = parts;

  // Version check (for future key rotation support)
  if (version !== 'v1') {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const keyBytes = hexToBytes(key);
  if (keyBytes.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex characters)');
  }

  // Decode IV and ciphertext from base64
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));

  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Get access token for an integration, handling both encrypted and plaintext
 *
 * During migration:
 * 1. If encrypted_access_token exists, decrypt and return
 * 2. If only plaintext access_token exists, encrypt it (lazy migration) and return
 * 3. Return null if neither exists
 *
 * @param db - D1 database instance
 * @param userId - User ID
 * @param provider - Integration provider (e.g., 'google_super', 'google')
 * @param encryptionKey - 32-byte hex encryption key
 */
export async function getAccessToken(
  db: D1Database,
  userId: string,
  provider: string,
  encryptionKey: string
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT id, access_token, encrypted_access_token
    FROM integrations
    WHERE user_id = ? AND provider = ? AND connected = 1
  `).bind(userId, provider).first<{
    id: string;
    access_token: string | null;
    encrypted_access_token: string | null;
  }>();

  if (!row) return null;

  // Prefer encrypted if available
  if (row.encrypted_access_token) {
    try {
      return await decrypt(row.encrypted_access_token, encryptionKey);
    } catch (error) {
      console.error(`[Crypto] Failed to decrypt token for user=${userId} provider=${provider}:`, error);
      // Fall back to plaintext if available (during migration)
      if (row.access_token) {
        console.warn(`[Crypto] Using plaintext fallback for user=${userId} provider=${provider}`);
        return row.access_token;
      }
      return null;
    }
  }

  // Legacy: plaintext token exists, encrypt it (lazy migration)
  if (row.access_token) {
    try {
      const encrypted = await encrypt(row.access_token, encryptionKey);
      // Only update if still null (avoid race condition with concurrent requests)
      await db.prepare(`
        UPDATE integrations
        SET encrypted_access_token = ?
        WHERE id = ? AND encrypted_access_token IS NULL
      `).bind(encrypted, row.id).run();
      console.log(`[Crypto] Lazy-migrated token for user=${userId} provider=${provider}`);
    } catch (error) {
      console.error(`[Crypto] Failed to lazy-migrate token:`, error);
      // Don't fail the request, just return the plaintext
    }
    return row.access_token;
  }

  return null;
}

/**
 * Get refresh token for an integration (with same migration logic)
 */
export async function getRefreshToken(
  db: D1Database,
  userId: string,
  provider: string,
  encryptionKey: string
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT id, refresh_token, encrypted_refresh_token
    FROM integrations
    WHERE user_id = ? AND provider = ? AND connected = 1
  `).bind(userId, provider).first<{
    id: string;
    refresh_token: string | null;
    encrypted_refresh_token: string | null;
  }>();

  if (!row) return null;

  if (row.encrypted_refresh_token) {
    try {
      return await decrypt(row.encrypted_refresh_token, encryptionKey);
    } catch (error) {
      console.error(`[Crypto] Failed to decrypt refresh token:`, error);
      return row.refresh_token || null;
    }
  }

  if (row.refresh_token) {
    try {
      const encrypted = await encrypt(row.refresh_token, encryptionKey);
      await db.prepare(`
        UPDATE integrations
        SET encrypted_refresh_token = ?
        WHERE id = ? AND encrypted_refresh_token IS NULL
      `).bind(encrypted, row.id).run();
    } catch (error) {
      console.error(`[Crypto] Failed to lazy-migrate refresh token:`, error);
    }
    return row.refresh_token;
  }

  return null;
}

/**
 * Store tokens for an integration (always encrypt)
 */
export async function storeTokens(
  db: D1Database,
  userId: string,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  encryptionKey: string
): Promise<void> {
  const encryptedAccess = await encrypt(accessToken, encryptionKey);
  const encryptedRefresh = refreshToken ? await encrypt(refreshToken, encryptionKey) : null;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO integrations (user_id, provider, connected, encrypted_access_token, encrypted_refresh_token, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      connected = 1,
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      updated_at = excluded.updated_at
  `).bind(userId, provider, encryptedAccess, encryptedRefresh, now, now).run();
}

/**
 * Encrypt MCP auth config
 */
export async function encryptAuthConfig(
  authConfig: Record<string, any>,
  encryptionKey: string
): Promise<string> {
  return encrypt(JSON.stringify(authConfig), encryptionKey);
}

/**
 * Decrypt MCP auth config
 */
export async function decryptAuthConfig(
  encryptedConfig: string,
  encryptionKey: string
): Promise<Record<string, any>> {
  const decrypted = await decrypt(encryptedConfig, encryptionKey);
  return JSON.parse(decrypted);
}
