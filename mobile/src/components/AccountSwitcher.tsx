import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, useTheme } from '../theme';

interface AccountSwitcherProps {
  email?: string;
  onPress?: () => void;
}

export function AccountSwitcher({ email, onPress }: AccountSwitcherProps) {
  const { colors: themeColors } = useTheme();

  const truncateEmail = (email: string, maxLength: number = 18) => {
    if (email.length <= maxLength) return email;
    const atIndex = email.indexOf('@');
    if (atIndex > maxLength - 3) {
      return email.slice(0, maxLength - 3) + '...';
    }
    return email.slice(0, atIndex).slice(0, maxLength - 6) + '...' + email.slice(atIndex);
  };

  const displayEmail = email ? truncateEmail(email) : 'Account';

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: themeColors.glassBackground, borderColor: themeColors.glassBorder }
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.email, { color: themeColors.textPrimary }]} numberOfLines={1}>
        {displayEmail}
      </Text>
      <Ionicons
        name="chevron-down"
        size={14}
        color={themeColors.textSecondary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  email: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    maxWidth: 150,
  },
});
