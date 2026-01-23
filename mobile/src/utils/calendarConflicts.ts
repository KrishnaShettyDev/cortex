import { CalendarEventItem } from '../services/integrations';

export interface ConflictInfo {
  eventId: string;
  conflictsWith: string[];
  overlapMinutes: number;
}

/**
 * Detect all conflicts between calendar events
 * Two events conflict if they overlap in time (excluding all-day events)
 */
export function detectConflicts(events: CalendarEventItem[]): Map<string, ConflictInfo> {
  const conflicts = new Map<string, ConflictInfo>();

  // Filter out all-day events (they don't create time conflicts)
  const timedEvents = events.filter(e => !e.is_all_day);

  for (let i = 0; i < timedEvents.length; i++) {
    for (let j = i + 1; j < timedEvents.length; j++) {
      const eventA = timedEvents[i];
      const eventB = timedEvents[j];

      const overlap = getOverlapMinutes(eventA, eventB);

      if (overlap > 0) {
        // Add conflict for event A
        if (!conflicts.has(eventA.id)) {
          conflicts.set(eventA.id, {
            eventId: eventA.id,
            conflictsWith: [],
            overlapMinutes: 0,
          });
        }
        const conflictA = conflicts.get(eventA.id)!;
        conflictA.conflictsWith.push(eventB.id);
        conflictA.overlapMinutes += overlap;

        // Add conflict for event B
        if (!conflicts.has(eventB.id)) {
          conflicts.set(eventB.id, {
            eventId: eventB.id,
            conflictsWith: [],
            overlapMinutes: 0,
          });
        }
        const conflictB = conflicts.get(eventB.id)!;
        conflictB.conflictsWith.push(eventA.id);
        conflictB.overlapMinutes += overlap;
      }
    }
  }

  return conflicts;
}

/**
 * Get overlap duration in minutes between two events
 * Returns 0 if no overlap
 */
export function getOverlapMinutes(
  eventA: CalendarEventItem,
  eventB: CalendarEventItem
): number {
  const startA = new Date(eventA.start_time).getTime();
  const endA = new Date(eventA.end_time).getTime();
  const startB = new Date(eventB.start_time).getTime();
  const endB = new Date(eventB.end_time).getTime();

  // Check if events overlap: A.end > B.start AND A.start < B.end
  if (endA > startB && startA < endB) {
    // Calculate overlap
    const overlapStart = Math.max(startA, startB);
    const overlapEnd = Math.min(endA, endB);
    return Math.round((overlapEnd - overlapStart) / (1000 * 60));
  }

  return 0;
}

/**
 * Get all events that conflict with a specific event
 */
export function getConflictingEvents(
  event: CalendarEventItem,
  allEvents: CalendarEventItem[]
): CalendarEventItem[] {
  if (event.is_all_day) return [];

  return allEvents.filter(other => {
    if (other.id === event.id) return false;
    if (other.is_all_day) return false;
    return getOverlapMinutes(event, other) > 0;
  });
}

/**
 * Check if a specific event has any conflicts
 */
export function hasConflict(
  event: CalendarEventItem,
  allEvents: CalendarEventItem[]
): boolean {
  return getConflictingEvents(event, allEvents).length > 0;
}

/**
 * Format overlap duration for display
 */
export function formatOverlapDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min overlap`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h overlap`;
  }
  return `${hours}h ${remainingMinutes}m overlap`;
}
