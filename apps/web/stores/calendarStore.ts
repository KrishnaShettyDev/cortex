/**
 * Calendar Store - Zustand
 * Caches events across navigation
 */

import { create } from 'zustand';
import type { CalendarEvent } from '@/types/calendar';

interface CalendarStore {
  events: CalendarEvent[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  cachedMonthKey: string | null;
  lastFetchTime: number | null;

  setEvents: (events: CalendarEvent[], monthKey: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;
  invalidateCache: () => void;
  isCacheValid: (monthKey: string) => boolean;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  events: [],
  isLoading: false,
  error: null,
  isConnected: false,
  cachedMonthKey: null,
  lastFetchTime: null,

  setEvents: (events, monthKey) => {
    set({
      events,
      cachedMonthKey: monthKey,
      lastFetchTime: Date.now(),
      isLoading: false,
    });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error, isLoading: false });
  },

  setConnected: (connected) => {
    set({ isConnected: connected });
  },

  invalidateCache: () => {
    set({ cachedMonthKey: null, lastFetchTime: null });
  },

  isCacheValid: (monthKey) => {
    const state = get();

    // Check if we have cached data for this month
    if (state.cachedMonthKey !== monthKey) {
      return false;
    }

    // Check if cache is still fresh
    if (!state.lastFetchTime) {
      return false;
    }

    const now = Date.now();
    const elapsed = now - state.lastFetchTime;

    return elapsed < CACHE_DURATION;
  },
}));
