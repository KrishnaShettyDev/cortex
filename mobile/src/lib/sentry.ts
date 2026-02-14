import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN, IS_PRODUCTION } from '../config/env';

let isInitialized = false;

export const initSentry = () => {
  if (isInitialized || !SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    // Set environment
    environment: IS_PRODUCTION ? 'production' : 'development',
    // Enable performance monitoring
    tracesSampleRate: IS_PRODUCTION ? 0.2 : 1.0,
    // Enable profiling (only in production to reduce overhead)
    profilesSampleRate: IS_PRODUCTION ? 0.1 : 0,
    // Attach stack traces to all messages
    attachStacktrace: true,
    // Enable native crash reporting
    enableNative: true,
    // Auto session tracking
    enableAutoSessionTracking: true,
    // Session close timeout (30 seconds)
    sessionTrackingIntervalMillis: 30000,
    // Debug mode in development
    debug: !IS_PRODUCTION,
    // Before send hook for filtering/modifying events
    beforeSend(event) {
      // Always send events - Sentry filters by environment anyway
      // Events will be tagged with environment: 'production' or 'development'
      return event;
    },
    // Integrations
    integrations: [
      Sentry.reactNativeTracingIntegration(),
    ],
  });

  isInitialized = true;
};

// Set user context on login
export const setUserContext = (user: { id: string; email?: string; name?: string }) => {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.name,
  });
};

// Clear user context on logout
export const clearUserContext = () => {
  Sentry.setUser(null);
};

// Add breadcrumb for tracking user actions
export const addBreadcrumb = (
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'info'
) => {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
  });
};

// Capture exception with optional context
export const captureException = (
  error: Error,
  context?: Record<string, unknown>
) => {
  if (context) {
    Sentry.setContext('additional', context);
  }
  Sentry.captureException(error);
};

// Capture message
export const captureMessage = (
  message: string,
  level: Sentry.SeverityLevel = 'info'
) => {
  Sentry.captureMessage(message, level);
};

// Set tag for filtering
export const setTag = (key: string, value: string) => {
  Sentry.setTag(key, value);
};

// Wrap component with Sentry error boundary
export const withSentryErrorBoundary = Sentry.wrap;

// Export native crash handler
export const nativeCrash = Sentry.nativeCrash;
