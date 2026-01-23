import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, gradients, spacing, borderRadius } from '../theme';

export interface ParsedEvent {
  title: string;
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  location?: string;
  description?: string;
  attendees?: { email: string; name?: string }[];
}

interface EventConfirmationModalProps {
  visible: boolean;
  event: ParsedEvent | null;
  isLoading: boolean;
  isCreating: boolean;
  onConfirm: (event: ParsedEvent) => void;
  onCancel: () => void;
}

export const EventConfirmationModal: React.FC<EventConfirmationModalProps> = ({
  visible,
  event,
  isLoading,
  isCreating,
  onConfirm,
  onCancel,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [editedEvent, setEditedEvent] = useState<ParsedEvent | null>(null);

  // Reset edit state when event changes
  useEffect(() => {
    if (event) {
      setEditedEvent({ ...event });
      setEditMode(false);
    }
  }, [event]);

  if (!event) return null;

  const displayEvent = editMode ? editedEvent : event;
  if (!displayEvent) return null;

  const startDate = new Date(displayEvent.start_time);
  const endDate = new Date(displayEvent.end_time);

  const formatDate = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const handleConfirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm(displayEvent);
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  const toggleEditMode = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditMode(!editMode);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <Pressable style={styles.overlay} onPress={onCancel}>
          <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.loadingText}>Parsing your event...</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.headerIcon}>
                    <Ionicons name="calendar" size={24} color="#4285F4" />
                  </View>
                  <Text style={styles.headerTitle}>
                    {editMode ? 'Edit Event' : 'Create Event'}
                  </Text>
                  <TouchableOpacity style={styles.closeButton} onPress={onCancel}>
                    <Ionicons name="close" size={24} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Event Details */}
                {editMode ? (
                  // Edit Mode
                  <View style={styles.editForm}>
                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>Title</Text>
                      <TextInput
                        style={styles.textInput}
                        value={editedEvent?.title}
                        onChangeText={(text) =>
                          setEditedEvent((prev) => prev ? { ...prev, title: text } : null)
                        }
                        placeholder="Event title"
                        placeholderTextColor={colors.textTertiary}
                      />
                    </View>

                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>Date & Time</Text>
                      <Text style={styles.dateTimePreview}>
                        {formatDate(startDate)}, {formatTime(startDate)} - {formatTime(endDate)}
                      </Text>
                      <Text style={styles.dateTimeHint}>
                        Tap "Edit" on calendar to change time
                      </Text>
                    </View>

                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>Location (optional)</Text>
                      <TextInput
                        style={styles.textInput}
                        value={editedEvent?.location || ''}
                        onChangeText={(text) =>
                          setEditedEvent((prev) => prev ? { ...prev, location: text || undefined } : null)
                        }
                        placeholder="Add location"
                        placeholderTextColor={colors.textTertiary}
                      />
                    </View>

                    <View style={styles.formField}>
                      <Text style={styles.fieldLabel}>Description (optional)</Text>
                      <TextInput
                        style={[styles.textInput, styles.textArea]}
                        value={editedEvent?.description || ''}
                        onChangeText={(text) =>
                          setEditedEvent((prev) => prev ? { ...prev, description: text || undefined } : null)
                        }
                        placeholder="Add description"
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        numberOfLines={3}
                      />
                    </View>
                  </View>
                ) : (
                  // Preview Mode
                  <View style={styles.preview}>
                    <Text style={styles.eventTitle}>{displayEvent.title}</Text>

                    <View style={styles.detailRow}>
                      <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                      <Text style={styles.detailText}>
                        {formatDate(startDate)}, {formatTime(startDate)} - {formatTime(endDate)}
                      </Text>
                    </View>

                    {displayEvent.location && (
                      <View style={styles.detailRow}>
                        <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                        <Text style={styles.detailText}>{displayEvent.location}</Text>
                      </View>
                    )}

                    {displayEvent.attendees && displayEvent.attendees.length > 0 && (
                      <View style={styles.detailRow}>
                        <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
                        <Text style={styles.detailText}>
                          {displayEvent.attendees.map((a) => a.name || a.email).join(', ')}
                        </Text>
                      </View>
                    )}

                    {displayEvent.description && (
                      <View style={styles.descriptionContainer}>
                        <Text style={styles.descriptionText}>{displayEvent.description}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={toggleEditMode}
                    disabled={isCreating}
                  >
                    <Ionicons
                      name={editMode ? 'eye-outline' : 'create-outline'}
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.editButtonText}>
                      {editMode ? 'Preview' : 'Edit'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmButton}
                    onPress={handleConfirm}
                    disabled={isCreating}
                  >
                    <LinearGradient
                      colors={gradients.primary}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.confirmGradient}
                    >
                      {isCreating ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="checkmark" size={18} color="#fff" />
                          <Text style={styles.confirmButtonText}>Create Event</Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 20,
    maxHeight: '80%',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  loadingText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(66, 133, 244, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: spacing.md,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    marginBottom: spacing.lg,
  },
  eventTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  detailText: {
    fontSize: 15,
    color: colors.textSecondary,
    flex: 1,
  },
  descriptionContainer: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
  },
  descriptionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  editForm: {
    marginBottom: spacing.lg,
  },
  formField: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  textInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  dateTimePreview: {
    fontSize: 15,
    color: colors.textPrimary,
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
  },
  dateTimeHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  confirmButton: {
    flex: 2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  confirmGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});

export default EventConfirmationModal;
