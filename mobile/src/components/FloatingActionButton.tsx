import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients, shadows, useTheme } from '../theme';

interface FloatingActionButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
}

export function FloatingActionButton({
  icon,
  onPress,
  size = 56,
}: FloatingActionButtonProps) {
  const { gradients: themeGradients, colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.container, shadows.lg]}
    >
      <LinearGradient
        colors={themeGradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.gradient,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Ionicons name={icon} size={24} color={themeColors.bgPrimary} />
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 28,
  },
  gradient: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
