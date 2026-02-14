/**
 * LoadingBubble - Animated typing indicator
 *
 * Shows three animated dots while assistant is responding.
 * Matches the iMessage style of chat bubbles.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { spacing, useTheme } from '../theme';

export function LoadingBubble() {
  const { isDark } = useTheme();
  const dots = [
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
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
            toValue: 0.4,
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

  // iMessage style gray bubble matching ChatBubble assistant style
  const bubbleColor = isDark ? '#3A3A3C' : '#E9E9EB';
  const dotColor = isDark ? '#8E8E93' : '#8E8E93';

  return (
    <View style={styles.container}>
      <View style={[styles.bubble, { backgroundColor: bubbleColor }]}>
        {dots.map((dot, index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                backgroundColor: dotColor,
                opacity: dot,
                transform: [{
                  scale: dot.interpolate({
                    inputRange: [0.4, 1],
                    outputRange: [0.8, 1.1],
                  }),
                }],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    minWidth: 72,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
