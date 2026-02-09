/**
 * Shared types for Cortex API
 */

import type { Context } from 'hono';

export interface Bindings {
  DB: D1Database;
  VECTORIZE: Vectorize;
  MEDIA: R2Bucket;
  AI: any; // Cloudflare AI for embeddings
  CACHE: KVNamespace; // KV for caching
  PROCESSING_QUEUE?: Queue<any>; // Queue for async processing (optional, requires paid plan)
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  COMPOSIO_API_KEY: string;
  COMPOSIO_WEBHOOK_SECRET?: string; // HMAC secret for webhook signature verification
  // Composio OAuth auth config IDs (from Composio dashboard)
  COMPOSIO_GMAIL_AUTH_CONFIG_ID?: string;
  COMPOSIO_CALENDAR_AUTH_CONFIG_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  // World context API keys
  OPENWEATHER_API_KEY?: string;
  SERPER_API_KEY?: string;
  YELP_API_KEY?: string;
  // APNs push notifications
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_KEY_BASE64?: string; // Base64-encoded .p8 key
  // Feature flags
  MULTI_AGENT_ENABLED?: string; // 'true' to enable multi-agent orchestration
  PROACTIVE_ENABLED?: string; // 'true' to enable proactive monitoring
}

export interface ErrorResponse {
  error: string;
  details?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

export interface UserResponse {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface IntegrationStatus {
  connected: boolean;
  email: string | null;
  last_sync: string | null;
}

export interface IntegrationsResponse {
  google: IntegrationStatus;
  apple: IntegrationStatus;
}

// Env alias for Bindings (used in some handlers)
export type Env = Bindings;

// User type for authenticated contexts
export interface User {
  id: string;
  email: string;
  name?: string;
  timezone?: string;
}

// Authenticated context with user attached
export type AuthenticatedContext = Context<{
  Bindings: Bindings;
  Variables: {
    user: User;
    jwtPayload: { sub: string; email: string };
    userId: string;
    tenantScope?: { containerTag: string };
  };
}>;
