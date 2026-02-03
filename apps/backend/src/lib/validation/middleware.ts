/**
 * Validation Middleware
 *
 * Hono middleware for request validation using Zod schemas.
 * Validates body, query params, and route params.
 */

import { Context, Next } from 'hono';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Format Zod errors for API response (compatible with Zod v3 and v4)
 */
function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  // Zod v4 uses error.issues, v3 uses error.errors
  const issues = error.issues || (error as any).errors || [];
  return issues.map((e: any) => ({
    path: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
    message: e.message || 'Validation failed',
  }));
}

/**
 * Validate request body against a Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);
      c.set('validatedBody', validated);
      await next();
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json(
          {
            error: 'Validation Error',
            details: formatZodError(error),
          },
          400
        );
      }
      // Re-throw non-Zod errors
      throw error;
    }
  };
}

/**
 * Validate query parameters against a Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const query = c.req.query();
      // Convert string values to appropriate types for Zod
      const parsed = Object.fromEntries(
        Object.entries(query).map(([key, value]) => {
          if (value === undefined || value === '') {
            return [key, undefined];
          }
          // Convert numeric strings to numbers
          if (/^\d+$/.test(value)) {
            return [key, parseInt(value, 10)];
          }
          // Convert boolean strings
          if (value === 'true') return [key, true];
          if (value === 'false') return [key, false];
          return [key, value];
        })
      );
      const validated = schema.parse(parsed);
      c.set('validatedQuery', validated);
      await next();
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json(
          {
            error: 'Validation Error',
            details: formatZodError(error),
          },
          400
        );
      }
      throw error;
    }
  };
}

/**
 * Validate route parameters against a Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const params = c.req.param();
      const validated = schema.parse(params);
      c.set('validatedParams', validated);
      await next();
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json(
          {
            error: 'Validation Error',
            details: formatZodError(error),
          },
          400
        );
      }
      throw error;
    }
  };
}

/**
 * Helper: Get validated body from context
 */
export function getValidatedBody<T>(c: Context): T {
  const body = c.get('validatedBody');
  if (!body) {
    throw new Error('No validated body found. Did you apply validateBody middleware?');
  }
  return body as T;
}

/**
 * Helper: Get validated query from context
 */
export function getValidatedQuery<T>(c: Context): T {
  const query = c.get('validatedQuery');
  if (!query) {
    throw new Error('No validated query found. Did you apply validateQuery middleware?');
  }
  return query as T;
}

/**
 * Helper: Get validated params from context
 */
export function getValidatedParams<T>(c: Context): T {
  const params = c.get('validatedParams');
  if (!params) {
    throw new Error('No validated params found. Did you apply validateParams middleware?');
  }
  return params as T;
}
