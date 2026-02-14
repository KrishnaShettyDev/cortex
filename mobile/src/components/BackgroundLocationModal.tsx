import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BottomSheet } from './BottomSheet';
import { spacing, borderRadius, typography, buttonStyles, useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface BackgroundLocationModalProps {
  visible: boolean;
  onClose: () => void;
  onEnable: () => Promise<void>;
  isLoading?: boolean;
}

/**
 * Modal to request background location permission for geofencing.
 * This is required for location-based reminders to work when the app is closed.
 */
export function BackgroundLocationModal({
  visible,
  onClose,
  onEnable,
  isLoading = false,
}: BackgroundLocationModalProps) {
  const { colors: themeColors, gradients: themeGradients } = useTheme();

  const handleEnable = async () => {
    await onEnable();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} height="auto">
      <View style={styles.content}>
        {/* Icon with gradient background */}
        <View style={styles.iconContainer}>
          <LinearGradient
            colors={themeGradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconGradient}
          >
            <Ionicons name="notifications" size={36} color={themeColors.bgPrimary} />
          </LinearGradient>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>
          Location-Based Reminders
        </Text>

        {/* Description */}
        <Text style={[styles.description, { color: themeColors.textSecondary }]}>
          To remind you when you arrive at or leave a place, Cortex needs background location access.
          Select "Always Allow" on the next screen.
        </Text>

        {/* Features list */}
        <View style={[styles.featureList, { backgroundColor: themeColors.fill }]}>
          <View style={styles.featureItem}>
            <Ionicons name="home-outline" size={20} color={themeColors.accent} />
            <Text style={[styles.featureText, { color: themeColors.textSecondary }]}>
              "Remind me when I get home"
            </Text>
          </View>
          <View style={styles.featureItem}>
            <Ionicons name="business-outline" size={20} color={themeColors.accent} />
            <Text style={[styles.featureText, { color: themeColors.textSecondary }]}>
              "Remind me when I leave work"
            </Text>
          </View>
          <View style={styles.featureItem}>
            <Ionicons name="cart-outline" size={20} color={themeColors.accent} />
            <Text style={[styles.featureText, { color: themeColors.textSecondary }]}>
              "Remind me when I'm near the grocery store"
            </Text>
          </View>
        </View>

        {/* Privacy note */}
        <View style={[styles.privacyNote, { backgroundColor: themeColors.fill }]}>
          <Ionicons name="shield-checkmark" size={16} color={themeColors.success} />
          <Text style={[styles.privacyText, { color: themeColors.textSecondary }]}>
            Location is only checked when you enter/leave reminder locations. Zero tracking, zero cloud uploads.
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[buttonStyles.primary, styles.primaryButton, { backgroundColor: themeColors.accent }]}
            onPress={handleEnable}
            disabled={isLoading}
          >
            <Ionicons
              name="location"
              size={20}
              color={themeColors.bgPrimary}
              style={styles.buttonIcon}
            />
            <Text style={[buttonStyles.primaryText, { color: themeColors.bgPrimary }]}>
              {isLoading ? 'Enabling...' : 'Enable Reminders'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[buttonStyles.secondary, styles.secondaryButton, { backgroundColor: themeColors.fill }]}
            onPress={onClose}
            disabled={isLoading}
          >
            <Text style={[buttonStyles.secondaryText, { color: themeColors.textPrimary }]}>Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  iconGradient: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    lineHeight: 24,
  },
  featureList: {
    width: '100%',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    ...typography.bodySmall,
    flex: 1,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xl,
  },
  privacyText: {
    ...typography.bodySmall,
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    width: '100%',
  },
  secondaryButton: {
    width: '100%',
  },
  buttonIcon: {
    marginRight: spacing.sm,
  },
});
