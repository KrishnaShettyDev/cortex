/**
 * PostHog Analytics configuration and event constants
 */

// Analytics event names for consistency across the app
export const ANALYTICS_EVENTS = {
  // Authentication
  SIGN_IN: 'user_signed_in',
  SIGN_OUT: 'user_signed_out',
  SIGN_IN_FAILED: 'sign_in_failed',
  SIGN_OUT_CONFIRMED: 'sign_out_confirmed',

  // Chat & Messages
  MESSAGE_SENT: 'message_sent',
  VOICE_RECORDING_STARTED: 'voice_recording_started',
  VOICE_RECORDING_COMPLETED: 'voice_recording_completed',
  SUGGESTION_TAPPED: 'suggestion_tapped',
  CONVERSATION_CLEARED: 'conversation_cleared',

  // Memory
  MEMORY_CREATED: 'memory_created',
  TEXT_MEMORY_CREATED: 'text_memory_created',
  VOICE_MEMORY_CREATED: 'voice_memory_created',
  PHOTO_MEMORY_CREATED: 'photo_memory_created',
  MEMORY_MODE_SWITCHED: 'memory_mode_switched',
  ADD_MEMORY_CANCELLED: 'add_memory_cancelled',

  // Calendar
  CALENDAR_VIEWED: 'calendar_viewed',
  CALENDAR_DATE_SELECTED: 'calendar_date_selected',
  CALENDAR_VIEW_TOGGLED: 'calendar_view_toggled',
  CALENDAR_NAVIGATED: 'calendar_navigated',
  CALENDAR_EVENT_TAPPED: 'calendar_event_tapped',
  CALENDAR_REFRESHED: 'calendar_refreshed',

  // Integrations
  GOOGLE_CONNECTED: 'google_account_connected',
  GOOGLE_DISCONNECTED: 'google_account_disconnected',
  GOOGLE_SYNC_COMPLETED: 'google_sync_completed',
  ACCOUNT_CONNECT_TAPPED: 'account_connect_tapped',
  ACCOUNT_SYNC_TAPPED: 'account_sync_tapped',

  // Settings
  THEME_CHANGED: 'theme_changed',
  SETTINGS_OPENED: 'settings_opened',
  NOTIFICATION_SETTING_CHANGED: 'notification_setting_changed',
  BIOMETRIC_TOGGLED: 'biometric_toggled',
  CONTACT_US_TAPPED: 'contact_us_tapped',

  // Navigation
  SCREEN_VIEWED: 'screen_viewed',
  FAB_TAPPED: 'fab_tapped',

  // Actions
  ACTION_APPROVED: 'action_approved',
  ACTION_REJECTED: 'action_rejected',

  // People
  PEOPLE_LIST_LOADED: 'people_list_loaded',
  PEOPLE_SORT_CHANGED: 'people_sort_changed',
  PERSON_TAPPED: 'person_tapped',
  PERSON_PROFILE_VIEWED: 'person_profile_viewed',
  MEETING_PREP_REQUESTED: 'meeting_prep_requested',
  MEETING_CONTEXT_GENERATED: 'meeting_context_generated',

  // Errors
  ERROR_OCCURRED: 'error_occurred',
  API_ERROR: 'api_error',
} as const;

// Type for event names
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
