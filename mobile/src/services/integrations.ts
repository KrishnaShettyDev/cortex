import { api } from './api';

export interface IntegrationStatus {
  connected: boolean;
  email: string | null;
  last_sync: string | null;
  status: 'active' | 'expired' | 'not_connected';
  gmail_connected: boolean;
  calendar_connected: boolean;
}

export interface IntegrationsStatus {
  google: IntegrationStatus;
  microsoft: IntegrationStatus;
}

export interface OAuthRedirectResponse {
  redirect_url: string;
}

export interface SyncResponse {
  memories_added: number;
  errors: string[];
}

// Calendar types - kept for future implementation
export interface CalendarEventAttendee {
  email: string;
  name?: string;
  optional?: boolean;
}

export type MeetingType = 'google_meet' | 'zoom' | 'teams' | 'webex' | 'video' | 'offline';

export interface CalendarEventItem {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location?: string;
  description?: string;
  attendees: string[];
  color?: string;
  html_link?: string;
  meet_link?: string;
  meeting_type: MeetingType;
}

class IntegrationsService {
  /**
   * Get the connection status of all integrations
   */
  async getStatus(): Promise<IntegrationsStatus> {
    return api.request<IntegrationsStatus>('/integrations/status');
  }

  /**
   * Connect Gmail - initiates OAuth flow
   * Backend endpoint: POST /integrations/gmail/connect
   */
  async connectGmail(): Promise<OAuthRedirectResponse> {
    return api.request<OAuthRedirectResponse>('/integrations/gmail/connect', {
      method: 'POST',
    });
  }

  /**
   * Connect Google Calendar - initiates OAuth flow
   * Backend endpoint: POST /integrations/calendar/connect
   */
  async connectCalendar(): Promise<OAuthRedirectResponse> {
    return api.request<OAuthRedirectResponse>('/integrations/calendar/connect', {
      method: 'POST',
    });
  }

  /**
   * Connect both Gmail and Calendar (convenience method)
   * Calls both connect endpoints and returns both redirect URLs
   */
  async connectGoogle(): Promise<{ gmail: string; calendar: string }> {
    const [gmailResponse, calendarResponse] = await Promise.all([
      this.connectGmail(),
      this.connectCalendar(),
    ]);
    return {
      gmail: gmailResponse.redirect_url,
      calendar: calendarResponse.redirect_url,
    };
  }

  /**
   * Get the Google OAuth connect URL
   * Used for initiating OAuth flow from settings/connected-accounts screens
   * @param returnUrl - The URL to redirect back to after OAuth completes
   */
  async getGoogleConnectUrl(returnUrl: string): Promise<string> {
    const response = await api.request<{ redirect_url: string }>('/auth/google/connect', {
      method: 'POST',
      body: { return_url: returnUrl },
    });
    return response.redirect_url;
  }

  /**
   * Disconnect a provider (gmail, calendar, etc.)
   * Backend endpoint: DELETE /integrations/:provider
   */
  async disconnect(provider: 'gmail' | 'calendar' | 'google'): Promise<void> {
    await api.request(`/integrations/${provider}`, { method: 'DELETE' });
  }

  /**
   * Disconnect Google (both Gmail and Calendar)
   */
  async disconnectGoogle(): Promise<void> {
    await this.disconnect('google');
  }

  /**
   * Trigger Gmail sync
   * Backend endpoint: POST /integrations/gmail/sync
   */
  async syncGmail(): Promise<SyncResponse> {
    return api.request<SyncResponse>('/integrations/gmail/sync', {
      method: 'POST',
    });
  }

  /**
   * Trigger Calendar sync
   * Backend endpoint: POST /integrations/calendar/sync
   */
  async syncCalendar(): Promise<SyncResponse> {
    return api.request<SyncResponse>('/integrations/calendar/sync', {
      method: 'POST',
    });
  }

  /**
   * Sync both Gmail and Calendar
   */
  async syncGoogle(): Promise<{ gmail: SyncResponse; calendar: SyncResponse }> {
    const [gmailResult, calendarResult] = await Promise.all([
      this.syncGmail(),
      this.syncCalendar(),
    ]);
    return {
      gmail: gmailResult,
      calendar: calendarResult,
    };
  }

  // ============== Calendar CRUD ==============
  // NOTE: These endpoints are not yet implemented in the backend.
  // The UI should hide these features or show "coming soon" until backend adds support.
  // Keeping the type definitions for future use.

  /**
   * @deprecated Calendar CRUD not implemented in backend yet
   */
  async getCalendarEvents(_startDate: Date, _endDate: Date): Promise<{ events: CalendarEventItem[] }> {
    console.warn('IntegrationsService: getCalendarEvents not implemented in backend');
    return { events: [] };
  }

  // ============== Email CRUD ==============
  // NOTE: Email listing/sending not implemented in backend yet.
  // The UI should hide these features until backend adds support.
}

export const integrationsService = new IntegrationsService();
