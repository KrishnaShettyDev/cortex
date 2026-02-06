/**
 * Integrations Service
 *
 * Handles OAuth connections for:
 * - Google (Gmail, Calendar, Drive, Docs via Google Super)
 * - Slack
 * - Notion
 */

import { api } from './api';

export interface ProviderStatus {
  connected: boolean;
  email?: string | null;
  lastSync?: string | null;
}

export interface IntegrationsStatus {
  google?: ProviderStatus;
  googlesuper?: ProviderStatus;
  slack?: ProviderStatus;
  notion?: ProviderStatus;
}

export interface ConnectResponse {
  redirectUrl: string;
  linkToken?: string;
  expiresAt?: string;
}

class IntegrationsService {
  /**
   * Get connection status for all integrations
   */
  async getStatus(): Promise<IntegrationsStatus> {
    return api.request<IntegrationsStatus>('/integrations/status');
  }

  /**
   * Connect Google (Gmail, Calendar, Drive, Docs)
   */
  async getGoogleConnectUrl(returnUrl?: string): Promise<string> {
    const response = await api.request<ConnectResponse>('/integrations/google/connect', {
      method: 'POST',
      body: returnUrl ? { return_url: returnUrl } : undefined,
    });
    return response.redirectUrl;
  }

  /**
   * Connect Slack
   */
  async getSlackConnectUrl(returnUrl?: string): Promise<string> {
    const response = await api.request<ConnectResponse>('/integrations/slack/connect', {
      method: 'POST',
      body: returnUrl ? { return_url: returnUrl } : undefined,
    });
    return response.redirectUrl;
  }

  /**
   * Connect Notion
   */
  async getNotionConnectUrl(returnUrl?: string): Promise<string> {
    const response = await api.request<ConnectResponse>('/integrations/notion/connect', {
      method: 'POST',
      body: returnUrl ? { return_url: returnUrl } : undefined,
    });
    return response.redirectUrl;
  }

  /**
   * Disconnect a provider
   */
  async disconnect(provider: 'google' | 'slack' | 'notion'): Promise<void> {
    await api.request(`/integrations/${provider}/disconnect`, { method: 'DELETE' });
  }

  /**
   * Trigger sync for a provider
   */
  async sync(provider: 'google' | 'slack' | 'notion'): Promise<{ success: boolean }> {
    return api.request(`/integrations/${provider}/sync`, { method: 'POST' });
  }
}

export const integrationsService = new IntegrationsService();
