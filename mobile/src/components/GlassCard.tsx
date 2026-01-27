import React, { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, borderRadius as br, useTheme } from '../theme';

interface GlassCardProps {
  children: ReactNode;
  style?: ViewStyle;
  borderRadius?: number;
  blurIntensity?: number;
  withBlur?: boolean;
}

export function GlassCard({
  children,
  style,
  borderRadius = br.xl,
  blurIntensity = 20,
  withBlur = false,
}: GlassCardProps) {
  const { colors: themeColors, isDark } = useTheme();

  return (
    <View style={[styles.container, { borderRadius, backgroundColor: themeColors.glassBackground, borderColor: themeColors.glassBorder }, style]}>
      {withBlur && (
        <BlurView
          intensity={blurIntensity}
          style={StyleSheet.absoluteFill}
          tint={isDark ? 'dark' : 'light'}
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
  },
});
