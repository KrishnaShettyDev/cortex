/**
 * Calendar utility functions and constants
 */
import { CalendarEventItem } from '../services';

// Time constants
export const START_HOUR = 0;
export const END_HOUR = 23;
export const HOUR_HEIGHT = 60;

// Month names
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Day names
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const DAYS_SINGLE = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Week view configuration
export const WEEK_VIEW_DAYS = 3;

// Date strip configuration
export const DATE_STRIP_ITEM_WIDTH = 48;
export const DATE_STRIP_DAYS_VISIBLE = 7;

// Swipe thresholds
export const SWIPE_THRESHOLD = 50;
export const SWIPE_VELOCITY_THRESHOLD = 500;

// View modes
export type ViewMode = 'day' | 'week' | 'agenda';

// Event layout interface
export interface EventWithLayout extends CalendarEventItem {
  column: number;
  totalColumns: number;
}

/**
 * Get number of days in a month
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Get first day of month (0 = Sunday)
 */
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

/**
 * Generate calendar grid for a month - always 6 rows (42 cells) for consistent height
 */
export function generateCalendarDays(year: number, month: number): (number | null)[] {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days: (number | null)[] = [];

  // Add empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Add days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  // Always pad to exactly 42 cells (6 rows) for consistent height
  while (days.length < 42) {
    days.push(null);
  }

  return days;
}

/**
 * Get dates for week view (3 days centered around selected date)
 */
export function getWeekViewDates(date: Date): Date[] {
  const dates: Date[] = [];

  // Start 1 day before selected date (so selected is in middle for 3-day view)
  const startDate = new Date(date);
  startDate.setDate(date.getDate() - 1);

  for (let i = 0; i < WEEK_VIEW_DAYS; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }

  return dates;
}

/**
 * Format date range for week view header
 */
export function formatWeekRange(dates: Date[]): string {
  if (dates.length === 0) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  const monthShort = MONTHS_SHORT[first.getMonth()];
  return `${monthShort} ${first.getDate()} - ${last.getDate()}`;
}

/**
 * Calculate overlapping events and their positions
 */
export function calculateEventLayout(events: CalendarEventItem[]): EventWithLayout[] {
  if (events.length === 0) return [];

  // Sort events by start time, then by duration (longer first)
  const sortedEvents = [...events].sort((a, b) => {
    const aStart = new Date(a.start_time).getTime();
    const bStart = new Date(b.start_time).getTime();
    if (aStart !== bStart) return aStart - bStart;
    // Longer events first
    const aDuration = new Date(a.end_time).getTime() - aStart;
    const bDuration = new Date(b.end_time).getTime() - bStart;
    return bDuration - aDuration;
  });

  const result: EventWithLayout[] = [];
  const columns: { event: CalendarEventItem; endTime: number }[][] = [];

  for (const event of sortedEvents) {
    const eventStart = new Date(event.start_time).getTime();
    const eventEnd = new Date(event.end_time).getTime();

    // Find a column where this event doesn't overlap
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastEventInCol = columns[col][columns[col].length - 1];
      if (lastEventInCol.endTime <= eventStart) {
        columns[col].push({ event, endTime: eventEnd });
        result.push({
          ...event,
          column: col,
          totalColumns: 0, // Will be calculated after
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Create new column
      columns.push([{ event, endTime: eventEnd }]);
      result.push({
        ...event,
        column: columns.length - 1,
        totalColumns: 0,
      });
    }
  }

  // Now calculate total columns for each event based on overlapping events
  for (let i = 0; i < result.length; i++) {
    const event = result[i];
    const eventStart = new Date(event.start_time).getTime();
    const eventEnd = new Date(event.end_time).getTime();

    // Find all events that overlap with this one
    let maxCol = event.column;
    for (const other of result) {
      const otherStart = new Date(other.start_time).getTime();
      const otherEnd = new Date(other.end_time).getTime();

      if (
        (otherStart < eventEnd && otherEnd > eventStart) ||
        (eventStart < otherEnd && eventEnd > otherStart)
      ) {
        maxCol = Math.max(maxCol, other.column);
      }
    }

    result[i].totalColumns = maxCol + 1;
  }

  return result;
}

/**
 * Format time range string
 */
export function formatTimeRange(start: Date, end: Date): string {
  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    if (minutes === 0) {
      return `${displayHours}${ampm}`;
    }
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
  };

  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}
