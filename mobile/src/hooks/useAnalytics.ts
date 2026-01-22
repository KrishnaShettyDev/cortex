import { usePostHog } from 'posthog-react-native';
import { useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ANALYTICS_EVENTS, AnalyticsEvent } from '../lib/analytics';

/**
 * Custom hook for analytics tracking with PostHog
 * Automatically identifies user when authenticated
 */
export function useAnalytics() {
  const posthog = usePostHog();
  const { user, isAuthenticated } = useAuth();

  // Identify user when authenticated
  useEffect(() => {
    if (!posthog) return;

    if (isAuthenticated && user) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
      });
    } else if (!isAuthenticated) {
      posthog.reset();
    }
  }, [isAuthenticated, user, posthog]);

  /**
   * Track a custom event
   */
  const track = useCallback(
    (event: AnalyticsEvent | string, properties?: Record<string, any>) => {
      posthog?.capture(event, properties);
    },
    [posthog]
  );

  /**
   * Track a screen view
   */
  const screen = useCallback(
    (screenName: string, properties?: Record<string, any>) => {
      posthog?.screen(screenName, properties);
    },
    [posthog]
  );

  /**
   * Set user properties
   */
  const setUserProperties = useCallback(
    (properties: Record<string, any>) => {
      if (posthog && user) {
        posthog.identify(user.id, properties);
      }
    },
    [posthog, user]
  );

  /**
   * Track feature flag
   */
  const isFeatureEnabled = useCallback(
    (flagKey: string): boolean => {
      return posthog?.isFeatureEnabled(flagKey) ?? false;
    },
    [posthog]
  );

  return {
    track,
    screen,
    setUserProperties,
    isFeatureEnabled,
    posthog,
    events: ANALYTICS_EVENTS,
  };
}
