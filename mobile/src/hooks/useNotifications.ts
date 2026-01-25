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

      case 'urgent_email':
        // Navigate to chat with email context
        if (data.subject) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Tell me about the urgent email: "${data.subject}"` },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'commitment':
        // Navigate to chat with commitment context
        if (data.description) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Help me with my commitment: "${data.description}"` },
          });
        } else if (data.person_name) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `What did I promise ${data.person_name}?` },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'pattern_warning':
        // Navigate to chat about the pattern
        if (data.pattern_name) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Tell me about my "${data.pattern_name}" pattern` },
          });
        } else {
          router.push({
            pathname: '/(main)/chat',
            params: { message: 'Tell me about the pattern you noticed' },
          });
        }
        break;

      case 'reconnection_nudge':
        // Navigate to person screen
        if (data.person_name) {
          router.push({
            pathname: '/(main)/person/[name]',
            params: { name: data.person_name },
          });
        } else {
          router.push('/(main)/people');
        }
        break;

      case 'important_date_reminder':
        // Navigate to chat with date context
        if (data.person_name && data.date_type) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Help me plan for ${data.person_name}'s ${data.date_type}` },
          });
        } else if (data.person_name) {
          router.push({
            pathname: '/(main)/person/[name]',
            params: { name: data.person_name },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'promise_reminder':
        // Navigate to chat with promise context
        if (data.person_name) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `What did I promise ${data.person_name}?` },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'intention_nudge':
        // Navigate to chat with intention context
        if (data.intention_id) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: 'What were the things I said I would do?' },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'snoozed_email':
        // Navigate to chat with email context
        if (data.subject) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: `Tell me about the email: "${data.subject}"` },
          });
        } else {
          router.push('/(main)/chat');
        }
        break;

      case 'decision_outcome':
        // Navigate to chat to record outcome
        if (data.decision_id) {
          router.push({
            pathname: '/(main)/chat',
            params: { message: 'Let me tell you about how that decision worked out' },
          });
        } else {
          router.push('/(main)/chat');
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
