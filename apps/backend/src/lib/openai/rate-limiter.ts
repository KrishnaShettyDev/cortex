/**
 * OpenAI Global Rate Limiter
 *
 * Prevents runaway OpenAI costs by enforcing:
 * - Max calls per minute (across all users)
 * - Max tokens per hour (across all users)
 *
 * Uses Cloudflare KV for distributed rate limiting across worker instances.
 */

export interface OpenAIRateLimitResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    callsPerMinute: number;
    tokensPerHour: number;
  };
}

const LIMITS = {
  callsPerMinute: 100,
  tokensPerHour: 500000,
};

/**
 * Check if an OpenAI call is allowed under global rate limits
 */
export async function checkOpenAIRateLimit(
  cache: KVNamespace
): Promise<OpenAIRateLimitResult> {
  const minuteKey = `openai:calls:${Math.floor(Date.now() / 60000)}`;
  const hourKey = `openai:tokens:${Math.floor(Date.now() / 3600000)}`;

  try {
    const [callsStr, tokensStr] = await Promise.all([
      cache.get(minuteKey),
      cache.get(hourKey),
    ]);

    const calls = callsStr ? parseInt(callsStr, 10) : 0;
    const tokens = tokensStr ? parseInt(tokensStr, 10) : 0;

    if (calls >= LIMITS.callsPerMinute) {
      console.warn(`[OpenAI RateLimit] Calls per minute limit reached: ${calls}/${LIMITS.callsPerMinute}`);
      return {
        allowed: false,
        reason: `Rate limit: ${calls}/${LIMITS.callsPerMinute} calls per minute`,
        remaining: {
          callsPerMinute: 0,
          tokensPerHour: Math.max(0, LIMITS.tokensPerHour - tokens),
        },
      };
    }

    if (tokens >= LIMITS.tokensPerHour) {
      console.warn(`[OpenAI RateLimit] Tokens per hour limit reached: ${tokens}/${LIMITS.tokensPerHour}`);
      return {
        allowed: false,
        reason: `Rate limit: ${tokens}/${LIMITS.tokensPerHour} tokens per hour`,
        remaining: {
          callsPerMinute: Math.max(0, LIMITS.callsPerMinute - calls),
          tokensPerHour: 0,
        },
      };
    }

    return {
      allowed: true,
      remaining: {
        callsPerMinute: LIMITS.callsPerMinute - calls - 1,
        tokensPerHour: LIMITS.tokensPerHour - tokens,
      },
    };
  } catch (error) {
    // If KV fails, allow the request but log warning
    console.warn('[OpenAI RateLimit] KV check failed, allowing request:', error);
    return { allowed: true };
  }
}

/**
 * Track OpenAI API usage after a call completes
 */
export async function trackOpenAIUsage(
  cache: KVNamespace,
  tokensUsed: number
): Promise<void> {
  const minuteKey = `openai:calls:${Math.floor(Date.now() / 60000)}`;
  const hourKey = `openai:tokens:${Math.floor(Date.now() / 3600000)}`;

  try {
    // Increment call counter
    const currentCalls = await cache.get(minuteKey);
    const newCalls = currentCalls ? parseInt(currentCalls, 10) + 1 : 1;
    await cache.put(minuteKey, String(newCalls), { expirationTtl: 120 });

    // Increment token counter
    const currentTokens = await cache.get(hourKey);
    const newTokens = currentTokens ? parseInt(currentTokens, 10) + tokensUsed : tokensUsed;
    await cache.put(hourKey, String(newTokens), { expirationTtl: 7200 });

    console.log(`[OpenAI RateLimit] Tracked: calls=${newCalls}, tokens=${newTokens}`);
  } catch (error) {
    // Non-blocking: don't fail if tracking fails
    console.warn('[OpenAI RateLimit] Failed to track usage:', error);
  }
}

/**
 * Get current OpenAI usage stats
 */
export async function getOpenAIUsageStats(
  cache: KVNamespace
): Promise<{
  callsThisMinute: number;
  tokensThisHour: number;
  limits: typeof LIMITS;
}> {
  const minuteKey = `openai:calls:${Math.floor(Date.now() / 60000)}`;
  const hourKey = `openai:tokens:${Math.floor(Date.now() / 3600000)}`;

  try {
    const [callsStr, tokensStr] = await Promise.all([
      cache.get(minuteKey),
      cache.get(hourKey),
    ]);

    return {
      callsThisMinute: callsStr ? parseInt(callsStr, 10) : 0,
      tokensThisHour: tokensStr ? parseInt(tokensStr, 10) : 0,
      limits: LIMITS,
    };
  } catch {
    return {
      callsThisMinute: 0,
      tokensThisHour: 0,
      limits: LIMITS,
    };
  }
}

/**
 * Wrapper for OpenAI calls that checks rate limits and tracks usage
 */
export async function withOpenAIRateLimit<T>(
  cache: KVNamespace,
  estimatedTokens: number,
  fn: () => Promise<{ result: T; tokensUsed: number }>
): Promise<T> {
  const check = await checkOpenAIRateLimit(cache);

  if (!check.allowed) {
    throw new Error(`OpenAI rate limit exceeded: ${check.reason}`);
  }

  const { result, tokensUsed } = await fn();

  // Track actual usage (non-blocking)
  trackOpenAIUsage(cache, tokensUsed).catch(() => {});

  return result;
}
