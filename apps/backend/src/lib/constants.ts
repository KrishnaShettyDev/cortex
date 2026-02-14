/**
 * Application Constants
 *
 * Centralized configuration for magic numbers and timeouts.
 * Use these instead of hardcoding values throughout the codebase.
 */

// =============================================================================
// TIME CONSTANTS (in milliseconds)
// =============================================================================

export const TIME = {
  /** 1 second */
  SECOND: 1000,
  /** 1 minute */
  MINUTE: 60 * 1000,
  /** 1 hour */
  HOUR: 60 * 60 * 1000,
  /** 1 day */
  DAY: 24 * 60 * 60 * 1000,
  /** 1 week */
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// =============================================================================
// EXPIRATION DURATIONS
// =============================================================================

export const EXPIRY = {
  /** Pending action expiration: 5 minutes */
  PENDING_ACTION: 5 * TIME.MINUTE,
  /** Auth token expiration: 7 days */
  AUTH_TOKEN: 7 * TIME.DAY,
  /** Password reset expiration: 1 hour */
  PASSWORD_RESET: 1 * TIME.HOUR,
  /** Email verification expiration: 24 hours */
  EMAIL_VERIFICATION: 24 * TIME.HOUR,
  /** Session expiration: 30 days */
  SESSION: 30 * TIME.DAY,
  /** MCP keepalive interval: 30 seconds */
  MCP_KEEPALIVE: 30 * TIME.SECOND,
} as const;

// =============================================================================
// CACHE TTL (in seconds for KV)
// =============================================================================

export const CACHE_TTL = {
  /** Embedding cache: 1 hour */
  EMBEDDING: 60 * 60,
  /** Profile cache: 5 minutes */
  PROFILE: 5 * 60,
  /** Search results: 5 minutes */
  SEARCH: 5 * 60,
  /** Entity cache: 30 minutes */
  ENTITY: 30 * 60,
  /** Search cache generation: 24 hours */
  SEARCH_GENERATION: 24 * 60 * 60,
} as const;

// =============================================================================
// LIMITS
// =============================================================================

export const LIMITS = {
  /** Maximum tool result characters (prevents context overflow) */
  MAX_TOOL_RESULT_CHARS: 80000,
  /** Maximum history messages to include */
  MAX_HISTORY_MESSAGES: 10,
  /** Maximum memories per search */
  MAX_MEMORIES_PER_SEARCH: 10,
  /** iOS geofence limit */
  MAX_GEOFENCES: 20,
  /** Maximum retry attempts for processing jobs */
  MAX_RETRIES: 3,
  /** Maximum content length for sanitization */
  MAX_CONTENT_LENGTH: 200000,
  /** Maximum prompt length */
  MAX_PROMPT_LENGTH: 4000,
  /** Maximum message length */
  MAX_MESSAGE_LENGTH: 2000,
  /** Vector batch size for indexing */
  VECTOR_BATCH_SIZE: 100,
  /** Maximum vectors per query */
  MAX_VECTOR_QUERY: 1000,
} as const;

// =============================================================================
// SCORES & THRESHOLDS
// =============================================================================

export const THRESHOLDS = {
  /** Minimum vector similarity score */
  MIN_VECTOR_SCORE: 0.7,
  /** Minimum AUDN similarity score */
  MIN_AUDN_SCORE: 0.75,
  /** Minimum confidence for contextual memory extraction */
  MIN_CONTEXTUAL_CONFIDENCE: 0.6,
  /** Minimum confidence for semantic facts */
  MIN_SEMANTIC_CONFIDENCE: 0.7,
  /** Importance threshold for consolidation */
  CONSOLIDATION_IMPORTANCE: 0.3,
  /** High similarity threshold for conflict detection */
  HIGH_SIMILARITY: 0.85,
  /** Minimum temporal extraction confidence */
  MIN_TEMPORAL_CONFIDENCE: 0.7,
  /** Grounded response minimum composite score */
  MIN_COMPOSITE_SCORE: 0.40,
  /** Grounded response minimum support count */
  MIN_SUPPORT_COUNT: 2,
} as const;

// =============================================================================
// API CONFIGURATION
// =============================================================================

export const API = {
  /** Default request timeout (45 seconds) */
  DEFAULT_TIMEOUT: 45000,
  /** Maximum API iterations (agentic loops) */
  MAX_ITERATIONS: 10,
  /** Interaction agent max iterations */
  INTERACTION_MAX_ITERATIONS: 5,
  /** Execution agent max iterations */
  EXECUTION_MAX_ITERATIONS: 10,
  /** Exponential backoff max delay */
  MAX_BACKOFF_DELAY: 60000,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate expiration timestamp
 * @param duration Duration in milliseconds
 * @returns ISO timestamp string
 */
export function getExpirationTimestamp(duration: number): string {
  return new Date(Date.now() + duration).toISOString();
}

/**
 * Calculate exponential backoff delay
 * @param retryCount Current retry count
 * @param baseDelay Base delay in ms (default 1000)
 * @param maxDelay Maximum delay in ms
 * @returns Delay in milliseconds
 */
export function getBackoffDelay(
  retryCount: number,
  baseDelay: number = 1000,
  maxDelay: number = API.MAX_BACKOFF_DELAY
): number {
  return Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
}
