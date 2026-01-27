import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import {
  RelationshipInsight,
  IntentionInsight,
  PatternInsight,
  PromiseInsight,
  ImportantDateInsight,
  ProactiveInsightsResponse,
} from '../types';

// ==================== INSIGHT PILL (Compact) ====================

interface InsightPillProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  text: string;
  subtext?: string;
  urgent?: boolean;
  onPress?: () => void;
}

export function InsightPill({ icon, iconColor, text, subtext, urgent, onPress }: InsightPillProps) {
  const { colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.pill,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        urgent && styles.pillUrgent
      ]}
    >
      <View style={[styles.pillIcon, { backgroundColor: iconColor + '20' }]}>
        <Ionicons name={icon} size={14} color={iconColor} />
      </View>
      <View style={styles.pillContent}>
        <Text style={[styles.pillText, { color: themeColors.textPrimary }]} numberOfLines={1}>{text}</Text>
        {subtext && <Text style={[styles.pillSubtext, { color: themeColors.textSecondary }]} numberOfLines={1}>{subtext}</Text>}
      </View>
      {urgent && <View style={styles.urgentDot} />}
    </TouchableOpacity>
  );
}

// ==================== RELATIONSHIP INSIGHT CARD ====================

interface RelationshipCardProps {
  insight: RelationshipInsight;
  onPress?: () => void;
  onAction?: () => void;
}

export function RelationshipCard({ insight, onPress, onAction }: RelationshipCardProps) {
  const { colors: themeColors } = useTheme();
  const isUrgent = insight.days_since_contact > 30;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        isUrgent && styles.cardUrgent
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: themeColors.warning + '20' }]}>
          <Ionicons name="heart-outline" size={18} color={themeColors.warning} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Reconnect with {insight.name}</Text>
          <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
            {insight.days_since_contact} days since contact
          </Text>
        </View>
      </View>

      <View style={[styles.healthBar, { backgroundColor: themeColors.bgSecondary }]}>
        <View style={[styles.healthFill, { width: `${insight.health_score}%`, backgroundColor: themeColors.success }]} />
      </View>

      {onAction && (
        <TouchableOpacity style={[styles.cardAction, { borderTopColor: themeColors.glassBorder }]} onPress={onAction}>
          <Ionicons name="chatbubble-outline" size={14} color={themeColors.accent} />
          <Text style={[styles.cardActionText, { color: themeColors.accent }]}>Send a message</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ==================== IMPORTANT DATE CARD ====================

interface ImportantDateCardProps {
  insight: ImportantDateInsight;
  onPress?: () => void;
}

export function ImportantDateCard({ insight, onPress }: ImportantDateCardProps) {
  const { colors: themeColors } = useTheme();
  const isToday = insight.days_until === 0;
  const isTomorrow = insight.days_until === 1;

  const getDaysText = () => {
    if (isToday) return 'Today!';
    if (isTomorrow) return 'Tomorrow';
    return `In ${insight.days_until} days`;
  };

  const getIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (insight.date_type) {
      case 'birthday': return 'gift-outline';
      case 'anniversary': return 'heart-outline';
      case 'work_anniversary': return 'briefcase-outline';
      default: return 'calendar-outline';
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        isToday && styles.cardUrgent
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: themeColors.accentPeach + '20' }]}>
          <Ionicons name={getIcon()} size={18} color={themeColors.accentPeach} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>{insight.person_name}'s {insight.date_label}</Text>
          <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }, isToday && { color: themeColors.warning, fontWeight: '500' }]}>
            {getDaysText()}
            {insight.years && ` - turning ${insight.years}`}
          </Text>
        </View>
      </View>

      {insight.notes && (
        <Text style={[styles.cardNote, { color: themeColors.textSecondary }]} numberOfLines={2}>
          {insight.notes}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ==================== INTENTION CARD ====================

interface IntentionCardProps {
  insight: IntentionInsight;
  onPress?: () => void;
  onComplete?: () => void;
}

export function IntentionCard({ insight, onPress, onComplete }: IntentionCardProps) {
  const { colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        insight.is_overdue && styles.cardUrgent
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: themeColors.accentMint + '20' }]}>
          <Ionicons name="flag-outline" size={18} color={themeColors.accentMint} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={2}>{insight.description}</Text>
          {insight.target_person && (
            <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>For {insight.target_person}</Text>
          )}
          {insight.is_overdue && insight.days_overdue && (
            <Text style={[styles.cardSubtitle, { color: themeColors.warning, fontWeight: '500' }]}>
              {insight.days_overdue} days overdue
            </Text>
          )}
        </View>
      </View>

      {onComplete && (
        <TouchableOpacity style={[styles.cardAction, { borderTopColor: themeColors.glassBorder }]} onPress={onComplete}>
          <Ionicons name="checkmark-circle-outline" size={14} color={themeColors.success} />
          <Text style={[styles.cardActionText, { color: themeColors.success }]}>Mark done</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ==================== PROMISE CARD ====================

interface PromiseCardProps {
  insight: PromiseInsight;
  onPress?: () => void;
  onFulfill?: () => void;
}

export function PromiseCard({ insight, onPress, onFulfill }: PromiseCardProps) {
  const { colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        insight.is_overdue && styles.cardUrgent
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: themeColors.accentSky + '20' }]}>
          <Ionicons name="hand-left-outline" size={18} color={themeColors.accentSky} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Promise to {insight.person_name}</Text>
          <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]} numberOfLines={2}>{insight.description}</Text>
          {insight.is_overdue && (
            <Text style={[styles.cardSubtitle, { color: themeColors.warning, fontWeight: '500' }]}>Overdue</Text>
          )}
          {!insight.is_overdue && insight.days_until_due !== null && insight.days_until_due <= 3 && (
            <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
              Due in {insight.days_until_due} day{insight.days_until_due !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {onFulfill && (
        <TouchableOpacity style={[styles.cardAction, { borderTopColor: themeColors.glassBorder }]} onPress={onFulfill}>
          <Ionicons name="checkmark-circle-outline" size={14} color={themeColors.success} />
          <Text style={[styles.cardActionText, { color: themeColors.success }]}>Mark fulfilled</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ==================== PATTERN WARNING CARD ====================

interface PatternCardProps {
  insight: PatternInsight;
  onPress?: () => void;
  onDismiss?: () => void;
}

export function PatternCard({ insight, onPress, onDismiss }: PatternCardProps) {
  const { colors: themeColors } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder },
        styles.cardWarning
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: themeColors.error + '20' }]}>
          <Ionicons name="warning-outline" size={18} color={themeColors.error} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Pattern Alert</Text>
          <Text style={[styles.cardSubtitle, { color: themeColors.error }]}>{insight.name}</Text>
        </View>
      </View>

      {insight.warning_message && (
        <Text style={[styles.cardNote, { color: themeColors.textSecondary }]}>{insight.warning_message}</Text>
      )}

      {onDismiss && (
        <TouchableOpacity style={[styles.cardAction, { borderTopColor: themeColors.glassBorder }]} onPress={onDismiss}>
          <Ionicons name="close-circle-outline" size={14} color={themeColors.textSecondary} />
          <Text style={[styles.cardActionText, { color: themeColors.accent }]}>Dismiss</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ==================== INSIGHTS SECTION (Container) ====================

interface InsightsSectionProps {
  insights: ProactiveInsightsResponse;
  onRelationshipPress?: (insight: RelationshipInsight) => void;
  onDatePress?: (insight: ImportantDateInsight) => void;
  onIntentionPress?: (insight: IntentionInsight) => void;
  onPromisePress?: (insight: PromiseInsight) => void;
  onPatternPress?: (insight: PatternInsight) => void;
}

export function InsightsSection({
  insights,
  onRelationshipPress,
  onDatePress,
  onIntentionPress,
  onPromisePress,
  onPatternPress,
}: InsightsSectionProps) {
  const hasInsights =
    insights.neglected_relationships.length > 0 ||
    insights.upcoming_dates.length > 0 ||
    insights.pending_intentions.length > 0 ||
    insights.pending_promises.length > 0 ||
    insights.pattern_warnings.length > 0;

  if (!hasInsights) return null;

  return (
    <View style={styles.section}>
      {/* Pattern Warnings (highest priority) */}
      {insights.pattern_warnings.map((p) => (
        <PatternCard
          key={p.id}
          insight={p}
          onPress={() => onPatternPress?.(p)}
        />
      ))}

      {/* Upcoming Dates */}
      {insights.upcoming_dates.map((d) => (
        <ImportantDateCard
          key={d.id}
          insight={d}
          onPress={() => onDatePress?.(d)}
        />
      ))}

      {/* Neglected Relationships */}
      {insights.neglected_relationships.map((r) => (
        <RelationshipCard
          key={r.entity_id}
          insight={r}
          onPress={() => onRelationshipPress?.(r)}
        />
      ))}

      {/* Pending Promises */}
      {insights.pending_promises.filter(p => p.is_overdue || (p.days_until_due !== null && p.days_until_due <= 3)).map((p) => (
        <PromiseCard
          key={p.id}
          insight={p}
          onPress={() => onPromisePress?.(p)}
        />
      ))}

      {/* Pending Intentions */}
      {insights.pending_intentions.filter(i => i.is_overdue).map((i) => (
        <IntentionCard
          key={i.id}
          insight={i}
          onPress={() => onIntentionPress?.(i)}
        />
      ))}
    </View>
  );
}

// ==================== COMPACT INSIGHTS ROW (Pills) ====================

interface InsightsPillRowProps {
  insights: ProactiveInsightsResponse;
  onPress?: () => void;
}

export function InsightsPillRow({ insights, onPress }: InsightsPillRowProps) {
  const { colors: themeColors } = useTheme();
  const pills: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string; urgent: boolean }[] = [];

  // Add upcoming dates
  insights.upcoming_dates.slice(0, 1).forEach((d) => {
    pills.push({
      icon: 'gift-outline',
      color: themeColors.accentPeach,
      text: `${d.person_name}'s ${d.date_label} ${d.days_until === 0 ? 'today!' : `in ${d.days_until}d`}`,
      urgent: d.days_until <= 1,
    });
  });

  // Add neglected relationships
  insights.neglected_relationships.slice(0, 1).forEach((r) => {
    pills.push({
      icon: 'heart-outline',
      color: themeColors.warning,
      text: `Reconnect with ${r.name}`,
      urgent: r.days_since_contact > 30,
    });
  });

  // Add pattern warnings
  insights.pattern_warnings.slice(0, 1).forEach((p) => {
    pills.push({
      icon: 'warning-outline',
      color: themeColors.error,
      text: p.name,
      urgent: true,
    });
  });

  if (pills.length === 0) return null;

  return (
    <View style={styles.pillRow}>
      {pills.map((pill, index) => (
        <InsightPill
          key={index}
          icon={pill.icon}
          iconColor={pill.color}
          text={pill.text}
          urgent={pill.urgent}
          onPress={onPress}
        />
      ))}
      {insights.total_attention_needed > pills.length && (
        <TouchableOpacity
          style={[styles.moreButton, { backgroundColor: themeColors.bgTertiary, borderColor: themeColors.glassBorder }]}
          onPress={onPress}
        >
          <Text style={[styles.moreButtonText, { color: themeColors.textSecondary }]}>
            +{insights.total_attention_needed - pills.length} more
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ==================== STYLES ====================

const styles = StyleSheet.create({
  // Pill styles
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    maxWidth: '100%',
  },
  pillUrgent: {
    borderColor: colors.warning + '40',
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
  pillText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  pillSubtext: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  urgentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  moreButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  moreButtonText: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Card styles
  section: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cardUrgent: {
    borderColor: colors.warning + '40',
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  cardWarning: {
    borderColor: colors.error + '40',
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  urgentText: {
    color: colors.warning,
    fontWeight: '500',
  },
  cardNote: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  healthBar: {
    height: 4,
    backgroundColor: colors.bgSecondary,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  healthFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  cardActionText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.accent,
  },
});
