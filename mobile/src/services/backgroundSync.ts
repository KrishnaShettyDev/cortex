/**
 * Background sync service for Cortex.
 * Handles syncing data when app comes to foreground and periodic location-based checks.
 */

import { AppState, AppStateStatus } from 'react-native';
import { logger } from '../utils/logger';
import { locationService } from './location';
import { remindersService } from './reminders';
import { storage } from './storage';

// Minimum interval between syncs (5 minutes)
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Storage keys
const LAST_SYNC_KEY = 'background_sync_last';
const LAST_LOCATION_CHECK_KEY = 'location_check_last';

export interface SyncResult {
  success: boolean;
  locationUpdated: boolean;
  locationRemindersTriggered: number;
  timestamp: Date;
}

class BackgroundSyncService {
  private appStateSubscription: { remove: () => void } | null = null;
  private lastAppState: AppStateStatus = 'active';
  private isSyncing = false;

  /**
   * Initialize the background sync service.
   * Call this once when the app starts.
   */
  initialize(): void {
    // Listen for app state changes
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
    logger.log('BackgroundSync: Initialized');

    // Perform initial sync
    this.performSync();
  }

  /**
   * Clean up listeners
   */
  cleanup(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    logger.log('BackgroundSync: Cleaned up');
  }

  /**
   * Handle app state changes (background -> foreground)
   */
  private async handleAppStateChange(nextAppState: AppStateStatus): Promise<void> {
    // When app comes to foreground
    if (
      this.lastAppState.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      logger.log('BackgroundSync: App came to foreground, checking if sync needed');
      await this.performSyncIfNeeded();
    }

    this.lastAppState = nextAppState;
  }

  /**
   * Check if enough time has passed since last sync
   */
  private async shouldSync(): Promise<boolean> {
    try {
      const lastSyncStr = await storage.get(LAST_SYNC_KEY);
      if (!lastSyncStr) return true;

      const lastSync = new Date(lastSyncStr);
      const elapsed = Date.now() - lastSync.getTime();
      return elapsed >= MIN_SYNC_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  /**
   * Perform sync only if enough time has passed
   */
  private async performSyncIfNeeded(): Promise<void> {
    if (await this.shouldSync()) {
      await this.performSync();
    } else {
      logger.log('BackgroundSync: Skipping sync, not enough time elapsed');
    }
  }

  /**
   * Perform a full background sync
   */
  async performSync(): Promise<SyncResult> {
    if (this.isSyncing) {
      logger.log('BackgroundSync: Already syncing, skipping');
      return {
        success: false,
        locationUpdated: false,
        locationRemindersTriggered: 0,
        timestamp: new Date(),
      };
    }

    this.isSyncing = true;
    logger.log('BackgroundSync: Starting sync');

    const result: SyncResult = {
      success: true,
      locationUpdated: false,
      locationRemindersTriggered: 0,
      timestamp: new Date(),
    };

    try {
      // 1. Update location
      const locationUpdated = await this.syncLocation();
      result.locationUpdated = locationUpdated;

      // 2. Check location-based reminders if location is available
      if (locationUpdated) {
        result.locationRemindersTriggered = await this.checkLocationReminders();
      }

      // Save last sync time
      await storage.set(LAST_SYNC_KEY, new Date().toISOString());

      logger.log('BackgroundSync: Sync completed successfully', result);
    } catch (error) {
      logger.error('BackgroundSync: Sync failed', error);
      result.success = false;
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Sync the user's location to the backend
   */
  private async syncLocation(): Promise<boolean> {
    try {
      const updated = await locationService.updateBackendLocation();
      if (updated) {
        logger.log('BackgroundSync: Location synced');
      }
      return updated;
    } catch (error) {
      logger.error('BackgroundSync: Location sync failed', error);
      return false;
    }
  }

  /**
   * Check for location-based reminders that should be triggered
   */
  private async checkLocationReminders(): Promise<number> {
    try {
      const location = await locationService.getCurrentLocation();
      if (!location) {
        return 0;
      }

      // Check if we should check location reminders (not more than once per minute)
      const lastCheckStr = await storage.get(LAST_LOCATION_CHECK_KEY);
      if (lastCheckStr) {
        const lastCheck = new Date(lastCheckStr);
        const elapsed = Date.now() - lastCheck.getTime();
        if (elapsed < 60 * 1000) {
          logger.log('BackgroundSync: Skipping location reminder check, too soon');
          return 0;
        }
      }

      const response = await remindersService.checkLocationReminders(
        location.latitude,
        location.longitude
      );

      await storage.set(LAST_LOCATION_CHECK_KEY, new Date().toISOString());

      if (response.total > 0) {
        logger.log(`BackgroundSync: Triggered ${response.total} location reminders`);
      }

      return response.total;
    } catch (error) {
      logger.error('BackgroundSync: Location reminder check failed', error);
      return 0;
    }
  }

  /**
   * Force a sync regardless of timing
   */
  async forceSync(): Promise<SyncResult> {
    logger.log('BackgroundSync: Force sync requested');
    return this.performSync();
  }

  /**
   * Get the last sync time
   */
  async getLastSyncTime(): Promise<Date | null> {
    try {
      const lastSyncStr = await storage.get(LAST_SYNC_KEY);
      return lastSyncStr ? new Date(lastSyncStr) : null;
    } catch {
      return null;
    }
  }
}

export const backgroundSyncService = new BackgroundSyncService();
