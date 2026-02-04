/**
 * Error handling utilities
 *
 * Provides standardized error responses across all API endpoints.
 * Format: { error: string, message?: string, code?: string, details?: any }
 */

import type { Context } from 'hono';

// ============================================================================
// Standardized Error Response Types
// ============================================================================

export interface APIError {
  /** Human-readable error type (e.g., "Not found", "Unauthorized") */
  error: string;
  /** Optional detailed message */
  message?: string;
  /** Optional machine-readable error code (e.g., "MEMORY_NOT_FOUND") */
  code?: string;
  /** Optional additional details (for debugging) */
  details?: any;
}

export type HTTPStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;

// ============================================================================
// Error Helper Functions
// ============================================================================

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  c: Context,
  status: HTTPStatus,
  error: string,
  options?: {
    message?: string;
    code?: string;
    details?: any;
  }
): Response {
  const body: APIError = { error };

  if (options?.message) body.message = options.message;
  if (options?.code) body.code = options.code;
  if (options?.details && process.env.NODE_ENV !== 'production') {
    body.details = options.details;
  }

  return c.json(body, status);
}

// Convenience functions for common errors

export function badRequest(c: Context, message: string, code?: string): Response {
  return createErrorResponse(c, 400, 'Bad request', { message, code });
}

export function unauthorized(c: Context, message?: string): Response {
  return createErrorResponse(c, 401, 'Unauthorized', {
    message: message || 'Authentication required',
    code: 'UNAUTHORIZED',
  });
}

export function forbidden(c: Context, message?: string): Response {
  return createErrorResponse(c, 403, 'Forbidden', {
    message: message || 'You do not have permission to access this resource',
    code: 'FORBIDDEN',
  });
}

export function notFound(c: Context, resource?: string): Response {
  const message = resource ? `${resource} not found` : 'Resource not found';
  return createErrorResponse(c, 404, 'Not found', {
    message,
    code: `${(resource || 'RESOURCE').toUpperCase().replace(/\s+/g, '_')}_NOT_FOUND`,
  });
}

export function conflict(c: Context, message: string): Response {
  return createErrorResponse(c, 409, 'Conflict', { message, code: 'CONFLICT' });
}

export function validationError(c: Context, message: string, details?: any): Response {
  return createErrorResponse(c, 422, 'Validation error', {
    message,
    code: 'VALIDATION_ERROR',
    details,
  });
}

export function rateLimited(c: Context, retryAfter?: number): Response {
  const message = retryAfter
    ? `Too many requests. Please retry after ${retryAfter} seconds.`
    : 'Too many requests. Please slow down.';

  return createErrorResponse(c, 429, 'Rate limited', {
    message,
    code: 'RATE_LIMITED',
  });
}

export function internalError(c: Context, message?: string, details?: any): Response {
  return createErrorResponse(c, 500, 'Internal server error', {
    message: message || 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    details,
  });
}

export function serviceUnavailable(c: Context, service?: string): Response {
  const message = service
    ? `${service} is temporarily unavailable`
    : 'Service temporarily unavailable';

  return createErrorResponse(c, 503, 'Service unavailable', {
    message,
    code: 'SERVICE_UNAVAILABLE',
  });
}

// ============================================================================
// Legacy Error Handler (for backwards compatibility)
// ============================================================================

/**
 * Centralized error handler for routes
 * Reduces repetitive try/catch blocks
 */
export async function handleError<T>(
  c: Context,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    console.error('Request error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = getErrorStatus(message);
    const errorType = getErrorType(message);

    return createErrorResponse(c, statusCode as HTTPStatus, errorType, {
      message,
      details: error instanceof Error ? error.stack : undefined,
    });
  }
}

function isAuthError(message: string): boolean {
  const authPatterns = [
    'Unauthorized',
    'token',
    'exp',           // JWT expiration claim
    'claim',         // JWT claim errors
    'expired',
    'invalid',
    'signature',
    'malformed',
  ];
  return authPatterns.some(pattern => message.toLowerCase().includes(pattern.toLowerCase()));
}

function getErrorStatus(message: string): number {
  if (message.includes('not found')) return 404;
  if (isAuthError(message)) return 401;
  if (message.includes('empty') || message.includes('required')) return 400;
  if (message.includes('rate limit')) return 429;
  if (message.includes('unavailable')) return 503;
  return 500;
}

function getErrorType(message: string): string {
  if (message.includes('not found')) return 'Not found';
  if (isAuthError(message)) {
    if (message.includes('exp') || message.includes('expired')) return 'Token expired';
    return 'Unauthorized';
  }
  if (message.includes('OpenAI')) return 'AI service error';
  if (message.includes('empty') || message.includes('required')) return 'Invalid request';
  if (message.includes('rate limit')) return 'Rate limited';
  if (message.includes('unavailable')) return 'Service unavailable';
  return 'Internal server error';
}
