/**
 * Insights Screen
 *
 * Displays the cognitive layer data:
 * - Learnings: Pattern discoveries from memories
 * - Beliefs: High-confidence propositions
 * - Outcomes: Recall quality and feedback stats
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

import { cognitiveService, Learning, Belief } from '../../src/services';
import { colors, spacing, borderRadius, useTheme } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';

type TabType = 'learnings' | 'beliefs';

interface LearningCardProps {
  learning: Learning;
  onValidate: () => void;
  onInvalidate: () => void;
}

function LearningCard({ learning, onValidate, onInvalidate }: LearningCardProps) {
  const { colors: themeColors } = useTheme();

  const getCategoryIcon = (category: string): keyof typeof Ionicons.glyphMap => {
    switch (category.toLowerCase()) {
      case 'preferences':
        return 'heart-outline';
      case 'behaviors':
        return 'repeat-outline';
      case 'knowledge':
        return 'bulb-outline';
      case 'relationships':
        return 'people-outline';
      case 'goals':
        return 'flag-outline';
      default:
        return 'sparkles-outline';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return colors.success;
    if (confidence >= 0.6) return '#F5A623';
    return themeColors.textTertiary;
  };

  return (
    <View style={[styles.card, { backgroundColor: themeColors.fill, borderColor: themeColors.glassBorder }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: themeColors.accent + '20' }]}>
          <Ionicons
            name={getCategoryIcon(learning.category)}
            size={14}
            color={themeColors.accent}
          />
          <Text style={[styles.categoryText, { color: themeColors.accent }]}>
            {learning.category}
          </Text>
        </View>
        <View style={styles.confidenceContainer}>
          <View
            style={[
              styles.confidenceDot,
              { backgroundColor: getConfidenceColor(learning.confidence) },
            ]}
          />
          <Text style={[styles.confidenceText, { color: themeColors.textTertiary }]}>
            {Math.round(learning.confidence * 100)}%
          </Text>
        </View>
      </View>

      <Text style={[styles.insightText, { color: themeColors.textPrimary }]}>
        {learning.insight}
      </Text>

      <View style={styles.cardFooter}>
        <Text style={[styles.evidenceText, { color: themeColors.textTertiary }]}>
          Based on {learning.evidence_count} {learning.evidence_count === 1 ? 'memory' : 'memories'}
        </Text>

        {learning.status === 'active' && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, { borderColor: colors.success + '40' }]}
              onPress={onValidate}
            >
              <Ionicons name="checkmark" size={16} color={colors.success} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { borderColor: themeColors.error + '40' }]}
              onPress={onInvalidate}
            >
              <Ionicons name="close" size={16} color={themeColors.error} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

interface BeliefCardProps {
  belief: Belief;
}

function BeliefCard({ belief }: BeliefCardProps) {
  const { colors: themeColors } = useTheme();

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'preference':
        return 'heart-outline';
      case 'behavior':
        return 'repeat-outline';
      case 'fact':
        return 'information-circle-outline';
      case 'relationship':
        return 'people-outline';
      case 'goal':
        return 'flag-outline';
      default:
        return 'ellipse-outline';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return colors.success;
    if (confidence >= 0.6) return '#F5A623';
    return themeColors.textTertiary;
  };

  return (
    <View style={[styles.card, { backgroundColor: themeColors.fill, borderColor: themeColors.glassBorder }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: themeColors.accent + '20' }]}>
          <Ionicons
            name={getTypeIcon(belief.belief_type)}
            size={14}
            color={themeColors.accent}
          />
          <Text style={[styles.categoryText, { color: themeColors.accent }]}>
            {belief.belief_type}
          </Text>
        </View>
        <View style={styles.confidenceContainer}>
          <View
            style={[
              styles.confidenceDot,
              { backgroundColor: getConfidenceColor(belief.current_confidence) },
            ]}
          />
          <Text style={[styles.confidenceText, { color: themeColors.textTertiary }]}>
            {Math.round(belief.current_confidence * 100)}%
          </Text>
        </View>
      </View>

      <Text style={[styles.insightText, { color: themeColors.textPrimary }]}>
        {belief.proposition}
      </Text>

      {belief.domain && (
        <View style={styles.cardFooter}>
          <Text style={[styles.domainText, { color: themeColors.textTertiary }]}>
            Domain: {belief.domain}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function InsightsScreen() {
  const posthog = usePostHog();
  const { colors: themeColors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('learnings');
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const [learningsRes, beliefsRes] = await Promise.all([
        cognitiveService.getLearnings({ status: 'active', limit: 50 }),
        cognitiveService.getBeliefs({ status: 'active', limit: 50 }),
      ]);

      setLearnings(learningsRes.learnings);
      setBeliefs(beliefsRes.beliefs);

      posthog?.capture('insights_loaded', {
        learnings_count: learningsRes.learnings.length,
        beliefs_count: beliefsRes.beliefs.length,
      });
    } catch (err: any) {
      logger.error('Failed to load insights:', err);
      setError(err.message || 'Failed to load insights');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleValidateLearning = async (learningId: string) => {
    try {
      await cognitiveService.validateLearning(learningId);
      setLearnings(prev =>
        prev.map(l => (l.id === learningId ? { ...l, status: 'validated' as const } : l))
      );
      posthog?.capture('learning_validated', { learning_id: learningId });
    } catch (err) {
      logger.error('Failed to validate learning:', err);
    }
  };

  const handleInvalidateLearning = async (learningId: string) => {
    try {
      await cognitiveService.invalidateLearning(learningId);
      setLearnings(prev => prev.filter(l => l.id !== learningId));
      posthog?.capture('learning_invalidated', { learning_id: learningId });
    } catch (err) {
      logger.error('Failed to invalidate learning:', err);
    }
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
          name={activeTab === 'learnings' ? 'bulb-outline' : 'library-outline'}
          size={48}
          color={themeColors.textTertiary}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
        No {activeTab} yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: themeColors.textSecondary }]}>
        {activeTab === 'learnings'
          ? 'Cortex will discover patterns as you add more memories'
          : 'Beliefs form from validated learnings over time'}
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
        <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>Insights</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, { borderBottomColor: themeColors.glassBorder }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'learnings' && [styles.tabActive, { borderBottomColor: themeColors.accent }],
          ]}
          onPress={() => setActiveTab('learnings')}
        >
          <Ionicons
            name="bulb-outline"
            size={18}
            color={activeTab === 'learnings' ? themeColors.accent : themeColors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'learnings' ? themeColors.accent : themeColors.textSecondary },
            ]}
          >
            Learnings ({learnings.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'beliefs' && [styles.tabActive, { borderBottomColor: themeColors.accent }],
          ]}
          onPress={() => setActiveTab('beliefs')}
        >
          <Ionicons
            name="library-outline"
            size={18}
            color={activeTab === 'beliefs' ? themeColors.accent : themeColors.textSecondary}
          />
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'beliefs' ? themeColors.accent : themeColors.textSecondary },
            ]}
          >
            Beliefs ({beliefs.length})
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
          {activeTab === 'learnings' ? (
            learnings.length > 0 ? (
              learnings.map(learning => (
                <LearningCard
                  key={learning.id}
                  learning={learning}
                  onValidate={() => handleValidateLearning(learning.id)}
                  onInvalidate={() => handleInvalidateLearning(learning.id)}
                />
              ))
            ) : (
              renderEmptyState()
            )
          ) : beliefs.length > 0 ? (
            beliefs.map(belief => <BeliefCard key={belief.id} belief={belief} />)
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
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confidenceText: {
    fontSize: 12,
  },
  insightText: {
    fontSize: 15,
    lineHeight: 22,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  evidenceText: {
    fontSize: 12,
  },
  domainText: {
    fontSize: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
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
