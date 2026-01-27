import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';

type ServiceType = 'gmail' | 'calendar' | 'action';

interface ServiceStatusPillProps {
  service: ServiceType;
  text: string;
  isLoading?: boolean;
  isComplete?: boolean;
}

export function ServiceStatusPill({
  service,
  text,
  isLoading = false,
  isComplete = false,
}: ServiceStatusPillProps) {
  const { colors: themeColors } = useTheme();

  const renderIcon = () => {
    switch (service) {
      case 'gmail':
        return <GmailIcon size={20} />;
      case 'calendar':
        return <GoogleCalendarIcon size={20} />;
      case 'action':
        return <Ionicons name="settings-outline" size={18} color={themeColors.textSecondary} />;
      default:
        return <Ionicons name="ellipse" size={18} color={themeColors.textSecondary} />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bgTertiary }]}>
      <View style={styles.iconContainer}>
        {renderIcon()}
      </View>
      <Text style={[styles.text, { color: themeColors.textPrimary }]}>{text}</Text>
      <View style={styles.statusIcon}>
        {isLoading ? (
          <ActivityIndicator size="small" color={themeColors.textSecondary} />
        ) : isComplete ? (
          <Ionicons name="checkmark" size={18} color={themeColors.success} />
        ) : null}
      </View>
    </View>
  );
}

// Thinking/parsing status indicator with bullet point
interface ThinkingStatusProps {
  text: string;
  onCancel?: () => void;
}

export function ThinkingStatus({ text, onCancel }: ThinkingStatusProps) {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.thinkingContainer}>
      <View style={[styles.bulletPoint, { backgroundColor: themeColors.textSecondary }]} />
      <Text style={[styles.thinkingText, { color: themeColors.textSecondary }]}>{text}</Text>
      {onCancel && (
        <Text style={[styles.cancelText, { color: themeColors.textSecondary }]} onPress={onCancel}>Cancel</Text>
      )}
    </View>
  );
}

// Loading dots indicator
export function LoadingDots() {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.dotsContainer}>
      <View style={[styles.dot, { backgroundColor: themeColors.textTertiary }]} />
      <View style={[styles.dot, { backgroundColor: themeColors.textTertiary }]} />
      <View style={[styles.dot, styles.dotActive, { backgroundColor: themeColors.textSecondary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  statusIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Thinking status styles
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  bulletPoint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textSecondary,
  },
  thinkingText: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  cancelText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  // Loading dots styles
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  dotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textSecondary,
  },
});
