/**
 * Personality API Handlers
 *
 * Endpoints for managing user personality preferences.
 * These are OPTIONAL - the system learns automatically from conversations.
 *
 * Endpoints:
 * - GET /v3/personality - Get current personality settings
 * - PUT /v3/personality - Update personality settings
 * - POST /v3/personality/reset - Reset to defaults (re-learn from scratch)
 * - GET /v3/personality/presets - List available tone presets
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import {
  getUserPersonality,
  saveUserPersonality,
  resetUserPersonality,
  TONE_PRESETS,
  type PersonalityConfig,
} from '../lib/personality';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /v3/personality
 * Get current personality settings for the user
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const personality = await getUserPersonality(c.env.DB, userId);

    return c.json({
      success: true,
      personality,
    });
  } catch (error: any) {
    console.error('[Personality] Get failed:', error);
    return c.json(
      {
        error: 'Failed to get personality settings',
        message: error.message,
      },
      500
    );
  }
});

/**
 * PUT /v3/personality
 * Update personality settings
 *
 * Body: {
 *   tone_preset?: 'professional' | 'casual' | 'supportive' | 'sassy' | 'coaching' | 'balanced',
 *   verbosity?: 'brief' | 'medium' | 'detailed',
 *   emoji_usage?: 'none' | 'minimal' | 'moderate' | 'frequent',
 *   preferred_name?: string,
 *   assistant_name?: string,
 *   proactive_suggestions?: boolean,
 *   memory_acknowledgment?: boolean,
 *   gentle_reminders?: boolean,
 *   communication_notes?: string
 * }
 */
app.put('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();

    // Validate tone preset
    if (body.tone_preset && !Object.keys(TONE_PRESETS).includes(body.tone_preset)) {
      return c.json(
        {
          error: 'Invalid tone preset',
          valid_presets: Object.keys(TONE_PRESETS),
        },
        400
      );
    }

    // Validate verbosity
    if (body.verbosity && !['brief', 'medium', 'detailed'].includes(body.verbosity)) {
      return c.json(
        {
          error: 'Invalid verbosity',
          valid_values: ['brief', 'medium', 'detailed'],
        },
        400
      );
    }

    // Validate emoji usage
    if (body.emoji_usage && !['none', 'minimal', 'moderate', 'frequent'].includes(body.emoji_usage)) {
      return c.json(
        {
          error: 'Invalid emoji_usage',
          valid_values: ['none', 'minimal', 'moderate', 'frequent'],
        },
        400
      );
    }

    // Map snake_case to camelCase for the config
    const config: Partial<PersonalityConfig> = {
      tonePreset: body.tone_preset,
      verbosity: body.verbosity,
      emojiUsage: body.emoji_usage,
      preferredName: body.preferred_name,
      assistantName: body.assistant_name,
      proactiveSuggestions: body.proactive_suggestions,
      memoryAcknowledgment: body.memory_acknowledgment,
      gentleReminders: body.gentle_reminders,
      communicationNotes: body.communication_notes,
    };

    // Remove undefined values
    Object.keys(config).forEach((key) => {
      if (config[key as keyof PersonalityConfig] === undefined) {
        delete config[key as keyof PersonalityConfig];
      }
    });

    await saveUserPersonality(c.env.DB, userId, config);

    // Return updated personality
    const updated = await getUserPersonality(c.env.DB, userId);

    return c.json({
      success: true,
      message: 'Personality settings updated',
      personality: updated,
    });
  } catch (error: any) {
    console.error('[Personality] Update failed:', error);
    return c.json(
      {
        error: 'Failed to update personality settings',
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /v3/personality/reset
 * Reset personality to defaults (will re-learn from future conversations)
 */
app.post('/reset', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    await resetUserPersonality(c.env.DB, userId);

    return c.json({
      success: true,
      message: 'Personality reset to defaults. Cortex will re-learn your preferences from future conversations.',
    });
  } catch (error: any) {
    console.error('[Personality] Reset failed:', error);
    return c.json(
      {
        error: 'Failed to reset personality',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/personality/presets
 * List available tone presets with examples
 */
app.get('/presets', async (c) => {
  return c.json({
    success: true,
    presets: Object.entries(TONE_PRESETS).map(([key, preset]) => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      greeting: preset.greeting,
      style: preset.style,
      examples: preset.examples,
      avoid: preset.avoid,
      is_default: key === 'balanced',
    })),
    note: 'The "balanced" preset is the default and provides a warm, Poke-like experience. Most users never need to change this.',
  });
});

export default app;
