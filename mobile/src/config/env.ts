import Constants from 'expo-constants';

/**
 * Environment configuration for Cortex app
 *
 * For production builds via EAS:
 * - Set API_URL in eas.json under build.production.env
 * - Or use EAS Secrets for sensitive values
 *
 * For local development:
 * - Update DEV_API_URL with your machine's IP
 */

// Development configuration
// Use your machine's IP for physical devices
// localhost only works for iOS Simulator
const DEV_CONFIG = {
  API_URL: 'https://askcortex.plutas.in', // Using production API for testing
  GOOGLE_CLIENT_ID: {
    // These must match exactly what's in Google Cloud Console
    ios: '266293132252-ks0f0m30egbekl2jhtqnqv8r8olfub4q.apps.googleusercontent.com',
    android: '266293132252-tu55j8qrfi96n15jntgbinpnj3cnh9si.apps.googleusercontent.com',
    web: '266293132252-ce19t4pktv5t8o5k34rito52r4opi7rk.apps.googleusercontent.com',
  },
  ENABLE_DEV_LOGIN: true,
};

// Production configuration - values come from EAS build env or secrets
const PROD_CONFIG = {
  API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://askcortex.plutas.in',
  GOOGLE_CLIENT_ID: {
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || DEV_CONFIG.GOOGLE_CLIENT_ID.ios,
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || DEV_CONFIG.GOOGLE_CLIENT_ID.android,
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || DEV_CONFIG.GOOGLE_CLIENT_ID.web,
  },
  ENABLE_DEV_LOGIN: false,
};

// Determine which config to use based on build type
const isProduction = !__DEV__;

export const ENV = isProduction ? PROD_CONFIG : DEV_CONFIG;

// Export individual values for convenience
export const API_BASE_URL = ENV.API_URL;
export const GOOGLE_CLIENT_ID = ENV.GOOGLE_CLIENT_ID;
export const ENABLE_DEV_LOGIN = ENV.ENABLE_DEV_LOGIN;
export const IS_PRODUCTION = isProduction;

// Sentry configuration
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

// PostHog Analytics configuration
export const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || 'phc_pqRL5o5RdFDjg0nwI2t6hiSSpYrYrp3Z2ux1wNAOETj';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

// App metadata
export const APP_CONFIG = {
  name: 'Cortex',
  version: Constants.expoConfig?.version || '1.0.0',
  buildNumber: Constants.expoConfig?.ios?.buildNumber || '1',
  bundleId: Constants.expoConfig?.ios?.bundleIdentifier || 'com.cortex.app',
  scheme: 'cortex',
};
