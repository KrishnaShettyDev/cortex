/**
 * Geofencing Service
 *
 * Client-side geofencing for location-based reminders.
 * Uses native OS geofencing (iOS CoreLocation / Android Geofencing API)
 * for battery-efficient, privacy-first location monitoring.
 *
 * Flow:
 * 1. Sync reminders from backend on app open
 * 2. Register geofences with OS (max 20 on iOS)
 * 3. OS monitors in background (zero battery drain)
 * 4. On enter/exit → show local notification
 * 5. Notify backend that reminder was triggered
 *
 * IMPORTANT: This must be imported at app startup to register the task.
 */

import { api } from './api';
import { logger } from '../utils/logger';
import { RETRY_CONFIG } from './constants';

// Lazy imports for Expo modules
let Location: typeof import('expo-location') | null = null;
let TaskManager: typeof import('expo-task-manager') | null = null;
let Notifications: typeof import('expo-notifications') | null = null;

const GEOFENCING_TASK_NAME = 'CORTEX_LOCATION_REMINDER_TASK';

export interface LocationReminder {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  message: string;
  triggerOn: 'enter' | 'exit' | 'both';
  isRecurring: boolean;
}

interface GeofencingEvent {
  eventType: number; // Location.GeofencingEventType.Enter or Exit
  region: {
    identifier: string;
    latitude: number;
    longitude: number;
    radius: number;
  };
}

// Cache of current reminders (for the task handler to access)
let cachedReminders: Map<string, LocationReminder> = new Map();

/**
 * Load Expo modules lazily
 */
async function loadModules() {
  if (!Location) {
    try {
      Location = await import('expo-location');
    } catch (e) {
      logger.log('Geofencing: expo-location not available');
    }
  }
  if (!TaskManager) {
    try {
      TaskManager = await import('expo-task-manager');
    } catch (e) {
      logger.log('Geofencing: expo-task-manager not available');
    }
  }
  if (!Notifications) {
    try {
      Notifications = await import('expo-notifications');
    } catch (e) {
      logger.log('Geofencing: expo-notifications not available');
    }
  }
  return { Location, TaskManager, Notifications };
}

/**
 * Show a local notification for a triggered reminder
 */
async function showReminderNotification(reminder: LocationReminder, eventType: 'enter' | 'exit') {
  const { Notifications: Notif } = await loadModules();
  if (!Notif) return;

  const action = eventType === 'enter' ? 'arrived at' : 'left';

  await Notif.scheduleNotificationAsync({
    content: {
      title: `Reminder: ${reminder.name}`,
      body: reminder.message,
      data: {
        type: 'location_reminder',
        reminderId: reminder.id,
        locationName: reminder.name,
      },
    },
    trigger: null, // Immediate
  });

  logger.log(`Geofencing: Showed notification for ${reminder.name} (${eventType})`);
}

/**
 * Notify the backend that a reminder was triggered
 */
async function notifyBackendTrigger(reminderId: string, eventType: 'enter' | 'exit') {
  try {
    await api.request(`/v3/location-reminders/${reminderId}/trigger`, {
      method: 'POST',
      body: { event_type: eventType },
    });
    logger.log(`Geofencing: Notified backend of trigger for ${reminderId}`);
  } catch (error) {
    logger.error('Geofencing: Failed to notify backend:', error);
  }
}

/**
 * Handle geofence events (called by OS when entering/exiting regions)
 * This runs in the background, even when the app is closed.
 */
async function handleGeofenceEvent({ data, error }: { data: GeofencingEvent; error: any }) {
  if (error) {
    logger.error('Geofencing: Task error:', error);
    return;
  }

  const { Location: Loc } = await loadModules();
  if (!Loc) return;

  const { eventType, region } = data;
  const reminder = cachedReminders.get(region.identifier);

  if (!reminder) {
    logger.log(`Geofencing: Unknown region ${region.identifier}, skipping`);
    return;
  }

  const isEnter = eventType === Loc.GeofencingEventType.Enter;
  const isExit = eventType === Loc.GeofencingEventType.Exit;
  const eventName = isEnter ? 'enter' : 'exit';

  logger.log(`Geofencing: ${eventName} event for ${reminder.name}`);

  // Check if this trigger type matches what the user wanted
  const shouldTrigger =
    reminder.triggerOn === 'both' ||
    (reminder.triggerOn === 'enter' && isEnter) ||
    (reminder.triggerOn === 'exit' && isExit);

  if (!shouldTrigger) {
    logger.log(`Geofencing: Event type ${eventName} doesn't match trigger_on ${reminder.triggerOn}, skipping`);
    return;
  }

  // Show notification
  await showReminderNotification(reminder, eventName);

  // Notify backend
  await notifyBackendTrigger(reminder.id, eventName);

  // If not recurring, remove from cache and stop monitoring
  if (!reminder.isRecurring) {
    cachedReminders.delete(reminder.id);
    // Note: The backend will mark it as completed, next sync will not include it
  }
}

class GeofencingService {
  private isInitialized = false;

  /**
   * Initialize geofencing - must be called at app startup
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    const { TaskManager: TM } = await loadModules();
    if (!TM) {
      logger.log('Geofencing: TaskManager not available, skipping initialization');
      return false;
    }

    try {
      // Define the background task
      // IMPORTANT: This must be called in the global scope (at module import time)
      TM.defineTask(GEOFENCING_TASK_NAME, handleGeofenceEvent);
      this.isInitialized = true;
      logger.log('Geofencing: Task defined successfully');
      return true;
    } catch (error) {
      logger.error('Geofencing: Failed to define task:', error);
      return false;
    }
  }

  /**
   * Check if we have background location permission
   */
  async hasBackgroundPermission(): Promise<boolean> {
    const { Location: Loc } = await loadModules();
    if (!Loc) return false;

    try {
      const { status } = await Loc.getBackgroundPermissionsAsync();
      return status === Loc.PermissionStatus.GRANTED;
    } catch (error) {
      return false;
    }
  }

  /**
   * Request background location permission
   * This is required for geofencing to work when app is closed
   */
  async requestBackgroundPermission(): Promise<boolean> {
    const { Location: Loc } = await loadModules();
    if (!Loc) return false;

    try {
      // First need foreground permission
      const foreground = await Loc.requestForegroundPermissionsAsync();
      if (foreground.status !== Loc.PermissionStatus.GRANTED) {
        logger.log('Geofencing: Foreground permission denied');
        return false;
      }

      // Then request background
      const background = await Loc.requestBackgroundPermissionsAsync();
      const granted = background.status === Loc.PermissionStatus.GRANTED;
      logger.log(`Geofencing: Background permission ${granted ? 'granted' : 'denied'}`);
      return granted;
    } catch (error) {
      logger.error('Geofencing: Error requesting permission:', error);
      return false;
    }
  }

  /**
   * Sync location reminders from backend and register geofences
   */
  async syncReminders(): Promise<number> {
    const { Location: Loc } = await loadModules();
    if (!Loc) return 0;

    // Check permission
    const hasPermission = await this.hasBackgroundPermission();
    if (!hasPermission) {
      logger.log('Geofencing: No background permission, skipping sync');
      return 0;
    }

    try {
      // Fetch reminders from backend
      const response = await api.request<{
        success: boolean;
        reminders: LocationReminder[];
        count: number;
      }>('/v3/location-reminders');

      if (!response.success || !response.reminders) {
        logger.log('Geofencing: No reminders to sync');
        return 0;
      }

      const reminders = response.reminders;
      logger.log(`Geofencing: Syncing ${reminders.length} reminders`);

      // Stop existing geofencing
      const isRunning = await Loc.hasStartedGeofencingAsync(GEOFENCING_TASK_NAME);
      if (isRunning) {
        await Loc.stopGeofencingAsync(GEOFENCING_TASK_NAME);
      }

      // Update cache
      cachedReminders.clear();
      for (const reminder of reminders) {
        cachedReminders.set(reminder.id, reminder);
      }

      if (reminders.length === 0) {
        logger.log('Geofencing: No active reminders');
        return 0;
      }

      // Register geofences with OS
      const regions = reminders.map(r => ({
        identifier: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        radius: Math.max(r.radius, 100), // Minimum 100m for reliability
        notifyOnEnter: r.triggerOn === 'enter' || r.triggerOn === 'both',
        notifyOnExit: r.triggerOn === 'exit' || r.triggerOn === 'both',
      }));

      await Loc.startGeofencingAsync(GEOFENCING_TASK_NAME, regions);
      logger.log(`Geofencing: Registered ${regions.length} geofences`);

      return regions.length;
    } catch (error) {
      logger.error('Geofencing: Sync failed:', error);
      return 0;
    }
  }

  /**
   * Stop all geofencing
   */
  async stopAll(): Promise<void> {
    const { Location: Loc } = await loadModules();
    if (!Loc) return;

    try {
      const isRunning = await Loc.hasStartedGeofencingAsync(GEOFENCING_TASK_NAME);
      if (isRunning) {
        await Loc.stopGeofencingAsync(GEOFENCING_TASK_NAME);
        logger.log('Geofencing: Stopped all monitoring');
      }
      cachedReminders.clear();
    } catch (error) {
      logger.error('Geofencing: Error stopping:', error);
    }
  }

  /**
   * Check if geofencing is currently active
   */
  async isActive(): Promise<boolean> {
    const { Location: Loc } = await loadModules();
    if (!Loc) return false;

    try {
      return await Loc.hasStartedGeofencingAsync(GEOFENCING_TASK_NAME);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current reminder count
   */
  getReminderCount(): number {
    return cachedReminders.size;
  }
}

export const geofencingService = new GeofencingService();

// Auto-initialize on module import with retry logic
// This is required for background tasks to work
let geofencingInitAttempts = 0;

const initGeofencingWithRetry = async (): Promise<void> => {
  try {
    await geofencingService.initialize();
    logger.log('Geofencing: Initialized successfully');
  } catch (error) {
    geofencingInitAttempts++;
    logger.error(`Geofencing: Init attempt ${geofencingInitAttempts} failed:`, error);

    if (geofencingInitAttempts < RETRY_CONFIG.MAX_ATTEMPTS) {
      // Retry after delay
      setTimeout(initGeofencingWithRetry, RETRY_CONFIG.GEOFENCING_RETRY_DELAY);
    } else {
      logger.error('Geofencing: All init attempts exhausted, service unavailable');
    }
  }
};

// Start initialization
initGeofencingWithRetry();
