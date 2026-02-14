/**
 * Error Handling Utilities
 *
 * Centralized error handling for consistent API responses.
 * Eliminates copy-pasted error handlers throughout the codebase.
 */

import type { Context } from 'hono';

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base application error with status code
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, public readonly field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  constructor(
    message: string = 'Rate limit exceeded',
    public readonly resetAt?: string
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

// =============================================================================
// ERROR RESPONSE HANDLER
// =============================================================================

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: string;
  message?: string;
  code?: string;
  field?: string;
  resetAt?: string;
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(error: unknown): {
  body: ErrorResponse;
  status: number;
} {
  // AppError and its subclasses
  if (error instanceof AppError) {
    const body: ErrorResponse = {
      error: error.message,
      code: error.code,
    };

    if (error instanceof ValidationError && error.field) {
      body.field = error.field;
    }

    if (error instanceof RateLimitError && error.resetAt) {
      body.resetAt = error.resetAt;
    }

    return { body, status: error.statusCode };
  }

  // Standard Error
  if (error instanceof Error) {
    return {
      body: {
        error: error.message || 'An unexpected error occurred',
      },
      status: 500,
    };
  }

  // Unknown error type
  return {
    body: {
      error: 'An unexpected error occurred',
    },
    status: 500,
  };
}

/**
 * Wrap a handler with standardized error handling
 * Eliminates try/catch boilerplate
 *
 * @example
 * app.get('/items', (c) => withErrorHandler(c, async () => {
 *   const items = await getItems();
 *   return c.json({ success: true, items });
 * }));
 */
export async function withErrorHandler<T>(
  c: Context,
  handler: () => Promise<T>,
  options: {
    logPrefix?: string;
    onError?: (error: unknown) => void;
  } = {}
): Promise<T | Response> {
  try {
    return await handler();
  } catch (error) {
    // Log the error
    const prefix = options.logPrefix || 'Handler';
    console.error(`[${prefix}] Error:`, error);

    // Call custom error handler if provided
    options.onError?.(error);

    // Return standardized error response
    const { body, status } = createErrorResponse(error);
    return c.json(body, status);
  }
}

/**
 * Create a handler wrapper for a specific resource type
 * Provides consistent error messages
 *
 * @example
 * const reminderHandler = createResourceHandler('Reminder');
 *
 * app.get('/reminders', (c) => reminderHandler(c, 'fetch', async () => {
 *   return c.json({ reminders: await getReminders() });
 * }));
 */
export function createResourceHandler(resourceName: string) {
  return async function <T>(
    c: Context,
    operation: string,
    handler: () => Promise<T>
  ): Promise<T | Response> {
    return withErrorHandler(c, handler, {
      logPrefix: resourceName,
      onError: () => {
        // Error is already logged by withErrorHandler
      },
    });
  };
}

// =============================================================================
// SAFE JSON PARSING
// =============================================================================

/**
 * Safely parse JSON with error handling
 * Returns null instead of throwing
 */
export function safeJsonParse<T = unknown>(
  text: string,
  fallback?: T
): T | null {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn('[SafeJsonParse] Failed to parse JSON:', error);
    return fallback ?? null;
  }
}

/**
 * Safely parse JSON from a request body
 * Returns empty object on failure
 */
export async function safeParseBody<T extends object = Record<string, unknown>>(
  req: Request,
  fallback: T = {} as T
): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    return fallback;
  }
}

// =============================================================================
// ERROR LOGGING
// =============================================================================

/**
 * Log an error with consistent formatting
 */
export function logError(
  prefix: string,
  operation: string,
  error: unknown
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[${prefix}] ${operation} failed:`, errorMessage);

  if (stack && process.env.NODE_ENV !== 'production') {
    console.error(stack);
  }
}
