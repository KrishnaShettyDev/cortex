/**
 * Proactive Polling Fallback
 *
 * When push notifications are unavailable or failing, this hook provides
 * a fallback polling mechanism with:
 * - 15-minute default interval (configurable)
 * - Exponential backoff on network errors
 * - Pause when app is in background
 * - Automatic disable when push notifications work
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { chatService, ProactiveMessage } from '../services/chat';
import { notificationService } from '../services/notifications';
import { useAuth } from '../context/AuthContext';
import { logger } from '../utils/logger';

// Polling configuration
const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum
const MAX_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour maximum
const BACKOFF_MULTIPLIER = 2;
const MAX_CONSECUTIVE_ERRORS = 5;

interface PollingState {
  isPolling: boolean;
  lastPollAt: string | null;
  nextPollAt: string | null;
  consecutiveErrors: number;
  currentInterval: number;
  pushAvailable: boolean;
}

interface UseProactivePollingOptions {
  /** Custom poll interval in milliseconds (default: 15 minutes) */
  pollInterval?: number;
  /** Callback when new messages are received */
  onNewMessages?: (messages: ProactiveMessage[]) => void;
  /** Whether polling is enabled (default: true when push unavailable) */
  enabled?: boolean;
}

export function useProactivePolling(options: UseProactivePollingOptions = {}) {
  const { isAuthenticated } = useAuth();
  const [state, setState] = useState<PollingState>({
    isPolling: false,
    lastPollAt: null,
    nextPollAt: null,
    consecutiveErrors: 0,
    currentInterval: options.pollInterval || DEFAULT_POLL_INTERVAL_MS,
    pushAvailable: false,
  });

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageTimestampRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);

  /**
   * Clear any existing poll timer
   */
  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /**
   * Calculate next poll interval with exponential backoff
   */
  const getNextInterval = useCallback((currentErrors: number): number => {
    if (currentErrors === 0) {
      return options.pollInterval || DEFAULT_POLL_INTERVAL_MS;
    }

    // Exponential backoff: interval * 2^errors
    const backoffInterval = (options.pollInterval || DEFAULT_POLL_INTERVAL_MS) *
      Math.pow(BACKOFF_MULTIPLIER, Math.min(currentErrors, MAX_CONSECUTIVE_ERRORS));

    return Math.min(backoffInterval, MAX_POLL_INTERVAL_MS);
  }, [options.pollInterval]);

  /**
   * Perform a single poll for new messages
   */
  const poll = useCallback(async (): Promise<ProactiveMessage[]> => {
    if (!mountedRef.current || !isAuthenticated) {
      return [];
    }

    // Don't poll if app is in background
    if (appStateRef.current !== 'active') {
      logger.log('[ProactivePolling] Skipping poll - app in background');
      return [];
    }

    setState(prev => ({ ...prev, isPolling: true }));

    try {
      const messages = await chatService.pollProactiveMessages(
        lastMessageTimestampRef.current || undefined
      );

      if (!mountedRef.current) return [];

      // Update last message timestamp for next poll
      if (messages.length > 0) {
        const latestMessage = messages.reduce((latest, msg) =>
          new Date(msg.createdAt) > new Date(latest.createdAt) ? msg : latest
        );
        lastMessageTimestampRef.current = latestMessage.createdAt;

        // Notify callback
        options.onNewMessages?.(messages);

        logger.log(`[ProactivePolling] Received ${messages.length} new messages`);
      }

      // Reset errors on successful poll
      setState(prev => ({
        ...prev,
        isPolling: false,
        lastPollAt: new Date().toISOString(),
        consecutiveErrors: 0,
        currentInterval: options.pollInterval || DEFAULT_POLL_INTERVAL_MS,
      }));

      return messages;
    } catch (error) {
      if (!mountedRef.current) return [];

      const newErrorCount = state.consecutiveErrors + 1;
      const newInterval = getNextInterval(newErrorCount);

      logger.warn(`[ProactivePolling] Poll failed (${newErrorCount} errors), next in ${newInterval / 1000}s`, error);

      setState(prev => ({
        ...prev,
        isPolling: false,
        lastPollAt: new Date().toISOString(),
        consecutiveErrors: newErrorCount,
        currentInterval: newInterval,
      }));

      return [];
    }
  }, [isAuthenticated, state.consecutiveErrors, getNextInterval, options]);

  /**
   * Schedule the next poll
   */
  const scheduleNextPoll = useCallback(() => {
    clearPollTimer();

    if (!mountedRef.current || !isAuthenticated) {
      return;
    }

    // Don't schedule if push notifications are working and enabled option is not explicitly true
    if (state.pushAvailable && options.enabled !== true) {
      logger.log('[ProactivePolling] Push available, skipping poll scheduling');
      return;
    }

    const interval = state.currentInterval;
    const nextPollTime = new Date(Date.now() + interval).toISOString();

    setState(prev => ({ ...prev, nextPollAt: nextPollTime }));

    pollTimerRef.current = setTimeout(async () => {
      await poll();
      // Schedule next poll after this one completes
      if (mountedRef.current) {
        scheduleNextPoll();
      }
    }, interval);

    logger.log(`[ProactivePolling] Next poll scheduled in ${interval / 1000}s`);
  }, [clearPollTimer, isAuthenticated, state.pushAvailable, state.currentInterval, options.enabled, poll]);

  /**
   * Force an immediate poll (used for pull-to-refresh)
   */
  const pollNow = useCallback(async (): Promise<ProactiveMessage[]> => {
    clearPollTimer();
    const messages = await poll();
    scheduleNextPoll();
    return messages;
  }, [clearPollTimer, poll, scheduleNextPoll]);

  /**
   * Start polling
   */
  const startPolling = useCallback(() => {
    if (!isAuthenticated) return;

    logger.log('[ProactivePolling] Starting polling');

    // Do an immediate poll
    poll().then(() => {
      scheduleNextPoll();
    });
  }, [isAuthenticated, poll, scheduleNextPoll]);

  /**
   * Stop polling
   */
  const stopPolling = useCallback(() => {
    logger.log('[ProactivePolling] Stopping polling');
    clearPollTimer();
    setState(prev => ({
      ...prev,
      isPolling: false,
      nextPollAt: null,
    }));
  }, [clearPollTimer]);

  // Check push notification availability
  useEffect(() => {
    const checkPush = async () => {
      const token = notificationService.getToken();
      setState(prev => ({ ...prev, pushAvailable: !!token }));
    };

    checkPush();
  }, []);

  // Handle app state changes (pause/resume polling)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextAppState === 'active';

      appStateRef.current = nextAppState;

      if (wasBackground && isNowActive) {
        // App came to foreground - do an immediate poll if we haven't polled recently
        const lastPoll = state.lastPollAt ? new Date(state.lastPollAt).getTime() : 0;
        const timeSinceLastPoll = Date.now() - lastPoll;

        if (timeSinceLastPoll > MIN_POLL_INTERVAL_MS) {
          logger.log('[ProactivePolling] App foregrounded, polling now');
          pollNow();
        } else {
          logger.log('[ProactivePolling] App foregrounded, last poll was recent');
          scheduleNextPoll();
        }
      } else if (!isNowActive) {
        // App went to background - stop polling
        clearPollTimer();
      }
    });

    return () => subscription.remove();
  }, [state.lastPollAt, pollNow, scheduleNextPoll, clearPollTimer]);

  // Start/stop polling based on auth and push availability
  useEffect(() => {
    if (!isAuthenticated) {
      stopPolling();
      return;
    }

    // Only start polling if push notifications are unavailable OR explicitly enabled
    const shouldPoll = options.enabled === true ||
      (options.enabled !== false && !state.pushAvailable);

    if (shouldPoll) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      clearPollTimer();
    };
  }, [isAuthenticated, state.pushAvailable, options.enabled, startPolling, stopPolling, clearPollTimer]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearPollTimer();
    };
  }, [clearPollTimer]);

  return {
    /** Current polling state */
    state,
    /** Force an immediate poll */
    pollNow,
    /** Start polling manually */
    startPolling,
    /** Stop polling manually */
    stopPolling,
    /** Whether polling is currently active */
    isPolling: state.isPolling,
    /** Time of last poll */
    lastPollAt: state.lastPollAt,
    /** Time of next scheduled poll */
    nextPollAt: state.nextPollAt,
    /** Whether push notifications are available */
    pushAvailable: state.pushAvailable,
  };
}

export default useProactivePolling;
