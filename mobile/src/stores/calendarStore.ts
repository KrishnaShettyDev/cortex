import { create } from 'zustand';
import { CalendarEventItem } from '../services/integrations';

// Cache validity: 5 minutes
const CACHE_VALIDITY_MS = 5 * 60 * 1000;

interface CalendarState {
  // Cached events
  events: CalendarEventItem[];

  // Cache metadata
  cachedMonthKey: string;
  lastLoadedAt: number | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Connection state
  isConnected: boolean;

  // Actions
  setEvents: (events: CalendarEventItem[], monthKey: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;

  // Cache helpers
  isCacheValid: (monthKey: string) => boolean;
  invalidateCache: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  events: [],
  cachedMonthKey: '',
  lastLoadedAt: null,
  isLoading: false,
  error: null,
  isConnected: false,
};

export const useCalendarStore = create<CalendarState>()((set, get) => ({
  ...initialState,

  setEvents: (events, monthKey) =>
    set({
      events,
      cachedMonthKey: monthKey,
      lastLoadedAt: Date.now(),
      error: null,
    }),

  setLoading: (loading) =>
    set({ isLoading: loading }),

  setError: (error) =>
    set({ error }),

  setConnected: (connected) =>
    set({ isConnected: connected }),

  isCacheValid: (monthKey) => {
    const state = get();

    // No cache
    if (!state.lastLoadedAt || state.cachedMonthKey !== monthKey) {
      return false;
    }

    // Check if cache is still fresh
    const age = Date.now() - state.lastLoadedAt;
    return age < CACHE_VALIDITY_MS;
  },

  invalidateCache: () =>
    set({
      cachedMonthKey: '',
      lastLoadedAt: null,
    }),

  reset: () => set(initialState),
}));

// Selectors
export const selectCalendarEvents = (state: CalendarState) => state.events;
export const selectCalendarLoading = (state: CalendarState) => state.isLoading;
export const selectCalendarError = (state: CalendarState) => state.error;
export const selectIsConnected = (state: CalendarState) => state.isConnected;
