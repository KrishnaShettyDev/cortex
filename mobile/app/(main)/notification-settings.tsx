import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useAppStore } from '../../src/stores/appStore';
import { api } from '../../src/services';
import { colors, spacing, borderRadius, typography } from '../../src/theme';

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

interface StepperRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

function StepperRow({
  icon,
  iconColor = colors.textSecondary,
  title,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  valueLabel,
}: StepperRowProps) {
  const decrease = () => {
    if (value > min) {
      onValueChange(value - step);
    }
  };

  const increase = () => {
    if (value < max) {
      onValueChange(value + step);
    }
  };

  return (
    <View style={styles.stepperRow}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + '15' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.stepperContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.stepperValueLabel}>{valueLabel || value}</Text>
      </View>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          style={[styles.stepperButton, value <= min && styles.stepperButtonDisabled]}
          onPress={decrease}
          disabled={value <= min}
        >
          <Ionicons name="remove" size={20} color={value <= min ? colors.textTertiary : colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          style={[styles.stepperButton, value >= max && styles.stepperButtonDisabled]}
          onPress={increase}
          disabled={value >= max}
        >
          <Ionicons name="add" size={20} color={value >= max ? colors.textTertiary : colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface TimePickerRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  value: string;
  onPress: () => void;
}

function TimePickerRow({
  icon,
  iconColor = colors.textSecondary,
  title,
  value,
  onPress,
}: TimePickerRowProps) {
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + '15' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
      </View>
      <Text style={styles.timeValue}>{formatTime(value)}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function NotificationSettingsScreen() {
  const { notificationSettings, setNotificationSettings } = useAppStore();
  const [isSyncing, setIsSyncing] = useState(false);

  // Sync settings with backend
  const syncWithBackend = async () => {
    try {
      setIsSyncing(true);
      await api.put('/notifications/preferences', {
        enable_morning_briefing: notificationSettings.morningBriefing,
        enable_evening_briefing: notificationSettings.eveningBriefing,
        enable_meeting_prep: notificationSettings.meetingPrep,
        enable_email_alerts: notificationSettings.emailAlerts,
        enable_commitment_reminders: notificationSettings.commitmentReminders,
        enable_pattern_warnings: notificationSettings.patternWarnings,
        enable_reconnection_nudges: notificationSettings.reconnectionNudges,
        enable_memory_insights: notificationSettings.memoryInsights,
        enable_important_dates: notificationSettings.importantDates,
        max_notifications_per_day: notificationSettings.maxNotificationsPerDay,
        quiet_hours_enabled: notificationSettings.quietHoursEnabled,
        quiet_hours_start: notificationSettings.quietHoursStart,
        quiet_hours_end: notificationSettings.quietHoursEnd,
        morning_briefing_time: notificationSettings.morningBriefingTime,
        evening_briefing_time: notificationSettings.eveningBriefingTime,
        meeting_prep_minutes_before: notificationSettings.meetingPrepMinutesBefore,
        timezone: notificationSettings.timezone,
      });
    } catch (error) {
      console.error('Failed to sync notification settings:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync on settings change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      syncWithBackend();
    }, 1000);
    return () => clearTimeout(timer);
  }, [notificationSettings]);

  const showTimePicker = (setting: 'morningBriefingTime' | 'eveningBriefingTime' | 'quietHoursStart' | 'quietHoursEnd') => {
    const labels = {
      morningBriefingTime: 'Morning Briefing Time',
      eveningBriefingTime: 'Evening Briefing Time',
      quietHoursStart: 'Quiet Hours Start',
      quietHoursEnd: 'Quiet Hours End',
    };

    // Simple time picker using Alert (for demo - would use DateTimePicker in production)
    const times = ['06:00', '07:00', '08:00', '09:00', '10:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

    Alert.alert(
      labels[setting],
      'Select a time',
      times.map(time => ({
        text: formatTimeDisplay(time),
        onPress: () => setNotificationSettings({ [setting]: time }),
      }))
    );
  };

  const formatTimeDisplay = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.backButton}>
          {isSyncing && (
            <Ionicons name="sync" size={20} color={colors.textTertiary} />
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Daily Budget Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Budget</Text>
          <Text style={styles.sectionDescription}>
            Limit how many notifications you receive per day
          </Text>

          <View style={styles.card}>
            <StepperRow
              icon="notifications-outline"
              iconColor={colors.accent}
              title="Max per day"
              value={notificationSettings.maxNotificationsPerDay}
              min={3}
              max={15}
              onValueChange={(v) => setNotificationSettings({ maxNotificationsPerDay: v })}
              valueLabel={`${notificationSettings.maxNotificationsPerDay} notifications`}
            />
          </View>
        </View>

        {/* Quiet Hours Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quiet Hours</Text>
          <Text style={styles.sectionDescription}>
            Pause notifications during specific hours
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="moon-outline"
              iconColor={colors.accent}
              title="Enable quiet hours"
              subtitle="No notifications during quiet hours"
              value={notificationSettings.quietHoursEnabled}
              onValueChange={(v) => setNotificationSettings({ quietHoursEnabled: v })}
            />
            {notificationSettings.quietHoursEnabled && (
              <>
                <View style={styles.separator} />
                <TimePickerRow
                  icon="time-outline"
                  iconColor={colors.textSecondary}
                  title="Start time"
                  value={notificationSettings.quietHoursStart}
                  onPress={() => showTimePicker('quietHoursStart')}
                />
                <View style={styles.separator} />
                <TimePickerRow
                  icon="time-outline"
                  iconColor={colors.textSecondary}
                  title="End time"
                  value={notificationSettings.quietHoursEnd}
                  onPress={() => showTimePicker('quietHoursEnd')}
                />
              </>
            )}
          </View>
        </View>

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
              subtitle={`${formatTimeDisplay(notificationSettings.morningBriefingTime)} · Today's events and emails`}
              value={notificationSettings.morningBriefing}
              onValueChange={(v) => setNotificationSettings({ morningBriefing: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="moon-outline"
              iconColor={colors.accent}
              title="Evening reflection"
              subtitle={`${formatTimeDisplay(notificationSettings.eveningBriefingTime)} · Day review and tomorrow's preview`}
              value={notificationSettings.eveningBriefing}
              onValueChange={(v) => setNotificationSettings({ eveningBriefing: v })}
            />
          </View>
        </View>

        {/* Proactive Alerts Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Proactive Alerts</Text>
          <Text style={styles.sectionDescription}>
            Intelligent notifications based on your context
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="calendar-outline"
              iconColor={colors.calendar}
              title="Meeting preparation"
              subtitle={`${notificationSettings.meetingPrepMinutesBefore} min before · Context about attendees`}
              value={notificationSettings.meetingPrep}
              onValueChange={(v) => setNotificationSettings({ meetingPrep: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="mail-outline"
              iconColor={colors.gmail}
              title="Urgent email alerts"
              subtitle="Important emails that need attention"
              value={notificationSettings.emailAlerts}
              onValueChange={(v) => setNotificationSettings({ emailAlerts: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="checkmark-circle-outline"
              iconColor={colors.success}
              title="Commitment reminders"
              subtitle="Things you said you'd do"
              value={notificationSettings.commitmentReminders}
              onValueChange={(v) => setNotificationSettings({ commitmentReminders: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="flash-outline"
              iconColor={colors.warning}
              title="Pattern warnings"
              subtitle="When you're repeating past mistakes"
              value={notificationSettings.patternWarnings}
              onValueChange={(v) => setNotificationSettings({ patternWarnings: v })}
            />
          </View>
        </View>

        {/* Relationship Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Relationships</Text>
          <Text style={styles.sectionDescription}>
            Stay connected with the people who matter
          </Text>

          <View style={styles.card}>
            <SettingRow
              icon="people-outline"
              iconColor={colors.accent}
              title="Reconnection nudges"
              subtitle="When you haven't talked to someone in a while"
              value={notificationSettings.reconnectionNudges}
              onValueChange={(v) => setNotificationSettings({ reconnectionNudges: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="gift-outline"
              iconColor={colors.error}
              title="Important dates"
              subtitle="Birthdays, anniversaries, and special days"
              value={notificationSettings.importantDates}
              onValueChange={(v) => setNotificationSettings({ importantDates: v })}
            />
          </View>
        </View>

        {/* Memory Section */}
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
              subtitle="Memories from past years"
              value={notificationSettings.memoryInsights}
              onValueChange={(v) => setNotificationSettings({ memoryInsights: v })}
            />
            <View style={styles.separator} />
            <SettingRow
              icon="alarm-outline"
              iconColor={colors.success}
              title="Smart reminders"
              subtitle="Event reminders before they happen"
              value={notificationSettings.smartReminders}
              onValueChange={(v) => setNotificationSettings({ smartReminders: v })}
            />
          </View>
        </View>

        {/* Info Note */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.infoText}>
            Notifications are coordinated to respect your daily budget. High priority items are always delivered first.
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
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  stepperContent: {
    flex: 1,
  },
  stepperValueLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.5,
  },
  stepperValue: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'center',
  },
  timeValue: {
    ...typography.body,
    color: colors.accent,
    marginRight: spacing.xs,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
