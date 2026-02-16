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
  const [isFocused, setIsFocused] = useState(false);

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

  const hasText = inputText.trim().length > 0;
  const canSend = hasText && !isParsing;

  return (
    <>
      <View style={[styles.container, { backgroundColor: themeColors.bgPrimary }]}>
        <View style={[
          styles.inputWrapper,
          { backgroundColor: themeColors.fill },
          isFocused && { backgroundColor: themeColors.fillSecondary }
        ]}>
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
            placeholder='Add event... "Meeting at 3pm"'
            placeholderTextColor={themeColors.textTertiary}
            editable={!isParsing}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />

          {/* Loading indicator or Send button - inline */}
          {isParsing ? (
            <ActivityIndicator
              size="small"
              color={themeColors.accent}
              style={styles.inlineIndicator}
            />
          ) : (
            <TouchableOpacity
              onPress={handleSend}
              disabled={!canSend}
              style={styles.inlineButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {canSend ? (
                <LinearGradient
                  colors={themeGradients.accent}
                  style={styles.inlineButtonGradient}
                >
                  <Ionicons name="arrow-up" size={18} color={themeColors.bgPrimary} />
                </LinearGradient>
              ) : (
                <View style={[styles.inlineButtonInactive, { backgroundColor: themeColors.bgTertiary }]}>
                  <Ionicons name="arrow-up" size={18} color={themeColors.textTertiary} />
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 48,
    gap: spacing.sm,
  },
  inputIcon: {
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: 16,
    letterSpacing: -0.41,
    paddingVertical: spacing.sm,
  },
  inlineIndicator: {
    marginRight: spacing.sm,
  },
  inlineButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
  },
  inlineButtonGradient: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButtonInactive: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default QuickAddInput;
