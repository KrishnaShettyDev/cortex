/**
 * Error handling utilities
 */

import type { Context } from 'hono';

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

    return c.json(
      {
        error: getErrorType(message),
        details: message,
      },
      statusCode as any
    );
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
  return 'Internal server error';
}
