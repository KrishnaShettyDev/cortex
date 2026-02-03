/**
 * Webhook Signature Verification
 *
 * Verifies HMAC-SHA256 signatures on incoming webhooks to prevent spoofing.
 * Each webhook provider may have different signature formats.
 */

/**
 * Compute HMAC-SHA256 signature
 */
async function computeHmac(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const payloadData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare signatures in constant time to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify Composio webhook signature
 *
 * Composio uses format: sha256=<hex_signature>
 */
export async function verifyComposioSignature(
  payload: string,
  signature: string | undefined,
  secret: string | undefined
): Promise<{ valid: boolean; error?: string }> {
  // If no secret configured, log warning but allow (for development)
  if (!secret) {
    console.warn('[Webhook] COMPOSIO_WEBHOOK_SECRET not configured - skipping signature verification');
    return { valid: true };
  }

  if (!signature) {
    return { valid: false, error: 'Missing webhook signature header' };
  }

  // Extract the hex signature (remove 'sha256=' prefix if present)
  const providedSignature = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  // Compute expected signature
  const expectedSignature = await computeHmac(secret, payload);

  // Secure comparison
  if (!secureCompare(providedSignature.toLowerCase(), expectedSignature.toLowerCase())) {
    return { valid: false, error: 'Invalid webhook signature' };
  }

  return { valid: true };
}

/**
 * Verify Google Pub/Sub webhook (Gmail, Calendar)
 *
 * Google Pub/Sub uses JWT tokens for authentication.
 * The token is in the Authorization header as "Bearer <token>"
 */
export async function verifyGooglePubSubWebhook(
  authHeader: string | undefined,
  expectedAudience: string | undefined
): Promise<{ valid: boolean; error?: string }> {
  // For Google Pub/Sub, we verify using the channel ID/resource ID mechanism
  // The channel is created with a specific ID that we store when setting up the webhook
  // Here we just verify the header format is correct

  if (!expectedAudience) {
    console.warn('[Webhook] Google Pub/Sub audience not configured - skipping verification');
    return { valid: true };
  }

  if (!authHeader) {
    return { valid: false, error: 'Missing authorization header' };
  }

  // Google sends "Bearer <token>" in Authorization header
  // Full JWT verification would require fetching Google's public keys
  // For now, we just verify the format and trust the Google Cloud infrastructure
  if (!authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Invalid authorization header format' };
  }

  // In production, you would:
  // 1. Extract the JWT token
  // 2. Verify the signature using Google's public keys
  // 3. Check the audience claim matches your expected value

  return { valid: true };
}

/**
 * Middleware factory for webhook signature verification
 */
export function createWebhookVerifier(
  provider: 'composio' | 'google',
  getSecret: (c: any) => string | undefined
) {
  return async function webhookVerifier(c: any, next: () => Promise<void>) {
    // Clone the request and read the body as text
    const rawBody = await c.req.text();

    // Store raw body for later use
    c.set('rawBody', rawBody);

    // Parse JSON for handler
    try {
      c.set('jsonBody', JSON.parse(rawBody));
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Verify based on provider
    if (provider === 'composio') {
      const signature = c.req.header('x-composio-signature');
      const secret = getSecret(c);

      const result = await verifyComposioSignature(rawBody, signature, secret);
      if (!result.valid) {
        console.error(`[Webhook] Signature verification failed: ${result.error}`);
        return c.json({ error: result.error }, 401);
      }
    } else if (provider === 'google') {
      const authHeader = c.req.header('authorization');
      const audience = getSecret(c);

      const result = await verifyGooglePubSubWebhook(authHeader, audience);
      if (!result.valid) {
        console.error(`[Webhook] Google verification failed: ${result.error}`);
        return c.json({ error: result.error }, 401);
      }
    }

    await next();
  };
}
