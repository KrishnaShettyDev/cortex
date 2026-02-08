/**
 * ProactiveMessage - Proactive assistant message bubble
 *
 * Displays system-initiated messages (notifications, reminders, insights)
 * with a distinct visual style and action buttons.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, spacing, useTheme } from '../theme';
import { SuggestedActions } from './SuggestedActions';
import type { ProactiveMessage as ProactiveMessageType, SuggestedAction } from '../services/chat';

interface ProactiveMessageProps {
  message: ProactiveMessageType;
  onActionPress: (action: SuggestedAction) => void;
  onDismiss?: () => void;
  isLoading?: boolean;
}

// Map message types to icons and colors
const MESSAGE_TYPE_CONFIG: Record<
  ProactiveMessageType['messageType'],
  { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }
> = {
  notification: {
    icon: 'notifications',
    color: '#6366F1',
    label: 'Notification',
  },
  briefing: {
    icon: 'sunny',
    color: '#F59E0B',
    label: 'Daily Briefing',
  },
  reminder: {
    icon: 'alarm',
    color: '#22C55E',
    label: 'Reminder',
  },
  insight: {
    icon: 'bulb',
    color: '#8B5CF6',
    label: 'Insight',
  },
  action_result: {
    icon: 'checkmark-circle',
    color: '#10B981',
    label: 'Action Complete',
  },
};

export function ProactiveMessageBubble({
  message,
  onActionPress,
  onDismiss,
  isLoading = false,
}: ProactiveMessageProps) {
  const { colors, isDark } = useTheme();
  const config = MESSAGE_TYPE_CONFIG[message.messageType] || MESSAGE_TYPE_CONFIG.notification;

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.container}>
      {/* Header with type indicator */}
      <View style={styles.header}>
        <View style={[styles.typeIndicator, { backgroundColor: `${config.color}20` }]}>
          <Ionicons name={config.icon} size={14} color={config.color} />
          <Text style={[styles.typeLabel, { color: config.color }]}>
            {config.label}
          </Text>
        </View>
        <Text style={[styles.timestamp, { color: colors.textTertiary }]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>

      {/* Message bubble */}
      <BlurView
        intensity={isDark ? 20 : 40}
        tint={isDark ? 'dark' : 'light'}
        style={[
          styles.bubble,
          {
            backgroundColor: isDark
              ? 'rgba(99, 102, 241, 0.1)'
              : 'rgba(99, 102, 241, 0.05)',
            borderColor: isDark
              ? 'rgba(99, 102, 241, 0.2)'
              : 'rgba(99, 102, 241, 0.15)',
          },
        ]}
      >
        {/* Accent bar */}
        <View style={[styles.accentBar, { backgroundColor: config.color }]} />

        {/* Content */}
        <View style={styles.content}>
          <Text style={[styles.messageText, { color: colors.textPrimary }]}>
            {message.content}
          </Text>

          {/* Suggested actions */}
          {message.suggestedActions && message.suggestedActions.length > 0 && (
            <View style={styles.actionsContainer}>
              <SuggestedActions
                actions={message.suggestedActions}
                onActionPress={onActionPress}
                isLoading={isLoading}
                compact
              />
            </View>
          )}
        </View>

        {/* Dismiss button */}
        {onDismiss && (
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </BlurView>

      {/* Unread indicator */}
      {!message.isRead && (
        <View style={[styles.unreadDot, { backgroundColor: config.color }]} />
      )}
    </View>
  );
}

/**
 * Compact variant for notification list
 */
export function ProactiveMessageCompact({
  message,
  onPress,
}: {
  message: ProactiveMessageType;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const config = MESSAGE_TYPE_CONFIG[message.messageType] || MESSAGE_TYPE_CONFIG.notification;

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <TouchableOpacity
      style={[styles.compactContainer, { backgroundColor: colors.fill }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.compactIcon, { backgroundColor: `${config.color}20` }]}>
        <Ionicons name={config.icon} size={18} color={config.color} />
      </View>
      <View style={styles.compactContent}>
        <Text
          style={[styles.compactText, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {message.content}
        </Text>
        <Text style={[styles.compactTime, { color: colors.textTertiary }]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
      {!message.isRead && (
        <View style={[styles.compactUnread, { backgroundColor: config.color }]} />
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textQuaternary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    marginVertical: spacing.sm,
    marginHorizontal: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  typeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: borderRadius.full,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  timestamp: {
    fontSize: 11,
  },
  bubble: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accentBar: {
    width: 3,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    paddingRight: spacing.xl,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.24,
  },
  actionsContainer: {
    marginTop: spacing.sm,
  },
  dismissButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
  },
  unreadDot: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // Compact variant styles
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xs,
  },
  compactIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactContent: {
    flex: 1,
  },
  compactText: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.24,
  },
  compactTime: {
    fontSize: 12,
    marginTop: 2,
  },
  compactUnread: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
});

export { ProactiveMessageBubble as ProactiveMessage };
