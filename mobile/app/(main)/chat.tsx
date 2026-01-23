import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  RefreshControl,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  GradientIcon,
  ChatBubble,
  SuggestionPill,
  SuggestActionsButton,
  AccountSwitcher,
  LoadingDots,
  ThinkingStatus,
  InlineActionReview,
  ActionData,
  EmailActionData,
  CalendarActionData,
  FloatingActionButton,
  ReasoningSteps,
} from '../../src/components';
import { useAuth } from '../../src/context/AuthContext';
import { chatService, speechService, api, StatusUpdate } from '../../src/services';
import { ChatMessage, PendingAction, MemoryReference } from '../../src/types';
import { colors, gradients, spacing, borderRadius } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { useChatSuggestions, useGreeting } from '../../src/hooks/useChat';
import { useAppStore } from '../../src/stores/appStore';
import { SkeletonChip } from '../../src/components/Skeleton';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';

export default function ChatScreen() {
  const { user } = useAuth();
  const posthog = usePostHog();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isFocused, setIsFocused] = useState(false);
  const flashListRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const { chatDraft, setChatDraft } = useAppStore();

  // Use React Query for greeting
  const { data: greetingData, refetch: refetchGreeting } = useGreeting();

  // Use React Query for suggestions
  const {
    data: suggestionsData,
    isLoading: suggestionsLoading,
    refetch: refetchSuggestions,
  } = useChatSuggestions();

  const suggestions = suggestionsData?.suggestions || [];
  const suggestionsLoaded = !suggestionsLoading;

  // State to control when suggestions are visible (only after clicking Suggest actions)
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Pull-to-refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initialize input from draft
  useEffect(() => {
    if (chatDraft && !inputText) {
      setInputText(chatDraft);
    }
  }, []);

  // Save draft on change
  useEffect(() => {
    setChatDraft(inputText);
  }, [inputText, setChatDraft]);

  // Auto-refresh suggestions when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refetchSuggestions();
    }, [refetchSuggestions])
  );

  // Auto-refresh suggestions when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        refetchSuggestions();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refetchSuggestions]);

  // Pulse animation for recording
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // Dynamic greeting from API, fallback to simple time-based
  const getGreeting = () => {
    if (greetingData?.greeting) {
      return greetingData.greeting;
    }
    // Fallback while loading
    const hour = new Date().getHours();
    const firstName = user?.name?.split(' ')[0] || '';
    if (hour < 12) return `Morning, ${firstName}.`;
    if (hour < 17) return `Afternoon, ${firstName}.`;
    return `Evening, ${firstName}.`;
  };

  // Handle suggest actions button - toggles suggestions visibility
  const handleSuggestActions = useCallback(async () => {
    if (showSuggestions) {
      // If already showing, hide them
      setShowSuggestions(false);
    } else {
      // Show and refresh suggestions
      setShowSuggestions(true);
      await refetchSuggestions();
    }
  }, [showSuggestions, refetchSuggestions]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchSuggestions(), refetchGreeting()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchSuggestions, refetchGreeting]);

  // Action review state - now inline in chat
  const [actionToReview, setActionToReview] = useState<ActionData | null>(null);
  const [currentPendingAction, setCurrentPendingAction] = useState<PendingAction | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Real-time streaming state
  const [streamingSteps, setStreamingSteps] = useState<StatusUpdate[]>([]);
  const [streamingContent, setStreamingContent] = useState<string>('');

  // Convert pending action from API to ActionData for inline review
  const convertToActionData = (pending: PendingAction): ActionData | undefined => {
    if (pending.tool === 'send_email') {
      const args = pending.arguments;
      const recipients = args.to || [];
      const toEmail = recipients.length > 0 ? recipients[0].email : '';
      return {
        type: 'email',
        to: toEmail,
        subject: args.subject || '',
        body: args.body || '',
        cc: args.cc?.map((r: any) => r.email).join(', '),
      } as EmailActionData;
    } else if (pending.tool === 'create_calendar_event') {
      const args = pending.arguments;
      return {
        type: 'calendar',
        title: args.title || '',
        datetime: args.start_time || '',
        location: args.location,
        description: args.description,
        attendees: args.attendees?.map((a: any) => a.email),
      } as CalendarActionData;
    }
    return undefined;
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || inputText;
    if (!messageText.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setStreamingSteps([]);
    setStreamingContent('');
    setShowSuggestions(false); // Hide suggestions when sending a message

    // Scroll to bottom
    setTimeout(() => {
      flashListRef.current?.scrollToEnd({ animated: true });
    }, 50);

    try {
      // Use streaming chat for real-time updates
      let memoriesFound: MemoryReference[] = [];
      let pendingActionsFound: PendingAction[] = [];
      let reasoningStepsCollected: StatusUpdate[] = [];
      let fullContent = '';
      let convId = conversationId || '';

      await chatService.chatStream(messageText, conversationId, {
        onSearchingMemories: () => {
          // Legacy callback - now handled by onStatus
        },
        onMemoriesFound: (memories) => {
          memoriesFound = memories;
        },
        onStatus: (status) => {
          // Collect reasoning steps to show with the response
          logger.log('Received status:', status);
          reasoningStepsCollected.push(status);
          setStreamingSteps((prev) => [...prev, status]);
          // Scroll to show new steps
          flashListRef.current?.scrollToEnd({ animated: true });
        },
        onContent: (chunk, total) => {
          fullContent = total;
          // Keep steps visible while content streams - they'll be cleared on complete
          setStreamingContent(total);
          // Scroll as content comes in
          flashListRef.current?.scrollToEnd({ animated: true });
        },
        onPendingActions: (actions) => {
          pendingActionsFound = actions;
        },
        onComplete: (response) => {
          convId = response.conversation_id;
          setStreamingSteps([]);
          setStreamingContent('');
          setIsLoading(false);

          // Track message sent
          posthog?.capture(ANALYTICS_EVENTS.MESSAGE_SENT, {
            message_length: messageText.length,
            has_memories: (response.memories_used?.length || 0) > 0,
            memories_count: response.memories_used?.length || 0,
            has_pending_actions: (response.pending_actions?.length || 0) > 0,
            pending_actions_count: response.pending_actions?.length || 0,
          });

          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response.response,
            memoriesUsed: response.memories_used,
            pendingActions: response.pending_actions,
            reasoningSteps: reasoningStepsCollected,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, assistantMessage]);
          setConversationId(convId);

          // If there are pending actions, show the inline review for the first one
          if (response.pending_actions && response.pending_actions.length > 0) {
            const firstPending = response.pending_actions[0];
            const reviewAction = convertToActionData(firstPending);
            if (reviewAction) {
              setCurrentPendingAction(firstPending);
              setActionToReview(reviewAction);
              setTimeout(() => {
                flashListRef.current?.scrollToEnd({ animated: true });
              }, 100);
            }
          }
        },
        onError: (error) => {
          logger.error('Stream error:', error);
          setStreamingSteps([]);
          setStreamingContent('');
          setIsLoading(false);

          const errorMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `I couldn't process that. ${error || 'Please try again.'}`,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMessage]);
        },
      });
    } catch (error: any) {
      logger.error('sendMessage error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I couldn't process that. ${error.message || 'Please try again.'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStreamingSteps([]);
      setStreamingContent('');
      setIsLoading(false);
    }
  };

  const handleMicPress = async () => {
    if (isRecording) {
      setIsRecording(false);
      const result = await speechService.stopRecording();

      if (result && result.uri) {
        posthog?.capture(ANALYTICS_EVENTS.VOICE_RECORDING_COMPLETED, { context: 'chat' });
        processVoiceInputForChat(result.uri).catch((error) => {
          logger.error('Voice input error:', error);
        });
      }
    } else {
      const started = await speechService.startRecording();
      if (started) {
        setIsRecording(true);
        posthog?.capture(ANALYTICS_EVENTS.VOICE_RECORDING_STARTED, { context: 'chat' });
      } else {
        Alert.alert(
          'Microphone Access',
          'Please enable microphone access in Settings to record voice notes.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const processVoiceInputForChat = async (audioUri: string) => {
    try {
      // First phase: transcribing voice (don't show assistant-side loading)
      setIsTranscribing(true);
      logger.log('Voice: Transcribing audio...');

      const uploadResult = await api.uploadAudioWithTranscription(audioUri);
      const transcription = uploadResult.transcription?.trim();

      // Done transcribing
      setIsTranscribing(false);

      if (transcription) {
        logger.log('Voice: Transcription received:', transcription);
        // Use the regular sendMessage which now supports streaming
        sendMessage(transcription);
      } else {
        logger.log('Voice: Transcription was empty');
        Alert.alert('Could not understand', 'Please try speaking again.');
      }
    } catch (error: any) {
      logger.error('Voice input error:', error);
      Alert.alert('Error', 'Failed to process voice input. Please try again.');
      setIsTranscribing(false);
      setIsLoading(false);
    }
  };

  const handleSendPress = () => {
    if (inputText.trim()) {
      sendMessage();
    } else {
      handleMicPress();
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setConversationId(undefined);
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages, isLoading]);

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  // Close suggestions when scrolling chat
  const handleScroll = useCallback(() => {
    if (showSuggestions) {
      setShowSuggestions(false);
    }
  }, [showSuggestions]);

  // Render suggestion pills as floating overlay above input
  const renderSuggestionsOverlay = () => {
    if (!showSuggestions) return null;

    return (
      <View style={styles.suggestionsOverlay}>
        {suggestionsLoaded ? (
          suggestions.map((suggestion, index) => (
            <SuggestionPill
              key={index}
              text={suggestion.text}
              services={suggestion.services}
              onPress={() => {
                posthog?.capture(ANALYTICS_EVENTS.SUGGESTION_TAPPED, {
                  suggestion_text: suggestion.text,
                  services: suggestion.services,
                });
                sendMessage(suggestion.text);
                setShowSuggestions(false);
              }}
            />
          ))
        ) : (
          <>
            <SkeletonChip width={300} />
            <SkeletonChip width={280} />
            <SkeletonChip width={260} />
          </>
        )}
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.greetingText}>
        {getGreeting()}
      </Text>
    </View>
  );

  const handleReviewAction = (pendingAction: PendingAction) => {
    logger.log('handleReviewAction called with:', JSON.stringify(pendingAction));
    const actionData = convertToActionData(pendingAction);
    logger.log('convertToActionData returned:', JSON.stringify(actionData));
    if (actionData) {
      setCurrentPendingAction(pendingAction);
      setActionToReview(actionData);
      // Scroll to bottom to show the inline review
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } else {
      logger.warn('Could not convert pending action to action data');
      Alert.alert('Error', 'Unable to review this action type');
    }
  };

  // Handle confirm action from inline review
  const handleConfirmAction = async (editedAction: ActionData) => {
    if (!currentPendingAction) return;
    setIsActionLoading(true);
    try {
      // Update the pending action arguments with edited values
      const updatedArgs = editedAction.type === 'email'
        ? {
            ...currentPendingAction.arguments,
            to: [{ email: (editedAction as EmailActionData).to }],
            subject: (editedAction as EmailActionData).subject,
            body: (editedAction as EmailActionData).body,
          }
        : {
            ...currentPendingAction.arguments,
            title: (editedAction as CalendarActionData).title,
            start_time: (editedAction as CalendarActionData).datetime,
            location: (editedAction as CalendarActionData).location,
          };

      const result = await chatService.executeAction(
        currentPendingAction.action_id,
        currentPendingAction.tool,
        updatedArgs
      );

      if (result.success) {
        // Track action approved
        posthog?.capture(ANALYTICS_EVENTS.ACTION_APPROVED, {
          action_type: editedAction.type,
          tool: currentPendingAction.tool,
        });

        const successMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: editedAction.type === 'email'
            ? 'Email sent successfully.'
            : 'Event created successfully.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, successMessage]);
        setActionToReview(null);
        setCurrentPendingAction(null);
      } else {
        Alert.alert('Error', result.message || 'Action failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to execute action');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Handle cancel action from inline review
  const handleCancelAction = () => {
    // Track action rejected
    posthog?.capture(ANALYTICS_EVENTS.ACTION_REJECTED, {
      action_type: actionToReview?.type || 'unknown',
      tool: currentPendingAction?.tool || 'unknown',
    });

    setActionToReview(null);
    setCurrentPendingAction(null);
    const cancelMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Action cancelled.',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, cancelMessage]);
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isUser = item.role === 'user';
    const showTimestamp = index === 0 ||
      (messages[index - 1] &&
       new Date(item.timestamp).getTime() - new Date(messages[index - 1].timestamp).getTime() > 300000);

    return (
      <View style={styles.messageContainer}>
        {showTimestamp && (
          <Text style={[
            styles.messageTimestamp,
            isUser && styles.messageTimestampRight
          ]}>
            {formatTimestamp(new Date(item.timestamp))}
          </Text>
        )}
        <ChatBubble
          message={item}
          onReviewAction={handleReviewAction}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <GradientIcon size={28} />

          <View style={{ flex: 1 }} />

          <AccountSwitcher
            email={user?.email}
            onPress={() => router.push('/(main)/settings')}
          />

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            onPress={clearConversation}
            disabled={messages.length === 0}
            style={[styles.headerButton, { opacity: messages.length === 0 ? 0.3 : 1 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {/* @ts-ignore - FlashList types issue with estimatedItemSize prop */}
        <FlashList<ChatMessage>
          ref={flashListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          ListEmptyComponent={renderEmptyState}
          onScrollBeginDrag={handleScroll}
          extraData={{ streamingSteps, streamingContent, isLoading }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
            />
          }
          {...{ estimatedItemSize: 100 } as any}
          ListFooterComponent={
            <View style={styles.footerContainer}>
              {/* Real-time reasoning steps */}
              {streamingSteps.length > 0 && (
                <ReasoningSteps steps={streamingSteps} />
              )}
              {/* Streaming content as it arrives */}
              {streamingContent && (
                <Text style={styles.streamingText}>{streamingContent}</Text>
              )}
              {/* Loading dots when waiting for stream to start */}
              {isLoading && streamingSteps.length === 0 && !streamingContent && <LoadingDots />}
              {/* Inline action review */}
              {actionToReview && (
                <View style={styles.inlineReviewContainer}>
                  <InlineActionReview
                    action={actionToReview}
                    onConfirm={handleConfirmAction}
                    onCancel={handleCancelAction}
                    isLoading={isActionLoading}
                  />
                </View>
              )}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />

        {/* Recording indicator */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording... Tap mic to stop</Text>
          </View>
        )}

        {/* Transcribing indicator - Glassmorphic iOS style */}
        {isTranscribing && (
          <BlurView intensity={80} tint="dark" style={styles.transcribingContainer}>
            <View style={styles.transcribingContent}>
              <View style={styles.transcribingPulse}>
                <Animated.View style={[styles.transcribingDot, { transform: [{ scale: pulseAnim }] }]} />
              </View>
              <Text style={styles.transcribingText}>Transcribing...</Text>
            </View>
          </BlurView>
        )}

        {/* Suggestions overlay - appears when button clicked */}
        {renderSuggestionsOverlay()}

        {/* Suggest actions button - fixed above input */}
        {!isLoading && !actionToReview && !isRecording && !isTranscribing && (
          <View style={styles.suggestButtonContainer}>
            <SuggestActionsButton onPress={handleSuggestActions} />
          </View>
        )}

        {/* Input Bar with FAB */}
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.inputRow}>
            <View style={[
              styles.inputWrapper,
              isFocused && styles.inputWrapperFocused
            ]}>
              <TextInput
                style={styles.input}
                placeholder="Ask Cortex..."
                placeholderTextColor={colors.textTertiary}
                value={inputText}
                onChangeText={setInputText}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                multiline
                maxLength={1000}
                editable={!isRecording && !isTranscribing}
                blurOnSubmit={false}
              />
              {/* Mic/Send button inside input */}
              <TouchableOpacity
                style={[
                  styles.inlineButton,
                  isRecording && styles.recordingButton,
                ]}
                onPress={handleSendPress}
                disabled={isLoading}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
              >
                <Animated.View style={{ transform: [{ scale: isRecording ? pulseAnim : 1 }] }}>
                  {inputText.trim() ? (
                    <LinearGradient
                      colors={gradients.accent}
                      style={styles.inlineButtonGradient}
                    >
                      <Ionicons name="arrow-up" size={18} color={colors.bgPrimary} />
                    </LinearGradient>
                  ) : (
                    <View style={[
                      styles.micButton,
                      isRecording && styles.micButtonRecording
                    ]}>
                      <Ionicons
                        name={isRecording ? 'stop' : 'mic'}
                        size={20}
                        color={isRecording ? colors.textPrimary : colors.textSecondary}
                      />
                    </View>
                  )}
                </Animated.View>
              </TouchableOpacity>
            </View>
            {/* Add Context FAB */}
            <FloatingActionButton
              icon="add"
              onPress={() => router.push('/(main)/add-memory')}
              size={48}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  keyboardView: {
    flex: 1,
  },
  // Header - Iris style
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerButton: {
    padding: spacing.xs,
  },
  clearText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '400',
  },
  // Messages list
  messagesList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  messageContainer: {
    marginBottom: spacing.md,
  },
  messageTimestamp: {
    fontSize: 12,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  messageTimestampRight: {
    textAlign: 'right',
  },
  // Empty state - Iris style
  emptyState: {
    paddingTop: spacing.sm,
  },
  greetingText: {
    fontSize: 24,
    fontWeight: '400',
    color: colors.textPrimary,
    lineHeight: 32,
    marginBottom: spacing.xl,
  },
  // Suggest button container - fixed position above input
  suggestButtonContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  // Suggestions overlay - appears above the suggest button
  suggestionsOverlay: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary,
    gap: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  recordingText: {
    color: colors.error,
    fontSize: 14,
  },
  transcribingContainer: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  transcribingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.glassBackground,
  },
  transcribingPulse: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcribingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  transcribingText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  // Input container with FAB
  inputContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: '#000000',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.full,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 48,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  inputWrapperFocused: {
    borderColor: colors.accent,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: spacing.xs,
  },
  inlineButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  inlineButtonGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  micButtonRecording: {
    backgroundColor: colors.error,
  },
  recordingButton: {
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  // Footer
  footerContainer: {
    paddingTop: spacing.sm,
  },
  inlineReviewContainer: {
    marginTop: spacing.sm,
  },
  streamingText: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
});
