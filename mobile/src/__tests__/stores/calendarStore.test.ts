/**
 * Tests for Calendar Store
 * Tests caching, state management, and cache invalidation
 */

import { useCalendarStore, selectCalendarEvents, selectCalendarLoading, selectCalendarError, selectIsConnected } from '../../stores/calendarStore';
import { CalendarEventItem } from '../../services/integrations';

// Mock events for testing
const mockEvents: CalendarEventItem[] = [
  {
    id: 'event-1',
    title: 'Team Meeting',
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    is_all_day: false,
    location: 'Conference Room A',
    description: 'Weekly sync',
    attendees: ['alice@example.com', 'bob@example.com'],
    meeting_type: 'google_meet',
  },
  {
    id: 'event-2',
    title: 'Lunch',
    start_time: '2024-01-15T12:00:00Z',
    end_time: '2024-01-15T13:00:00Z',
    is_all_day: false,
    attendees: [],
    meeting_type: 'offline',
  },
];

describe('calendarStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useCalendarStore.getState().reset();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useCalendarStore.getState();

      expect(state.events).toEqual([]);
      expect(state.cachedMonthKey).toBe('');
      expect(state.lastLoadedAt).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.isConnected).toBe(false);
    });
  });

  describe('setEvents', () => {
    it('should set events and update cache metadata', () => {
      const { setEvents } = useCalendarStore.getState();
      const monthKey = '2024-01';

      setEvents(mockEvents, monthKey);

      const state = useCalendarStore.getState();
      expect(state.events).toEqual(mockEvents);
      expect(state.cachedMonthKey).toBe(monthKey);
      expect(state.lastLoadedAt).toBeGreaterThan(0);
      expect(state.error).toBeNull();
    });

    it('should clear error when setting events', () => {
      const { setError, setEvents } = useCalendarStore.getState();

      // Set an error first
      setError('Some error');
      expect(useCalendarStore.getState().error).toBe('Some error');

      // Setting events should clear the error
      setEvents(mockEvents, '2024-01');
      expect(useCalendarStore.getState().error).toBeNull();
    });

    it('should update lastLoadedAt timestamp', () => {
      const { setEvents } = useCalendarStore.getState();
      const beforeSet = Date.now();

      setEvents(mockEvents, '2024-01');

      const afterSet = Date.now();
      const { lastLoadedAt } = useCalendarStore.getState();

      expect(lastLoadedAt).toBeGreaterThanOrEqual(beforeSet);
      expect(lastLoadedAt).toBeLessThanOrEqual(afterSet);
    });
  });

  describe('setLoading', () => {
    it('should set loading state to true', () => {
      const { setLoading } = useCalendarStore.getState();

      setLoading(true);

      expect(useCalendarStore.getState().isLoading).toBe(true);
    });

    it('should set loading state to false', () => {
      const { setLoading } = useCalendarStore.getState();

      setLoading(true);
      setLoading(false);

      expect(useCalendarStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      const { setError } = useCalendarStore.getState();
      const errorMessage = 'Failed to load events';

      setError(errorMessage);

      expect(useCalendarStore.getState().error).toBe(errorMessage);
    });

    it('should clear error when set to null', () => {
      const { setError } = useCalendarStore.getState();

      setError('Some error');
      setError(null);

      expect(useCalendarStore.getState().error).toBeNull();
    });
  });

  describe('setConnected', () => {
    it('should set connected state to true', () => {
      const { setConnected } = useCalendarStore.getState();

      setConnected(true);

      expect(useCalendarStore.getState().isConnected).toBe(true);
    });

    it('should set connected state to false', () => {
      const { setConnected } = useCalendarStore.getState();

      setConnected(true);
      setConnected(false);

      expect(useCalendarStore.getState().isConnected).toBe(false);
    });
  });

  describe('isCacheValid', () => {
    it('should return false when no cache exists', () => {
      const { isCacheValid } = useCalendarStore.getState();

      expect(isCacheValid('2024-01')).toBe(false);
    });

    it('should return false when month key does not match', () => {
      const { setEvents, isCacheValid } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');

      expect(isCacheValid('2024-02')).toBe(false);
    });

    it('should return true when cache is fresh and month key matches', () => {
      const { setEvents, isCacheValid } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');

      expect(isCacheValid('2024-01')).toBe(true);
    });

    it('should return false when cache is expired', () => {
      const { setEvents } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');

      // Manually set lastLoadedAt to 10 minutes ago (expired)
      useCalendarStore.setState({ lastLoadedAt: Date.now() - 10 * 60 * 1000 });

      const { isCacheValid } = useCalendarStore.getState();
      expect(isCacheValid('2024-01')).toBe(false);
    });

    it('should return true when cache is within validity period', () => {
      const { setEvents } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');

      // Manually set lastLoadedAt to 2 minutes ago (still valid)
      useCalendarStore.setState({ lastLoadedAt: Date.now() - 2 * 60 * 1000 });

      const { isCacheValid } = useCalendarStore.getState();
      expect(isCacheValid('2024-01')).toBe(true);
    });
  });

  describe('invalidateCache', () => {
    it('should clear cache metadata', () => {
      const { setEvents, invalidateCache } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');

      // Verify cache is set
      expect(useCalendarStore.getState().cachedMonthKey).toBe('2024-01');
      expect(useCalendarStore.getState().lastLoadedAt).not.toBeNull();

      invalidateCache();

      // Cache metadata should be cleared
      expect(useCalendarStore.getState().cachedMonthKey).toBe('');
      expect(useCalendarStore.getState().lastLoadedAt).toBeNull();
    });

    it('should not clear events when invalidating cache', () => {
      const { setEvents, invalidateCache } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');
      invalidateCache();

      // Events should still be there (just cache is invalid)
      expect(useCalendarStore.getState().events).toEqual(mockEvents);
    });

    it('should make isCacheValid return false after invalidation', () => {
      const { setEvents, invalidateCache, isCacheValid } = useCalendarStore.getState();

      setEvents(mockEvents, '2024-01');
      expect(isCacheValid('2024-01')).toBe(true);

      invalidateCache();

      expect(useCalendarStore.getState().isCacheValid('2024-01')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { setEvents, setLoading, setError, setConnected, reset } = useCalendarStore.getState();

      // Set various state
      setEvents(mockEvents, '2024-01');
      setLoading(true);
      setError('Some error');
      setConnected(true);

      // Reset
      reset();

      const state = useCalendarStore.getState();
      expect(state.events).toEqual([]);
      expect(state.cachedMonthKey).toBe('');
      expect(state.lastLoadedAt).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.isConnected).toBe(false);
    });
  });

  describe('Selectors', () => {
    it('selectCalendarEvents should return events', () => {
      useCalendarStore.getState().setEvents(mockEvents, '2024-01');

      const events = selectCalendarEvents(useCalendarStore.getState());
      expect(events).toEqual(mockEvents);
    });

    it('selectCalendarLoading should return loading state', () => {
      useCalendarStore.getState().setLoading(true);

      const isLoading = selectCalendarLoading(useCalendarStore.getState());
      expect(isLoading).toBe(true);
    });

    it('selectCalendarError should return error', () => {
      useCalendarStore.getState().setError('Test error');

      const error = selectCalendarError(useCalendarStore.getState());
      expect(error).toBe('Test error');
    });

    it('selectIsConnected should return connected state', () => {
      useCalendarStore.getState().setConnected(true);

      const isConnected = selectIsConnected(useCalendarStore.getState());
      expect(isConnected).toBe(true);
    });
  });

  describe('State Updates', () => {
    it('should maintain other state when updating single property', () => {
      const { setEvents, setConnected, setError } = useCalendarStore.getState();

      // Set initial state
      setEvents(mockEvents, '2024-01');
      setConnected(true);

      // Update error only
      setError('Network error');

      // Other state should be preserved
      const state = useCalendarStore.getState();
      expect(state.events).toEqual(mockEvents);
      expect(state.isConnected).toBe(true);
      expect(state.error).toBe('Network error');
    });
  });
});
