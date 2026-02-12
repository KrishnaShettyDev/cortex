/**
 * Personality Loader
 *
 * Loads and saves user personality preferences.
 * Returns sensible defaults if no customization exists.
 */

import { TonePreset } from '../../config/tone-presets';

export interface PersonalityConfig {
  tonePreset: TonePreset;
  verbosity: 'brief' | 'medium' | 'detailed';
  emojiUsage: 'none' | 'minimal' | 'moderate' | 'frequent';
  preferredName?: string;
  assistantName: string;
  proactiveSuggestions: boolean;
  memoryAcknowledgment: boolean;
  gentleReminders: boolean;
  communicationNotes?: string;
}

/**
 * Default personality configuration
 * Warm, Poke-like default - NOT corporate/robotic
 */
export const DEFAULT_PERSONALITY: PersonalityConfig = {
  tonePreset: 'balanced',
  verbosity: 'medium',
  emojiUsage: 'moderate',
  assistantName: 'Cortex',
  proactiveSuggestions: true,
  memoryAcknowledgment: true,
  gentleReminders: true,
};

/**
 * Load personality configuration for a user
 */
export async function getUserPersonality(
  db: D1Database,
  userId: string
): Promise<PersonalityConfig> {
  try {
    const personality = await db
      .prepare(`SELECT * FROM user_personality WHERE user_id = ?`)
      .bind(userId)
      .first<{
        tone_preset: string;
        verbosity: string;
        emoji_usage: string;
        preferred_name: string | null;
        assistant_name: string | null;
        proactive_suggestions: number;
        memory_acknowledgment: number;
        gentle_reminders: number;
        communication_notes: string | null;
      }>();

    // Return defaults if no customization
    if (!personality) {
      return DEFAULT_PERSONALITY;
    }

    return {
      tonePreset: (personality.tone_preset as TonePreset) || 'balanced',
      verbosity: (personality.verbosity as PersonalityConfig['verbosity']) || 'medium',
      emojiUsage: (personality.emoji_usage as PersonalityConfig['emojiUsage']) || 'moderate',
      preferredName: personality.preferred_name || undefined,
      assistantName: personality.assistant_name || 'Cortex',
      proactiveSuggestions: personality.proactive_suggestions !== 0,
      memoryAcknowledgment: personality.memory_acknowledgment !== 0,
      gentleReminders: personality.gentle_reminders !== 0,
      communicationNotes: personality.communication_notes || undefined,
    };
  } catch (error) {
    console.error('[PersonalityLoader] Error loading personality:', error);
    return DEFAULT_PERSONALITY;
  }
}

/**
 * Save/update personality configuration for a user
 */
export async function saveUserPersonality(
  db: D1Database,
  userId: string,
  config: Partial<PersonalityConfig>
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `
    INSERT INTO user_personality (
      id, user_id, tone_preset, verbosity, emoji_usage,
      preferred_name, assistant_name, proactive_suggestions,
      memory_acknowledgment, gentle_reminders, communication_notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tone_preset = COALESCE(excluded.tone_preset, tone_preset),
      verbosity = COALESCE(excluded.verbosity, verbosity),
      emoji_usage = COALESCE(excluded.emoji_usage, emoji_usage),
      preferred_name = COALESCE(excluded.preferred_name, preferred_name),
      assistant_name = COALESCE(excluded.assistant_name, assistant_name),
      proactive_suggestions = COALESCE(excluded.proactive_suggestions, proactive_suggestions),
      memory_acknowledgment = COALESCE(excluded.memory_acknowledgment, memory_acknowledgment),
      gentle_reminders = COALESCE(excluded.gentle_reminders, gentle_reminders),
      communication_notes = COALESCE(excluded.communication_notes, communication_notes),
      updated_at = excluded.updated_at
  `
    )
    .bind(
      id,
      userId,
      config.tonePreset || null,
      config.verbosity || null,
      config.emojiUsage || null,
      config.preferredName || null,
      config.assistantName || null,
      config.proactiveSuggestions !== undefined ? (config.proactiveSuggestions ? 1 : 0) : null,
      config.memoryAcknowledgment !== undefined ? (config.memoryAcknowledgment ? 1 : 0) : null,
      config.gentleReminders !== undefined ? (config.gentleReminders ? 1 : 0) : null,
      config.communicationNotes || null,
      now,
      now
    )
    .run();
}

/**
 * Reset personality to defaults
 */
export async function resetUserPersonality(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM user_personality WHERE user_id = ?`).bind(userId).run();
}
