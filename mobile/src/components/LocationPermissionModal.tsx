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
import { colors, gradients, spacing, borderRadius, typography, buttonStyles, useTheme } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LocationPermissionModalProps {
  visible: boolean;
  onClose: () => void;
  onEnableLocation: () => Promise<void>;
  isLoading?: boolean;
}

export function LocationPermissionModal({
  visible,
  onClose,
  onEnableLocation,
  isLoading = false,
}: LocationPermissionModalProps) {
  const { colors: themeColors, gradients: themeGradients } = useTheme();

  const handleEnableLocation = async () => {
    await onEnableLocation();
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
            <Ionicons name="location" size={36} color={themeColors.bgPrimary} />
          </LinearGradient>
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Enable Location</Text>

        {/* Description */}
        <Text style={[styles.description, { color: themeColors.textSecondary }]}>
          To find places near you, Cortex needs your location. This helps us suggest restaurants,
          coffee shops, and venues nearby.
        </Text>

        {/* Privacy note */}
        <View style={[styles.privacyNote, { backgroundColor: themeColors.fill }]}>
          <Ionicons name="shield-checkmark" size={16} color={themeColors.success} />
          <Text style={[styles.privacyText, { color: themeColors.textSecondary }]}>
            Your location is only used when you search for places
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[buttonStyles.primary, styles.primaryButton, { backgroundColor: themeColors.accent }]}
            onPress={handleEnableLocation}
            disabled={isLoading}
          >
            <Ionicons
              name="navigate"
              size={20}
              color={themeColors.bgPrimary}
              style={styles.buttonIcon}
            />
            <Text style={[buttonStyles.primaryText, { color: themeColors.bgPrimary }]}>
              {isLoading ? 'Enabling...' : 'Enable Location'}
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
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    lineHeight: 24,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glassBackground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xl,
  },
  privacyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
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
