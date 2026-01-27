/**
 * LoadingBubble - Animated typing indicator
 *
 * Shows three animated dots while assistant is responding.
 * Matches the glassmorphic style of chat bubbles.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, borderRadius, spacing, useTheme } from '../theme';

export function LoadingBubble() {
  const { colors: themeColors, isDark } = useTheme();
  const dots = [
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
    useRef(new Animated.Value(0.3)).current,
  ];

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 200),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      )
    );

    animations.forEach((anim) => anim.start());

    return () => {
      animations.forEach((anim) => anim.stop());
    };
  }, []);

  return (
    <View style={styles.container}>
      <BlurView intensity={15} tint={isDark ? 'dark' : 'light'} style={styles.blurContainer}>
        <View style={[
          styles.bubble,
          {
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
            borderColor: themeColors.glassBorder,
          }
        ]}>
          {dots.map((dot, index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: themeColors.accent,
                  opacity: dot,
                  transform: [{
                    scale: dot.interpolate({
                      inputRange: [0.3, 1],
                      outputRange: [0.8, 1.1],
                    }),
                  }],
                },
              ]}
            />
          ))}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  blurContainer: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: borderRadius.xl,
    borderBottomLeftRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    minWidth: 72,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
