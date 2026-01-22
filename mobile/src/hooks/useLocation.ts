/**
 * Hook for managing location in Cortex.
 * Handles permission management, location updates, and foreground refresh.
 * Uses expo-location for battery-efficient location tracking.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { locationService, UserLocation, StoredLocation } from '../services/location';
import { useAuth } from '../context/AuthContext';
import { logger } from '../utils/logger';

export interface UseLocationResult {
  // Permission state
  permissionStatus: Location.PermissionStatus | null;
  isPermissionGranted: boolean;

  // Location state
  location: UserLocation | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  requestPermission: () => Promise<boolean>;
  refreshLocation: () => Promise<void>;
}

export function useLocation(): UseLocationResult {
  const { isAuthenticated } = useAuth();
  const [permissionStatus, setPermissionStatus] = useState<Location.PermissionStatus | null>(null);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appState = useRef<AppStateStatus>(AppState.currentState);
  const isUpdatingRef = useRef(false);

  /**
   * Check and update permission status
   */
  const checkPermission = useCallback(async () => {
    const status = await locationService.getPermissionStatus();
    setPermissionStatus(status);
    return status;
  }, []);

  /**
   * Request location permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setError(null);
    const granted = await locationService.requestPermission();
    await checkPermission();

    if (granted) {
      // Permission granted - immediately get and update location
      await refreshLocation();
    }

    return granted;
  }, [checkPermission]);

  /**
   * Refresh location and update backend
   * This is the main function called when app comes to foreground
   */
  const refreshLocation = useCallback(async (): Promise<void> => {
    // Prevent concurrent updates
    if (isUpdatingRef.current) {
      logger.log('Location: Update already in progress, skipping');
      return;
    }

    isUpdatingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // First check permission
      const status = await checkPermission();

      if (status !== Location.PermissionStatus.GRANTED) {
        logger.log('Location: Permission not granted, skipping update');
        setIsLoading(false);
        isUpdatingRef.current = false;
        return;
      }

      // Get current location
      const currentLocation = await locationService.getCurrentLocation();

      if (currentLocation) {
        setLocation(currentLocation);

        // Update backend (silently, don't block UI)
        locationService.updateBackendLocation().catch((e) => {
          logger.error('Location: Failed to update backend:', e);
        });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to get location';
      logger.error('Location: Refresh error:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      isUpdatingRef.current = false;
    }
  }, [checkPermission]);

  /**
   * Handle app state changes (foreground/background)
   * This is the key to automatic location updates like food delivery apps
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      // App came to foreground
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        logger.log('Location: App came to foreground, refreshing location');
        await refreshLocation();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isAuthenticated, refreshLocation]);

  /**
   * Initial setup - check permission and get location if permitted
   */
  useEffect(() => {
    if (!isAuthenticated) return;

    const initialize = async () => {
      const status = await checkPermission();

      if (status === Location.PermissionStatus.GRANTED) {
        await refreshLocation();
      } else {
        // Try to load from local storage as fallback
        const localLocation = await locationService.getLocalLocation();
        if (localLocation && locationService.isLocationValid(localLocation)) {
          setLocation({
            latitude: localLocation.latitude,
            longitude: localLocation.longitude,
          });
        }
      }
    };

    initialize();
  }, [isAuthenticated, checkPermission, refreshLocation]);

  return {
    permissionStatus,
    isPermissionGranted: permissionStatus === Location.PermissionStatus.GRANTED,
    location,
    isLoading,
    error,
    requestPermission,
    refreshLocation,
  };
}
