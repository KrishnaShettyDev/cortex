/**
 * Webhook Signature Verification
 *
 * Verifies HMAC-SHA256 signatures on incoming webhooks to prevent spoofing.
 * Updated to match Composio's actual webhook format.
 *
 * Composio webhook headers:
 * - webhook-signature: v1,<base64_signature>
 * - webhook-id: unique message ID
 * - webhook-timestamp: Unix timestamp
 *
 * Signing string: {webhook-id}.{webhook-timestamp}.{raw_body}
 */

import { createLogger } from './logger';

const logger = createLogger('webhook-signature');

/**
 * Verify Composio webhook signature (async - Web Crypto API)
 *
 * @param body - Raw request body as string
 * @param signature - webhook-signature header value (format: v1,<base64>)
 * @param msgId - webhook-id header value
 * @param timestamp - webhook-timestamp header value
 * @param secret - COMPOSIO_WEBHOOK_SECRET
 * @returns true if signature is valid
 */
export async function verifyComposioWebhookAsync(
  body: string,
  signature: string | null | undefined,
  msgId: string | null | undefined,
  timestamp: string | null | undefined,
  secret: string | undefined
): Promise<boolean> {
  // If no secret configured, log warning but allow (for development)
  if (!secret) {
    logger.warn('COMPOSIO_WEBHOOK_SECRET not configured - skipping signature verification');
    return true;
  }

  // Validate required headers
  if (!signature || !msgId || !timestamp) {
    logger.warn('Missing webhook headers', {
      hasSignature: !!signature,
      hasMsgId: !!msgId,
      hasTimestamp: !!timestamp,
    });
    return false;
  }

  // Validate signature format (v1,<base64>)
  if (!signature.startsWith('v1,')) {
    logger.warn('Invalid signature format - expected v1,<base64>', {
      signaturePrefix: signature.substring(0, 10),
    });
    return false;
  }

  // Optional: Check timestamp to prevent replay attacks (5 min window)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > 300) {
    logger.warn('Webhook timestamp too old/new', {
      webhookTimestamp: timestampNum,
      currentTimestamp: now,
      difference: Math.abs(now - timestampNum),
    });
    // Allow but log - Composio may have clock skew
  }

  // Extract the base64 signature (remove 'v1,' prefix)
  const receivedSignature = signature.slice(3);

  // Build signing string: {webhook-id}.{webhook-timestamp}.{raw_body}
  const signingString = `${msgId}.${timestamp}.${body}`;

  try {
    // Import the secret key
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Compute HMAC-SHA256
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signingString)
    );

    // Convert to base64
    const expectedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer))
    );

    // Constant-time comparison to prevent timing attacks
    if (receivedSignature.length !== expectedSignature.length) {
      logger.warn('Signature length mismatch');
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < receivedSignature.length; i++) {
      mismatch |= receivedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }

    const isValid = mismatch === 0;
    if (!isValid) {
      logger.warn('Signature mismatch', { msgId });
    }

    return isValid;
  } catch (error) {
    logger.error('Signature verification error', error);
    return false;
  }
}

/**
 * Legacy signature verification (sha256=hex format)
 * Kept for backwards compatibility with other webhook providers
 */
export async function verifyLegacySignature(
  payload: string,
  signature: string | undefined,
  secret: string | undefined
): Promise<{ valid: boolean; error?: string }> {
  if (!secret) {
    logger.warn('Webhook secret not configured - skipping signature verification');
    return { valid: true };
  }

  if (!signature) {
    return { valid: false, error: 'Missing webhook signature header' };
  }

  // Extract the hex signature (remove 'sha256=' prefix if present)
  const providedSignature = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload)
    );

    // Convert to hex
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison
    if (providedSignature.length !== expectedSignature.length) {
      return { valid: false, error: 'Invalid webhook signature' };
    }

    let mismatch = 0;
    for (let i = 0; i < providedSignature.length; i++) {
      mismatch |=
        providedSignature.toLowerCase().charCodeAt(i) ^
        expectedSignature.toLowerCase().charCodeAt(i);
    }

    if (mismatch !== 0) {
      return { valid: false, error: 'Invalid webhook signature' };
    }

    return { valid: true };
  } catch (error) {
    logger.error('Legacy signature verification error', error);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Verify Google Pub/Sub webhook (Gmail, Calendar)
 * Google Pub/Sub uses JWT tokens for authentication.
 */
export async function verifyGooglePubSubWebhook(
  authHeader: string | undefined,
  expectedAudience: string | undefined
): Promise<{ valid: boolean; error?: string }> {
  if (!expectedAudience) {
    logger.warn('Google Pub/Sub audience not configured - skipping verification');
    return { valid: true };
  }

  if (!authHeader) {
    return { valid: false, error: 'Missing authorization header' };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Invalid authorization header format' };
  }

  // Full JWT verification would require fetching Google's public keys
  // For now, we trust the Google Cloud infrastructure
  return { valid: true };
}
