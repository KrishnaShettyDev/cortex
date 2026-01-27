/**
 * Skeleton loader for calendar view
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import { HOUR_HEIGHT } from '../utils/calendarHelpers';

const AnimatedSkeletonView = Reanimated.createAnimatedComponent(View);

export const CalendarSkeletonLoader: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const opacity = useSharedValue(0.3);

  React.useEffect(() => {
    // Use withRepeat for proper looping animation
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 800 }),
      -1, // Infinite repeat
      true // Reverse on each iteration
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* Skeleton hour rows with event placeholders */}
      {Array.from({ length: 8 }).map((_, rowIndex) => (
        <View key={rowIndex} style={[styles.hourRow, { borderBottomColor: themeColors.glassBorder }]}>
          {/* Hour label skeleton */}
          <AnimatedSkeletonView style={[styles.hourLabel, { backgroundColor: themeColors.bgTertiary }, animatedStyle]} />
          {/* Event skeleton - varying sizes */}
          {rowIndex % 2 === 0 && (
            <AnimatedSkeletonView
              style={[
                styles.eventBlock,
                { width: 50 + (rowIndex * 5), backgroundColor: themeColors.bgTertiary },
                animatedStyle
              ]}
            />
          )}
          {rowIndex === 1 && (
            <AnimatedSkeletonView
              style={[
                styles.eventBlock,
                { width: 150, height: 80, backgroundColor: themeColors.bgTertiary },
                animatedStyle
              ]}
            />
          )}
          {rowIndex === 3 && (
            <AnimatedSkeletonView
              style={[
                styles.eventBlock,
                { width: 120, height: 60, backgroundColor: themeColors.bgTertiary },
                animatedStyle
              ]}
            />
          )}
          {rowIndex === 5 && (
            <AnimatedSkeletonView
              style={[
                styles.eventBlock,
                { width: 100, height: 45, backgroundColor: themeColors.bgTertiary },
                animatedStyle
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  hourRow: {
    flexDirection: 'row',
    height: HOUR_HEIGHT,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  hourLabel: {
    width: 50,
    height: 12,
    backgroundColor: colors.bgTertiary,
    borderRadius: 4,
    marginRight: spacing.md,
  },
  eventBlock: {
    height: 40,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
});
