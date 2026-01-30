/**
 * Shared types for Cortex API
 */

export interface Bindings {
  DB: D1Database;
  VECTORIZE: Vectorize;
  MEDIA: R2Bucket;
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  COMPOSIO_API_KEY: string;
  GOOGLE_CLIENT_ID?: string;
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
