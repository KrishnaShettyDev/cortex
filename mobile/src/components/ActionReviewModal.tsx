/**
 * ActionReviewModal - iOS-style action review sheet
 *
 * Clean bottom sheet for reviewing and approving actions.
 * Native iOS aesthetic with smooth interactions.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AutonomousAction,
  EmailPayload,
  CalendarPayload,
} from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius, sheetHandle, useTheme } from '../theme';

interface ActionReviewModalProps {
  action: AutonomousAction | null;
  visible: boolean;
  onClose: () => void;
  onApprove: (actionId: string, modifications?: Record<string, unknown>) => void;
  onDismiss: (actionId: string) => void;
  isLoading?: boolean;
}

export function ActionReviewModal({
  action,
  visible,
  onClose,
  onApprove,
  onDismiss,
  isLoading = false,
}: ActionReviewModalProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState<Record<string, unknown>>({});

  // Reset state when action changes
  React.useEffect(() => {
    if (action) {
      setEditedPayload(action.action_payload as unknown as Record<string, unknown>);
      setIsEditing(false);
    }
  }, [action?.id]);

  if (!action) return null;

  const handleApprove = () => {
    if (isEditing) {
      onApprove(action.id, editedPayload);
    } else {
      onApprove(action.id);
    }
  };

  const handleDismiss = () => {
    onDismiss(action.id);
    onClose();
  };

  // Action type helpers
  const getActionTypeLabel = () => {
    switch (action.action_type) {
      case 'email_reply': return 'Reply';
      case 'email_compose': return 'New Email';
      case 'followup': return 'Follow Up';
      case 'calendar_create': return 'New Event';
      case 'calendar_reschedule': return 'Reschedule';
      case 'meeting_prep': return 'Prep Notes';
      default: return 'Action';
    }
  };

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
      case 'meeting_prep':
        return 'Done';
      default:
        return 'Approve';
    }
  };

  const renderIcon = () => {
    const size = 18;
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return <GmailIcon size={size} />;
      case 'calendar_create':
      case 'calendar_reschedule':
      case 'meeting_prep':
        return <GoogleCalendarIcon size={size} />;
      default:
        return <Ionicons name="flash" size={size} color={themeColors.accent} />;
    }
  };

  // Email content renderer
  const renderEmailContent = () => {
    const payload = (isEditing ? editedPayload : action.action_payload) as EmailPayload;

    return (
      <View style={styles.contentSection}>
        {/* To field */}
        <View style={[styles.fieldRow, { borderBottomColor: themeColors.separator }]}>
          <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>To</Text>
          <Text style={[styles.fieldValue, { color: themeColors.textPrimary }]} numberOfLines={1}>{payload.to}</Text>
        </View>

        {/* Subject */}
        {payload.subject && (
          <View style={[styles.fieldRow, { borderBottomColor: themeColors.separator }]}>
            <Text style={[styles.fieldLabel, { color: themeColors.textTertiary }]}>Re</Text>
            <Text style={[styles.fieldValue, { color: themeColors.textPrimary }]} numberOfLines={2}>{payload.subject}</Text>
          </View>
        )}

        {/* Body */}
        <View style={styles.bodySection}>
          {isEditing ? (
            <TextInput
              style={[styles.bodyInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.body as string}
              onChangeText={(text) => setEditedPayload({ ...editedPayload, body: text })}
              multiline
              placeholder="Email body"
              placeholderTextColor={themeColors.textTertiary}
              autoFocus
            />
          ) : (
            <Text style={[styles.bodyText, { color: themeColors.textPrimary }]}>{payload.body}</Text>
          )}
        </View>
      </View>
    );
  };

  // Calendar content renderer
  const renderCalendarContent = () => {
    const payload = (isEditing ? editedPayload : action.action_payload) as CalendarPayload;

    return (
      <View style={styles.contentSection}>
        {isEditing ? (
          <>
            <TextInput
              style={[styles.titleInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={editedPayload.title as string}
              onChangeText={(text) => setEditedPayload({ ...editedPayload, title: text })}
              placeholder="Event title"
              placeholderTextColor={themeColors.textTertiary}
            />
            <TextInput
              style={[styles.locationInput, { color: themeColors.textPrimary, backgroundColor: themeColors.fill }]}
              value={(editedPayload.location as string) || ''}
              onChangeText={(text) => setEditedPayload({ ...editedPayload, location: text })}
              placeholder="Location (optional)"
              placeholderTextColor={themeColors.textTertiary}
            />
          </>
        ) : (
          <>
            <Text style={[styles.eventTitle, { color: themeColors.textPrimary }]}>{payload.title}</Text>
            <View style={styles.eventMeta}>
              <Ionicons name="time-outline" size={14} color={themeColors.textSecondary} />
              <Text style={[styles.eventTime, { color: themeColors.textSecondary }]}>
                {new Date(payload.start_time).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            {payload.location && (
              <View style={styles.eventMeta}>
                <Ionicons name="location-outline" size={14} color={themeColors.textSecondary} />
                <Text style={[styles.eventLocation, { color: themeColors.textSecondary }]}>{payload.location}</Text>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  // Content based on action type
  const renderContent = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return renderEmailContent();
      case 'calendar_create':
      case 'calendar_reschedule':
        return renderCalendarContent();
      default:
        return (
          <View style={styles.contentSection}>
            <Text style={[styles.bodyText, { color: themeColors.textPrimary }]}>{action.description}</Text>
          </View>
        );
    }
  };

  // Check if action supports editing
  const canEdit =
    action.action_type === 'email_reply' ||
    action.action_type === 'email_compose' ||
    action.action_type === 'followup' ||
    action.action_type === 'calendar_create';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalContainer}
      >
        {/* Backdrop */}
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Sheet */}
        <View style={[styles.sheet, { backgroundColor: themeColors.bgElevated }]}>
          {/* Handle */}
          <View style={sheetHandle} />

          {/* Header */}
          <View style={[styles.header, { borderBottomColor: themeColors.separator }]}>
            <View style={styles.headerLeft}>
              {renderIcon()}
              <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>{getActionTypeLabel()}</Text>
            </View>
            {canEdit && (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setIsEditing(!isEditing)}
              >
                <Text style={[styles.editButtonText, { color: themeColors.accent }]}>
                  {isEditing ? 'Done' : 'Edit'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Content */}
          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {renderContent()}
          </ScrollView>

          {/* Actions */}
          <View style={[styles.actions, { borderTopColor: themeColors.separator }]}>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={handleDismiss}
              disabled={isLoading}
            >
              <Text style={[styles.dismissText, { color: themeColors.textSecondary }]}>Dismiss</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.approveButton, { backgroundColor: themeColors.accent }, isLoading && styles.approveButtonLoading]}
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.41,
  },
  editButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  editButtonText: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.accent,
    letterSpacing: -0.41,
  },
  scrollView: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  contentSection: {
    marginBottom: spacing.lg,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  fieldLabel: {
    width: 32,
    fontSize: 15,
    fontWeight: '400',
    color: colors.textTertiary,
    letterSpacing: -0.24,
  },
  fieldValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
    letterSpacing: -0.24,
  },
  bodySection: {
    marginTop: spacing.md,
  },
  bodyText: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 24,
    letterSpacing: -0.41,
  },
  bodyInput: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 24,
    letterSpacing: -0.41,
    minHeight: 120,
    textAlignVertical: 'top',
    padding: spacing.md,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.md,
  },
  eventTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: 0.38,
    marginBottom: spacing.sm,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  eventTime: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.24,
  },
  eventLocation: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.24,
  },
  titleInput: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    padding: spacing.md,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  locationInput: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
    padding: spacing.md,
    backgroundColor: colors.fill,
    borderRadius: borderRadius.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  dismissButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  dismissText: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: -0.41,
  },
  approveButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.lg,
    minWidth: 100,
    alignItems: 'center',
  },
  approveButtonLoading: {
    opacity: 0.7,
  },
  approveText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.41,
  },
});
