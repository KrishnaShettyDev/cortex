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
import { router, useLocalSearchParams } from 'expo-router';

import { peopleService } from '../../../src/services';
import { PersonProfile, MemoryBrief } from '../../../src/types';
import { colors, spacing, borderRadius } from '../../../src/theme';
import { logger } from '../../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../../src/lib/analytics';

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getRelationshipIcon(type: string | null): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'colleague':
      return 'briefcase-outline';
    case 'friend':
      return 'heart-outline';
    case 'family':
      return 'home-outline';
    case 'professional':
      return 'business-outline';
    default:
      return 'person-outline';
  }
}

function getSentimentColor(sentiment: string | null): string {
  switch (sentiment) {
    case 'positive':
      return colors.success;
    case 'negative':
      return colors.error;
    case 'mixed':
      return colors.warning;
    default:
      return colors.textSecondary;
  }
}

interface MemoryCardProps {
  memory: MemoryBrief;
}

function MemoryCard({ memory }: MemoryCardProps) {
  return (
    <View style={styles.memoryCard}>
      <View style={styles.memoryHeader}>
        <View style={styles.memoryTypeContainer}>
          <Ionicons
            name={memory.memory_type === 'voice' ? 'mic-outline' : 'document-text-outline'}
            size={12}
            color={colors.textTertiary}
          />
          <Text style={styles.memoryType}>{memory.memory_type}</Text>
        </View>
        <Text style={styles.memoryDate}>
          {formatDate(memory.memory_date)}
        </Text>
      </View>
      <Text style={styles.memoryContent} numberOfLines={3}>
        {memory.content}
      </Text>
    </View>
  );
}

export default function PersonDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const posthog = usePostHog();
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meetingContext, setMeetingContext] = useState<string | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);

  const loadProfile = useCallback(async (refresh = false) => {
    if (!name) return;

    try {
      if (refresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const response = await peopleService.getPersonProfile(name, refresh);
      setProfile(response);
      posthog?.capture(ANALYTICS_EVENTS.PERSON_PROFILE_VIEWED, {
        person_name: name,
        mention_count: response.mention_count,
        has_summary: !!response.summary,
      });
    } catch (err: any) {
      logger.error('Failed to load person profile:', err);
      setError(err.message || 'Failed to load profile');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [name]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handlePrepareForMeeting = async () => {
    if (!name) return;

    posthog?.capture(ANALYTICS_EVENTS.MEETING_PREP_REQUESTED, {
      person_name: name,
    });

    setIsLoadingContext(true);
    try {
      const response = await peopleService.getMeetingContext(name);
      setMeetingContext(response.context || null);
      posthog?.capture(ANALYTICS_EVENTS.MEETING_CONTEXT_GENERATED, {
        person_name: name,
        context_length: response.context?.length || 0,
      });
    } catch (err: any) {
      logger.error('Failed to get meeting context:', err);
      setMeetingContext(`Unable to load context for ${name}. Please try again.`);
    } finally {
      setIsLoadingContext(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(main)/people');
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goBack}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Person</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={styles.errorText}>{error || 'Person not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadProfile()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const initial = profile.name.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{profile.name}</Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => loadProfile(true)}
        >
          <Ionicons name="refresh-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadProfile(true)}
            tintColor={colors.accent}
          />
        }
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.profileName}>{profile.name}</Text>
          {profile.relationship_type && (
            <View style={styles.relationshipBadge}>
              <Ionicons
                name={getRelationshipIcon(profile.relationship_type)}
                size={14}
                color={colors.accent}
              />
              <Text style={styles.relationshipText}>
                {profile.relationship_type.charAt(0).toUpperCase() + profile.relationship_type.slice(1)}
              </Text>
            </View>
          )}
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{profile.mention_count}</Text>
            <Text style={styles.statLabel}>Mentions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatDate(profile.first_seen)}</Text>
            <Text style={styles.statLabel}>First Seen</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatDate(profile.last_seen)}</Text>
            <Text style={styles.statLabel}>Last Seen</Text>
          </View>
        </View>

        {/* Summary */}
        {profile.summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryText}>{profile.summary}</Text>
            </View>
          </View>
        )}

        {/* Sentiment */}
        {profile.sentiment_trend && (
          <View style={styles.sentimentRow}>
            <Ionicons
              name="trending-up-outline"
              size={16}
              color={getSentimentColor(profile.sentiment_trend)}
            />
            <Text style={[styles.sentimentText, { color: getSentimentColor(profile.sentiment_trend) }]}>
              {profile.sentiment_trend.charAt(0).toUpperCase() + profile.sentiment_trend.slice(1)} sentiment
            </Text>
          </View>
        )}

        {/* Topics */}
        {profile.topics && profile.topics.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Topics</Text>
            <View style={styles.topicsContainer}>
              {profile.topics.map((topic, index) => (
                <View key={index} style={styles.topicPill}>
                  <Text style={styles.topicText}>{topic}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Meeting Prep Button */}
        <TouchableOpacity
          style={styles.meetingButton}
          onPress={handlePrepareForMeeting}
          disabled={isLoadingContext}
        >
          {isLoadingContext ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <>
              <Ionicons name="calendar-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.meetingButtonText}>Prepare for Meeting</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Meeting Context */}
        {meetingContext && (
          <View style={styles.contextCard}>
            <View style={styles.contextHeader}>
              <Ionicons name="bulb-outline" size={16} color={colors.accent} />
              <Text style={styles.contextTitle}>Meeting Context</Text>
            </View>
            <Text style={styles.contextText}>{meetingContext}</Text>
          </View>
        )}

        {/* Recent Memories */}
        {profile.recent_memories && profile.recent_memories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Memories</Text>
            {profile.recent_memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headerRight: {
    width: 40,
  },
  refreshButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accent + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: colors.accent,
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  relationshipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  relationshipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.xs,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  summaryText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  sentimentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.lg,
  },
  sentimentText: {
    fontSize: 14,
    fontWeight: '500',
  },
  topicsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  topicPill: {
    backgroundColor: colors.glassBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  topicText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  meetingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  meetingButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  contextCard: {
    backgroundColor: colors.accent + '10',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  contextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  contextTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  contextText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  memoryCard: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  memoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  memoryTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  memoryType: {
    fontSize: 11,
    color: colors.textTertiary,
    textTransform: 'capitalize',
  },
  memoryDate: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  memoryContent: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
