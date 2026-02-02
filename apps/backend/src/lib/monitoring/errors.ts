/**
 * Error Monitoring and Observability
 *
 * Production-grade error tracking with:
 * - Error categorization
 * - Context capture
 * - Stack traces
 * - User/tenant scoping
 * - Rate limiting
 */

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorCategory =
  | 'auth'
  | 'database'
  | 'vectorize'
  | 'processing'
  | 'external_api'
  | 'validation'
  | 'rate_limit'
  | 'unknown';

export interface ErrorContext {
  // Request context
  userId?: string;
  containerTag?: string;
  endpoint?: string;
  method?: string;

  // Error details
  errorMessage: string;
  errorStack?: string;
  errorCode?: string;

  // Additional context
  metadata?: Record<string, any>;

  // Timing
  timestamp: string;
}

export interface CategorizedError {
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  context: ErrorContext;
  shouldAlert: boolean;
}

/**
 * Categorize and enrich error with context
 */
export function categorizeError(
  error: Error,
  context: Partial<ErrorContext>
): CategorizedError {
  const errorMessage = error.message;
  const errorStack = error.stack;

  // Determine category and severity
  let category: ErrorCategory = 'unknown';
  let severity: ErrorSeverity = 'medium';
  let shouldAlert = false;

  // Auth errors
  if (
    errorMessage.includes('Unauthorized') ||
    errorMessage.includes('token') ||
    errorMessage.includes('authentication')
  ) {
    category = 'auth';
    severity = 'low';
  }

  // Database errors
  else if (
    errorMessage.includes('SQLITE') ||
    errorMessage.includes('D1') ||
    errorMessage.includes('database')
  ) {
    category = 'database';
    severity = 'high';
    shouldAlert = true;
  }

  // Vectorize errors
  else if (
    errorMessage.includes('Vectorize') ||
    errorMessage.includes('embedding')
  ) {
    category = 'vectorize';
    severity = 'high';
    shouldAlert = true;
  }

  // Processing errors
  else if (
    errorMessage.includes('Processing') ||
    errorMessage.includes('extraction') ||
    errorMessage.includes('chunking')
  ) {
    category = 'processing';
    severity = 'medium';
  }

  // External API errors
  else if (
    errorMessage.includes('fetch') ||
    errorMessage.includes('API') ||
    errorMessage.includes('timeout')
  ) {
    category = 'external_api';
    severity = 'medium';
  }

  // Validation errors
  else if (
    errorMessage.includes('required') ||
    errorMessage.includes('invalid') ||
    errorMessage.includes('validation')
  ) {
    category = 'validation';
    severity = 'low';
  }

  // Rate limit errors
  else if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests')
  ) {
    category = 'rate_limit';
    severity = 'low';
  }

  return {
    severity,
    category,
    message: errorMessage,
    context: {
      ...context,
      errorMessage,
      errorStack,
      timestamp: new Date().toISOString(),
    },
    shouldAlert,
  };
}

/**
 * Log error with full context
 */
export function logError(categorized: CategorizedError): void {
  const { severity, category, message, context } = categorized;

  const logPrefix = `[Error][${severity.toUpperCase()}][${category}]`;
  const logData = {
    severity,
    category,
    message,
    userId: context.userId,
    containerTag: context.containerTag,
    endpoint: context.endpoint,
    timestamp: context.timestamp,
    metadata: context.metadata,
  };

  // Use console.error for visibility
  console.error(logPrefix, message);
  console.error('Context:', JSON.stringify(logData, null, 2));

  if (context.errorStack) {
    console.error('Stack:', context.errorStack);
  }
}

/**
 * Track error metrics in KV
 */
export async function trackErrorMetrics(
  kv: KVNamespace,
  categorized: CategorizedError
): Promise<void> {
  const { severity, category } = categorized;
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Increment counters
  const keys = [
    `error_count:${date}`,
    `error_count:${date}:${severity}`,
    `error_count:${date}:${category}`,
  ];

  for (const key of keys) {
    try {
      const current = await kv.get(key);
      const count = current ? parseInt(current) : 0;
      await kv.put(key, (count + 1).toString(), {
        expirationTtl: 60 * 60 * 24 * 30, // 30 days
      });
    } catch (err) {
      // Don't let metrics tracking fail the request
      console.warn('Failed to track error metric:', err);
    }
  }
}

/**
 * Get error metrics for date range
 */
export async function getErrorMetrics(
  kv: KVNamespace,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  const metrics: Record<string, number> = {};

  // Generate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates: string[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }

  // Fetch metrics for each date
  for (const date of dates) {
    const key = `error_count:${date}`;
    const count = await kv.get(key);
    if (count) {
      metrics[date] = parseInt(count);
    }
  }

  return metrics;
}

/**
 * Check if error rate is too high (circuit breaker pattern)
 */
export async function checkErrorRate(
  kv: KVNamespace,
  threshold: number = 100
): Promise<{ tooHigh: boolean; count: number }> {
  const date = new Date().toISOString().split('T')[0];
  const key = `error_count:${date}`;

  const count = await kv.get(key);
  const errorCount = count ? parseInt(count) : 0;

  return {
    tooHigh: errorCount >= threshold,
    count: errorCount,
  };
}

/**
 * Global error handler for uncaught errors
 */
export function handleUncaughtError(
  error: Error,
  context: Partial<ErrorContext>,
  kv?: KVNamespace
): CategorizedError {
  const categorized = categorizeError(error, context);

  // Always log
  logError(categorized);

  // Track metrics if KV available
  if (kv) {
    trackErrorMetrics(kv, categorized).catch((err) =>
      console.warn('Failed to track metrics:', err)
    );
  }

  return categorized;
}
