/**
 * SuggestedActions - Proactive message action buttons
 *
 * Displays a row of action buttons for proactive messages (Poke/Iris-style).
 * Actions can include reply, archive, snooze, open, etc.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, borderRadius, useTheme } from '../theme';
import type { SuggestedAction } from '../services/chat';

interface SuggestedActionsProps {
  actions: SuggestedAction[];
  onActionPress: (action: SuggestedAction) => void;
  isLoading?: boolean;
  compact?: boolean;
}

// Map action types to icons
const ACTION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  reply: 'arrow-undo',
  archive: 'archive',
  snooze: 'time',
  open: 'open',
  dismiss: 'close-circle',
  confirm: 'checkmark-circle',
  cancel: 'close',
  view: 'eye',
  call: 'call',
  email: 'mail',
  message: 'chatbubble',
  calendar: 'calendar',
  remind: 'alarm',
  complete: 'checkmark',
  reschedule: 'calendar-outline',
  followup: 'arrow-forward',
  default: 'ellipsis-horizontal',
};

// Map action types to colors
const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  reply: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
  confirm: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22C55E' },
  complete: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22C55E' },
  cancel: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
  dismiss: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9CA3AF' },
  snooze: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  remind: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  archive: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9CA3AF' },
  default: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
};

function getIconName(actionType: string): keyof typeof Ionicons.glyphMap {
  return ACTION_ICONS[actionType] || ACTION_ICONS.default;
}

function getColors(actionType: string): { bg: string; text: string } {
  return ACTION_COLORS[actionType] || ACTION_COLORS.default;
}

export function SuggestedActions({
  actions,
  onActionPress,
  isLoading = false,
  compact = false,
}: SuggestedActionsProps) {
  const { colors: themeColors } = useTheme();

  if (!actions || actions.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {actions.map((action, index) => {
        const actionColors = getColors(action.type);
        const iconName = getIconName(action.type);

        return (
          <TouchableOpacity
            key={`${action.type}-${index}`}
            style={[
              styles.button,
              compact && styles.buttonCompact,
              { backgroundColor: actionColors.bg },
              isLoading && styles.buttonDisabled,
            ]}
            onPress={() => onActionPress(action)}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            <Ionicons
              name={iconName}
              size={compact ? 14 : 16}
              color={actionColors.text}
            />
            <Text
              style={[
                styles.label,
                compact && styles.labelCompact,
                { color: actionColors.text },
              ]}
              numberOfLines={1}
            >
              {action.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/**
 * SuggestedActionsInline - Vertical list variant for inline display
 */
export function SuggestedActionsInline({
  actions,
  onActionPress,
  isLoading = false,
}: SuggestedActionsProps) {
  const { colors: themeColors } = useTheme();

  if (!actions || actions.length === 0) {
    return null;
  }

  return (
    <View style={styles.inlineContainer}>
      {actions.map((action, index) => {
        const actionColors = getColors(action.type);
        const iconName = getIconName(action.type);

        return (
          <TouchableOpacity
            key={`${action.type}-${index}`}
            style={[
              styles.inlineButton,
              { backgroundColor: themeColors.fill },
              isLoading && styles.buttonDisabled,
            ]}
            onPress={() => onActionPress(action)}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.inlineIconContainer,
                { backgroundColor: actionColors.bg },
              ]}
            >
              <Ionicons name={iconName} size={16} color={actionColors.text} />
            </View>
            <Text
              style={[styles.inlineLabel, { color: themeColors.textPrimary }]}
              numberOfLines={1}
            >
              {action.label}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={themeColors.textQuaternary}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
  },
  buttonCompact: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.24,
  },
  labelCompact: {
    fontSize: 12,
  },
  // Inline variant styles
  inlineContainer: {
    gap: spacing.xs,
  },
  inlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
  },
  inlineIconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: -0.24,
  },
});
