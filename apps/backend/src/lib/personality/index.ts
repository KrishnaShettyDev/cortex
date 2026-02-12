/**
 * Personality Module
 *
 * Handles per-user personality customization:
 * - Automatic learning from user messages
 * - Tone presets (professional, casual, supportive, sassy, coaching, balanced)
 * - Verbosity and emoji preferences
 * - Name preferences
 */

export { TONE_PRESETS, type TonePreset, type ToneConfig } from '../../config/tone-presets';
export {
  getUserPersonality,
  saveUserPersonality,
  resetUserPersonality,
  DEFAULT_PERSONALITY,
  type PersonalityConfig,
} from './loader';
export { learnFromConversation, getLearnedMessageCount, type LearnedPreferences } from './learning';
