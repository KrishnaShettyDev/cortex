/**
 * API Client for Cortex Backend
 * Connects to Cloudflare Workers at askcortex.plutas.in
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://askcortex.plutas.in';

export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

class ApiClient {
  private baseURL: string;
  private token: string | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.baseURL + endpoint;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('API error: ' + response.status + ' - ' + error);
    }

    return response.json();
  }

  async googleSignIn(idToken: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  }

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async getIntegrationStatus() {
    return this.request('/integrations/status');
  }

  async connectGmail(): Promise<{ redirectUrl: string; linkToken: string; expiresAt: string }> {
    return this.request('/integrations/gmail/connect', { method: 'POST' });
  }

  async connectCalendar(): Promise<{ redirectUrl: string; linkToken: string; expiresAt: string }> {
    return this.request('/integrations/calendar/connect', { method: 'POST' });
  }

  async syncGmail() {
    return this.request('/integrations/gmail/sync', { method: 'POST' });
  }

  async syncCalendar() {
    return this.request('/integrations/calendar/sync', { method: 'POST' });
  }

  async getMemories(query?: string): Promise<{ memories: any[] }> {
    const params = query ? '?query=' + encodeURIComponent(query) : '';
    return this.request('/v3/memories' + params);
  }

  async addMemory(content: string) {
    return this.request('/v3/memories', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async search(query: string): Promise<{ results: any[] }> {
    return this.request('/v3/search', {
      method: 'POST',
      body: JSON.stringify({ q: query }),
    });
  }

  async getProfile() {
    return this.request('/v3/profile');
  }
}

export const apiClient = new ApiClient();
