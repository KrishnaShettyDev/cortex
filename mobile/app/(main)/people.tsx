import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { peopleService } from '../../src/services';
import { PersonSummary } from '../../src/types';
import { colors, spacing, borderRadius, sheetHandle } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';

type SortOption = 'recent' | 'frequent' | 'alphabetical';

const sortOptions: { value: SortOption; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'recent', label: 'Recent', icon: 'time-outline' },
  { value: 'frequent', label: 'Frequent', icon: 'trending-up-outline' },
  { value: 'alphabetical', label: 'A-Z', icon: 'text-outline' },
];

interface PersonItemProps {
  person: PersonSummary;
  onPress: () => void;
}

function PersonItem({ person, onPress }: PersonItemProps) {
  const initial = person.name.charAt(0).toUpperCase();
  const lastSeenText = person.last_seen
    ? formatRelativeDate(new Date(person.last_seen))
    : 'Never';

  return (
    <TouchableOpacity style={styles.personItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={styles.personInfo}>
        <Text style={styles.personName}>{person.name}</Text>
        <Text style={styles.personMeta}>
          {person.mention_count} {person.mention_count === 1 ? 'mention' : 'mentions'} · Last seen {lastSeenText}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export default function PeopleScreen() {
  const posthog = usePostHog();
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [error, setError] = useState<string | null>(null);

  const loadPeople = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        setIsRefreshing(true);
      }
      setError(null);

      const response = await peopleService.listPeople(sortBy);
      setPeople(response.people);
      posthog?.capture(ANALYTICS_EVENTS.PEOPLE_LIST_LOADED, {
        count: response.people.length,
        sort_by: sortBy,
      });
    } catch (err: any) {
      logger.error('Failed to load people:', err);
      setError(err.message || 'Failed to load people');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [sortBy]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  const handlePersonPress = (person: PersonSummary) => {
    posthog?.capture(ANALYTICS_EVENTS.PERSON_TAPPED, {
      person_name: person.name,
      mention_count: person.mention_count,
    });
    router.push({
      pathname: '/(main)/person/[name]',
      params: { name: person.name },
    });
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="people-outline" size={48} color={colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>No people yet</Text>
      <Text style={styles.emptySubtitle}>
        People mentioned in your memories will appear here
      </Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
      </View>
      <Text style={styles.emptyTitle}>Something went wrong</Text>
      <Text style={styles.emptySubtitle}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={() => loadPeople()}>
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Sheet Handle */}
      <View style={styles.handleContainer}>
        <View style={styles.handle} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>People</Text>
      </View>

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        {sortOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.sortButton,
              sortBy === option.value && styles.sortButtonActive,
            ]}
            onPress={() => {
              if (sortBy !== option.value) {
                posthog?.capture(ANALYTICS_EVENTS.PEOPLE_SORT_CHANGED, {
                  from_sort: sortBy,
                  to_sort: option.value,
                });
              }
              setSortBy(option.value);
            }}
          >
            <Ionicons
              name={option.icon}
              size={14}
              color={sortBy === option.value ? colors.accent : colors.textSecondary}
            />
            <Text
              style={[
                styles.sortButtonText,
                sortBy === option.value && styles.sortButtonTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        renderError()
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PersonItem person={item} onPress={() => handlePersonPress(item)} />
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadPeople(true)}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
    backgroundColor: colors.textTertiary,
    opacity: 0.4,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sortContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.glassBackground,
  },
  sortButtonActive: {
    backgroundColor: colors.accent + '20',
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  sortButtonTextActive: {
    color: colors.accent,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingVertical: spacing.sm,
    flexGrow: 1,
  },
  personItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.accent,
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  personMeta: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.glassBackground,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
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
});
