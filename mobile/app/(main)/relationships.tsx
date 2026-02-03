/**
 * Relationships Screen
 *
 * Displays relationship intelligence:
 * - Relationship health scores
 * - Proactive nudges
 * - Recommendations for maintaining relationships
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { entitiesService, Nudge, RelationshipHealth } from '../../src/services';
import { colors, spacing, borderRadius, useTheme } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';

type TabType = 'health' | 'nudges';

interface HealthCardProps {
  health: RelationshipHealth;
  onPress: () => void;
}

function HealthCard({ health, onPress }: HealthCardProps) {
  const { colors: themeColors } = useTheme();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return colors.success;
      case 'attention_needed':
        return '#F5A623';
      case 'at_risk':
        return themeColors.error;
      case 'dormant':
        return themeColors.textTertiary;
      default:
        return themeColors.textSecondary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'Healthy';
      case 'attention_needed':
        return 'Needs Attention';
      case 'at_risk':
        return 'At Risk';
      case 'dormant':
        return 'Dormant';
      default:
        return status;
    }
  };

  const statusColor = getStatusColor(health.health_status);
  const initial = health.entity_name.charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      style={[styles.healthCard, { backgroundColor: themeColors.fill, borderColor: themeColors.glassBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.healthCardHeader}>
        <View style={[styles.avatar, { backgroundColor: themeColors.accent + '20' }]}>
          <Text style={[styles.avatarText, { color: themeColors.accent }]}>{initial}</Text>
        </View>
        <View style={styles.healthInfo}>
          <Text style={[styles.healthName, { color: themeColors.textPrimary }]} numberOfLines={1}>
            {health.entity_name}
          </Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {getStatusLabel(health.health_status)}
            </Text>
          </View>
        </View>
        <View style={styles.scoreContainer}>
          <Text style={[styles.scoreValue, { color: themeColors.textPrimary }]}>
            {Math.round(health.health_score * 100)}
          </Text>
          <Text style={[styles.scoreLabel, { color: themeColors.textTertiary }]}>score</Text>
        </View>
      </View>

      {health.factors && (
        <View style={styles.factorsContainer}>
          <FactorBar label="Recency" value={health.factors.recency.score} colors={themeColors} />
          <FactorBar label="Frequency" value={health.factors.frequency.score} colors={themeColors} />
          {health.factors.sentiment && (
            <FactorBar label="Sentiment" value={health.factors.sentiment.score} colors={themeColors} />
          )}
        </View>
      )}

      {health.recommendations && health.recommendations.length > 0 && (
        <View style={[styles.recommendationContainer, { backgroundColor: themeColors.accent + '10' }]}>
          <Ionicons name="bulb-outline" size={14} color={themeColors.accent} />
          <Text style={[styles.recommendationText, { color: themeColors.textSecondary }]} numberOfLines={2}>
            {health.recommendations[0]}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface FactorBarProps {
  label: string;
  value: number;
  colors: any;
}

function FactorBar({ label, value, colors: themeColors }: FactorBarProps) {
  const getBarColor = (val: number) => {
    if (val >= 0.7) return colors.success;
    if (val >= 0.4) return '#F5A623';
    return themeColors.error;
  };

  return (
    <View style={styles.factorBar}>
      <Text style={[styles.factorLabel, { color: themeColors.textTertiary }]}>{label}</Text>
      <View style={[styles.factorBarBg, { backgroundColor: themeColors.glassBorder }]}>
        <View
          style={[
            styles.factorBarFill,
            { width: `${value * 100}%`, backgroundColor: getBarColor(value) },
          ]}
        />
      </View>
    </View>
  );
}

interface NudgeCardProps {
  nudge: Nudge;
  onAction: () => void;
}

function NudgeCard({ nudge, onAction }: NudgeCardProps) {
  const { colors: themeColors } = useTheme();

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return themeColors.error;
      case 'medium':
        return '#F5A623';
      default:
        return themeColors.textTertiary;
    }
  };

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'follow_up':
        return 'chatbubble-outline';
      case 'maintenance':
        return 'sync-outline';
      case 'commitment_due':
        return 'alarm-outline';
      case 'at_risk':
        return 'alert-circle-outline';
      case 'milestone':
        return 'trophy-outline';
      default:
        return 'notifications-outline';
    }
  };

  return (
    <View style={[styles.nudgeCard, { backgroundColor: themeColors.fill, borderColor: themeColors.glassBorder }]}>
      <View style={styles.nudgeHeader}>
        <View style={[styles.nudgeIconContainer, { backgroundColor: getPriorityColor(nudge.priority) + '20' }]}>
          <Ionicons
            name={getTypeIcon(nudge.nudge_type)}
            size={18}
            color={getPriorityColor(nudge.priority)}
          />
        </View>
        <View style={styles.nudgeInfo}>
          <Text style={[styles.nudgeTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>
            {nudge.title}
          </Text>
          <Text style={[styles.nudgeEntity, { color: themeColors.textTertiary }]}>
            {nudge.entity_name}
          </Text>
        </View>
        <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(nudge.priority) + '20' }]}>
          <Text style={[styles.priorityText, { color: getPriorityColor(nudge.priority) }]}>
            {nudge.priority}
          </Text>
        </View>
      </View>

      <Text style={[styles.nudgeMessage, { color: themeColors.textSecondary }]} numberOfLines={2}>
        {nudge.message}
      </Text>

      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: themeColors.accent }]}
        onPress={onAction}
      >
        <Text style={[styles.actionButtonText, { color: themeColors.textPrimary }]}>
          {nudge.suggested_action || 'Take Action'}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={themeColors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

export default function RelationshipsScreen() {
  const posthog = usePostHog();
  const { colors: themeColors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('health');
  const [healthData, setHealthData] = useState<RelationshipHealth[]>([]);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const [healthRes, nudgesRes] = await Promise.all([
        entitiesService.getRelationshipHealth(),
        entitiesService.getNudges({ limit: 20 }),
      ]);

      setHealthData(healthRes.health_scores || []);
      setNudges(nudgesRes.nudges || []);

      posthog?.capture('relationships_loaded', {
        health_count: healthRes.health_scores?.length || 0,
        nudges_count: nudgesRes.nudges?.length || 0,
      });
    } catch (err: any) {
      logger.error('Failed to load relationships:', err);
      setError(err.message || 'Failed to load relationship data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleHealthCardPress = (health: RelationshipHealth) => {
    posthog?.capture('relationship_health_tapped', {
      entity_name: health.entity_name,
      health_status: health.health_status,
    });
    // Navigate to person detail
    router.push({
      pathname: '/(main)/person/[name]',
      params: { name: health.entity_name },
    });
  };

  const handleNudgeAction = (nudge: Nudge) => {
    posthog?.capture('nudge_action_tapped', {
      nudge_type: nudge.nudge_type,
      entity_name: nudge.entity_name,
    });
    // Navigate to chat with the suggested action pre-filled
    router.push('/(main)/chat');
    // TODO: Pre-fill chat with nudge.suggested_action
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/chat');
    }
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIconContainer, { backgroundColor: themeColors.fill }]}>
        <Ionicons
          name={activeTab === 'health' ? 'heart-outline' : 'notifications-outline'}
          size={48}
          color={themeColors.textTertiary}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
        No {activeTab === 'health' ? 'relationship data' : 'nudges'} yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: themeColors.textSecondary }]}>
        {activeTab === 'health'
          ? 'Add memories about people to see relationship health'
          : 'Nudges appear when your relationships need attention'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors.bgPrimary }]} edges={['top']}>
      {/* Handle */}
      <View style={styles.handleContainer}>
        <View style={[styles.handle, { backgroundColor: themeColors.textTertiary }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={themeColors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>Relationships</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, { borderBottomColor: themeColors.glassBorder }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'health' && [styles.tabActive, { borderBottomColor: themeColors.accent }],
          ]}
          onPress={() => setActiveTab('health')}
        >
          <Ionicons
            name="heart-outline"
            size={18}
            color={activeTab === 'health' ? themeColors.accent : themeColors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'health' ? themeColors.accent : themeColors.textSecondary },
            ]}
          >
            Health ({healthData.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'nudges' && [styles.tabActive, { borderBottomColor: themeColors.accent }],
          ]}
          onPress={() => setActiveTab('nudges')}
        >
          <Ionicons
            name="notifications-outline"
            size={18}
            color={activeTab === 'nudges' ? themeColors.accent : themeColors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'nudges' ? themeColors.accent : themeColors.textSecondary },
            ]}
          >
            Nudges ({nudges.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={themeColors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={themeColors.error} />
          <Text style={[styles.errorText, { color: themeColors.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: themeColors.accent }]}
            onPress={() => loadData()}
          >
            <Text style={[styles.retryButtonText, { color: themeColors.textPrimary }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true)}
              tintColor={themeColors.accent}
            />
          }
        >
          {activeTab === 'health' ? (
            healthData.length > 0 ? (
              healthData.map(health => (
                <HealthCard
                  key={health.entity_id}
                  health={health}
                  onPress={() => handleHealthCardPress(health)}
                />
              ))
            ) : (
              renderEmptyState()
            )
          ) : nudges.length > 0 ? (
            nudges.map(nudge => (
              <NudgeCard
                key={nudge.id}
                nudge={nudge}
                onAction={() => handleNudgeAction(nudge)}
              />
            ))
          ) : (
            renderEmptyState()
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    width: 40,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorText: {
    fontSize: 16,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Health Card
  healthCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  healthCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
  },
  healthInfo: {
    flex: 1,
  },
  healthName: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  scoreContainer: {
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  scoreLabel: {
    fontSize: 10,
  },
  factorsContainer: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  factorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  factorLabel: {
    width: 70,
    fontSize: 11,
  },
  factorBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  factorBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  recommendationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  recommendationText: {
    flex: 1,
    fontSize: 13,
  },

  // Nudge Card
  nudgeCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  nudgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  nudgeIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeInfo: {
    flex: 1,
  },
  nudgeTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  nudgeEntity: {
    fontSize: 12,
    marginTop: 2,
  },
  priorityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  nudgeMessage: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Empty State
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
});
