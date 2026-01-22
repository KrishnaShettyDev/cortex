import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useAppStore } from '../../src/stores/appStore';
import { colors, spacing, borderRadius, typography, sheetHandle } from '../../src/theme';

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/settings');
  }
};

interface SettingRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function SettingRow({
  icon,
  iconColor = colors.textSecondary,
  title,
  subtitle,
  value,
  onValueChange,
}: SettingRowProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + '15' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.glassBorder, true: colors.accent + '80' }}
        thumbColor={value ? colors.accent : colors.textTertiary}
        ios_backgroundColor={colors.glassBorder}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const { notificationSettings, setNotificationSettings } = useAppStore();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Daily Briefings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Briefings</Text>
          <Text style={styles.sectionDescription}>
            Calm check-ins to start and end your day
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="sunny-outline"
              iconColor={colors.warning}
              title="Morning briefing"
              subtitle="8:00 AM · Today's events and emails"
              value={notificationSettings.morningBriefing}
              onValueChange={(v) => setNotificationSettings({ morningBriefing: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="moon-outline"
              iconColor={colors.accent}
              title="Evening reflection"
              subtitle="6:00 PM · Day review and tomorrow's preview"
              value={notificationSettings.eveningBriefing}
              onValueChange={(v) => setNotificationSettings({ eveningBriefing: v })}
            />
          </View>
        </View>

        {/* Smart Reminders Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Smart Reminders</Text>
          <Text style={styles.sectionDescription}>
            Gentle nudges when something needs your attention
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="alarm-outline"
              iconColor={colors.success}
              title="Event reminders"
              subtitle="15 and 5 minutes before events"
              value={notificationSettings.smartReminders}
              onValueChange={(v) => setNotificationSettings({ smartReminders: v })}
            />
          </View>
        </View>

        {/* Memory Insights Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Memory Insights</Text>
          <Text style={styles.sectionDescription}>
            Resurface meaningful moments from your past
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="sparkles-outline"
              iconColor={colors.calendar}
              title="On this day"
              subtitle="10:00 AM · Memories from past years"
              value={notificationSettings.memoryInsights}
              onValueChange={(v) => setNotificationSettings({ memoryInsights: v })}
            />
          </View>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.infoText}>
            Notifications are processed locally and respect your privacy.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
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
    ...typography.h3,
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  section: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.glassBorder,
    marginLeft: 60,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  infoText: {
    ...typography.caption,
    color: colors.textTertiary,
    flex: 1,
  },
});
