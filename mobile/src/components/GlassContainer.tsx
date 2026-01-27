/**
 * GlassContainer - iOS Liquid Glass effect with graceful fallback
 *
 * Uses Expo Glass Effect when available (iOS 26+),
 * falls back to BlurView on older iOS, and solid background on Android.
 *
 * Based on Apple HIG 2025 Liquid Glass design language.
 */

import React from 'react';
import { View, ViewProps, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';
import { borderRadius, spacing } from '../theme';

// Try to import expo-glass-effect if available
let GlassView: any = null;
let isLiquidGlassAvailable: () => boolean = () => false;

try {
  const glassEffect = require('expo-glass-effect');
  GlassView = glassEffect.GlassView;
  isLiquidGlassAvailable = glassEffect.isLiquidGlassAvailable;
} catch {
  // expo-glass-effect not installed - will use fallback
}

// ============================================================================
// TYPES
// ============================================================================
type GlassIntensity = 'subtle' | 'regular' | 'prominent';
type FallbackStyle = 'blur' | 'solid';

interface GlassContainerProps extends ViewProps {
  /** Intensity of the glass effect */
  intensity?: GlassIntensity;
  /** Fallback style when glass is not available */
  fallbackStyle?: FallbackStyle;
  /** Border radius override */
  radius?: number;
  /** Children to render inside */
  children?: React.ReactNode;
}

// ============================================================================
// COMPONENT
// ============================================================================
export function GlassContainer({
  children,
  intensity = 'regular',
  fallbackStyle = 'blur',
  radius = borderRadius.lg,
  style,
  ...props
}: GlassContainerProps) {
  const { colors, isDark } = useTheme();

  // Check if we can use native Liquid Glass
  const canUseGlass = GlassView && isLiquidGlassAvailable?.();

  // Map intensity to glass effect style
  const getGlassStyle = () => {
    switch (intensity) {
      case 'subtle':
        return 'clear';
      case 'prominent':
        return 'thick';
      default:
        return 'regular';
    }
  };

  // Native Liquid Glass (iOS 26+)
  if (canUseGlass) {
    return (
      <GlassView
        glassEffectStyle={getGlassStyle()}
        style={[
          styles.container,
          { borderRadius: radius },
          style,
        ]}
        {...props}
      >
        {children}
      </GlassView>
    );
  }

  // BlurView fallback (iOS < 26)
  if (Platform.OS === 'ios' && fallbackStyle === 'blur') {
    const blurIntensity = intensity === 'subtle' ? 15 : intensity === 'prominent' ? 40 : 25;

    return (
      <View
        style={[
          styles.container,
          {
            borderRadius: radius,
            overflow: 'hidden',
          },
          style,
        ]}
        {...props}
      >
        <BlurView
          intensity={blurIntensity}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.blurOverlay,
            {
              backgroundColor: isDark
                ? colors.glassBackground
                : 'rgba(255, 255, 255, 0.7)',
              borderColor: colors.glassBorder,
            },
          ]}
        >
          {children}
        </View>
      </View>
    );
  }

  // Solid fallback (Android or when blur not desired)
  return (
    <View
      style={[
        styles.container,
        styles.solidFallback,
        {
          borderRadius: radius,
          backgroundColor: colors.bgElevated,
          borderColor: colors.glassBorder,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

// ============================================================================
// SPECIALIZED VARIANTS
// ============================================================================

/** Glass card for content containers - uses new theming system */
export function ThemedGlassCard({
  children,
  style,
  ...props
}: Omit<GlassContainerProps, 'intensity' | 'fallbackStyle'>) {
  return (
    <GlassContainer
      intensity="subtle"
      fallbackStyle="blur"
      style={[styles.card, style]}
      {...props}
    >
      {children}
    </GlassContainer>
  );
}

/** Glass sheet for bottom sheets and modals */
export function GlassSheet({
  children,
  style,
  ...props
}: Omit<GlassContainerProps, 'intensity' | 'fallbackStyle'>) {
  return (
    <GlassContainer
      intensity="regular"
      fallbackStyle="blur"
      radius={borderRadius.xl}
      style={[styles.sheet, style]}
      {...props}
    >
      {children}
    </GlassContainer>
  );
}

/** Glass pill for buttons and chips */
export function GlassPill({
  children,
  style,
  ...props
}: Omit<GlassContainerProps, 'intensity' | 'fallbackStyle' | 'radius'>) {
  return (
    <GlassContainer
      intensity="subtle"
      fallbackStyle="solid"
      radius={999}
      style={[styles.pill, style]}
      {...props}
    >
      {children}
    </GlassContainer>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  blurOverlay: {
    flex: 1,
    borderWidth: 1,
  },
  solidFallback: {
    borderWidth: 1,
  },
  card: {
    padding: spacing.md,
  },
  sheet: {
    padding: spacing.lg,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});

// ============================================================================
// UTILITIES
// ============================================================================

/** Check if native Liquid Glass is available */
export function isGlassAvailable(): boolean {
  return Boolean(GlassView && isLiquidGlassAvailable?.());
}
