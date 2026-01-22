import { api } from './api';
import { storage } from './storage';
import { logger } from '../utils/logger';

// Lazy import to avoid crash in Expo Go
let Location: typeof import('expo-location') | null = null;

async function getLocationModule() {
  if (!Location) {
    try {
      Location = await import('expo-location');
    } catch (error) {
      logger.log('Location: expo-location not available (normal in Expo Go)');
      return null;
    }
  }
  return Location;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
}

export interface StoredLocation extends UserLocation {
  updatedAt: Date;
}

export interface LocationResponse {
  latitude: number | null;
  longitude: number | null;
  updated_at: string | null;
  is_stale: boolean;
}

class LocationService {
  private static LOCATION_STORAGE_KEY = 'user_location';

  /**
   * Check current permission status
   */
  async getPermissionStatus(): Promise<string> {
    const loc = await getLocationModule();
    if (!loc) return 'unavailable';

    try {
      const { status } = await loc.getForegroundPermissionsAsync();
      return status;
    } catch (error) {
      logger.log('Location: Permission check failed (native module not available)');
      return 'unavailable';
    }
  }

  /**
   * Request location permission
   * Returns true if permission was granted
   */
  async requestPermission(): Promise<boolean> {
    const loc = await getLocationModule();
    if (!loc) return false;

    try {
      const { status } = await loc.requestForegroundPermissionsAsync();
      logger.log(`Location: Permission request result: ${status}`);
      return status === loc.PermissionStatus.GRANTED;
    } catch (error) {
      logger.error('Location: Error requesting permission:', error);
      return false;
    }
  }

  /**
   * Get current location (fast, uses cached/last known position)
   * This is battery-efficient and returns quickly
   */
  async getCurrentLocation(): Promise<UserLocation | null> {
    const loc = await getLocationModule();
    if (!loc) return null;

    try {
      const status = await this.getPermissionStatus();

      if (status !== 'granted') {
        logger.log('Location: Permission not granted');
        return null;
      }

      // Use getLastKnownPositionAsync for speed - it uses cached location
      // This is what food delivery apps do for battery efficiency
      let location = await loc.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000, // Accept location up to 10 minutes old
      });

      // If no cached location, get current (slower but accurate)
      if (!location) {
        logger.log('Location: No cached location, getting current...');
        location = await loc.getCurrentPositionAsync({
          accuracy: loc.Accuracy.Balanced, // Good balance of speed and accuracy
        });
      }

      if (location) {
        const result: UserLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        logger.log(`Location: Got location: ${result.latitude}, ${result.longitude}`);
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Location: Error getting location:', error);
      return null;
    }
  }

  /**
   * Update the backend with the user's current location
   * This should be called when the app comes to foreground
   */
  async updateBackendLocation(): Promise<boolean> {
    try {
      const location = await this.getCurrentLocation();

      if (!location) {
        logger.log('Location: No location to update');
        return false;
      }

      await api.request('/auth/location', {
        method: 'POST',
        body: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
      });

      // Also store locally as backup
      await this.storeLocationLocally(location);

      logger.log('Location: Backend updated successfully');
      return true;
    } catch (error) {
      logger.error('Location: Error updating backend:', error);
      return false;
    }
  }

  /**
   * Get the user's location from the backend
   */
  async getBackendLocation(): Promise<LocationResponse | null> {
    try {
      const response = await api.request<LocationResponse>('/auth/location');
      return response;
    } catch (error) {
      logger.error('Location: Error getting backend location:', error);
      return null;
    }
  }

  /**
   * Store location locally (AsyncStorage backup)
   */
  async storeLocationLocally(location: UserLocation): Promise<void> {
    try {
      const stored: StoredLocation = {
        ...location,
        updatedAt: new Date(),
      };
      await storage.set(LocationService.LOCATION_STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      logger.error('Location: Error storing locally:', error);
    }
  }

  /**
   * Get locally stored location (backup if backend fails)
   */
  async getLocalLocation(): Promise<StoredLocation | null> {
    try {
      const data = await storage.get(LocationService.LOCATION_STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...parsed,
          updatedAt: new Date(parsed.updatedAt),
        };
      }
      return null;
    } catch (error) {
      logger.error('Location: Error getting local location:', error);
      return null;
    }
  }

  /**
   * Clear stored location (for privacy/logout)
   */
  async clearLocation(): Promise<void> {
    try {
      await storage.remove(LocationService.LOCATION_STORAGE_KEY);
      logger.log('Location: Cleared local storage');
    } catch (error) {
      logger.error('Location: Error clearing location:', error);
    }
  }

  /**
   * Check if we have a valid (non-stale) location
   * A location is considered valid if it's less than 1 hour old
   */
  isLocationValid(location: StoredLocation | null, maxAgeMs = 60 * 60 * 1000): boolean {
    if (!location) return false;
    const age = Date.now() - location.updatedAt.getTime();
    return age < maxAgeMs;
  }
}

export const locationService = new LocationService();
