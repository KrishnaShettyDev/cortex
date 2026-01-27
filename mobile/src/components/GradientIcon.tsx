import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients, colors, useTheme } from '../theme';

interface GradientIconProps {
  size?: number;
  variant?: 'default' | 'solid' | 'ring';
}

export function GradientIcon({ size = 48, variant = 'default' }: GradientIconProps) {
  const { colors: themeColors, gradients: themeGradients, isDark } = useTheme();
  const innerSize = variant === 'ring' ? size * 0.7 : size * 0.5;

  if (variant === 'solid') {
    return (
      <LinearGradient
        colors={themeGradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={themeGradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View
          style={[
            styles.inner,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
              backgroundColor: variant === 'ring' ? themeColors.bgPrimary : (isDark ? 'rgba(13, 13, 13, 0.6)' : 'rgba(255, 255, 255, 0.8)'),
            },
          ]}
        />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  gradient: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {},
});
