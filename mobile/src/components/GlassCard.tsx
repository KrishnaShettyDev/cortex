import React, { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, borderRadius as br } from '../theme';

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
  return (
    <View style={[styles.container, { borderRadius }, style]}>
      {withBlur && (
        <BlurView
          intensity={blurIntensity}
          style={StyleSheet.absoluteFill}
          tint="dark"
        />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
});
