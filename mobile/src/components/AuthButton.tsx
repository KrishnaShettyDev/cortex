import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing } from '../theme';

interface AuthButtonProps {
  type: 'apple' | 'google' | 'dev';
  onPress: () => void;
  isLoading?: boolean;
}

export function AuthButton({ type, onPress, isLoading = false }: AuthButtonProps) {
  const config = {
    apple: {
      icon: 'logo-apple' as const,
      text: 'Continue with Apple',
      bgColor: colors.textPrimary,
      textColor: colors.bgPrimary,
    },
    google: {
      icon: 'logo-google' as const,
      text: 'Continue with Google',
      bgColor: colors.glassBackground,
      textColor: colors.textPrimary,
    },
    dev: {
      icon: 'code-slash' as const,
      text: 'Dev Login',
      bgColor: colors.glassBackground,
      textColor: colors.textSecondary,
    },
  };

  const { icon, text, bgColor, textColor } = config[type];

  return (
    <TouchableOpacity
      style={[
        styles.button,
        {
          backgroundColor: bgColor,
          borderColor: type === 'apple' ? 'transparent' : colors.glassBorder,
        },
      ]}
      onPress={onPress}
      disabled={isLoading}
      activeOpacity={0.8}
    >
      {isLoading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          <Ionicons name={icon} size={20} color={textColor} />
          <Text style={[styles.text, { color: textColor }]}>{text}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    gap: 10,
  },
  text: {
    fontSize: 17,
    fontWeight: '600',
  },
});
