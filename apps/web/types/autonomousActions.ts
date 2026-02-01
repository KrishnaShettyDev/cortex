/**
 * Autonomous Actions Types
 * Types for AI-powered action suggestions
 */

export type ActionType =
  | 'email_reply'
  | 'calendar_create'
  | 'calendar_reschedule'
  | 'meeting_prep'
  | 'reminder'
  | 'follow_up';

export interface EmailPayload {
  thread_id: string;
  to: string;
  subject: string;
  body: string;
}

export interface CalendarPayload {
  event_id?: string;
  title: string;
  start_time: string;
  end_time: string;
  attendees?: string[];
  location?: string;
  description?: string;
}

export interface ReminderPayload {
  title: string;
  time: string;
  note?: string;
}

export type ActionPayload = EmailPayload | CalendarPayload | ReminderPayload;

export interface AutonomousAction {
  id: string;
  action_type: ActionType;
  title: string;
  description: string;
  action_payload: ActionPayload;
  reason: string;
  confidence_score: number; // 0-1
  priority_score: number; // 0-100
  source_type: string; // 'email', 'calendar', 'pattern', 'memory'
  created_at: string;
  expires_at: string;
}

export interface ActionExecutionResult {
  success: boolean;
  message: string;
  event_id?: string;
  event_url?: string;
  message_id?: string;
}
