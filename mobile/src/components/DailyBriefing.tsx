import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { colors, gradients, spacing, borderRadius, useTheme } from '../theme';
import { chatService } from '../services';
import { BriefingItem, DailyBriefingResponse } from '../types';
import { logger } from '../utils/logger';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';

interface DailyBriefingProps {
  onActionPress: (actionPrompt: string) => void;
  variant?: 'card' | 'pill';
}

// Check if item should use a service icon (Gmail, Calendar)
const useServiceIcon = (type: BriefingItem['type']): 'gmail' | 'calendar' | null => {
  switch (type) {
    case 'email':
      return 'gmail';
    case 'calendar':
    case 'meeting':
      return 'calendar';
    default:
      return null;
  }
};

// Map briefing type to Ionicon name (for non-service items)
const getIconName = (type: BriefingItem['type']): keyof typeof Ionicons.glyphMap => {
  switch (type) {
    case 'reminder':
      return 'alarm-outline';
    case 'pattern':
      return 'analytics-outline';
    case 'deadline':
      return 'time-outline';
    case 'test':
      return 'school-outline';
    case 'memory':
      return 'bulb-outline';
    default:
      return 'information-circle-outline';
  }
};

// Get urgency color
const getUrgencyColor = (score: number, themeColors: { error: string; accent: string }): string => {
  if (score >= 80) return themeColors.error;
  if (score >= 50) return '#F5A623'; // Orange/amber
  return themeColors.accent;
};

// Briefing Item Row Component
const BriefingItemRow: React.FC<{
  item: BriefingItem;
  onPress: () => void;
}> = ({ item, onPress }) => {
  const { colors: themeColors } = useTheme();
  const serviceIcon = useServiceIcon(item.type);
  const urgencyColor = getUrgencyColor(item.urgency_score, themeColors);

  const renderIcon = () => {
    if (serviceIcon === 'gmail') {
      return <GmailIcon size={20} />;
    }
    if (serviceIcon === 'calendar') {
      return <GoogleCalendarIcon size={20} />;
    }
    const iconName = getIconName(item.type);
    return <Ionicons name={iconName} size={18} color={urgencyColor} />;
  };

  return (
    <TouchableOpacity
      style={[styles.itemRow, { borderBottomColor: themeColors.glassBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.itemIcon, { backgroundColor: serviceIcon ? 'transparent' : urgencyColor + '20' }]}>
        {renderIcon()}
      </View>
      <View style={styles.itemContent}>
        <Text style={[styles.itemTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.itemSubtitle, { color: themeColors.textSecondary }]} numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={themeColors.textTertiary} />
    </TouchableOpacity>
  );
};

// Main DailyBriefing Component
export const DailyBriefing: React.FC<DailyBriefingProps> = ({
  onActionPress,
  variant = 'card',
}) => {
  const { colors: themeColors, gradients: themeGradients } = useTheme();
  const [briefing, setBriefing] = useState<DailyBriefingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const expandAnim = useState(new Animated.Value(1))[0];

  const fetchBriefing = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await chatService.getBriefing();
      setBriefing(data);
    } catch (err: any) {
      logger.warn('Failed to fetch briefing:', err);
      setError('Could not load briefing');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  const toggleExpanded = () => {
    const toValue = isExpanded ? 0 : 1;
    Animated.spring(expandAnim, {
      toValue,
      useNativeDriver: false,
      tension: 100,
      friction: 10,
    }).start();
    setIsExpanded(!isExpanded);
  };

  const handleItemPress = (item: BriefingItem) => {
    onActionPress(item.action_prompt);
  };

  // Don't render if no items or error
  if (error || (!isLoading && (!briefing || briefing.items.length === 0))) {
    return null;
  }

  // Pill variant - compact summary
  if (variant === 'pill') {
    if (isLoading) return null;

    const urgentCount = briefing?.items.filter(i => i.urgency_score >= 7).length || 0;
    const totalCount = briefing?.total_count || 0;

    if (totalCount === 0) return null;

    return (
      <TouchableOpacity
        style={styles.pillContainer}
        onPress={() => onActionPress("What needs my attention today?")}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={briefing?.has_urgent ? ['#F5A62320', '#F5A62310'] : [themeColors.accent + '20', themeColors.accent + '10']}
          style={[styles.pillGradient, { borderColor: themeColors.glassBorder }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Ionicons
            name={briefing?.has_urgent ? 'alert-circle' : 'sparkles'}
            size={16}
            color={briefing?.has_urgent ? '#F5A623' : themeColors.accent}
          />
          <Text style={[styles.pillText, { color: themeColors.textPrimary }]}>
            {urgentCount > 0
              ? `${urgentCount} urgent ${urgentCount === 1 ? 'item' : 'items'} need attention`
              : `${totalCount} ${totalCount === 1 ? 'thing' : 'things'} to review`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={themeColors.textTertiary} />
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  // Card variant - full expandable briefing
  return (
    <View style={[styles.cardContainer, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }]}>
      {/* Header */}
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={toggleExpanded}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          <View style={[styles.headerIcon, { backgroundColor: themeColors.bgTertiary }]}>
            <Ionicons name="sunny-outline" size={20} color={themeColors.textPrimary} />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>Your Day</Text>
            {!isExpanded && briefing && (
              <Text style={[styles.headerSubtitle, { color: themeColors.textSecondary }]}>
                {briefing.total_count} {briefing.total_count === 1 ? 'item' : 'items'} to review
              </Text>
            )}
          </View>
        </View>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={themeColors.textSecondary}
        />
      </TouchableOpacity>

      {/* Content */}
      <Animated.View
        style={[
          styles.cardContent,
          {
            maxHeight: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 400],
            }),
            opacity: expandAnim,
          },
        ]}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={[styles.loadingText, { color: themeColors.textSecondary }]}>Loading your briefing...</Text>
          </View>
        ) : (
          <View style={styles.itemsList}>
            {briefing?.items.map((item, index) => (
              <BriefingItemRow
                key={item.id || `briefing-item-${index}`}
                item={item}
                onPress={() => handleItemPress(item)}
              />
            ))}

            {/* See all button if more items */}
            {briefing && briefing.total_count > briefing.items.length && (
              <TouchableOpacity
                style={styles.seeAllButton}
                onPress={() => onActionPress("Show me everything that needs my attention today")}
                activeOpacity={0.7}
              >
                <Text style={[styles.seeAllText, { color: themeColors.accent }]}>
                  +{briefing.total_count - briefing.items.length} more
                </Text>
                <Ionicons name="arrow-forward" size={14} color={themeColors.accent} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Card variant styles
  cardContainer: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardContent: {
    overflow: 'hidden',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  itemsList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },

  // Item row styles
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  itemSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // See all button
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  seeAllText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '500',
  },

  // Pill variant styles
  pillContainer: {
    marginBottom: spacing.md,
  },
  pillGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  pillText: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
});

export default DailyBriefing;
