/**
 * Calendar Types
 * Matching mobile app types exactly
 */

export type MeetingType = 'google_meet' | 'zoom' | 'teams' | 'webex' | 'whatsapp' | 'offline';
export type ViewMode = 'day' | 'week' | 'agenda';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string; // ISO string
  end_time: string; // ISO string
  location?: string;
  attendees?: string[];
  meeting_type?: MeetingType;
  meet_link?: string;
  color?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EventWithLayout extends CalendarEvent {
  column: number;
  totalColumns: number;
}

export interface TimeSlot {
  start: string; // ISO string
  end: string; // ISO string
  duration: number; // minutes
}

export interface ParsedEvent {
  title: string;
  start_time: string;
  end_time: string;
  location?: string;
  description?: string;
}

export interface CreateCalendarEventRequest {
  title: string;
  start_time: string;
  end_time: string;
  location?: string;
  description?: string;
  attendees?: string[];
  send_notifications?: boolean;
}

export interface CalendarEventsResponse {
  success: boolean;
  events: CalendarEvent[];
  message?: string;
}

export interface ConflictInfo {
  eventId: string;
  conflictsWith: string[];
}
