import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { colors, borderRadius, spacing } from '../theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

// Base skeleton component with shimmer animation
export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius: radius = borderRadius.sm,
  style,
}) => {
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

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius,
          opacity,
        },
        style,
      ]}
    />
  );
};

// Text placeholder
export const SkeletonText: React.FC<{
  lines?: number;
  lineHeight?: number;
  lastLineWidth?: string;
  style?: ViewStyle;
}> = ({ lines = 1, lineHeight = 16, lastLineWidth = '60%', style }) => {
  return (
    <View style={[styles.textContainer, style]}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={lineHeight}
          width={index === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
          style={index < lines - 1 ? styles.textLine : undefined}
        />
      ))}
    </View>
  );
};

// Card placeholder
export const SkeletonCard: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <View style={styles.cardHeaderText}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
        </View>
      </View>
      <SkeletonText lines={3} style={{ marginTop: spacing.md }} />
    </View>
  );
};

// Chat message placeholder
export const SkeletonChatMessage: React.FC<{
  isUser?: boolean;
  style?: ViewStyle;
}> = ({ isUser = false, style }) => {
  return (
    <View
      style={[
        styles.chatMessage,
        isUser ? styles.chatMessageUser : styles.chatMessageAssistant,
        style,
      ]}
    >
      <Skeleton
        width={isUser ? '70%' : '85%'}
        height={isUser ? 40 : 80}
        borderRadius={borderRadius.lg}
      />
    </View>
  );
};

// Memory card placeholder
export const SkeletonMemory: React.FC<{ style?: ViewStyle }> = ({ style }) => {
  return (
    <View style={[styles.memoryCard, style]}>
      <View style={styles.memoryHeader}>
        <Skeleton width={80} height={20} borderRadius={borderRadius.full} />
        <Skeleton width={60} height={14} />
      </View>
      <SkeletonText lines={2} style={{ marginTop: spacing.sm }} />
      <View style={styles.memoryFooter}>
        <Skeleton width={100} height={12} />
      </View>
    </View>
  );
};

// Suggestion chip placeholder
export const SkeletonChip: React.FC<{ width?: number; style?: ViewStyle }> = ({
  width = 100,
  style,
}) => {
  return (
    <Skeleton
      width={width}
      height={36}
      borderRadius={borderRadius.full}
      style={style}
    />
  );
};

// Suggestions row placeholder
export const SkeletonSuggestions: React.FC<{ style?: ViewStyle }> = ({
  style,
}) => {
  return (
    <View style={[styles.suggestionsRow, style]}>
      <SkeletonChip width={120} />
      <SkeletonChip width={90} />
      <SkeletonChip width={110} />
    </View>
  );
};

// Full chat screen placeholder
export const SkeletonChatScreen: React.FC = () => {
  return (
    <View style={styles.chatScreen}>
      <SkeletonSuggestions style={{ marginBottom: spacing.lg }} />
      <SkeletonChatMessage isUser={false} />
      <SkeletonChatMessage isUser={true} />
      <SkeletonChatMessage isUser={false} />
    </View>
  );
};

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.bgTertiary,
  },
  textContainer: {
    gap: spacing.xs,
  },
  textLine: {
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  chatMessage: {
    marginVertical: spacing.xs,
  },
  chatMessageUser: {
    alignItems: 'flex-end',
  },
  chatMessageAssistant: {
    alignItems: 'flex-start',
  },
  memoryCard: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memoryFooter: {
    marginTop: spacing.md,
    flexDirection: 'row',
  },
  suggestionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatScreen: {
    flex: 1,
    padding: spacing.md,
  },
});
