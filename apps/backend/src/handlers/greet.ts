/**
 * Cortex Greeting API Handler
 *
 * GET /v3/greet - Returns a savage, contextual greeting from Cortex
 * The greeting is designed to start a conversation by roasting the user
 * about overdue tasks, neglected relationships, or their schedule.
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CortexGreetGenerator } from '../lib/greet/generator';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/greet
 * Generate a savage greeting based on user context
 *
 * Returns:
 * - message: The greeting text (roast + question)
 * - greetType: 'roast' | 'nudge' | 'celebration' | 'curiosity'
 * - targetedItem: What we're roasting about
 * - severity: 'light' | 'medium' | 'savage'
 * - generatedAt: ISO timestamp
 *
 * Caching:
 * - Greetings are cached for 1 hour per user
 * - This prevents excessive LLM calls and gives users variety
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload')?.sub;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Check cache first (1 hour TTL)
    const cacheKey = `greet:${userId}`;
    if (c.env.CACHE) {
      const cached = await c.env.CACHE.get(cacheKey);
      if (cached) {
        console.log('[Greet] Returning cached greeting for user:', userId);
        return c.json(JSON.parse(cached));
      }
    }

    // Get user info for personalization
    const user = await c.env.DB.prepare(
      'SELECT name, email FROM users WHERE id = ?'
    ).bind(userId).first<{ name: string; email: string }>();

    const userName = user?.name || user?.email?.split('@')[0] || 'friend';

    // Generate greeting
    const generator = new CortexGreetGenerator(c.env.DB, c.env.OPENAI_API_KEY);
    const greeting = await generator.generateGreeting(userId, userName);

    const response = {
      greeting,
      userName,
    };

    // Cache for 1 hour
    if (c.env.CACHE) {
      await c.env.CACHE.put(cacheKey, JSON.stringify(response), {
        expirationTtl: 3600, // 1 hour
      });
    }

    console.log('[Greet] Generated new greeting for user:', userId, 'type:', greeting.greetType);
    return c.json(response);

  } catch (error) {
    console.error('[Greet] Error generating greeting:', error);

    // Return a safe fallback
    return c.json({
      greeting: {
        message: "Hey! What's on your mind today? 👀",
        greetType: 'curiosity',
        targetedItem: null,
        severity: 'light',
        generatedAt: new Date().toISOString(),
      },
      userName: 'friend',
    });
  }
});

/**
 * DELETE /v3/greet/cache
 * Clear cached greeting (useful for testing or forcing refresh)
 */
app.delete('/cache', async (c) => {
  const userId = c.get('jwtPayload')?.sub;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (c.env.CACHE) {
    await c.env.CACHE.delete(`greet:${userId}`);
  }

  return c.json({ success: true, message: 'Greeting cache cleared' });
});

export default app;
