/**
 * ActionReviewModal - Full action review and approval
 *
 * Shows complete action details with Edit option.
 * User can approve or dismiss from here.
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
import { BlurView } from 'expo-blur';
import {
  AutonomousAction,
  EmailPayload,
  CalendarPayload,
} from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius } from '../theme';

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
  const [isEditing, setIsEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState<Record<string, unknown>>({});

  // Reset state when action changes
  React.useEffect(() => {
    if (action) {
      setEditedPayload(action.action_payload as Record<string, unknown>);
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

  // Get action type label
  const getActionTypeLabel = () => {
    switch (action.action_type) {
      case 'email_reply':
        return 'Reply to Email';
      case 'email_compose':
        return 'Send Email';
      case 'followup':
        return 'Follow Up';
      case 'calendar_create':
        return 'Create Event';
      case 'calendar_reschedule':
        return 'Reschedule Event';
      case 'meeting_prep':
        return 'Meeting Prep';
      default:
        return 'Action';
    }
  };

  // Get approve button text
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
        return 'Got it';
      default:
        return 'Approve';
    }
  };

  // Render icon
  const renderIcon = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'email_compose':
      case 'followup':
        return <GmailIcon size={20} />;
      case 'calendar_create':
      case 'calendar_reschedule':
      case 'meeting_prep':
        return <GoogleCalendarIcon size={20} />;
      default:
        return <Ionicons name="flash" size={20} color={colors.accent} />;
    }
  };

  // Render email content
  const renderEmailContent = () => {
    const payload = (isEditing ? editedPayload : action.action_payload) as EmailPayload;

    return (
      <View style={styles.emailContent}>
        <View style={styles.emailHeader}>
          {renderIcon()}
          <Text style={styles.actionTypeLabel}>{getActionTypeLabel()}</Text>
        </View>

        <Text style={styles.emailTo}>To: {payload.to}</Text>

        {payload.subject && (
          <View style={styles.replyingTo}>
            <Text style={styles.replyingToLabel}>Replying to:</Text>
            <Text style={styles.replyingToSubject}>{payload.subject}</Text>
          </View>
        )}

        {isEditing ? (
          <TextInput
            style={styles.bodyInput}
            value={editedPayload.body as string}
            onChangeText={(text) => setEditedPayload({ ...editedPayload, body: text })}
            multiline
            placeholder="Email body"
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />
        ) : (
          <Text style={styles.emailBody}>{payload.body}</Text>
        )}
      </View>
    );
  };

  // Render calendar content
  const renderCalendarContent = () => {
    const payload = (isEditing ? editedPayload : action.action_payload) as CalendarPayload;

    return (
      <View style={styles.emailContent}>
        <View style={styles.emailHeader}>
          {renderIcon()}
          <Text style={styles.actionTypeLabel}>{getActionTypeLabel()}</Text>
        </View>

        {isEditing ? (
          <>
            <TextInput
              style={styles.titleInput}
              value={editedPayload.title as string}
              onChangeText={(text) => setEditedPayload({ ...editedPayload, title: text })}
              placeholder="Event title"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={styles.locationInput}
              value={(editedPayload.location as string) || ''}
              onChangeText={(text) => setEditedPayload({ ...editedPayload, location: text })}
              placeholder="Location (optional)"
              placeholderTextColor={colors.textTertiary}
            />
          </>
        ) : (
          <>
            <Text style={styles.eventTitle}>{payload.title}</Text>
            <Text style={styles.eventTime}>
              {new Date(payload.start_time).toLocaleString()}
            </Text>
            {payload.location && (
              <Text style={styles.eventLocation}>{payload.location}</Text>
            )}
          </>
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
      default:
        return (
          <View style={styles.emailContent}>
            <View style={styles.emailHeader}>
              {renderIcon()}
              <Text style={styles.actionTypeLabel}>{getActionTypeLabel()}</Text>
            </View>
            <Text style={styles.emailBody}>{action.description}</Text>
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
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.headerTitle}>Action Confirmation Required</Text>
            </View>
            <TouchableOpacity onPress={handleApprove} disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="checkmark" size={24} color={colors.accent} />
              )}
            </TouchableOpacity>
          </View>

          {/* Review Actions Label */}
          <Text style={styles.reviewLabel}>Review Actions</Text>

          {/* Content */}
          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.contentCard}>
              {renderContent()}

              {/* Edit Button */}
              {canEdit && (
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => setIsEditing(!isEditing)}
                >
                  <Ionicons
                    name={isEditing ? 'checkmark' : 'pencil-outline'}
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.editButtonText}>
                    {isEditing ? 'Done' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* Bottom Actions */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={handleDismiss}
              disabled={isLoading}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.approveButton}
              onPress={handleApprove}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.bgPrimary} />
              ) : (
                <Text style={styles.approveText}>{getApproveText()}</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    paddingBottom: 34, // Safe area
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  reviewLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  scrollView: {
    paddingHorizontal: spacing.lg,
  },
  contentCard: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  emailContent: {},
  emailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionTypeLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emailTo: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  replyingTo: {
    marginBottom: spacing.md,
  },
  replyingToLabel: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  replyingToSubject: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emailBody: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  bodyInput: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    minHeight: 120,
    textAlignVertical: 'top',
    padding: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  eventTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  eventTime: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  eventLocation: {
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  titleInput: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    padding: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  locationInput: {
    fontSize: 14,
    color: colors.textPrimary,
    padding: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
  },
  editButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  dismissButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dismissText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  approveButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    minWidth: 100,
    alignItems: 'center',
  },
  approveText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.bgPrimary,
  },
});
