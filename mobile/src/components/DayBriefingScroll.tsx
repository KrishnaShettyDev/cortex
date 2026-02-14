/**
 * DayBriefingScroll - iOS-style day overview
 *
 * Compact, minimal horizontal scroll of your day's items.
 * Clean Apple aesthetic with subtle interactions.
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import { BriefingItem, DailyBriefingResponse } from '../types';
import { useBriefing } from '../hooks/useChat';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { Skeleton } from './Skeleton';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.38;
const CARD_HEIGHT = 88;
const NOW_WIDTH = 64;
const CARD_GAP = spacing.sm;

interface DayBriefingScrollProps {
  onItemPress: (actionPrompt: string) => void;
}

// Get icon for item type
const getItemIcon = (type: BriefingItem['type']): keyof typeof Ionicons.glyphMap => {
  switch (type) {
    case 'calendar':
    case 'meeting':
      return 'calendar';
    case 'email':
      return 'mail';
    case 'reminder':
      return 'alarm';
    case 'deadline':
      return 'time';
    case 'pattern':
      return 'analytics';
    case 'memory':
      return 'bulb';
    default:
      return 'ellipse';
  }
};

// Get accent color based on urgency
const getUrgencyColor = (score: number, themeColors: typeof colors): string => {
  if (score >= 80) return themeColors.error;
  if (score >= 50) return themeColors.warning;
  return themeColors.accent;
};

// Individual time block card - iOS style
const TimeBlockCard: React.FC<{
  item: BriefingItem;
  onPress: () => void;
  index: number;
  themeColors: typeof colors;
}> = ({ item, onPress, index, themeColors }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        delay: index * 40,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 10,
        delay: index * 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isCalendar = item.type === 'calendar' || item.type === 'meeting';
  const isEmail = item.type === 'email';
  const accentColor = getUrgencyColor(item.urgency_score, themeColors);

  const renderIcon = () => {
    if (isEmail) return <GmailIcon size={16} />;
    if (isCalendar) return <GoogleCalendarIcon size={16} />;
    return <Ionicons name={getItemIcon(item.type)} size={16} color={accentColor} />;
  };

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={[styles.card, { backgroundColor: themeColors.fill }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <View style={styles.cardContent}>
          {/* Icon + urgency indicator */}
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.fillSecondary }]}>
              {renderIcon()}
            </View>
            {item.urgency_score >= 70 && (
              <View style={[styles.urgentDot, { backgroundColor: accentColor }]} />
            )}
          </View>

          {/* Title */}
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={2}>
            {item.title}
          </Text>

          {/* Time/Subtitle */}
          <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]} numberOfLines={1}>
            {item.subtitle}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Now card - minimal time display
const NowCard: React.FC<{ onPress: () => void; themeColors: typeof colors }> = ({ onPress, themeColors }) => {
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const timeString = `${hour % 12 || 12}:${minute.toString().padStart(2, '0')}`;
  const ampm = hour >= 12 ? 'PM' : 'AM';

  return (
    <TouchableOpacity
      style={[styles.nowCard, { backgroundColor: themeColors.fill }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.nowLabel, { color: themeColors.textTertiary }]}>Now</Text>
      <Text style={[styles.nowTime, { color: themeColors.textPrimary }]}>{timeString}</Text>
      <Text style={[styles.nowAmPm, { color: themeColors.textTertiary }]}>{ampm}</Text>
    </TouchableOpacity>
  );
};

// Empty state
const EmptyState: React.FC<{ onPress: () => void; themeColors: typeof colors }> = ({ onPress, themeColors }) => (
  <TouchableOpacity
    style={[styles.emptyCard, { backgroundColor: themeColors.fill }]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Ionicons name="checkmark-circle" size={18} color={themeColors.success} />
    <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>All clear</Text>
  </TouchableOpacity>
);

// Skeleton loading
const SkeletonCard: React.FC<{ index: number }> = ({ index }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      delay: index * 60,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.cardWrapper, { opacity: fadeAnim }]}>
      <View style={styles.skeletonCard}>
        <Skeleton width={20} height={20} borderRadius={6} />
        <Skeleton width="80%" height={13} borderRadius={4} style={{ marginTop: spacing.sm }} />
        <Skeleton width="50%" height={11} borderRadius={4} style={{ marginTop: spacing.xs }} />
      </View>
    </Animated.View>
  );
};

const SkeletonNow: React.FC = () => (
  <View style={styles.skeletonNow}>
    <Skeleton width={24} height={10} borderRadius={4} />
    <Skeleton width={32} height={16} borderRadius={4} style={{ marginTop: spacing.xs }} />
  </View>
);

const LoadingSkeleton: React.FC = () => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.scrollContent}
    scrollEnabled={false}
  >
    <SkeletonNow />
    <SkeletonCard index={0} />
    <SkeletonCard index={1} />
    <SkeletonCard index={2} />
  </ScrollView>
);

// Main component
export const DayBriefingScroll: React.FC<DayBriefingScrollProps> = ({
  onItemPress,
}) => {
  const { colors: themeColors } = useTheme();
  const { data: briefing, isLoading, error } = useBriefing();

  const handleNowPress = () => onItemPress("What should I focus on right now?");
  const handleItemPress = (item: BriefingItem) => onItemPress(item.action_prompt);
  const handleEmptyPress = () => onItemPress("How's my day looking?");

  // Loading
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Skeleton width={60} height={13} borderRadius={4} />
        </View>
        <LoadingSkeleton />
      </View>
    );
  }

  // Error - hide
  if (error) return null;

  const items = briefing?.items || [];

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: themeColors.textTertiary }]}>Your Day</Text>
        {briefing && briefing.total_count > 0 && (
          <View style={[styles.countBadge, { backgroundColor: themeColors.accentMuted }]}>
            <Text style={[styles.countText, { color: themeColors.accent }]}>{briefing.total_count}</Text>
          </View>
        )}
      </View>

      {/* Horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
      >
        <NowCard onPress={handleNowPress} themeColors={themeColors} />

        {items.length > 0 ? (
          items.map((item, index) => (
            <TimeBlockCard
              key={item.id || `item-${index}`}
              item={item}
              onPress={() => handleItemPress(item)}
              index={index}
              themeColors={themeColors}
            />
          ))
        ) : (
          <EmptyState onPress={handleEmptyPress} themeColors={themeColors} />
        )}

        <View style={{ width: spacing.lg }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
    letterSpacing: -0.08,
  },
  countBadge: {
    backgroundColor: colors.accentMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
  },
  scrollContent: {
    paddingRight: spacing.md,
  },

  // Card wrapper
  cardWrapper: {
    marginRight: CARD_GAP,
  },

  // Time block card
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.fillSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 18,
    letterSpacing: -0.15,
  },
  cardSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.08,
  },

  // Now card
  nowCard: {
    width: NOW_WIDTH,
    height: CARD_HEIGHT,
    marginRight: CARD_GAP,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  nowLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nowTime: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 2,
    letterSpacing: -0.5,
  },
  nowAmPm: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 1,
  },

  // Empty state
  emptyCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },

  // Skeletons
  skeletonCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  skeletonNow: {
    width: NOW_WIDTH,
    height: CARD_HEIGHT,
    marginRight: CARD_GAP,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DayBriefingScroll;
