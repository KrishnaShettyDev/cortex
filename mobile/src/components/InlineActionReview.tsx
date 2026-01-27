import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, useTheme } from '../theme';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { ServiceStatusPill } from './ServiceStatusPill';

// Email action data
export interface EmailActionData {
  type: 'email';
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

// Calendar action data
export interface CalendarActionData {
  type: 'calendar';
  title: string;
  datetime: string;
  location?: string;
  attendees?: string[];
  description?: string;
}

export type ActionData = EmailActionData | CalendarActionData;

interface InlineActionReviewProps {
  action: ActionData;
  onConfirm: (editedAction: ActionData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function InlineActionReview({
  action,
  onConfirm,
  onCancel,
  isLoading = false,
}: InlineActionReviewProps) {
  const { colors: themeColors } = useTheme();
  const [isEditing, setIsEditing] = useState(false);

  // Email state
  const [emailTo, setEmailTo] = useState(action.type === 'email' ? action.to : '');
  const [emailSubject, setEmailSubject] = useState(action.type === 'email' ? action.subject : '');
  const [emailBody, setEmailBody] = useState(action.type === 'email' ? action.body : '');

  // Calendar state
  const [calendarTitle, setCalendarTitle] = useState(action.type === 'calendar' ? action.title : '');
  const [calendarDatetime, setCalendarDatetime] = useState(action.type === 'calendar' ? action.datetime : '');
  const [calendarLocation, setCalendarLocation] = useState(action.type === 'calendar' ? action.location || '' : '');

  const isEmail = action.type === 'email';

  const handleConfirm = () => {
    if (isEmail) {
      onConfirm({
        type: 'email',
        to: emailTo,
        subject: emailSubject,
        body: emailBody,
      });
    } else {
      onConfirm({
        type: 'calendar',
        title: calendarTitle,
        datetime: calendarDatetime,
        location: calendarLocation || undefined,
      });
    }
  };

  const renderEmailContent = () => {
    if (isEditing) {
      return (
        <View style={styles.editContent}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>To:</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
              value={emailTo}
              onChangeText={setEmailTo}
              placeholder="recipient@email.com"
              placeholderTextColor={themeColors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Subject:</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder="Email subject"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
          <TextInput
            style={[styles.textInput, styles.bodyInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
            value={emailBody}
            onChangeText={setEmailBody}
            placeholder="Email body"
            placeholderTextColor={themeColors.textTertiary}
            multiline
            textAlignVertical="top"
          />
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <GmailIcon size={22} />
          <View style={styles.headerText}>
            <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Send Email</Text>
            <Text style={[styles.recipientText, { color: themeColors.textSecondary }]}>To: {emailTo}</Text>
          </View>
        </View>

        <Text style={[styles.subjectLine, { color: themeColors.textSecondary }]}>Subject: {emailSubject}</Text>

        <ScrollView style={styles.bodyScroll} nestedScrollEnabled>
          <Text style={[styles.bodyText, { color: themeColors.textPrimary }]}>{emailBody}</Text>
        </ScrollView>
      </View>
    );
  };

  const renderCalendarContent = () => {
    if (isEditing) {
      return (
        <View style={styles.editContent}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Title:</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
              value={calendarTitle}
              onChangeText={setCalendarTitle}
              placeholder="Event title"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>When:</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
              value={calendarDatetime}
              onChangeText={setCalendarDatetime}
              placeholder="Date and time"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Location:</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary }]}
              value={calendarLocation}
              onChangeText={setCalendarLocation}
              placeholder="Location (optional)"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <GoogleCalendarIcon size={22} />
          <View style={styles.headerText}>
            <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Create Event</Text>
            <Text style={[styles.recipientText, { color: themeColors.textSecondary }]}>{calendarTitle}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={16} color={themeColors.textSecondary} />
          <Text style={[styles.detailText, { color: themeColors.textSecondary }]}>{calendarDatetime}</Text>
        </View>

        {calendarLocation ? (
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={16} color={themeColors.textSecondary} />
            <Text style={[styles.detailText, { color: themeColors.textSecondary }]}>{calendarLocation}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Action Confirmation Header */}
      <ServiceStatusPill
        service="action"
        text="Action Confirmation Required"
        isComplete={true}
      />

      {/* Review Actions Card */}
      <View style={[styles.reviewCard, { backgroundColor: themeColors.bgTertiary }]}>
        <Text style={[styles.reviewHeader, { color: themeColors.textPrimary }]}>Review Actions</Text>

        <View style={[styles.actionCard, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }]}>
          {isEmail ? renderEmailContent() : renderCalendarContent()}

          {/* Edit Button */}
          <TouchableOpacity
            style={[styles.editButton, { borderTopColor: themeColors.glassBorder, backgroundColor: themeColors.bgTertiary }]}
            onPress={() => setIsEditing(!isEditing)}
          >
            <Ionicons
              name={isEditing ? 'checkmark' : 'pencil'}
              size={16}
              color={themeColors.textSecondary}
            />
            <Text style={[styles.editButtonText, { color: themeColors.textSecondary }]}>
              {isEditing ? 'Done' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Action Buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }]}
            onPress={onCancel}
            disabled={isLoading}
          >
            <Text style={[styles.cancelButtonText, { color: themeColors.textPrimary }]}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmButton, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }, isEditing && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={isLoading || isEditing}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={themeColors.textPrimary} />
            ) : (
              <Text style={[styles.confirmButtonText, { color: themeColors.textPrimary }, isEditing && { color: themeColors.textSecondary }]}>
                {isEmail ? 'Send' : 'Create'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  reviewCard: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  reviewHeader: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  actionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  content: {
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  recipientText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subjectLine: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  bodyScroll: {
    maxHeight: 250,
  },
  bodyText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  detailText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  editContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  editField: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  textInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    padding: spacing.sm + 2,
    fontSize: 16,
    color: colors.textPrimary,
  },
  bodyInput: {
    minHeight: 140,
    paddingTop: spacing.sm,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cancelButtonText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  confirmButtonTextDisabled: {
    color: colors.textSecondary,
  },
});
