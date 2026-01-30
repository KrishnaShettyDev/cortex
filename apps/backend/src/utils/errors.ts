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

function getErrorStatus(message: string): number {
  if (message.includes('not found')) return 404;
  if (message.includes('Unauthorized') || message.includes('token')) return 401;
  if (message.includes('empty') || message.includes('required')) return 400;
  return 500;
}

function getErrorType(message: string): string {
  if (message.includes('not found')) return 'Not found';
  if (message.includes('Unauthorized') || message.includes('token')) return 'Unauthorized';
  if (message.includes('OpenAI')) return 'AI service error';
  if (message.includes('empty') || message.includes('required')) return 'Invalid request';
  return 'Internal server error';
}
