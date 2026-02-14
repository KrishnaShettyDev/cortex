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
  type:
    | 'briefing'
    | 'reminder'
    | 'memory_insight'
    | 'connection'
    | 'meeting_prep'
    | 'urgent_email'
    | 'commitment'
    | 'pattern_warning'
    | 'reconnection_nudge'
    | 'important_date_reminder'
    | 'promise_reminder'
    | 'intention_nudge'
    | 'snoozed_email'
    | 'decision_outcome'
    // Proactive system types (Poke/Iris-style)
    | 'proactive_message'
    | 'trigger_reminder'
    | 'email_notification'
    | 'calendar_notification'
    | 'action_result';

  // Common fields
  full_content?: string;
  prompt?: string;
  topic?: string;
  event_id?: string;
  memory_id?: string;
  connection_id?: string;
  person_name?: string;

  // Email fields
  thread_id?: string;
  message_id?: string;
  subject?: string;
  from?: string;
  urgency_score?: number;

  // Commitment/intention fields
  commitment_id?: string;
  intention_id?: string;
  description?: string;
  is_overdue?: boolean;
  days_overdue?: number;

  // Pattern fields
  pattern_name?: string;
  confidence?: number;

  // Important date fields
  date_id?: string;
  date_type?: string;

  // Promise fields
  promise_id?: string;
  total_pending?: number;

  // Decision fields
  decision_id?: string;

  // Entity fields
  entity_id?: string;
  total_neglected?: number;

  // Proactive system fields
  proactive_message_id?: string;
  trigger_id?: string;
  action_id?: string;
  urgency?: 'critical' | 'high' | 'medium' | 'low';
  suggested_actions?: Array<{
    type: string;
    label: string;
    payload?: Record<string, any>;
  }>;
}

/**
 * Deep link target for notification handling.
 */
export interface DeepLinkTarget {
  screen: 'chat' | 'settings' | 'triggers' | 'briefing';
  params?: {
    messageId?: string;
    triggerId?: string;
    scrollToMessage?: boolean;
    actionToExecute?: string;
  };
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
        shouldShowBanner: true,
        shouldShowList: true,
        priority: module.AndroidNotificationPriority.HIGH,
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
  private responseCallback: ((target: DeepLinkTarget) => void) | null = null;

  /**
   * Set a callback for handling notification taps.
   * The callback receives the deep link target to navigate to.
   */
  setResponseHandler(callback: (target: DeepLinkTarget) => void): void {
    this.responseCallback = callback;
  }

  /**
   * Parse notification data into a deep link target.
   */
  parseDeepLinkTarget(data: NotificationData | null): DeepLinkTarget {
    if (!data) {
      return { screen: 'chat' };
    }

    // Proactive message types
    if (data.type === 'proactive_message' || data.proactive_message_id) {
      return {
        screen: 'chat',
        params: {
          messageId: data.proactive_message_id,
          scrollToMessage: true,
        },
      };
    }

    // Trigger-related notifications
    if (data.type === 'trigger_reminder' || data.trigger_id) {
      return {
        screen: 'chat',
        params: {
          triggerId: data.trigger_id,
          scrollToMessage: true,
        },
      };
    }

    // Email notifications
    if (data.type === 'email_notification' || data.type === 'urgent_email') {
      return {
        screen: 'chat',
        params: {
          messageId: data.proactive_message_id,
          scrollToMessage: true,
        },
      };
    }

    // Calendar notifications
    if (data.type === 'calendar_notification' || data.type === 'meeting_prep') {
      return {
        screen: 'chat',
        params: {
          messageId: data.proactive_message_id,
          scrollToMessage: true,
        },
      };
    }

    // Briefing
    if (data.type === 'briefing') {
      return {
        screen: 'briefing',
      };
    }

    // Commitment/reminder
    if (data.type === 'commitment' || data.type === 'reminder') {
      return {
        screen: 'chat',
        params: {
          messageId: data.proactive_message_id || data.commitment_id,
          scrollToMessage: true,
        },
      };
    }

    // Default to chat
    return { screen: 'chat' };
  }

  /**
   * Get the Android notification channel for a given notification type.
   */
  getChannelForType(type: NotificationData['type']): string {
    switch (type) {
      case 'briefing':
        return 'briefings';
      case 'meeting_prep':
      case 'calendar_notification':
        return 'meeting_prep';
      case 'urgent_email':
      case 'email_notification':
        return 'urgent_email';
      case 'commitment':
      case 'promise_reminder':
      case 'trigger_reminder':
        return 'commitments';
      case 'pattern_warning':
        return 'patterns';
      case 'reconnection_nudge':
      case 'important_date_reminder':
      case 'connection':
        return 'relationships';
      case 'reminder':
      case 'proactive_message':
        return 'reminders';
      case 'memory_insight':
        return 'insights';
      default:
        return 'default';
    }
  }

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
   * Setup Android notification channels for all notification types.
   */
  private async setupAndroidChannel(Notifications: typeof NotificationsType): Promise<void> {
    // Default channel
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

    // Meeting preparation channel
    await Notifications.setNotificationChannelAsync('meeting_prep', {
      name: 'Meeting Preparation',
      description: 'Context and insights before your meetings',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    // Urgent emails channel
    await Notifications.setNotificationChannelAsync('urgent_email', {
      name: 'Urgent Emails',
      description: 'Important emails that need your attention',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    // Commitments channel
    await Notifications.setNotificationChannelAsync('commitments', {
      name: 'Commitments',
      description: 'Reminders about things you said you would do',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });

    // Pattern warnings channel
    await Notifications.setNotificationChannelAsync('patterns', {
      name: 'Pattern Alerts',
      description: 'Warnings when you might be repeating past mistakes',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });

    // Relationships channel
    await Notifications.setNotificationChannelAsync('relationships', {
      name: 'Relationships',
      description: 'Reconnection nudges and important dates',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });

    // Smart reminders channel
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Smart Reminders',
      description: 'Contextual reminders for events and follow-ups',
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

    // Proactive notifications channel (critical urgency)
    await Notifications.setNotificationChannelAsync('proactive_critical', {
      name: 'Critical Alerts',
      description: 'OTPs, security alerts, and urgent notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500],
      sound: 'default',
      bypassDnd: true,
    });

    // Proactive notifications channel (high urgency)
    await Notifications.setNotificationChannelAsync('proactive_high', {
      name: 'Important Notifications',
      description: 'VIP emails, payment issues, and direct requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      sound: 'default',
    });
  }

  /**
   * Register push token with backend.
   * Also sends user's timezone for timezone-aware notifications.
   */
  private async registerToken(token: string, Device: typeof DeviceType): Promise<void> {
    try {
      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      await api.request('/notifications/register', {
        method: 'POST',
        body: {
          push_token: token,
          platform: Platform.OS,
          device_name: Device.deviceName || `${Device.brand} ${Device.modelName}`,
        },
      });

      // Also update timezone in notification preferences
      await api.request('/notifications/preferences', {
        method: 'PUT',
        body: { timezone },
      }).catch((error) => {
        // Log but don't fail - preferences might not exist yet for new users
        logger.warn('Failed to update notification timezone preference:', error);
      });

      logger.log('Push token registered with backend, timezone:', timezone);
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
      return NotificationsModule.addNotificationResponseReceivedListener((response) => {
        // Parse deep link target - cast through unknown to avoid strict type checking
        const rawData = response.notification.request.content.data;
        const data = (rawData && typeof rawData === 'object' && 'type' in rawData)
          ? rawData as unknown as NotificationData
          : null;
        if (data && this.responseCallback) {
          const target = this.parseDeepLinkTarget(data);
          this.responseCallback(target);
        }
        // Also call the original callback
        callback(response);
      });
    } catch (error) {
      logger.warn('addNotificationResponseReceivedListener not available');
      return { remove: () => {} };
    }
  }

  /**
   * Handle notification that was opened while app was closed.
   * Call this on app startup to handle any pending deep links.
   */
  async handleInitialNotification(): Promise<DeepLinkTarget | null> {
    const response = await this.getLastNotificationResponse();
    if (!response) return null;

    // Cast through unknown to avoid strict type checking
    const rawData = response.notification.request.content.data;
    const data = (rawData && typeof rawData === 'object' && 'type' in rawData)
      ? rawData as unknown as NotificationData
      : null;
    return this.parseDeepLinkTarget(data);
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
