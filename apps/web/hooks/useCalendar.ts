/**
 * useCalendar Hook
 * Manages calendar state and data fetching
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';
import { apiClient } from '@/lib/api/client';
import type { CalendarEvent } from '@/types/calendar';
import { isSameDay } from '@/lib/calendar/helpers';

export function useCalendar(selectedDate: Date) {
  const {
    events: cachedEvents,
    isLoading,
    error,
    isConnected,
    setEvents,
    setLoading,
    setError,
    setConnected,
    isCacheValid,
    invalidateCache,
  } = useCalendarStore();

  // Get current month key for cache
  const currentMonthKey = useMemo(() => {
    return `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  }, [selectedDate]);

  // Filter events for selected date (INSTANT - no API call)
  const events = useMemo(() => {
    return cachedEvents.filter((event) => {
      const eventDate = new Date(event.start_time);
      return isSameDay(eventDate, selectedDate);
    });
  }, [cachedEvents, selectedDate]);

  // Load events for the month
  const loadMonthEvents = useCallback(async (forceRefresh = false) => {
    // Skip if cache is valid and not forcing refresh
    if (!forceRefresh && isCacheValid(currentMonthKey)) {
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Check connection status first
      const status = await apiClient.getIntegrationStatus();
      setConnected(status.calendar?.connected || false);

      if (!status.calendar?.connected) {
        setEvents([], currentMonthKey);
        setLoading(false);
        return;
      }

      // Fetch events for the entire month (plus a few days before/after)
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();

      const startOfMonth = new Date(year, month, 1);
      startOfMonth.setDate(startOfMonth.getDate() - 7);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date(year, month + 1, 0);
      endOfMonth.setDate(endOfMonth.getDate() + 7);
      endOfMonth.setHours(23, 59, 59, 999);

      const response = await apiClient.getCalendarEvents({
        start: startOfMonth.toISOString(),
        end: endOfMonth.toISOString(),
      });

      setEvents(response.events || [], currentMonthKey);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load calendar events:', err);
      setEvents([], currentMonthKey);

      if (err.message?.includes('timed out')) {
        setError('Loading took too long. Please try again.');
      } else if (err.message?.includes('connection')) {
        setError('Connection issue. Please check your network.');
      } else {
        setError('Could not load events. Pull down to retry.');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedDate, currentMonthKey, isCacheValid, setEvents, setLoading, setError, setConnected]);

  // Load events when month changes
  useEffect(() => {
    if (!isCacheValid(currentMonthKey)) {
      loadMonthEvents();
    }
  }, [currentMonthKey, isCacheValid, loadMonthEvents]);

  return {
    events,
    allEvents: cachedEvents,
    isLoading,
    error,
    isConnected,
    loadMonthEvents,
    invalidateCache,
  };
}
