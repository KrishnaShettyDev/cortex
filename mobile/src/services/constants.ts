/**
 * Mobile App Constants
 *
 * Centralized configuration for magic numbers and timeouts.
 * Use these instead of hardcoding values throughout the codebase.
 */

// Re-export API URL from centralized config
export { API_BASE_URL } from '../config/env';

// =============================================================================
// STORAGE KEYS
// =============================================================================

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'cortex_access_token',
  REFRESH_TOKEN: 'cortex_refresh_token',
  USER: 'cortex_user',
} as const;

// =============================================================================
// API TIMEOUTS (in milliseconds)
// =============================================================================

export const API_TIMEOUTS = {
  /** Default request timeout */
  DEFAULT: 10000,
  /** Chat endpoint timeout (AI responses can take time) */
  CHAT: 60000,
  /** Streaming request timeout */
  STREAM: 90000,
  /** Long operations: calendar, integrations, feedback (Composio can be slow) */
  LONG_OPERATIONS: 45000,
} as const;

// =============================================================================
// CHAT CONFIGURATION
// =============================================================================

export const CHAT_CONFIG = {
  /** Maximum history messages to send for context */
  MAX_HISTORY_MESSAGES: 10,
  /** Characters per chunk when simulating streaming */
  STREAM_CHUNK_SIZE: 20,
  /** Delay between chunks for smooth streaming effect (ms) */
  STREAM_CHUNK_DELAY_MS: 30,
  /** Default model for chat */
  DEFAULT_MODEL: 'gpt-4o-mini',
  /** Default context limit for memory retrieval */
  DEFAULT_CONTEXT_LIMIT: 5,
} as const;

// =============================================================================
// UI DELAYS (in milliseconds)
// =============================================================================

export const UI_DELAYS = {
  /** Delay before showing status updates */
  STATUS_BEFORE: 400,
  /** Delay after showing status updates */
  STATUS_AFTER: 300,
  /** Toast display duration */
  TOAST_DURATION: 3000,
  /** Animation duration for transitions */
  ANIMATION_DURATION: 200,
} as const;

// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

export const RETRY_CONFIG = {
  /** Maximum retry attempts */
  MAX_ATTEMPTS: 3,
  /** Base delay for exponential backoff (ms) */
  BASE_DELAY: 1000,
  /** Maximum delay between retries (ms) */
  MAX_DELAY: 30000,
  /** Delay between geofencing init retries (ms) */
  GEOFENCING_RETRY_DELAY: 5000,
} as const;

// =============================================================================
// SYNC INTERVALS (in milliseconds)
// =============================================================================

export const SYNC_INTERVALS = {
  /** Background sync interval */
  BACKGROUND_SYNC: 15 * 60 * 1000, // 15 minutes
  /** Nudges refresh interval */
  NUDGES_REFRESH: 5 * 60 * 1000, // 5 minutes
  /** Calendar sync interval */
  CALENDAR_SYNC: 30 * 60 * 1000, // 30 minutes
} as const;

// =============================================================================
// LIMITS
// =============================================================================

export const LIMITS = {
  /** iOS geofence limit */
  MAX_GEOFENCES: 20,
  /** Maximum cached items */
  MAX_CACHE_ITEMS: 100,
  /** Maximum message length */
  MAX_MESSAGE_LENGTH: 10000,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate exponential backoff delay
 * @param attempt Current attempt number (0-indexed)
 * @param baseDelay Base delay in ms
 * @param maxDelay Maximum delay in ms
 * @returns Delay in milliseconds
 */
export function getBackoffDelay(
  attempt: number,
  baseDelay: number = RETRY_CONFIG.BASE_DELAY,
  maxDelay: number = RETRY_CONFIG.MAX_DELAY
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}

/**
 * Sleep for a specified duration
 * @param ms Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simulate streaming by chunking content
 * @param content Full content to stream
 * @param onChunk Callback for each chunk
 * @param chunkSize Characters per chunk
 * @param delayMs Delay between chunks
 */
export async function simulateStreaming(
  content: string,
  onChunk: (chunk: string, fullSoFar: string) => void,
  chunkSize: number = CHAT_CONFIG.STREAM_CHUNK_SIZE,
  delayMs: number = CHAT_CONFIG.STREAM_CHUNK_DELAY_MS
): Promise<void> {
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    onChunk(chunk, content.slice(0, i + chunkSize));
    await sleep(delayMs);
  }
}
