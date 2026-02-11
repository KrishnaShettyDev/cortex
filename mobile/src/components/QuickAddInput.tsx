import React, { useState, useCallback } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, gradients, spacing, borderRadius, useTheme } from '../theme';
import { chatService } from '../services/chat';
import { integrationsService, CreateCalendarEventRequest } from '../services/integrations';
import { EventConfirmationModal, ParsedEvent } from './EventConfirmationModal';
import { PendingAction } from '../types';
import { logger } from '../utils/logger';

interface QuickAddInputProps {
  selectedDate: Date;
  onEventCreated: () => void;
}

export const QuickAddInput: React.FC<QuickAddInputProps> = ({
  selectedDate,
  onEventCreated,
}) => {
  const { colors: themeColors, gradients: themeGradients } = useTheme();
  const [inputText, setInputText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [parsedEvent, setParsedEvent] = useState<ParsedEvent | null>(null);

  const formatDateContext = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const extractEventFromAction = (action: PendingAction): ParsedEvent | null => {
    if (action.tool !== 'create_calendar_event') return null;

    const args = action.arguments;
    return {
      title: args.title || 'Untitled Event',
      start_time: args.start_time,
      end_time: args.end_time,
      location: args.location,
      description: args.description,
      attendees: args.attendees,
    };
  };

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isParsing) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();
    setIsParsing(true);
    setParsedEvent(null);

    const contextDate = formatDateContext(selectedDate);
    const prompt = `Parse this into a calendar event and create it: "${text}". Context: the user is looking at ${contextDate} on their calendar. If no specific date is mentioned, assume they mean ${contextDate}. If no duration is specified, default to 1 hour.`;

    let foundEvent: ParsedEvent | null = null;

    try {
      await chatService.chatStream(prompt, undefined, {
        onPendingActions: (actions) => {
          // Find create_calendar_event action
          for (const action of actions) {
            const event = extractEventFromAction(action);
            if (event) {
              foundEvent = event;
              break;
            }
          }
        },
        onComplete: () => {
          if (foundEvent) {
            setParsedEvent(foundEvent);
            setShowModal(true);
          }
          setIsParsing(false);
        },
        onError: (error) => {
          logger.error('Error parsing event:', error);
          setIsParsing(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      });
    } catch (error) {
      logger.error('Error sending to chat service:', error);
      setIsParsing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [inputText, isParsing, selectedDate]);

  const handleConfirm = useCallback(async (event: ParsedEvent) => {
    setIsCreating(true);

    try {
      const request: CreateCalendarEventRequest = {
        title: event.title,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        description: event.description,
        attendees: event.attendees?.map((a) => a.email),
        send_notifications: true,
      };

      const response = await integrationsService.createCalendarEvent(request);

      if (response.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setInputText('');
        setShowModal(false);
        setParsedEvent(null);
        onEventCreated();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        logger.error('Failed to create event:', response.error);
      }
    } catch (error) {
      logger.error('Error creating event:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCreating(false);
    }
  }, [onEventCreated]);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setParsedEvent(null);
  }, []);

  return (
    <>
      <View style={[styles.container, { backgroundColor: themeColors.bgPrimary, borderTopColor: themeColors.glassBorder }]}>
        <View style={[styles.inputWrapper, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }]}>
          <Ionicons
            name="calendar-outline"
            size={20}
            color={themeColors.textTertiary}
            style={styles.inputIcon}
          />
          <TextInput
            style={[styles.input, { color: themeColors.textPrimary }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Add event... &quot;Meeting at 3pm&quot;"
            placeholderTextColor={themeColors.textTertiary}
            editable={!isParsing}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          {isParsing && (
            <ActivityIndicator
              size="small"
              color={themeColors.accent}
              style={styles.loadingIndicator}
            />
          )}
        </View>

        <TouchableOpacity
          onPress={handleSend}
          disabled={!inputText.trim() || isParsing}
          style={styles.sendButton}
        >
          <LinearGradient
            colors={
              inputText.trim() && !isParsing
                ? themeGradients.primary
                : [themeColors.bgTertiary, themeColors.bgTertiary]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendGradient}
          >
            <Ionicons
              name="arrow-up"
              size={20}
              color={inputText.trim() && !isParsing ? '#fff' : themeColors.textTertiary}
            />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <EventConfirmationModal
        visible={showModal}
        event={parsedEvent}
        isLoading={false}
        isCreating={isCreating}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    minHeight: 48,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  loadingIndicator: {
    marginLeft: spacing.sm,
  },
  sendButton: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  sendGradient: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default QuickAddInput;
