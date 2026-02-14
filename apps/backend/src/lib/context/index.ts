/**
 * Context Module Exports
 *
 * Proactive context building and monitoring for Cortex.
 */

export {
  getUserContext,
  formatContextForPrompt,
  type UserContext,
  type UserLocation,
  type UserPreferences,
  type ImportantPerson,
  type ActiveProject,
} from './user-context';

export {
  processMeetingPrepNotifications,
  syncCalendarEvents,
} from './meeting-prep';

export {
  handleNewEmail,
  classifyEmailImportance,
  pollNewEmails,
  type EmailEvent,
  type EmailImportance,
  type EmailClassification,
} from './email-monitor';
