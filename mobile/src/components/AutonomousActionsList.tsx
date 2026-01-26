/**
 * AutonomousActionsList - Iris-style Actions Section
 *
 * Displays pending autonomous actions in a scrollable list.
 * Shows skeleton loading state and empty state.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { AutonomousActionCard } from './AutonomousActionCard';
import {
  useAutonomousActions,
  useApproveAction,
  useDismissAction,
} from '../hooks/useAutonomousActions';
import { colors, spacing, borderRadius } from '../theme';
import { logger } from '../utils/logger';

interface AutonomousActionsListProps {
  onActionExecuted?: () => void;
}

export function AutonomousActionsList({ onActionExecuted }: AutonomousActionsListProps) {
  const { data, isLoading, error } = useAutonomousActions();
  const approveAction = useApproveAction();
  const dismissAction = useDismissAction();

  // Debug logging
  logger.log('[AutonomousActions] Loading:', isLoading, 'Data:', data, 'Error:', error);

  const handleApprove = async (
    actionId: string,
    modifications?: Record<string, unknown>
  ) => {
    try {
      await approveAction.mutateAsync({ actionId, modifications });
      logger.log('Action approved:', actionId);
      onActionExecuted?.();
    } catch (error) {
      logger.error('Failed to approve action:', error);
    }
  };

  const handleDismiss = async (actionId: string, reason?: string) => {
    try {
      await dismissAction.mutateAsync({ actionId, reason });
      logger.log('Action dismissed:', actionId);
    } catch (error) {
      logger.error('Failed to dismiss action:', error);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.sectionTitle}>Actions I Can Handle</Text>
        </View>
        <SkeletonCard />
      </View>
    );
  }

  // Error state - silently fail, don't show error to user
  if (error) {
    logger.error('Failed to load autonomous actions:', error);
    return null;
  }

  // No actions state - show debug info temporarily
  if (!data || data.actions.length === 0) {
    // TODO: Remove this debug view after testing
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.sectionTitle}>Actions I Can Handle</Text>
          <Text style={styles.sectionSubtitle}>No pending actions</Text>
        </View>
        <View style={[styles.skeletonCard, { padding: spacing.md }]}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
            Actions will appear here when Cortex has suggestions for you.
            {'\n\n'}Try connecting Gmail or Calendar to get started!
          </Text>
        </View>
      </View>
    );
  }

  const isPending = approveAction.isPending || dismissAction.isPending;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Actions I Can Handle</Text>
        <Text style={styles.sectionSubtitle}>
          {data.count} suggestion{data.count !== 1 ? 's' : ''}
        </Text>
      </View>

      {data.actions.map((action) => (
        <AutonomousActionCard
          key={action.id}
          action={action}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
          isLoading={isPending}
        />
      ))}
    </View>
  );
}

// Skeleton loading card
function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonHeader}>
        <View style={styles.skeletonIcon} />
        <View style={styles.skeletonTextContainer}>
          <View style={[styles.skeletonLine, { width: '60%' }]} />
          <View style={[styles.skeletonLine, { width: '40%', marginTop: 6 }]} />
        </View>
      </View>
      <View style={styles.skeletonContent}>
        <View style={[styles.skeletonLine, { width: '80%' }]} />
        <View style={[styles.skeletonLine, { width: '100%', marginTop: 8 }]} />
        <View style={[styles.skeletonLine, { width: '70%', marginTop: 8 }]} />
      </View>
      <View style={styles.skeletonActions}>
        <View style={styles.skeletonButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Skeleton styles
  skeletonCard: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.bgTertiary,
  },
  skeletonTextContainer: {
    flex: 1,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.bgTertiary,
  },
  skeletonContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  skeletonActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  skeletonButton: {
    width: 80,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgTertiary,
  },
});
