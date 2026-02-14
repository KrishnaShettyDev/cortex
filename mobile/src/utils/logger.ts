/**
 * Production-safe logging utility
 * - Development: Logs to console
 * - Production: Errors are sent to Sentry
 */

import * as Sentry from '@sentry/react-native';

const isDev = __DEV__;

export const logger = {
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (isDev) {
      console.warn(...args);
    } else {
      // Capture warnings as breadcrumbs in production
      Sentry.addBreadcrumb({
        category: 'warning',
        message: args.map(a => String(a)).join(' '),
        level: 'warning',
      });
    }
  },
  error: (...args: any[]) => {
    if (isDev) {
      console.error(...args);
    }
    // Always capture errors in Sentry (production and dev)
    const error = args[0];
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(args.map(a => String(a)).join(' '), 'error');
    }
  },
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },
};

export default logger;
