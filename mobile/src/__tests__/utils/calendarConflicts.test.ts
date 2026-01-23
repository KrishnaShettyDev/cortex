// Unit tests for calendar conflict detection utilities

import {
  detectConflicts,
  getOverlapMinutes,
  getConflictingEvents,
  hasConflict,
  formatOverlapDuration,
  ConflictInfo,
} from '../../utils/calendarConflicts';
import { CalendarEventItem } from '../../services/integrations';

// Helper to create mock calendar events
const createMockEvent = (
  id: string,
  startTime: string,
  endTime: string,
  isAllDay = false
): CalendarEventItem => ({
  id,
  title: `Event ${id}`,
  start_time: startTime,
  end_time: endTime,
  is_all_day: isAllDay,
  attendees: [],
  meeting_type: 'offline',
});

describe('calendarConflicts', () => {
  describe('getOverlapMinutes', () => {
    it('should return 0 for non-overlapping events', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const eventB = createMockEvent('2', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z');

      expect(getOverlapMinutes(eventA, eventB)).toBe(0);
    });

    it('should return 0 for adjacent events (no overlap)', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const eventB = createMockEvent('2', '2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z');

      expect(getOverlapMinutes(eventA, eventB)).toBe(0);
    });

    it('should calculate overlap for partially overlapping events', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const eventB = createMockEvent('2', '2024-01-15T09:30:00Z', '2024-01-15T10:30:00Z');

      // Overlap: 9:30 - 10:00 = 30 minutes
      expect(getOverlapMinutes(eventA, eventB)).toBe(30);
    });

    it('should calculate overlap when one event contains another', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T12:00:00Z');
      const eventB = createMockEvent('2', '2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z');

      // Event B is fully contained in Event A: 1 hour = 60 minutes
      expect(getOverlapMinutes(eventA, eventB)).toBe(60);
    });

    it('should calculate overlap for fully overlapping events', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const eventB = createMockEvent('2', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');

      expect(getOverlapMinutes(eventA, eventB)).toBe(60);
    });

    it('should handle events in reverse order', () => {
      const eventA = createMockEvent('1', '2024-01-15T09:30:00Z', '2024-01-15T10:30:00Z');
      const eventB = createMockEvent('2', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');

      expect(getOverlapMinutes(eventA, eventB)).toBe(30);
    });
  });

  describe('detectConflicts', () => {
    it('should return empty map for empty events array', () => {
      const conflicts = detectConflicts([]);
      expect(conflicts.size).toBe(0);
    });

    it('should return empty map for single event', () => {
      const events = [createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z')];
      const conflicts = detectConflicts(events);
      expect(conflicts.size).toBe(0);
    });

    it('should return empty map for non-overlapping events', () => {
      const events = [
        createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z'),
        createMockEvent('2', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z'),
        createMockEvent('3', '2024-01-15T14:00:00Z', '2024-01-15T15:00:00Z'),
      ];
      const conflicts = detectConflicts(events);
      expect(conflicts.size).toBe(0);
    });

    it('should detect conflict between two overlapping events', () => {
      const events = [
        createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z'),
        createMockEvent('2', '2024-01-15T09:30:00Z', '2024-01-15T10:30:00Z'),
      ];
      const conflicts = detectConflicts(events);

      expect(conflicts.size).toBe(2);
      expect(conflicts.has('1')).toBe(true);
      expect(conflicts.has('2')).toBe(true);
      expect(conflicts.get('1')?.conflictsWith).toContain('2');
      expect(conflicts.get('2')?.conflictsWith).toContain('1');
    });

    it('should detect multiple conflicts for one event', () => {
      const events = [
        createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T12:00:00Z'), // Long event
        createMockEvent('2', '2024-01-15T09:30:00Z', '2024-01-15T10:00:00Z'), // Overlaps with 1
        createMockEvent('3', '2024-01-15T11:00:00Z', '2024-01-15T11:30:00Z'), // Overlaps with 1
      ];
      const conflicts = detectConflicts(events);

      expect(conflicts.size).toBe(3);
      expect(conflicts.get('1')?.conflictsWith).toHaveLength(2);
      expect(conflicts.get('1')?.conflictsWith).toContain('2');
      expect(conflicts.get('1')?.conflictsWith).toContain('3');
    });

    it('should exclude all-day events from conflict detection', () => {
      const events = [
        createMockEvent('1', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z', true), // All day
        createMockEvent('2', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z'),
      ];
      const conflicts = detectConflicts(events);

      expect(conflicts.size).toBe(0);
    });

    it('should calculate total overlap minutes correctly', () => {
      const events = [
        createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T11:00:00Z'),
        createMockEvent('2', '2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z'),
      ];
      const conflicts = detectConflicts(events);

      // Overlap is 10:00 - 11:00 = 60 minutes
      expect(conflicts.get('1')?.overlapMinutes).toBe(60);
      expect(conflicts.get('2')?.overlapMinutes).toBe(60);
    });
  });

  describe('getConflictingEvents', () => {
    it('should return empty array for event with no conflicts', () => {
      const event = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const allEvents = [
        event,
        createMockEvent('2', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z'),
      ];

      const conflicting = getConflictingEvents(event, allEvents);
      expect(conflicting).toHaveLength(0);
    });

    it('should return conflicting events', () => {
      const event = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const conflictingEvent = createMockEvent('2', '2024-01-15T09:30:00Z', '2024-01-15T10:30:00Z');
      const nonConflictingEvent = createMockEvent('3', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z');

      const allEvents = [event, conflictingEvent, nonConflictingEvent];
      const conflicting = getConflictingEvents(event, allEvents);

      expect(conflicting).toHaveLength(1);
      expect(conflicting[0].id).toBe('2');
    });

    it('should not include itself in conflicting events', () => {
      const event = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const allEvents = [event];

      const conflicting = getConflictingEvents(event, allEvents);
      expect(conflicting).toHaveLength(0);
    });

    it('should return empty array for all-day events', () => {
      const event = createMockEvent('1', '2024-01-15T00:00:00Z', '2024-01-16T00:00:00Z', true);
      const allEvents = [
        event,
        createMockEvent('2', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z'),
      ];

      const conflicting = getConflictingEvents(event, allEvents);
      expect(conflicting).toHaveLength(0);
    });
  });

  describe('hasConflict', () => {
    it('should return false for event with no conflicts', () => {
      const event = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const allEvents = [
        event,
        createMockEvent('2', '2024-01-15T11:00:00Z', '2024-01-15T12:00:00Z'),
      ];

      expect(hasConflict(event, allEvents)).toBe(false);
    });

    it('should return true for event with conflicts', () => {
      const event = createMockEvent('1', '2024-01-15T09:00:00Z', '2024-01-15T10:00:00Z');
      const allEvents = [
        event,
        createMockEvent('2', '2024-01-15T09:30:00Z', '2024-01-15T10:30:00Z'),
      ];

      expect(hasConflict(event, allEvents)).toBe(true);
    });
  });

  describe('formatOverlapDuration', () => {
    it('should format minutes less than 60', () => {
      expect(formatOverlapDuration(30)).toBe('30 min overlap');
      expect(formatOverlapDuration(1)).toBe('1 min overlap');
      expect(formatOverlapDuration(59)).toBe('59 min overlap');
    });

    it('should format exact hours', () => {
      expect(formatOverlapDuration(60)).toBe('1h overlap');
      expect(formatOverlapDuration(120)).toBe('2h overlap');
      expect(formatOverlapDuration(180)).toBe('3h overlap');
    });

    it('should format hours and minutes', () => {
      expect(formatOverlapDuration(90)).toBe('1h 30m overlap');
      expect(formatOverlapDuration(150)).toBe('2h 30m overlap');
      expect(formatOverlapDuration(75)).toBe('1h 15m overlap');
    });
  });
});
