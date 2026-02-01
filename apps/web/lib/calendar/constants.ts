/**
 * Calendar Constants
 * Matching mobile app constants
 */

import type { MeetingType } from '@/types/calendar';

// Timeline settings
export const START_HOUR = 7; // 7 AM
export const END_HOUR = 23; // 11 PM
export const HOUR_HEIGHT = 60; // pixels per hour

// Date strip settings
export const DATE_STRIP_ITEM_WIDTH = 60;
export const DATE_STRIP_DAYS_VISIBLE = 7;

// Week view settings
export const WEEK_VIEW_DAYS = 3; // 3-day view

// Swipe thresholds
export const SWIPE_THRESHOLD = 50;
export const SWIPE_VELOCITY_THRESHOLD = 500;

// Month names
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// Day names
export const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_SINGLE = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Meeting type configurations
export const MEETING_TYPE_CONFIG: Record<MeetingType, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon?: string;
}> = {
  google_meet: {
    label: 'Google Meet',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.1)',
    borderColor: '#00897B',
  },
  zoom: {
    label: 'Zoom',
    color: '#2D8CFF',
    bgColor: 'rgba(45, 140, 255, 0.1)',
    borderColor: '#2D8CFF',
  },
  teams: {
    label: 'Microsoft Teams',
    color: '#6264A7',
    bgColor: 'rgba(98, 100, 167, 0.1)',
    borderColor: '#6264A7',
  },
  webex: {
    label: 'Webex',
    color: '#00BCF2',
    bgColor: 'rgba(0, 188, 242, 0.1)',
    borderColor: '#00BCF2',
  },
  whatsapp: {
    label: 'WhatsApp',
    color: '#25D366',
    bgColor: 'rgba(37, 211, 102, 0.1)',
    borderColor: '#25D366',
  },
  offline: {
    label: 'In-Person',
    color: '#8E8E93',
    bgColor: 'rgba(142, 142, 147, 0.1)',
    borderColor: '#8E8E93',
  },
};

// Conflict colors
export const CONFLICT_COLOR = '#F59E0B';
export const CONFLICT_BORDER_COLOR = '#F59E0B';
