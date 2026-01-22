/**
 * Push notification service for Cortex.
 * Handles permission requests, token registration, and notification events.
 * Uses lazy-loading to avoid native module errors in Expo Go.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from './api';
import { logger } from '../utils/logger';

// Type imports only (not runtime)
import type * as NotificationsType from 'expo-notifications';
import type * as DeviceType from 'expo-device';

export interface NotificationData {
  type: 'briefing' | 'reminder' | 'memory_insight' | 'connection' | 'meeting_prep';
  full_content?: string;
  prompt?: string;
  topic?: string;
  event_id?: string;
  memory_id?: string;
  connection_id?: string;
  person_name?: string;
}

// Lazy-loaded modules
let NotificationsModule: typeof NotificationsType | null = null;
let DeviceModule: typeof DeviceType | null = null;
let nativeModulesAvailable = true;

/**
 * Lazy-load expo-device to avoid native module errors in Expo Go.
 */
const getDevice = async (): Promise<typeof DeviceType | null> => {
  if (DeviceModule) return DeviceModule;
  if (!nativeModulesAvailable) return null;

  try {
    DeviceModule = await import('expo-device');
    return DeviceModule;
  } catch (error) {
    logger.warn('expo-device not available (this is normal in Expo Go)');
    nativeModulesAvailable = false;
    return null;
  }
};

/**
 * Lazy-load expo-notifications to avoid native module errors in Expo Go.
 */
const getNotifications = async (): Promise<typeof NotificationsType | null> => {
  if (NotificationsModule) return NotificationsModule;
  if (!nativeModulesAvailable) return null;

  try {
    const module = await import('expo-notifications');

    // Verify critical methods exist (they won't in Expo Go)
    if (typeof module.addNotificationReceivedListener !== 'function') {
      logger.warn('expo-notifications methods not available (this is normal in Expo Go)');
      nativeModulesAvailable = false;
      return null;
    }

    // Configure notification behavior when app is foregrounded
    module.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    NotificationsModule = module;
    return NotificationsModule;
  } catch (error) {
    logger.warn('expo-notifications not available (this is normal in Expo Go)');
    nativeModulesAvailable = false;
    return null;
  }
};

class NotificationService {
  private pushToken: string | null = null;
  private initialized = false;

  /**
   * Initialize notification service.
   * Requests permissions and registers token with backend.
   */
  async initialize(): Promise<string | null> {
    if (this.initialized && this.pushToken) {
      return this.pushToken;
    }

    const Device = await getDevice();
    const Notifications = await getNotifications();

    if (!Device || !Notifications) {
      logger.log('Native modules not available (running in Expo Go)');
      return null;
    }

    // Must be a physical device
    if (!Device.isDevice) {
      logger.log('Push notifications require a physical device');
      return null;
    }

    try {
      // Check existing permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Request permission if not granted
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        logger.log('Push notification permission not granted');
        return null;
      }

      // Get Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        logger.warn('No EAS project ID found');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      this.pushToken = tokenData.data;
      logger.log('Push token obtained:', this.pushToken);

      // Configure Android notification channel
      if (Platform.OS === 'android') {
        await this.setupAndroidChannel(Notifications);
      }

      // Register with backend
      await this.registerToken(this.pushToken, Device);

      this.initialized = true;
      return this.pushToken;
    } catch (error) {
      logger.error('Failed to initialize notifications:', error);
      return null;
    }
  }

  /**
   * Setup Android notification channel.
   */
  private async setupAndroidChannel(Notifications: typeof NotificationsType): Promise<void> {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Cortex',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      lightColor: '#6366F1',
      sound: 'default',
    });

    // Daily briefings channel
    await Notifications.setNotificationChannelAsync('briefings', {
      name: 'Daily Briefings',
      description: 'Morning and evening briefings from your second brain',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    // Reminders channel
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Smart Reminders',
      description: 'Contextual reminders for meetings and follow-ups',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    // Insights channel
    await Notifications.setNotificationChannelAsync('insights', {
      name: 'Memory Insights',
      description: 'On this day memories and weekly summaries',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  /**
   * Register push token with backend.
   */
  private async registerToken(token: string, Device: typeof DeviceType): Promise<void> {
    try {
      await api.request('/notifications/register', {
        method: 'POST',
        body: {
          push_token: token,
          platform: Platform.OS,
          device_name: Device.deviceName || `${Device.brand} ${Device.modelName}`,
        },
      });
      logger.log('Push token registered with backend');
    } catch (error) {
      logger.error('Failed to register push token:', error);
    }
  }

  /**
   * Unregister push token (on logout).
   */
  async unregister(): Promise<void> {
    if (!this.pushToken) return;

    try {
      await api.request('/notifications/unregister', {
        method: 'POST',
        body: { push_token: this.pushToken },
      });
      this.pushToken = null;
      this.initialized = false;
      logger.log('Push token unregistered');
    } catch (error) {
      logger.error('Failed to unregister push token:', error);
    }
  }

  /**
   * Get current push token.
   */
  getToken(): string | null {
    return this.pushToken;
  }

  /**
   * Add listener for when notification is received while app is foregrounded.
   */
  addNotificationReceivedListener(
    callback: (notification: NotificationsType.Notification) => void
  ): { remove: () => void } {
    // Return a no-op subscription if notifications not available
    if (!NotificationsModule || !nativeModulesAvailable) {
      return { remove: () => {} };
    }
    try {
      return NotificationsModule.addNotificationReceivedListener(callback);
    } catch (error) {
      logger.warn('addNotificationReceivedListener not available');
      return { remove: () => {} };
    }
  }

  /**
   * Add listener for when user taps on a notification.
   */
  addNotificationResponseListener(
    callback: (response: NotificationsType.NotificationResponse) => void
  ): { remove: () => void } {
    // Return a no-op subscription if notifications not available
    if (!NotificationsModule || !nativeModulesAvailable) {
      return { remove: () => {} };
    }
    try {
      return NotificationsModule.addNotificationResponseReceivedListener(callback);
    } catch (error) {
      logger.warn('addNotificationResponseReceivedListener not available');
      return { remove: () => {} };
    }
  }

  /**
   * Get the last notification response (for deep linking on app open).
   */
  async getLastNotificationResponse(): Promise<NotificationsType.NotificationResponse | null> {
    const Notifications = await getNotifications();
    if (!Notifications) return null;
    return await Notifications.getLastNotificationResponseAsync();
  }

  /**
   * Schedule a local notification (for testing).
   */
  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: NotificationData,
    secondsFromNow: number = 5
  ): Promise<string | null> {
    const Notifications = await getNotifications();
    if (!Notifications) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data as unknown as Record<string, unknown>,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsFromNow,
      },
    });
  }

  /**
   * Cancel all scheduled notifications.
   */
  async cancelAllScheduled(): Promise<void> {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  /**
   * Get badge count.
   */
  async getBadgeCount(): Promise<number> {
    const Notifications = await getNotifications();
    if (!Notifications) return 0;
    return await Notifications.getBadgeCountAsync();
  }

  /**
   * Set badge count.
   */
  async setBadgeCount(count: number): Promise<void> {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    await Notifications.setBadgeCountAsync(count);
  }

  /**
   * Clear badge.
   */
  async clearBadge(): Promise<void> {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    await Notifications.setBadgeCountAsync(0);
  }
}

export const notificationService = new NotificationService();
