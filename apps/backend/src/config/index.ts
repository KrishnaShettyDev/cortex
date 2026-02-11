/**
 * Centralized Configuration Module
 * All configurable values in one place - no more hardcoding!
 *
 * For Cloudflare Workers: Use the getConfig(env) functions to pass bindings
 */

import type { Bindings } from '../types';

// =============================================================================
// API ENDPOINTS (Static - no env needed)
// =============================================================================

export const API_ENDPOINTS = {
  // OpenAI
  OPENAI_BASE: 'https://api.openai.com/v1',
  OPENAI_CHAT: 'https://api.openai.com/v1/chat/completions',
  OPENAI_EMBEDDINGS: 'https://api.openai.com/v1/embeddings',

  // Composio
  COMPOSIO_V3: 'https://backend.composio.dev/api/v3',
  COMPOSIO_V2: 'https://backend.composio.dev/api/v2',

  // Google APIs
  GOOGLE_GMAIL: 'https://www.googleapis.com/gmail/v1',
  GOOGLE_CALENDAR: 'https://www.googleapis.com/calendar/v3',
  GOOGLE_PEOPLE: 'https://people.googleapis.com/v1',

  // External Services
  SERPER_API: 'https://google.serper.dev',
  OPENWEATHERMAP_API: 'https://api.openweathermap.org/data/2.5',
  YELP_API: 'https://api.yelp.com/v3',

  // Push Notifications
  EXPO_PUSH: 'https://exp.host/--/api/v2/push/send',
  EXPO_RECEIPTS: 'https://exp.host/--/api/v2/push/getReceipts',
  APNS_PRODUCTION: 'https://api.push.apple.com',
  APNS_SANDBOX: 'https://api.sandbox.push.apple.com',
} as const;

// =============================================================================
// MODEL CONFIGURATION
// =============================================================================

export const MODELS = {
  // Chat/Completion Models (defaults - can be overridden via env)
  CHAT_DEFAULT: 'gpt-4o-mini',
  CHAT_FAST: 'gpt-4o-mini',
  CHAT_SMART: 'gpt-4o',

  // Embedding Models
  EMBEDDING_CLOUDFLARE: '@cf/baai/bge-base-en-v1.5',
  EMBEDDING_OPENAI: 'text-embedding-3-small',

  // Model Pricing (per 1M tokens)
  PRICING: {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  } as Record<string, { input: number; output: number }>,
} as const;

// Helper to get model from env
export function getChatModel(env?: Partial<Bindings>): string {
  return (env as any)?.LLM_MODEL || MODELS.CHAT_DEFAULT;
}

// =============================================================================
// TIMEOUTS (in milliseconds) - Static defaults
// =============================================================================

export const TIMEOUTS = {
  FAST: 5000,
  NORMAL: 15000,
  SLOW: 30000,
  VERY_SLOW: 60000,
  COMPOSIO: 30000,
  LLM_CALL: 30000,
  WEBHOOK: 10000,
} as const;

// =============================================================================
// BATCH SIZES AND LIMITS - Static defaults
// =============================================================================

export const BATCH_SIZES = {
  EMBEDDING: 10,
  VECTORIZE: 100,
  ENTITIES: 100,
  NOTIFICATIONS: 50,
  RERANK: 20,
  TRIGGERS: 50,
  QUEUE: 5,
  APNS: 50,
} as const;

export const LIMITS = {
  MAX_INPUT_LENGTH: 512,
  MAX_FACT_LENGTH: 500,
  MAX_QUERY_LENGTH: 1000,
  MAX_TOOL_RESULT_CHARS: 80000,
  MAX_SEARCH_RESULTS: 10,
  MAX_EMAILS_FETCH: 50,
  MAX_CALENDAR_EVENTS: 50,
  MAX_HISTORY_MESSAGES: 10,
  MAX_USERS_PER_SYNC: 10,
  CONTEXT_WINDOW: 50,
} as const;

// =============================================================================
// TTLs AND EXPIRY TIMES - Static defaults
// =============================================================================

export const TTL = {
  // Cache TTLs (seconds)
  SEARCH_CACHE: 3600, // 1 hour
  CLASSIFICATION_CACHE: 3600, // 1 hour
  SEEN_EVENTS: 86400, // 24 hours

  // Expiry times (seconds)
  ACTION_EXPIRY: 300, // 5 minutes
  AUTH_LINK_EXPIRY: 3600, // 1 hour
  APNS_TOKEN_REFRESH: 3000, // 50 minutes

  // Sync intervals (milliseconds)
  MIN_SYNC_INTERVAL_MS: 300000, // 5 minutes
  ACTIVE_USER_THRESHOLD_MS: 3600000, // 1 hour
} as const;

// =============================================================================
// CRON CONFIGURATION
// =============================================================================

export const CRON = {
  WALL_TIME_LIMIT_MS: 25000,
  LOCK_TTL_SECONDS: 120,
  LOCK_STALE_MS: 55000,
  LLM_BUDGET_PER_MINUTE: 10,
} as const;

// =============================================================================
// FEATURE FLAGS
// =============================================================================

export function getFeatureFlags(env?: Partial<Bindings>) {
  return {
    PROACTIVE_ENABLED: env?.PROACTIVE_ENABLED !== 'false',
    MULTI_AGENT_ENABLED: env?.MULTI_AGENT_ENABLED === 'true',
  };
}

// =============================================================================
// SECURITY CONFIGURATION
// =============================================================================

export const SECURITY = {
  API_KEY_LENGTH: 32,
  JWT_EXPIRY: '7d',
  REFRESH_TOKEN_EXPIRY: '30d',
} as const;

// =============================================================================
// ERROR THRESHOLDS
// =============================================================================

export const THRESHOLDS = {
  CIRCUIT_BREAKER: 5,
  HALLUCINATION_RATE: 0.05,
} as const;

// =============================================================================
// CORS AND ALLOWED ORIGINS
// =============================================================================

export function getAllowedOrigins(env?: Partial<Bindings>): string[] {
  const envOrigins = (env as any)?.ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o: string) => o.trim());
  }

  // Default allowed origins
  return [
    'https://app.askcortex.plutas.in',
    'https://askcortex.plutas.in',
    'https://cortex-console.pages.dev',
    'https://console.askcortex.in',
  ];
}

// =============================================================================
// WEBHOOK AND BASE URLS
// =============================================================================

export function getWebhookBaseUrl(env?: Partial<Bindings>): string {
  return env?.WEBHOOK_BASE_URL || 'https://askcortex.plutas.in';
}

export function getMediaBaseUrl(env?: Partial<Bindings>): string {
  return (env as any)?.MEDIA_BASE_URL || 'https://media.askcortex.com';
}

// =============================================================================
// COMPOSIO CONFIGURATION
// =============================================================================

export function getComposioAuthConfigId(env?: Partial<Bindings>): string {
  return (env as any)?.COMPOSIO_GOOGLE_SUPER_AUTH_CONFIG_ID || 'ac_lt9oHFMw6m0T';
}

// =============================================================================
// TIMEZONE CONFIGURATION
// =============================================================================

export function getDefaultTimezone(env?: Partial<Bindings>): string {
  return (env as any)?.DEFAULT_TIMEZONE || 'UTC';
}

// =============================================================================
// APNS CONFIGURATION
// =============================================================================

export function getApnsEndpoint(isProduction: boolean = true): string {
  return isProduction ? API_ENDPOINTS.APNS_PRODUCTION : API_ENDPOINTS.APNS_SANDBOX;
}
