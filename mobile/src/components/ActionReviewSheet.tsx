import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BottomSheet } from './BottomSheet';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import { colors, spacing, borderRadius, gradients, useTheme } from '../theme';

export interface EmailAction {
  type: 'email';
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface CalendarAction {
  type: 'calendar';
  title: string;
  datetime: string;
  attendees?: string[];
  location?: string;
  description?: string;
}

export type ReviewAction = EmailAction | CalendarAction;

interface ActionReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  action: ReviewAction | null;
  onConfirm: (editedAction: ReviewAction) => void;
  onEdit?: () => void;
  isLoading?: boolean;
}

export function ActionReviewSheet({
  visible,
  onClose,
  action,
  onConfirm,
  isLoading = false,
}: ActionReviewSheetProps) {
  const { colors: themeColors, gradients: themeGradients } = useTheme();
  const [isEditing, setIsEditing] = useState(false);

  // Email state
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailCc, setEmailCc] = useState('');

  // Calendar state
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarDatetime, setCalendarDatetime] = useState('');
  const [calendarLocation, setCalendarLocation] = useState('');
  const [calendarDescription, setCalendarDescription] = useState('');
  const [calendarAttendees, setCalendarAttendees] = useState('');

  // Initialize state when action changes
  useEffect(() => {
    if (action) {
      if (action.type === 'email') {
        setEmailTo(action.to || '');
        setEmailSubject(action.subject || '');
        setEmailBody(action.body || '');
        setEmailCc(action.cc || '');
      } else {
        setCalendarTitle(action.title || '');
        setCalendarDatetime(action.datetime || '');
        setCalendarLocation(action.location || '');
        setCalendarDescription(action.description || '');
        setCalendarAttendees(action.attendees?.join(', ') || '');
      }
      setIsEditing(false);
    }
  }, [action]);

  // Derived values - use defaults when action is null
  const isEmail = action?.type === 'email';
  const actionTitle = isEmail ? 'Send Email' : 'Create Event';
  const confirmText = isEmail ? 'Send' : 'Create';

  const handleConfirm = () => {
    let editedAction: ReviewAction;

    if (isEmail) {
      editedAction = {
        type: 'email',
        to: emailTo,
        subject: emailSubject,
        body: emailBody,
        cc: emailCc || undefined,
      };
    } else {
      editedAction = {
        type: 'calendar',
        title: calendarTitle,
        datetime: calendarDatetime,
        location: calendarLocation || undefined,
        description: calendarDescription || undefined,
        attendees: calendarAttendees ? calendarAttendees.split(',').map(a => a.trim()) : undefined,
      };
    }

    onConfirm(editedAction);
  };

  const toggleEdit = () => {
    setIsEditing(!isEditing);
  };

  const renderEmailContent = () => {
    if (isEditing) {
      return (
        <View style={styles.content}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>To</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={emailTo}
              onChangeText={setEmailTo}
              placeholder="recipient@email.com"
              placeholderTextColor={themeColors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>CC (optional)</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={emailCc}
              onChangeText={setEmailCc}
              placeholder="cc@email.com"
              placeholderTextColor={themeColors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Subject</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder="Email subject"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Body</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={emailBody}
              onChangeText={setEmailBody}
              placeholder="Email body"
              placeholderTextColor={themeColors.textTertiary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <View style={styles.subjectRow}>
          <Text style={[styles.subjectLabel, { color: themeColors.textSecondary }]}>To:</Text>
          <Text style={[styles.subjectValue, { color: themeColors.textPrimary }]}>{emailTo}</Text>
        </View>
        {emailCc ? (
          <View style={styles.subjectRow}>
            <Text style={[styles.subjectLabel, { color: themeColors.textSecondary }]}>CC:</Text>
            <Text style={[styles.subjectValue, { color: themeColors.textPrimary }]}>{emailCc}</Text>
          </View>
        ) : null}
        <View style={styles.subjectRow}>
          <Text style={[styles.subjectLabel, { color: themeColors.textSecondary }]}>Subject:</Text>
          <Text style={[styles.subjectValue, { color: themeColors.textPrimary }]}>{emailSubject}</Text>
        </View>
        <View style={[styles.bodyDivider, { backgroundColor: themeColors.glassBorder }]} />
        <ScrollView
          style={styles.bodyContainer}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <Text style={[styles.bodyText, { color: themeColors.textPrimary }]}>{emailBody}</Text>
        </ScrollView>
      </View>
    );
  };

  const renderCalendarContent = () => {
    if (isEditing) {
      return (
        <View style={styles.content}>
          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Event Title</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={calendarTitle}
              onChangeText={setCalendarTitle}
              placeholder="Event title"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Date & Time</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={calendarDatetime}
              onChangeText={setCalendarDatetime}
              placeholder="e.g., Tomorrow at 3pm"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Location (optional)</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={calendarLocation}
              onChangeText={setCalendarLocation}
              placeholder="Event location"
              placeholderTextColor={themeColors.textTertiary}
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Attendees (comma-separated)</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={calendarAttendees}
              onChangeText={setCalendarAttendees}
              placeholder="email1@example.com, email2@example.com"
              placeholderTextColor={themeColors.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.editField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Description (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput, { backgroundColor: themeColors.bgTertiary, color: themeColors.textPrimary, borderColor: themeColors.glassBorder }]}
              value={calendarDescription}
              onChangeText={setCalendarDescription}
              placeholder="Event description"
              placeholderTextColor={themeColors.textTertiary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        <Text style={[styles.eventTitle, { color: themeColors.textPrimary }]}>{calendarTitle}</Text>
        <View style={styles.eventDetails}>
          <View style={styles.eventDetailRow}>
            <Ionicons name="time-outline" size={16} color={themeColors.textSecondary} />
            <Text style={[styles.eventDetailText, { color: themeColors.textSecondary }]}>{calendarDatetime}</Text>
          </View>
          {calendarLocation ? (
            <View style={styles.eventDetailRow}>
              <Ionicons name="location-outline" size={16} color={themeColors.textSecondary} />
              <Text style={[styles.eventDetailText, { color: themeColors.textSecondary }]}>{calendarLocation}</Text>
            </View>
          ) : null}
          {calendarAttendees ? (
            <View style={styles.eventDetailRow}>
              <Ionicons name="people-outline" size={16} color={themeColors.textSecondary} />
              <Text style={[styles.eventDetailText, { color: themeColors.textSecondary }]}>{calendarAttendees}</Text>
            </View>
          ) : null}
          {calendarDescription ? (
            <View style={styles.eventDetailRow}>
              <Ionicons name="document-text-outline" size={16} color={themeColors.textSecondary} />
              <Text style={[styles.eventDetailText, { color: themeColors.textSecondary }]}>{calendarDescription}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  // Always render BottomSheet to properly handle animation lifecycle
  // Content is conditionally rendered based on action presence
  return (
    <BottomSheet visible={visible && !!action} onClose={onClose} height="auto">
      {action && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.container}>
              <View style={styles.headerRow}>
                <Text style={[styles.header, { color: themeColors.textPrimary }]}>
                  {isEditing ? 'Edit Action' : 'Review Action'}
                </Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <Ionicons name="close" size={24} color={themeColors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={[styles.actionCard, { backgroundColor: themeColors.glassBackground, borderColor: themeColors.glassBorder }]}>
                {/* Service Header */}
                <View style={[styles.serviceHeader, { borderBottomColor: themeColors.glassBorder }]}>
                  <View style={[styles.serviceIconBg, { backgroundColor: isEmail ? '#EA433515' : '#4285F415' }]}>
                    {isEmail ? <GmailIcon size={22} /> : <GoogleCalendarIcon size={22} />}
                  </View>
                  <View style={styles.serviceHeaderText}>
                    <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>{actionTitle}</Text>
                    {isEmail && !isEditing && (
                      <Text style={[styles.recipientText, { color: themeColors.textSecondary }]}>To: {emailTo}</Text>
                    )}
                  </View>
                </View>

                {/* Content */}
                {isEmail ? renderEmailContent() : renderCalendarContent()}

                {/* Edit Button */}
                <TouchableOpacity
                  style={[
                    styles.editButton,
                    { borderTopColor: themeColors.glassBorder, backgroundColor: themeColors.bgTertiary },
                    isEditing && { backgroundColor: themeColors.accent + '15' }
                  ]}
                  onPress={toggleEdit}
                >
                  <Ionicons
                    name={isEditing ? 'checkmark-circle-outline' : 'pencil-outline'}
                    size={16}
                    color={isEditing ? themeColors.accent : themeColors.textSecondary}
                  />
                  <Text style={[styles.editButtonText, { color: themeColors.textSecondary }, isEditing && { color: themeColors.accent }]}>
                    {isEditing ? 'Done Editing' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Action Buttons */}
              <View style={styles.buttons}>
                <TouchableOpacity
                  style={[styles.cancelButton, { backgroundColor: themeColors.glassBackground, borderColor: themeColors.glassBorder }]}
                  onPress={onClose}
                  disabled={isLoading}
                >
                  <Text style={[styles.cancelButtonText, { color: themeColors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, isEditing && styles.confirmButtonDisabled]}
                  onPress={handleConfirm}
                  disabled={isLoading || isEditing}
                >
                  {isLoading ? (
                    <View style={[styles.loadingContainer, { backgroundColor: themeColors.bgTertiary }]}>
                      <ActivityIndicator size="small" color={themeColors.textPrimary} />
                    </View>
                  ) : (
                    <LinearGradient
                      colors={isEditing ? [themeColors.bgTertiary, themeColors.bgTertiary] : themeGradients.accent}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.confirmButtonGradient}
                    >
                      <Text style={[styles.confirmButtonText, { color: themeColors.textPrimary }, isEditing && { color: themeColors.textSecondary }]}>
                        {confirmText}
                      </Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    maxHeight: 600,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  header: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
    marginRight: -spacing.xs,
  },
  actionCard: {
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  serviceIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceHeaderText: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  recipientText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  content: {
    padding: spacing.md,
  },
  subjectRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  subjectLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    minWidth: 60,
  },
  subjectValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  bodyDivider: {
    height: 1,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.md,
  },
  bodyContainer: {
    maxHeight: 150,
  },
  bodyText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  eventTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  eventDetails: {
    gap: spacing.sm,
  },
  eventDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  eventDetailText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  editField: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  textInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  multilineInput: {
    minHeight: 100,
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
  editButtonActive: {
    backgroundColor: colors.accent + '15',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  editButtonTextActive: {
    color: colors.accent,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.glassBackground,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.md + 2,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  confirmButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonGradient: {
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  confirmButtonTextDisabled: {
    color: colors.textSecondary,
  },
  loadingContainer: {
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
  },
});
