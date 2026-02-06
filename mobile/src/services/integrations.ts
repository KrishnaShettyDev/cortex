/**
 * Integrations Service
 *
 * Handles OAuth connections for:
 * - Google (Gmail, Calendar, Drive, Docs via Google Super)
 * - Slack
 * - Notion
 *
 * Also provides calendar integration for reading/creating events.
 */

import { api } from './api';

// ============== Provider Status Types ==============

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

// ============== Calendar Types ==============

export type MeetingType = 'google_meet' | 'zoom' | 'teams' | 'webex' | 'offline';

export interface CalendarEventItem {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  meet_link?: string;
  meeting_type?: MeetingType;
  color?: string;
  attendees?: string[];
  is_all_day?: boolean;
  calendar_id?: string;
}

export interface TimeSlot {
  start: string;
  end: string;
  duration_minutes: number;
}

export interface CreateCalendarEventRequest {
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  location?: string;
  attendees?: string[];
  send_notifications?: boolean;
}

export interface CreateCalendarEventResponse {
  success: boolean;
  event?: CalendarEventItem;
  error?: string;
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

  // ============== CALENDAR METHODS ==============

  /**
   * Get calendar events for a date range
   */
  async getCalendarEvents(
    startDate: Date,
    endDate: Date
  ): Promise<{ events: CalendarEventItem[] }> {
    const params = new URLSearchParams({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });
    return api.request<{ events: CalendarEventItem[] }>(`/integrations/google/calendar/events?${params}`);
  }

  /**
   * Create a new calendar event
   */
  async createCalendarEvent(
    request: CreateCalendarEventRequest
  ): Promise<CreateCalendarEventResponse> {
    return api.request<CreateCalendarEventResponse>('/integrations/google/calendar/events', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * Find available time slots
   */
  async findAvailableSlots(
    date: Date,
    durationMinutes: number = 30
  ): Promise<{ slots: TimeSlot[] }> {
    const params = new URLSearchParams({
      date: date.toISOString().split('T')[0],
      duration: durationMinutes.toString(),
    });
    return api.request<{ slots: TimeSlot[] }>(`/integrations/google/calendar/available?${params}`);
  }
}

export const integrationsService = new IntegrationsService();
