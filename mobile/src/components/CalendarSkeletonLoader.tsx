/**
 * Skeleton loader for calendar view
 * Matches the design language of the app's Skeleton components
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import { HOUR_HEIGHT, START_HOUR, END_HOUR } from '../utils/calendarHelpers';

// Reusable animated skeleton block
const SkeletonBlock: React.FC<{
  width: number | string;
  height: number;
  radius?: number;
  style?: any;
  shimmerAnim: Animated.Value;
  backgroundColor: string;
}> = ({ width, height, radius = borderRadius.sm, style, shimmerAnim, backgroundColor }) => {
  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor,
          opacity,
        },
        style,
      ]}
    />
  );
};

export const CalendarSkeletonLoader: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  // Generate realistic event placeholders
  const eventPlaceholders = [
    { row: 0, width: '75%', height: 50 },
    { row: 2, width: '60%', height: 70 },
    { row: 3, width: '45%', height: 40 },
    { row: 5, width: '80%', height: 55 },
    { row: 7, width: '50%', height: 45 },
  ];

  const hours = Array.from({ length: 8 }, (_, i) => i);

  return (
    <View style={styles.container}>
      <View style={styles.timelineContainer}>
        {/* Hours column */}
        <View style={styles.hoursColumn}>
          {hours.map((_, index) => (
            <View key={index} style={styles.hourRow}>
              <SkeletonBlock
                width={40}
                height={12}
                radius={4}
                shimmerAnim={shimmerAnim}
                backgroundColor={themeColors.bgTertiary}
              />
            </View>
          ))}
        </View>

        {/* Events column */}
        <View style={[styles.eventsColumn, { borderLeftColor: themeColors.glassBorder }]}>
          {/* Grid lines */}
          {hours.map((_, index) => (
            <View
              key={`grid-${index}`}
              style={[
                styles.gridLine,
                { top: index * HOUR_HEIGHT, backgroundColor: themeColors.glassBorder }
              ]}
            />
          ))}

          {/* Event placeholders */}
          {eventPlaceholders.map((event, index) => (
            <View
              key={`event-${index}`}
              style={[
                styles.eventPlaceholder,
                { top: event.row * HOUR_HEIGHT + 4 }
              ]}
            >
              <SkeletonBlock
                width={event.width}
                height={event.height}
                radius={borderRadius.sm}
                shimmerAnim={shimmerAnim}
                backgroundColor={themeColors.bgTertiary}
                style={styles.eventBlock}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.md,
  },
  timelineContainer: {
    flexDirection: 'row',
    flex: 1,
  },
  hoursColumn: {
    width: 60,
    paddingRight: spacing.sm,
  },
  hourRow: {
    height: HOUR_HEIGHT,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingRight: spacing.sm,
  },
  eventsColumn: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: 1,
    marginRight: spacing.md,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  eventPlaceholder: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
  },
  eventBlock: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(66, 133, 244, 0.3)',
  },
});
