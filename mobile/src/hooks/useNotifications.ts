/**
 * Hook for managing push notifications in Cortex.
 * Handles initialization, event listeners, and deep linking.
 * Uses type-only imports to avoid native module errors in Expo Go.
 */

import { useEffect, useRef, useCallback } from 'react';
import { router } from 'expo-router';
import type * as Notifications from 'expo-notifications';
import { notificationService, NotificationData } from '../services/notifications';
import { useAuth } from '../context/AuthContext';
import { logger } from '../utils/logger';

export function useNotifications() {
  const { isAuthenticated } = useAuth();
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const initializedRef = useRef(false);

  /**
   * Handle navigation based on notification data.
   */
  const handleNotificationNavigation = useCallback((data: NotificationData) => {
    logger.log('Handling notification navigation:', data);

    switch (data.type) {
      case 'briefing':
        // Navigate to chat with briefing context
        router.push({
          pathname: '/(main)/chat',
          params: data.full_content ? { briefing: data.full_content } : undefined,
        });
        break;

      case 'reminder':
        // Navigate to chat with pre-filled prompt
        if (data.prompt) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: data.prompt },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'memory_insight':
        // Navigate to chat asking about the topic
        if (data.topic) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Tell me about ${data.topic}` },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'connection':
        // Navigate to chat with connection context
        if (data.connection_id) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: 'Tell me about that memory connection you discovered' },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'meeting_prep':
        // Navigate to person detail screen
        if (data.person_name) {
          router.push({
            pathname: '/(main)/person/[name]',
            params: { name: data.person_name },
          });
        } else {
          router.push('/(main)/people');
        }
        break;

      default:
        // Default: just open chat
        router.push('/(main)/chat');
    }
  }, []);

  /**
   * Handle notification received while app is in foreground.
   */
  const handleNotificationReceived = useCallback(
    (notification: Notifications.Notification) => {
      logger.log('Notification received in foreground:', notification.request.content);
      // Clear badge when notification is received
      notificationService.clearBadge();
    },
    []
  );

  /**
   * Handle notification tap (user interaction).
   */
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      logger.log('Notification tapped:', response.notification.request.content);
      const data = response.notification.request.content.data as unknown as NotificationData;
      if (data) {
        handleNotificationNavigation(data);
      }
      // Clear badge when notification is tapped
      notificationService.clearBadge();
    },
    [handleNotificationNavigation]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      // Clean up when logged out
      notificationListener.current?.remove();
      responseListener.current?.remove();
      initializedRef.current = false;
      return;
    }

    // Initialize notifications
    const init = async () => {
      if (initializedRef.current) return;

      logger.log('Initializing notifications...');
      const token = await notificationService.initialize();

      // Set up listeners only after initialization (which checks if native modules work)
      notificationListener.current = notificationService.addNotificationReceivedListener(
        handleNotificationReceived
      );
      responseListener.current = notificationService.addNotificationResponseListener(
        handleNotificationResponse
      );

      if (token) {
        logger.log('Notifications initialized with token');
        initializedRef.current = true;

        // Check if app was opened via notification
        const lastResponse = await notificationService.getLastNotificationResponse();
        if (lastResponse) {
          const data = lastResponse.notification.request.content.data as unknown as NotificationData;
          if (data) {
            // Small delay to ensure navigation is ready
            setTimeout(() => {
              handleNotificationNavigation(data);
            }, 500);
          }
        }
      } else {
        logger.log('Notifications not available (normal in Expo Go)');
      }
    };

    init();

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isAuthenticated, handleNotificationReceived, handleNotificationResponse, handleNotificationNavigation]);

  /**
   * Manually trigger notification registration.
   * Useful for requesting permissions after initial app load.
   */
  const requestPermission = useCallback(async () => {
    return await notificationService.initialize();
  }, []);

  /**
   * Unregister from notifications (on logout).
   */
  const unregister = useCallback(async () => {
    await notificationService.unregister();
    initializedRef.current = false;
  }, []);

  /**
   * Check if notifications are enabled.
   */
  const getToken = useCallback(() => {
    return notificationService.getToken();
  }, []);

  return {
    requestPermission,
    unregister,
    getToken,
  };
}
