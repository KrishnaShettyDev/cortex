/**
 * Calendar Helper Functions
 * Matching mobile app helpers
 */

import type { CalendarEvent, EventWithLayout } from '@/types/calendar';
import { WEEK_VIEW_DAYS } from './constants';

// Date comparison
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

// Get days in month
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Get first day of month (0-6, Sunday-Saturday)
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// Generate calendar days for month picker
export function generateCalendarDays(year: number, month: number): (number | null)[] {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const days: (number | null)[] = [];

  // Add empty slots for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Add days of month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return days;
}

// Get dates for week view (3 days centered around selected date)
export function getWeekViewDates(selectedDate: Date): Date[] {
  const dates: Date[] = [];
  const dayBefore = new Date(selectedDate);
  dayBefore.setDate(selectedDate.getDate() - 1);

  const dayAfter = new Date(selectedDate);
  dayAfter.setDate(selectedDate.getDate() + 1);

  dates.push(dayBefore, selectedDate, dayAfter);

  return dates;
}

// Format week range (e.g., "Dec 25 - Dec 31")
export function formatWeekRange(dates: Date[]): string {
  if (dates.length === 0) return '';

  const first = dates[0];
  const last = dates[dates.length - 1];

  const firstMonth = first.toLocaleDateString('en-US', { month: 'short' });
  const lastMonth = last.toLocaleDateString('en-US', { month: 'short' });

  if (firstMonth === lastMonth) {
    return `${firstMonth} ${first.getDate()} - ${last.getDate()}`;
  }

  return `${firstMonth} ${first.getDate()} - ${lastMonth} ${last.getDate()}`;
}

// Format time range (e.g., "2:00 PM - 3:00 PM")
export function formatTimeRange(start: Date, end: Date): string {
  const startTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const endTime = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${startTime} - ${endTime}`;
}

// Calculate event layout for overlapping events
export function calculateEventLayout(events: CalendarEvent[]): EventWithLayout[] {
  if (events.length === 0) return [];

  // Sort events by start time
  const sorted = [...events].sort((a, b) => {
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  const eventsWithLayout: EventWithLayout[] = [];
  const columns: CalendarEvent[][] = [];

  sorted.forEach((event) => {
    const eventStart = new Date(event.start_time).getTime();
    const eventEnd = new Date(event.end_time).getTime();

    // Find first available column
    let columnIndex = 0;
    let placed = false;

    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const lastEvent = column[column.length - 1];
      const lastEventEnd = new Date(lastEvent.end_time).getTime();

      // If this event starts after the last event in this column ends, it can go here
      if (eventStart >= lastEventEnd) {
        column.push(event);
        columnIndex = i;
        placed = true;
        break;
      }
    }

    // If not placed, create new column
    if (!placed) {
      columns.push([event]);
      columnIndex = columns.length - 1;
    }

    eventsWithLayout.push({
      ...event,
      column: columnIndex,
      totalColumns: 0, // Will be updated after
    });
  });

  // Find max columns needed at any time
  const maxColumns = columns.length;

  // Update totalColumns for all events
  eventsWithLayout.forEach((event) => {
    event.totalColumns = maxColumns;
  });

  return eventsWithLayout;
}

// Detect if two events overlap
export function eventsOverlap(event1: CalendarEvent, event2: CalendarEvent): boolean {
  const start1 = new Date(event1.start_time).getTime();
  const end1 = new Date(event1.end_time).getTime();
  const start2 = new Date(event2.start_time).getTime();
  const end2 = new Date(event2.end_time).getTime();

  return start1 < end2 && start2 < end1;
}

// Detect conflicts between events
export function detectConflicts(events: CalendarEvent[]): Map<string, { eventId: string; conflictsWith: string[] }> {
  const conflicts = new Map<string, { eventId: string; conflictsWith: string[] }>();

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (eventsOverlap(events[i], events[j])) {
        // Add conflict for event i
        if (!conflicts.has(events[i].id)) {
          conflicts.set(events[i].id, { eventId: events[i].id, conflictsWith: [] });
        }
        conflicts.get(events[i].id)!.conflictsWith.push(events[j].id);

        // Add conflict for event j
        if (!conflicts.has(events[j].id)) {
          conflicts.set(events[j].id, { eventId: events[j].id, conflictsWith: [] });
        }
        conflicts.get(events[j].id)!.conflictsWith.push(events[i].id);
      }
    }
  }

  return conflicts;
}

// Get conflicting events for a specific event
export function getConflictingEvents(event: CalendarEvent, allEvents: CalendarEvent[]): CalendarEvent[] {
  return allEvents.filter((e) => e.id !== event.id && eventsOverlap(event, e));
}
