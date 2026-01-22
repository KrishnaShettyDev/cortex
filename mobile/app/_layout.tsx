import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator, LogBox } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';

import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { queryClient } from '../src/lib/queryClient';
import { initSentry, setUserContext, clearUserContext } from '../src/lib/sentry';
import { initDatabase } from '../src/lib/db/database';
import { useAppStore } from '../src/stores/appStore';
import { useBiometric } from '../src/hooks/useBiometric';
import { useOffline } from '../src/hooks/useOffline';
import { useNotifications } from '../src/hooks/useNotifications';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { colors, spacing, typography } from '../src/theme';
import { backgroundSyncService } from '../src/services/backgroundSync';
import { POSTHOG_API_KEY, POSTHOG_HOST } from '../src/config/env';

// Ignore known warnings in Expo Go (these features are disabled gracefully)
LogBox.ignoreLogs([
  'Cannot find native module',
  'NativeModule.RNCNetInfo is null',
  'useAuth must be used within', // Race condition during hot reload
]);

SplashScreen.preventAutoHideAsync();

// Initialize Sentry on app start
initSentry();

// Biometric lock screen
function BiometricLockScreen() {
  const { authenticate, isAvailable } = useBiometric();
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    setError(null);
    const result = await authenticate('Unlock Cortex');
    if (!result.success && result.error !== 'user_cancel') {
      setError('Authentication failed. Please try again.');
    }
  };

  useEffect(() => {
    if (isAvailable) {
      handleUnlock();
    }
  }, [isAvailable]);

  return (
    <View style={styles.lockScreen}>
      <Text style={styles.lockTitle}>Cortex</Text>
      <Text style={styles.lockSubtitle}>Tap to unlock</Text>
      {error && <Text style={styles.lockError}>{error}</Text>}
      <View style={styles.lockButton}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </View>
  );
}

// Offline banner
function OfflineBanner() {
  const { isOffline } = useOffline();

  if (!isOffline) return null;

  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>You're offline. Changes will sync when connected.</Text>
    </View>
  );
}

// Main navigation with auth-aware routing
function RootLayoutNav() {
  const { isLoading, user } = useAuth();
  const { isBiometricEnabled, isUnlocked, setUnlocked } = useAppStore();
  const [dbReady, setDbReady] = useState(false);

  // Initialize push notifications
  useNotifications();

  // Debug logging
  useEffect(() => {
    console.log('RootLayoutNav state:', { isLoading, user: user?.email, dbReady, isBiometricEnabled, isUnlocked });
  }, [isLoading, user, dbReady, isBiometricEnabled, isUnlocked]);

  // Initialize database
  useEffect(() => {
    const init = async () => {
      console.log('Initializing database...');
      try {
        await initDatabase();
        console.log('Database initialized, setting dbReady=true');
        setDbReady(true);
      } catch (error) {
        console.error('Failed to initialize database:', error);
        // Continue without offline support
        setDbReady(true);
      }
    };
    init();
  }, []);

  // Set Sentry user context and initialize background sync
  useEffect(() => {
    if (user) {
      setUserContext({
        id: user.id,
        email: user.email,
        name: user.name,
      });
      // Initialize background sync when user is logged in
      backgroundSyncService.initialize();
    } else {
      clearUserContext();
      backgroundSyncService.cleanup();
    }

    return () => {
      backgroundSyncService.cleanup();
    };
  }, [user]);

  // Auto-unlock if biometric not enabled
  useEffect(() => {
    if (!isBiometricEnabled && !isUnlocked) {
      setUnlocked(true);
    }
  }, [isBiometricEnabled, isUnlocked, setUnlocked]);

  // Hide splash when ready
  useEffect(() => {
    if (!isLoading && dbReady) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, dbReady]);

  // Show loading screen
  if (isLoading || !dbReady) {
    return <View style={styles.loadingScreen} />;
  }

  // Show biometric lock screen
  if (isBiometricEnabled && !isUnlocked && user) {
    return <BiometricLockScreen />;
  }

  return (
    <>
      <StatusBar style="light" />
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(main)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <PostHogProvider
          apiKey={POSTHOG_API_KEY}
          options={{
            host: POSTHOG_HOST,
          }}
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RootLayoutNav />
            </AuthProvider>
          </QueryClientProvider>
        </PostHogProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  lockScreen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  lockTitle: {
    ...typography.h1,
    marginBottom: spacing.sm,
  },
  lockSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  lockError: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
  },
  lockButton: {
    marginTop: spacing.lg,
  },
  offlineBanner: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  offlineText: {
    ...typography.caption,
    color: colors.bgPrimary,
    textAlign: 'center',
  },
});
