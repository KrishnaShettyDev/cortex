/**
 * TriggerCard - Display and manage user-defined triggers
 *
 * Shows trigger info with toggle switch and delete option.
 * Used in Settings screen for trigger management.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, spacing, useTheme } from '../theme';

export interface Trigger {
  id: string;
  name: string;
  humanReadable: string;
  isActive: boolean;
  nextTriggerAt: string | null;
  lastTriggeredAt: string | null;
}

interface TriggerCardProps {
  trigger: Trigger;
  onToggle: (triggerId: string, isActive: boolean) => Promise<boolean>;
  onDelete: (triggerId: string) => Promise<boolean>;
  onPress?: (trigger: Trigger) => void;
}

export function TriggerCard({ trigger, onToggle, onDelete, onPress }: TriggerCardProps) {
  const { colors } = useTheme();
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localActive, setLocalActive] = useState(trigger.isActive);

  const handleToggle = async (value: boolean) => {
    setIsToggling(true);
    setLocalActive(value); // Optimistic update
    const success = await onToggle(trigger.id, value);
    if (!success) {
      setLocalActive(!value); // Revert on failure
    }
    setIsToggling(false);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Trigger',
      `Are you sure you want to delete "${trigger.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            await onDelete(trigger.id);
            setIsDeleting(false);
          },
        },
      ]
    );
  };

  const formatNextRun = (dateString: string | null) => {
    if (!dateString) return 'Not scheduled';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) return 'Overdue';
    if (diffMins < 60) return `In ${diffMins}m`;
    if (diffMins < 1440) return `In ${Math.floor(diffMins / 60)}h`;
    return date.toLocaleDateString();
  };

  const formatLastRun = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: colors.fill, opacity: isDeleting ? 0.5 : 1 },
      ]}
      onPress={() => onPress?.(trigger)}
      activeOpacity={0.7}
      disabled={isDeleting}
    >
      {/* Icon */}
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: localActive
              ? 'rgba(99, 102, 241, 0.15)'
              : 'rgba(156, 163, 175, 0.15)',
          },
        ]}
      >
        <Ionicons
          name="alarm"
          size={20}
          color={localActive ? '#6366F1' : '#9CA3AF'}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text
          style={[
            styles.name,
            { color: colors.textPrimary },
            !localActive && styles.nameInactive,
          ]}
          numberOfLines={1}
        >
          {trigger.name}
        </Text>
        <Text style={[styles.schedule, { color: colors.textSecondary }]}>
          {trigger.humanReadable}
        </Text>
        <View style={styles.timing}>
          <Text style={[styles.timingText, { color: colors.textTertiary }]}>
            Next: {formatNextRun(trigger.nextTriggerAt)}
          </Text>
          {trigger.lastTriggeredAt && (
            <>
              <Text style={[styles.timingDot, { color: colors.textQuaternary }]}>
                {' \u2022 '}
              </Text>
              <Text style={[styles.timingText, { color: colors.textTertiary }]}>
                Last: {formatLastRun(trigger.lastTriggeredAt)}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Switch
          value={localActive}
          onValueChange={handleToggle}
          disabled={isToggling || isDeleting}
          trackColor={{ false: colors.bgTertiary, true: '#6366F1' }}
          thumbColor={localActive ? '#FFFFFF' : '#F4F4F5'}
          ios_backgroundColor={colors.bgTertiary}
        />
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          disabled={isDeleting}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={18} color="#EF4444" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Create trigger button
 */
export function CreateTriggerButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.createButton, { borderColor: colors.glassBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.createIcon}>
        <Ionicons name="add" size={20} color="#6366F1" />
      </View>
      <View style={styles.createContent}>
        <Text style={[styles.createTitle, { color: colors.textPrimary }]}>
          Create Trigger
        </Text>
        <Text style={[styles.createSubtitle, { color: colors.textSecondary }]}>
          "Remind me every weekday at 9am..."
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textQuaternary} />
    </TouchableOpacity>
  );
}

/**
 * Empty state for no triggers
 */
export function TriggersEmptyState({ onCreatePress }: { onCreatePress: () => void }) {
  const { colors } = useTheme();

  return (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: 'rgba(99, 102, 241, 0.1)' }]}>
        <Ionicons name="alarm-outline" size={32} color="#6366F1" />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
        No Triggers Yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Create triggers using natural language to schedule reminders and automated tasks.
      </Text>
      <TouchableOpacity
        style={styles.emptyButton}
        onPress={onCreatePress}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={styles.emptyButtonText}>Create Your First Trigger</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  content: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.24,
    marginBottom: 2,
  },
  nameInactive: {
    opacity: 0.6,
  },
  schedule: {
    fontSize: 13,
    marginBottom: 4,
  },
  timing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timingText: {
    fontSize: 11,
  },
  timingDot: {
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteButton: {
    padding: spacing.xs,
  },
  // Create button styles
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: spacing.sm,
  },
  createIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  createContent: {
    flex: 1,
  },
  createTitle: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.24,
  },
  createSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  // Empty state styles
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.24,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#6366F1',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
