/**
 * Apple Push Notification Service (APNs) Client
 *
 * Sends push notifications directly to iOS devices using APNs HTTP/2 API.
 * Uses JWT authentication with ES256 signing.
 *
 * Required environment variables:
 * - APNS_KEY_ID: Key ID from Apple Developer Portal
 * - APNS_TEAM_ID: Team ID from Apple Developer Portal
 * - APNS_BUNDLE_ID: App bundle identifier (e.g., com.cortex.app)
 * - APNS_KEY_BASE64: Base64-encoded .p8 private key
 */

import { createLogger } from '../logger';

const logger = createLogger('apns');

// APNs endpoints
const APNS_PRODUCTION = 'https://api.push.apple.com';
const APNS_SANDBOX = 'https://api.sandbox.push.apple.com';

// JWT token cache (tokens are valid for 1 hour, we refresh at 50 min)
let cachedToken: { token: string; expiresAt: number } | null = null;

export interface APNsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyBase64: string;
  production?: boolean;
}

export interface APNsNotification {
  deviceToken: string;
  title: string;
  body: string;
  badge?: number;
  sound?: string;
  data?: Record<string, any>;
  category?: string;
  threadId?: string;
  /** Critical alert (requires entitlement) */
  critical?: boolean;
  /** Time-sensitive notification (iOS 15+) */
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
}

export interface APNsResult {
  success: boolean;
  apnsId?: string;
  error?: string;
  reason?: string;
  statusCode?: number;
}

/**
 * Generate JWT token for APNs authentication
 */
async function generateAPNsToken(config: APNsConfig): Promise<string> {
  // Check cache first
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }

  logger.debug('Generating new APNs JWT token');

  // Decode the base64 private key
  const privateKeyPem = atob(config.privateKeyBase64);

  // Extract the raw key data from PEM format
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const pemContents = privateKeyPem
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  // Import the key
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Create JWT header
  const header = {
    alg: 'ES256',
    kid: config.keyId,
  };

  // Create JWT payload
  const payload = {
    iss: config.teamId,
    iat: now,
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign the JWT
  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  // Convert signature to base64url (ES256 produces raw r||s format)
  const signature = base64UrlEncode(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  );

  const token = `${signingInput}.${signature}`;

  // Cache the token (expires in 1 hour)
  cachedToken = {
    token,
    expiresAt: now + 3600,
  };

  return token;
}

/**
 * Base64 URL encode (JWT-safe)
 */
function base64UrlEncode(str: string): string {
  const base64 = btoa(str);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Send push notification via APNs
 */
export async function sendAPNsNotification(
  config: APNsConfig,
  notification: APNsNotification
): Promise<APNsResult> {
  try {
    const token = await generateAPNsToken(config);
    const baseUrl = config.production ? APNS_PRODUCTION : APNS_SANDBOX;
    const url = `${baseUrl}/3/device/${notification.deviceToken}`;

    // Build APNs payload
    const aps: Record<string, any> = {
      alert: {
        title: notification.title,
        body: notification.body,
      },
    };

    if (notification.badge !== undefined) {
      aps.badge = notification.badge;
    }

    if (notification.sound) {
      aps.sound = notification.sound;
    } else {
      aps.sound = 'default';
    }

    if (notification.category) {
      aps.category = notification.category;
    }

    if (notification.threadId) {
      aps['thread-id'] = notification.threadId;
    }

    if (notification.interruptionLevel) {
      aps['interruption-level'] = notification.interruptionLevel;
    }

    if (notification.critical) {
      aps.sound = {
        critical: 1,
        name: 'default',
        volume: 1.0,
      };
    }

    // Full payload with custom data
    const payload: Record<string, any> = { aps };
    if (notification.data) {
      Object.assign(payload, notification.data);
    }

    // Set push type based on content
    const pushType = notification.data && Object.keys(notification.data).length > 0 && !notification.title
      ? 'background'
      : 'alert';

    logger.debug('Sending APNs notification', {
      deviceToken: notification.deviceToken.slice(0, 8) + '...',
      pushType,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${token}`,
        'apns-topic': config.bundleId,
        'apns-push-type': pushType,
        'apns-priority': notification.interruptionLevel === 'time-sensitive' ? '10' : '5',
        'apns-expiration': '0', // Immediate delivery only
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const apnsId = response.headers.get('apns-id') || undefined;

    if (response.ok) {
      logger.info('APNs notification sent', { apnsId });
      return { success: true, apnsId };
    }

    // Handle error response
    const errorBody = await response.json().catch(() => ({})) as { reason?: string };
    const reason = errorBody.reason || 'Unknown';

    logger.warn('APNs notification failed', {
      statusCode: response.status,
      reason,
      apnsId,
    });

    return {
      success: false,
      statusCode: response.status,
      reason,
      apnsId,
      error: `APNs error: ${response.status} - ${reason}`,
    };
  } catch (error) {
    logger.error('APNs send error', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send multiple notifications (batched)
 */
export async function sendAPNsNotifications(
  config: APNsConfig,
  notifications: APNsNotification[]
): Promise<{ results: APNsResult[]; successCount: number; failureCount: number }> {
  const results: APNsResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  // APNs prefers individual requests, but we can parallelize
  const BATCH_SIZE = 50;
  for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
    const batch = notifications.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(n => sendAPNsNotification(config, n))
    );

    for (const result of batchResults) {
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }
  }

  logger.info('APNs batch complete', { successCount, failureCount, total: notifications.length });
  return { results, successCount, failureCount };
}

/**
 * Check if a device token is valid APNs format
 * APNs tokens are 64 hex characters
 */
export function isValidAPNsToken(token: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(token);
}

/**
 * Create APNs config from environment bindings
 */
export function createAPNsConfig(env: {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_KEY_BASE64?: string;
}): APNsConfig | null {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_BUNDLE_ID || !env.APNS_KEY_BASE64) {
    logger.warn('APNs not configured - missing environment variables');
    return null;
  }

  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID,
    privateKeyBase64: env.APNS_KEY_BASE64,
    production: true, // Default to production
  };
}
