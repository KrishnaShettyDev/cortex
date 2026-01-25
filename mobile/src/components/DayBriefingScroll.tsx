import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, spacing, borderRadius } from '../theme';
import { chatService } from '../services';
import { BriefingItem, DailyBriefingResponse } from '../types';
import { logger } from '../utils/logger';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { Skeleton } from './Skeleton';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.42;
const CARD_MARGIN = spacing.sm;

interface DayBriefingScrollProps {
  onItemPress: (actionPrompt: string) => void;
}

// Time of day for greeting
const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};

// Get icon for item type
const getItemIcon = (type: BriefingItem['type']): keyof typeof Ionicons.glyphMap => {
  switch (type) {
    case 'calendar':
    case 'meeting':
      return 'calendar-outline';
    case 'email':
      return 'mail-outline';
    case 'reminder':
      return 'alarm-outline';
    case 'deadline':
      return 'time-outline';
    case 'pattern':
      return 'analytics-outline';
    case 'memory':
      return 'bulb-outline';
    default:
      return 'ellipse-outline';
  }
};

// Get accent color based on urgency
const getUrgencyAccent = (score: number): string => {
  if (score >= 80) return colors.error;
  if (score >= 50) return '#F5A623';
  return colors.accent;
};

// Individual time block card
const TimeBlockCard: React.FC<{
  item: BriefingItem;
  onPress: () => void;
  index: number;
}> = ({ item, onPress, index }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        delay: index * 50,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        delay: index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isCalendar = item.type === 'calendar' || item.type === 'meeting';
  const isEmail = item.type === 'email';
  const accentColor = getUrgencyAccent(item.urgency_score);

  const renderIcon = () => {
    if (isEmail) {
      return <GmailIcon size={18} />;
    }
    if (isCalendar) {
      return <GoogleCalendarIcon size={18} />;
    }
    return (
      <Ionicons
        name={getItemIcon(item.type)}
        size={18}
        color={accentColor}
      />
    );
  };

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* Accent bar at top */}
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {/* Card content */}
        <View style={styles.cardContent}>
          {/* Icon and type */}
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: accentColor + '20' }]}>
              {renderIcon()}
            </View>
            {item.urgency_score >= 70 && (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentText}>Urgent</Text>
              </View>
            )}
          </View>

          {/* Title */}
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>

          {/* Subtitle / Time */}
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {item.subtitle}
          </Text>

          {/* Action hint */}
          <View style={styles.actionHint}>
            <Text style={styles.actionText}>Tap to act</Text>
            <Ionicons name="chevron-forward" size={12} color={colors.textTertiary} />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Now card - shows current time context
const NowCard: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const timeOfDay = getTimeOfDay();
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const timeString = `${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;

  return (
    <TouchableOpacity
      style={styles.nowCard}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={gradients.subtle}
        style={styles.nowCardGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.nowCardContent}>
          <Text style={styles.nowLabel}>Now</Text>
          <Text style={styles.nowTime}>{timeString}</Text>
          <View style={styles.nowDivider} />
          <Text style={styles.nowHint}>What's next?</Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

// Empty state when no items
const EmptyState: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <TouchableOpacity
    style={styles.emptyCard}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Ionicons name="checkmark-circle-outline" size={32} color={colors.success} />
    <Text style={styles.emptyTitle}>All clear</Text>
    <Text style={styles.emptySubtitle}>Nothing needs attention</Text>
  </TouchableOpacity>
);

// Skeleton card for loading state
const SkeletonTimeCard: React.FC<{ index: number }> = ({ index }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.cardWrapper, { opacity: fadeAnim }]}>
      <View style={styles.skeletonCard}>
        {/* Accent bar skeleton */}
        <Skeleton width="100%" height={3} borderRadius={0} />

        <View style={styles.skeletonContent}>
          {/* Icon placeholder */}
          <View style={styles.skeletonHeader}>
            <Skeleton width={32} height={32} borderRadius={8} />
          </View>

          {/* Title placeholder */}
          <Skeleton width="85%" height={14} borderRadius={4} style={{ marginTop: spacing.sm }} />

          {/* Subtitle placeholder */}
          <Skeleton width="60%" height={12} borderRadius={4} style={{ marginTop: spacing.xs }} />

          {/* Action hint placeholder */}
          <View style={styles.skeletonFooter}>
            <Skeleton width={50} height={10} borderRadius={4} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

// Skeleton now card
const SkeletonNowCard: React.FC = () => (
  <View style={styles.skeletonNowCard}>
    <View style={styles.skeletonNowContent}>
      <Skeleton width={30} height={10} borderRadius={4} />
      <Skeleton width={50} height={16} borderRadius={4} style={{ marginTop: spacing.xs }} />
      <View style={styles.skeletonNowDivider} />
      <Skeleton width={55} height={10} borderRadius={4} />
    </View>
  </View>
);

// Loading skeleton row
const LoadingSkeleton: React.FC = () => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.scrollContent}
    scrollEnabled={false}
  >
    <SkeletonNowCard />
    <SkeletonTimeCard index={0} />
    <SkeletonTimeCard index={1} />
    <SkeletonTimeCard index={2} />
  </ScrollView>
);

// Main component
export const DayBriefingScroll: React.FC<DayBriefingScrollProps> = ({
  onItemPress,
}) => {
  const [briefing, setBriefing] = useState<DailyBriefingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const fetchBriefing = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await chatService.getBriefing();
      setBriefing(data);
    } catch (err: any) {
      logger.warn('Failed to fetch day briefing:', err);
      setError('Could not load');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  const handleNowPress = () => {
    onItemPress("What should I focus on right now?");
  };

  const handleItemPress = (item: BriefingItem) => {
    onItemPress(item.action_prompt);
  };

  const handleEmptyPress = () => {
    onItemPress("How's my day looking?");
  };

  // Loading state with skeletons
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Skeleton width={70} height={15} borderRadius={4} />
        </View>
        <LoadingSkeleton />
      </View>
    );
  }

  // Error state - hide component
  if (error) {
    return null;
  }

  const items = briefing?.items || [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Day</Text>
        {briefing && briefing.total_count > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{briefing.total_count}</Text>
          </View>
        )}
      </View>

      {/* Horizontal scroll */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_MARGIN}
        snapToAlignment="start"
      >
        {/* Now card always first */}
        <NowCard onPress={handleNowPress} />

        {/* Items or empty state */}
        {items.length > 0 ? (
          items.map((item, index) => (
            <TimeBlockCard
              key={item.id || `item-${index}`}
              item={item}
              onPress={() => handleItemPress(item)}
              index={index}
            />
          ))
        ) : (
          <EmptyState onPress={handleEmptyPress} />
        )}

        {/* End padding for scroll */}
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
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  countBadge: {
    backgroundColor: colors.accent + '30',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  scrollContent: {
    paddingRight: spacing.md,
  },

  // Card wrapper for animation
  cardWrapper: {
    marginRight: CARD_MARGIN,
  },

  // Time block card
  card: {
    width: CARD_WIDTH,
    height: 140,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  cardContent: {
    flex: 1,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentBadge: {
    backgroundColor: colors.error + '30',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  urgentText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.error,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  actionHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  actionText: {
    fontSize: 11,
    color: colors.textTertiary,
  },

  // Now card
  nowCard: {
    width: 90,
    height: 140,
    marginRight: CARD_MARGIN,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  nowCardGradient: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  nowCardContent: {
    flex: 1,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nowTime: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  nowDivider: {
    width: 24,
    height: 1,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.sm,
  },
  nowHint: {
    fontSize: 10,
    color: colors.accent,
    textAlign: 'center',
  },

  // Empty state
  emptyCard: {
    width: CARD_WIDTH * 1.5,
    height: 140,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Skeleton styles
  skeletonCard: {
    width: CARD_WIDTH,
    height: 140,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  skeletonContent: {
    flex: 1,
    padding: spacing.sm,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonFooter: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
  },
  skeletonNowCard: {
    width: 90,
    height: 140,
    marginRight: CARD_MARGIN,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  skeletonNowContent: {
    flex: 1,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonNowDivider: {
    width: 24,
    height: 1,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.sm,
  },
});

export default DayBriefingScroll;
