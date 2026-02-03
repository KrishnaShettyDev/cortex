/**
 * ProactiveNudges - Real nudges from the API
 *
 * Displays actual proactive intelligence from /v3/nudges:
 * - Relationship health alerts
 * - Commitment reminders
 * - Follow-up suggestions
 *
 * Tapping a nudge sends a contextual message to the chat.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNudges, Nudge, getNudgeIcon, getNudgePriorityColor } from '../hooks/useNudges';
import { useTheme, spacing, borderRadius } from '../theme';

interface ProactiveNudgesProps {
  onNudgeTap: (prompt: string) => void;
  maxNudges?: number;
}

export function ProactiveNudges({ onNudgeTap, maxNudges = 3 }: ProactiveNudgesProps) {
  const { colors } = useTheme();
  const { data, isLoading, error } = useNudges();

  // Loading state - show nothing to keep it clean
  if (isLoading) {
    return null;
  }

  // Error or no nudges - show nothing
  if (error || !data || data.nudges.length === 0) {
    return null;
  }

  // Only show top nudges by priority
  const topNudges = data.nudges.slice(0, maxNudges);

  const handleNudgeTap = (nudge: Nudge) => {
    // Generate a contextual prompt based on the nudge
    let prompt = '';

    switch (nudge.nudge_type) {
      case 'relationship_maintenance':
      case 'dormant_relationship':
        prompt = nudge.entity_name
          ? `Help me reconnect with ${nudge.entity_name}. What should I say?`
          : 'Help me reconnect with someone I haven\'t talked to in a while.';
        break;

      case 'follow_up':
        prompt = nudge.entity_name
          ? `I need to follow up with ${nudge.entity_name}. Help me draft a message.`
          : 'What follow-ups do I have pending?';
        break;

      case 'commitment_due':
      case 'deadline_approaching':
        prompt = nudge.entity_name
          ? `Remind me about my commitment to ${nudge.entity_name}.`
          : 'What commitments do I have coming up?';
        break;

      case 'overdue_commitment':
        prompt = nudge.entity_name
          ? `I have an overdue commitment with ${nudge.entity_name}. Help me address it.`
          : 'What overdue commitments do I need to address?';
        break;

      default:
        prompt = nudge.suggested_action || nudge.title;
    }

    onNudgeTap(prompt);
  };

  return (
    <View style={styles.container}>
      {topNudges.map((nudge) => (
        <NudgePill
          key={nudge.id}
          nudge={nudge}
          onPress={() => handleNudgeTap(nudge)}
        />
      ))}
      {data.nudges.length > maxNudges && (
        <TouchableOpacity
          style={[styles.moreButton, { backgroundColor: colors.bgTertiary, borderColor: colors.glassBorder }]}
          onPress={() => onNudgeTap('What else needs my attention today?')}
        >
          <Text style={[styles.moreText, { color: colors.textSecondary }]}>
            +{data.nudges.length - maxNudges} more
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

interface NudgePillProps {
  nudge: Nudge;
  onPress: () => void;
}

function NudgePill({ nudge, onPress }: NudgePillProps) {
  const { colors } = useTheme();
  const iconName = getNudgeIcon(nudge.nudge_type) as keyof typeof Ionicons.glyphMap;
  const iconColor = getNudgePriorityColor(nudge.priority, colors);
  const isUrgent = nudge.priority === 'urgent' || nudge.priority === 'high';

  return (
    <TouchableOpacity
      style={[
        styles.pill,
        { backgroundColor: colors.bgTertiary, borderColor: colors.glassBorder },
        isUrgent && { borderColor: iconColor + '40' },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.pillIcon, { backgroundColor: iconColor + '20' }]}>
        <Ionicons name={iconName} size={14} color={iconColor} />
      </View>
      <View style={styles.pillContent}>
        <Text style={[styles.pillTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {nudge.title}
        </Text>
        {nudge.entity_name && (
          <Text style={[styles.pillSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {nudge.message.substring(0, 50)}
          </Text>
        )}
      </View>
      {isUrgent && <View style={[styles.urgentDot, { backgroundColor: iconColor }]} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    gap: spacing.xs,
    borderWidth: 1,
  },
  pillIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillContent: {
    flex: 1,
  },
  pillTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  pillSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  urgentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  moreButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  moreText: {
    fontSize: 12,
  },
});
