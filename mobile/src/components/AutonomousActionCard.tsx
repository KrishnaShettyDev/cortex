/**
 * AutonomousActionCard - Iris-style Action Suggestion Card
 *
 * Features:
 * - One-tap approve/dismiss
 * - Inline edit mode for modifying before approval
 * - Service icon + confidence indicator
 * - Glassmorphic styling
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AutonomousAction,
  EmailPayload,
  CalendarPayload,
  MeetingPrepPayload,
} from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius, gradients, useTheme } from '../theme';

interface AutonomousActionCardProps {
  action: AutonomousAction;
  onApprove: (actionId: string, modifications?: Record<string, unknown>) => void;
  onDismiss: (actionId: string, reason?: string) => void;
  isLoading?: boolean;
}

export function AutonomousActionCard({
  action,
  onApprove,
  onDismiss,
  isLoading = false,
}: AutonomousActionCardProps) {
  const { colors: themeColors, gradients: themeGradients, isDark } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState<Record<string, unknown>>(
    action.action_payload as Record<string, unknown>
  );

  const handleApprove = () => {
    if (isEditing) {
      onApprove(action.id, editedPayload);
    } else {
      onApprove(action.id);
    }
  };

  const handleDismiss = () => {
    onDismiss(action.id);
  };

  const toggleEdit = () => {
    setIsEditing(!isEditing);
  };

  // Get icon based on action type
  const renderIcon = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return <GmailIcon size={24} />;
      case 'calendar_create':
      case 'calendar_reschedule':
      case 'calendar_cancel':
        return <GoogleCalendarIcon size={24} />;
      case 'meeting_prep':
        return <GoogleCalendarIcon size={24} />;
      default:
        return <Ionicons name="flash" size={24} color={themeColors.accent} />;
    }
  };

  // Get action button text
  const getApproveText = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return 'Send';
      case 'calendar_create':
        return 'Create';
      case 'calendar_reschedule':
        return 'Reschedule';
      case 'calendar_cancel':
        return 'Cancel Event';
      case 'meeting_prep':
        return 'Got it';
      default:
        return 'Approve';
    }
  };

  // Render confidence indicator
  const renderConfidenceIndicator = () => {
    const confidence = action.confidence_score;
    const color =
      confidence >= 0.7
        ? themeColors.success
        : confidence >= 0.4
        ? themeColors.warning
        : themeColors.textTertiary;

    return (
      <View style={styles.confidenceContainer}>
        <View style={[styles.confidenceDot, { backgroundColor: color }]} />
        <Text style={[styles.confidenceText, { color }]}>
          {Math.round(confidence * 100)}%
        </Text>
      </View>
    );
  };

  // Render email content
  const renderEmailContent = () => {
    const payload = action.action_payload as EmailPayload;

    if (isEditing) {
      return (
        <View style={styles.editContent}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>To</Text>
            <TextInput
              style={[styles.textInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.to as string}
              onChangeText={(text) =>
                setEditedPayload({ ...editedPayload, to: text })
              }
              placeholder="recipient@email.com"
              placeholderTextColor={themeColors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>Subject</Text>
            <TextInput
              style={[styles.textInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.subject as string}
              onChangeText={(text) =>
                setEditedPayload({ ...editedPayload, subject: text })
              }
              placeholder="Email subject"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>Body</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.body as string}
              onChangeText={(text) =>
                setEditedPayload({ ...editedPayload, body: text })
              }
              placeholder="Email body"
              placeholderTextColor={themeColors.textTertiary}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.previewContent}>
        <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>To: {payload.to}</Text>
        <Text style={[styles.previewSubject, { color: themeColors.textPrimary }]}>{payload.subject}</Text>
        <Text style={[styles.previewBody, { color: themeColors.textSecondary }]} numberOfLines={3}>
          {payload.body}
        </Text>
      </View>
    );
  };

  // Render calendar content
  const renderCalendarContent = () => {
    const payload = action.action_payload as CalendarPayload;

    if (isEditing) {
      return (
        <View style={styles.editContent}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>Title</Text>
            <TextInput
              style={[styles.textInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.title as string}
              onChangeText={(text) =>
                setEditedPayload({ ...editedPayload, title: text })
              }
              placeholder="Event title"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>Location (optional)</Text>
            <TextInput
              style={[styles.textInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={(editedPayload.location as string) || ''}
              onChangeText={(text) =>
                setEditedPayload({ ...editedPayload, location: text })
              }
              placeholder="Add location"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.previewContent}>
        <Text style={[styles.previewSubject, { color: themeColors.textPrimary }]}>{payload.title}</Text>
        <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
          {new Date(payload.start_time).toLocaleString()}
        </Text>
        {payload.location && (
          <Text style={[styles.previewBody, { color: themeColors.textSecondary }]}>{payload.location}</Text>
        )}
      </View>
    );
  };

  // Render meeting prep content
  const renderMeetingPrepContent = () => {
    const payload = action.action_payload as MeetingPrepPayload;

    return (
      <View style={styles.previewContent}>
        <Text style={[styles.previewSubject, { color: themeColors.textPrimary }]}>{payload.event_title}</Text>
        <Text style={[styles.previewLabel, { color: themeColors.textSecondary }]}>
          {new Date(payload.start_time).toLocaleString()}
        </Text>
        {payload.attendees && payload.attendees.length > 0 && (
          <Text style={[styles.previewBody, { color: themeColors.textSecondary }]}>
            {payload.attendees.length} attendee{payload.attendees.length > 1 ? 's' : ''}
          </Text>
        )}
      </View>
    );
  };

  // Render content based on action type
  const renderContent = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return renderEmailContent();
      case 'calendar_create':
      case 'calendar_reschedule':
        return renderCalendarContent();
      case 'meeting_prep':
        return renderMeetingPrepContent();
      default:
        return (
          <View style={styles.previewContent}>
            <Text style={[styles.previewBody, { color: themeColors.textSecondary }]}>{action.description}</Text>
          </View>
        );
    }
  };

  // Check if action type supports editing
  const canEdit =
    action.action_type === 'email_reply' ||
    action.action_type === 'email_compose' ||
    action.action_type === 'followup' ||
    action.action_type === 'calendar_create';

  return (
    <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={[styles.container, { borderColor: themeColors.glassBorder }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: themeColors.fill }]}>{renderIcon()}</View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: themeColors.textPrimary }]} numberOfLines={1}>
            {action.title}
          </Text>
          <Text style={[styles.reason, { color: themeColors.textSecondary }]} numberOfLines={1}>
            {action.reason || 'Suggested action'}
          </Text>
        </View>
        {renderConfidenceIndicator()}
      </View>

      {/* Content */}
      <View style={styles.content}>{renderContent()}</View>

      {/* Actions */}
      <View style={[styles.actions, { borderTopColor: themeColors.glassBorder }]}>
        {canEdit && (
          <TouchableOpacity
            style={styles.editButton}
            onPress={toggleEdit}
            disabled={isLoading}
          >
            <Text style={[styles.editText, { color: themeColors.accent }]}>{isEditing ? 'Done' : 'Edit'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.dismissButton}
          onPress={handleDismiss}
          disabled={isLoading}
        >
          <Text style={[styles.dismissText, { color: themeColors.textSecondary }]}>Dismiss</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.approveButton, { backgroundColor: themeColors.accent }, isEditing && styles.approveButtonDisabled]}
          onPress={handleApprove}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={themeColors.bgPrimary} />
          ) : (
            <Text style={[styles.approveText, { color: themeColors.bgPrimary }]}>{getApproveText()}</Text>
          )}
        </TouchableOpacity>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.glassBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  reason: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '500',
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  previewContent: {},
  previewLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  previewSubject: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  previewBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  editContent: {
    gap: spacing.sm,
  },
  editField: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  textInput: {
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  editButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: 'auto',
  },
  editText: {
    fontSize: 15,
    color: colors.accent,
    fontWeight: '500',
  },
  dismissButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dismissText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  approveButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    minWidth: 80,
    alignItems: 'center',
  },
  approveButtonDisabled: {
    opacity: 0.7,
  },
  approveText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.bgPrimary,
  },
});
