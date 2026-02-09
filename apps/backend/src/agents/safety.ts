/**
 * Agent Safety & Resilience
 *
 * Provides:
 * - Timeout handling with configurable limits
 * - Fallback model support
 * - Rate limiting per user/agent
 * - Circuit breaker for failing services
 */

export interface RateLimitConfig {
  maxPerHour: number;
  maxPerDay: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  reason?: string;
}

/**
 * Execute a function with a timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutError: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Execute with fallback on error
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  shouldFallback: (error: Error) => boolean = () => true
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (error instanceof Error && shouldFallback(error)) {
      console.warn('[Safety] Primary failed, using fallback:', error.message);
      return fallback();
    }
    throw error;
  }
}

/**
 * Check rate limit for a user/agent combination
 */
export async function checkRateLimit(
  db: D1Database,
  userId: string,
  agentType: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Count executions in the last hour and day
  const counts = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as hour_count,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as day_count
       FROM agent_executions
       WHERE user_id = ? AND agent_type = ?`
    )
    .bind(hourAgo, dayAgo, userId, agentType)
    .first<{ hour_count: number; day_count: number }>();

  const hourCount = counts?.hour_count || 0;
  const dayCount = counts?.day_count || 0;

  if (hourCount >= config.maxPerHour) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      reason: `Hourly limit reached (${config.maxPerHour}/hour)`,
    };
  }

  if (dayCount >= config.maxPerDay) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      reason: `Daily limit reached (${config.maxPerDay}/day)`,
    };
  }

  return {
    allowed: true,
    remaining: Math.min(config.maxPerHour - hourCount, config.maxPerDay - dayCount),
    resetAt: hourAgo,
  };
}

/**
 * Simple circuit breaker for external services
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailure: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if we should try again
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.warn(`[CircuitBreaker] Opened after ${this.failures} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

// Global circuit breakers for external services
const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(service: string): CircuitBreaker {
  if (!circuitBreakers.has(service)) {
    circuitBreakers.set(service, new CircuitBreaker());
  }
  return circuitBreakers.get(service)!;
}

/**
 * Retry with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: Error, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = (error) => {
      // Retry on rate limits and server errors
      const message = error.message.toLowerCase();
      return (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('timeout')
      );
    },
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
      console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Sanitize tool arguments to prevent injection
 */
export function sanitizeToolArgs(args: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Remove potential code injection patterns
      sanitized[key] = value
        .replace(/[<>]/g, '') // Remove HTML-like tags
        .replace(/\$\{[^}]*\}/g, '') // Remove template literals
        .slice(0, 10000); // Limit length
    } else if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 100).map((v) =>
        typeof v === 'string' ? v.slice(0, 1000) : v
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeToolArgs(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validate that a goal/prompt doesn't contain harmful patterns
 */
export function validateGoal(goal: string): { valid: boolean; reason?: string } {
  const harmful = [
    /ignore.*previous.*instructions/i,
    /forget.*system.*prompt/i,
    /pretend.*you.*are/i,
    /act.*as.*if/i,
    /bypass.*safety/i,
    /execute.*code/i,
    /run.*command/i,
    /delete.*all/i,
    /drop.*table/i,
  ];

  for (const pattern of harmful) {
    if (pattern.test(goal)) {
      return { valid: false, reason: 'Goal contains potentially harmful patterns' };
    }
  }

  if (goal.length > 5000) {
    return { valid: false, reason: 'Goal too long' };
  }

  return { valid: true };
}
