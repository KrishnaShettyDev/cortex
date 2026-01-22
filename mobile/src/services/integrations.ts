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

// Calendar types
export interface CalendarEventAttendee {
  email: string;
  name?: string;
  optional?: boolean;
}

export interface CreateCalendarEventRequest {
  title: string;
  description?: string;
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  location?: string;
  attendees?: CalendarEventAttendee[];
  send_notifications?: boolean;
}

export interface UpdateCalendarEventRequest {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  attendees?: CalendarEventAttendee[];
  send_notifications?: boolean;
}

export interface CalendarEventResponse {
  success: boolean;
  event_id: string;
  event_url?: string;
  message: string;
}

// Calendar Events List types
export interface CalendarEventItem {
  id: string;
  title: string;
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  is_all_day: boolean;
  location?: string;
  description?: string;
  attendees: string[];
  color?: string;
  html_link?: string;
}

export interface CalendarEventsResponse {
  success: boolean;
  events: CalendarEventItem[];
  message?: string;
}

// Email types
export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailItem {
  id: string;
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string | null;
}

export interface InboxResponse {
  success: boolean;
  emails: EmailItem[];
  message: string;
}

export interface SendEmailRequest {
  to: EmailRecipient[];
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  subject: string;
  body: string;
  is_html?: boolean;
  reply_to_message_id?: string;
}

export interface EmailResponse {
  success: boolean;
  message_id?: string;
  thread_id?: string;
  message: string;
}

class IntegrationsService {
  /**
   * Get the connection status of all integrations
   */
  async getStatus(): Promise<IntegrationsStatus> {
    return api.request<IntegrationsStatus>('/integrations/status');
  }

  /**
   * Get OAuth URL for connecting Google account
   *
   * Uses unified 'googlesuper' which provides access to Gmail, Calendar,
   * Drive, and all other Google services with a single OAuth flow.
   *
   * The backend handles the callback URL automatically and redirects
   * back to the app via deep link after OAuth completes.
   *
   * @param appReturnUrl - The deep link URL to return to after OAuth (from Linking.createURL)
   */
  async getGoogleConnectUrl(appReturnUrl?: string): Promise<string> {
    const params = new URLSearchParams();
    if (appReturnUrl) params.append('app_return_url', appReturnUrl);
    // Backend always uses googlesuper for unified Google access
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.request<OAuthRedirectResponse>(`/integrations/google/connect${queryString}`);
    return response.redirect_url;
  }

  /**
   * Disconnect Google account
   */
  async disconnectGoogle(): Promise<void> {
    await api.request('/integrations/google', { method: 'DELETE' });
  }

  /**
   * Trigger a sync for Google (Gmail + Calendar)
   */
  async syncGoogle(): Promise<SyncResponse> {
    return api.request<SyncResponse>('/integrations/sync', {
      method: 'POST',
      body: { provider: 'google' },
    });
  }

  // ============== Calendar Actions ==============

  /**
   * Get calendar events for a date range
   */
  async getCalendarEvents(startDate: Date, endDate: Date): Promise<CalendarEventsResponse> {
    const params = new URLSearchParams();
    params.append('start_date', startDate.toISOString());
    params.append('end_date', endDate.toISOString());
    return api.request<CalendarEventsResponse>(`/integrations/google/calendar/events?${params.toString()}`);
  }

  /**
   * Create a new calendar event
   */
  async createCalendarEvent(request: CreateCalendarEventRequest): Promise<CalendarEventResponse> {
    return api.request<CalendarEventResponse>('/integrations/google/calendar/events', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * Update/reschedule a calendar event
   */
  async updateCalendarEvent(eventId: string, request: UpdateCalendarEventRequest): Promise<CalendarEventResponse> {
    return api.request<CalendarEventResponse>(`/integrations/google/calendar/events/${eventId}`, {
      method: 'PUT',
      body: request,
    });
  }

  /**
   * Delete a calendar event
   */
  async deleteCalendarEvent(eventId: string, sendNotifications: boolean = true): Promise<CalendarEventResponse> {
    return api.request<CalendarEventResponse>(
      `/integrations/google/calendar/events/${eventId}?send_notifications=${sendNotifications}`,
      { method: 'DELETE' }
    );
  }

  // ============== Email Actions ==============

  /**
   * Get inbox emails
   */
  async getInbox(maxResults: number = 20, unreadOnly: boolean = false): Promise<InboxResponse> {
    const params = new URLSearchParams();
    params.append('max_results', maxResults.toString());
    if (unreadOnly) params.append('unread_only', 'true');
    return api.request<InboxResponse>(`/integrations/google/gmail/inbox?${params.toString()}`);
  }

  /**
   * Send an email via Gmail
   */
  async sendEmail(request: SendEmailRequest): Promise<EmailResponse> {
    return api.request<EmailResponse>('/integrations/google/gmail/send', {
      method: 'POST',
      body: request,
    });
  }
}

export const integrationsService = new IntegrationsService();
