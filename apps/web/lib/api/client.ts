/**
 * API Client for Cortex Backend
 * Clean, typed API client with consistent error handling
 */

import type { Memory, MemoriesResponse, SearchResponse } from '@/types/memory';
import type { CalendarEvent, CalendarEventsResponse, CreateCalendarEventRequest } from '@/types/calendar';
import type { AutonomousAction } from '@/types/autonomousActions';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://askcortex.plutas.in';

// ============================================================================
// Types
// ============================================================================

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

export interface IntegrationStatus {
  gmail: {
    connected: boolean;
    email: string | null;
    last_sync: string | null;
  };
  calendar: {
    connected: boolean;
    email: string | null;
    last_sync: string | null;
  };
}

export interface ConnectResponse {
  redirectUrl: string;
  linkToken: string;
  expiresAt: string;
}

export interface RecallResponse {
  answer: string;
  memories: Memory[];
  sources: Array<{ id: string; content: string; score: number }>;
}

export interface BriefingResponse {
  greeting: string;
  summary: string;
  urgent_items: Array<{ type: string; title: string; description: string; count?: number }>;
  insights: Array<{ type: string; count: number; label: string }>;
  autonomous_actions: AutonomousAction[];
}

export interface ApiError extends Error {
  status: number;
  code?: string;
}

// ============================================================================
// API Client Class
// ============================================================================

class ApiClient {
  private baseURL: string;
  private token: string | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
  }

  setToken(token: string): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  clearToken(): void {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = this.baseURL + endpoint;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = 'Bearer ' + this.token;
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(errorText || `API error: ${response.status}`) as ApiError;
      error.status = response.status;
      throw error;
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return {} as T;

    return JSON.parse(text);
  }

  // ==========================================================================
  // Auth
  // ==========================================================================

  async googleSignIn(idToken: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  }

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async deleteAccount(): Promise<void> {
    return this.request('/auth/account', { method: 'DELETE' });
  }

  // ==========================================================================
  // Integrations
  // ==========================================================================

  async getIntegrationStatus(): Promise<IntegrationStatus> {
    return this.request<IntegrationStatus>('/integrations/status');
  }

  async connectGmail(): Promise<ConnectResponse> {
    return this.request<ConnectResponse>('/integrations/gmail/connect', { method: 'POST' });
  }

  async connectCalendar(): Promise<ConnectResponse> {
    return this.request<ConnectResponse>('/integrations/calendar/connect', { method: 'POST' });
  }

  async disconnectIntegration(provider: 'gmail' | 'calendar'): Promise<void> {
    return this.request(`/integrations/${provider}`, { method: 'DELETE' });
  }

  async syncGmail(): Promise<{ success: boolean; synced: number }> {
    return this.request('/integrations/gmail/sync', { method: 'POST' });
  }

  async syncCalendar(): Promise<{ success: boolean; synced: number }> {
    return this.request('/integrations/calendar/sync', { method: 'POST' });
  }

  // ==========================================================================
  // Memories
  // ==========================================================================

  async getMemories(params?: { limit?: number; offset?: number; source?: string }): Promise<MemoriesResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.source) query.set('source', params.source);

    const queryStr = query.toString();
    return this.request<MemoriesResponse>(`/v3/memories${queryStr ? '?' + queryStr : ''}`);
  }

  async getMemory(id: string): Promise<Memory> {
    return this.request<Memory>(`/v3/memories/${id}`);
  }

  async createMemory(content: string, metadata?: Record<string, unknown>): Promise<Memory> {
    return this.request<Memory>('/v3/memories', {
      method: 'POST',
      body: JSON.stringify({ content, metadata }),
    });
  }

  async updateMemory(id: string, content: string): Promise<Memory> {
    return this.request<Memory>(`/v3/memories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMemory(id: string): Promise<void> {
    return this.request(`/v3/memories/${id}`, { method: 'DELETE' });
  }

  async searchMemories(query: string): Promise<SearchResponse> {
    return this.request<SearchResponse>('/v3/search', {
      method: 'POST',
      body: JSON.stringify({ q: query }),
    });
  }

  // ==========================================================================
  // Chat / Recall
  // ==========================================================================

  async recall(query: string): Promise<RecallResponse> {
    return this.request<RecallResponse>('/v3/recall', {
      method: 'POST',
      body: JSON.stringify({ q: query }),
    });
  }

  async chat(message: string): Promise<{ response: string; memories: Memory[] }> {
    return this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // ==========================================================================
  // Briefing & Insights
  // ==========================================================================

  async getBriefing(): Promise<BriefingResponse> {
    return this.request<BriefingResponse>('/chat/briefing');
  }

  async getInsights(): Promise<{ insights: Array<{ type: string; count: number; label: string }> }> {
    return this.request('/chat/insights');
  }

  async getAutonomousActions(): Promise<AutonomousAction[]> {
    return this.request<AutonomousAction[]>('/autonomous-actions');
  }

  // ==========================================================================
  // Calendar
  // ==========================================================================

  async getCalendarEvents(params: { start: string; end: string }): Promise<CalendarEventsResponse> {
    const query = new URLSearchParams({ start: params.start, end: params.end });
    return this.request<CalendarEventsResponse>(`/integrations/calendar/events?${query}`);
  }

  async createCalendarEvent(event: CreateCalendarEventRequest): Promise<CalendarEvent> {
    return this.request<CalendarEvent>('/integrations/calendar/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async updateCalendarEvent(id: string, event: Partial<CreateCalendarEventRequest>): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/integrations/calendar/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(event),
    });
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    return this.request(`/integrations/calendar/events/${id}`, { method: 'DELETE' });
  }

  // ==========================================================================
  // Actions
  // ==========================================================================

  async approveAction(actionId: string, modifications?: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request('/actions/approve', {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId, modifications }),
    });
  }

  async dismissAction(actionId: string, reason?: string): Promise<void> {
    return this.request('/actions/dismiss', {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId, reason }),
    });
  }

  // ==========================================================================
  // Profile
  // ==========================================================================

  async getProfile(): Promise<{ user: User; stats: { memories: number; entities: number } }> {
    return this.request('/v3/profile');
  }
}

export const apiClient = new ApiClient();
