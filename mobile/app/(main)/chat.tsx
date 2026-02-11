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
  ThinkingIndicator,
  DailyBriefing,
  DayBriefingScroll,
  ProactiveNudges,
} from '../../src/components';
import { useAuth } from '../../src/context/AuthContext';
import { chatService, speechService, api, StatusUpdate } from '../../src/services';
import { ChatMessage, PendingAction, MemoryReference, ActionTaken } from '../../src/types';
import { colors, spacing, borderRadius, useTheme } from '../../src/theme';
import { logger } from '../../src/utils/logger';
import { useChatSuggestions, useGreeting, useProactiveMessages } from '../../src/hooks/useChat';
import { useAppStore } from '../../src/stores/appStore';
import { SkeletonChip } from '../../src/components/Skeleton';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';

export default function ChatScreen() {
  const { user } = useAuth();
  const posthog = usePostHog();
  const insets = useSafeAreaInsets();
  const { colors, gradients, isDark } = useTheme();
  const {
    chatDraft,
    setChatDraft,
    chatMessages,
    addChatMessage,
    setChatMessages,
    clearChatMessages,
    lastConversationId,
    setLastConversationId,
  } = useAppStore();

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const conversationId = lastConversationId || undefined;
  const [isFocused, setIsFocused] = useState(false);
  const flashListRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

  // Use React Query for proactive messages (Poke/Iris-style)
  const { data: proactiveData, refetch: refetchProactive } = useProactiveMessages();

  // State to control when suggestions are visible (only after clicking Suggest actions)
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Track if we've loaded proactive messages this session
  const [proactiveLoaded, setProactiveLoaded] = useState(false);

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

  // Load proactive messages on mount (Poke/Iris-style: Cortex texts you first)
  useEffect(() => {
    if (proactiveData && !proactiveLoaded && chatMessages.length === 0) {
      const messages = proactiveData || [];
      if (messages.length > 0) {
        // Add recent proactive messages to chat
        const proactiveMessages: ChatMessage[] = messages.slice(0, 3).map((msg: any) => ({
          id: `proactive-${msg.id}`,
          role: 'assistant' as const,
          content: msg.content,
          timestamp: new Date(msg.created_at),
          isProactive: true,
          proactiveType: msg.message_type,
          metadata: msg.metadata,
        }));

        // Add messages in chronological order (oldest first)
        proactiveMessages.reverse().forEach((msg) => {
          addChatMessage(msg);
        });

        setProactiveLoaded(true);
        logger.log('[Chat] Loaded proactive messages:', proactiveMessages.length);
      }
    }
  }, [proactiveData, proactiveLoaded, chatMessages.length, addChatMessage]);

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
  const [currentStatus, setCurrentStatus] = useState<StatusUpdate | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>('');

  // Actions that should be shown to users for review/confirmation
  const USER_FACING_ACTIONS = [
    'send_email',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'reply_to_email',
    'reschedule_events',
  ];

  // Filter pending actions to only include user-facing ones
  const filterUserFacingActions = (actions: PendingAction[] | undefined): PendingAction[] => {
    if (!actions) return [];
    return actions.filter(a => USER_FACING_ACTIONS.includes(a.tool));
  };

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

    addChatMessage(userMessage);
    setInputText('');
    setIsLoading(true);
    // Show thinking immediately - don't wait for backend
    setCurrentStatus({ step: 'generating', message: 'Thinking' });
    setStreamingContent('');
    setShowSuggestions(false);

    // Scroll to bottom
    setTimeout(() => {
      flashListRef.current?.scrollToEnd({ animated: true });
    }, 50);

    // Safety timeout to reset loading state if stream hangs
    const safetyTimeout = setTimeout(() => {
      if (isLoading) {
        logger.warn('Chat stream timeout - resetting loading state');
        setIsLoading(false);
        setCurrentStatus(null);
        setStreamingContent('');
      }
    }, 60000); // 60 second timeout

    try {
      let memoriesFound: MemoryReference[] = [];
      let pendingActionsFound: PendingAction[] = [];
      let actionsTakenFound: ActionTaken[] = [];
      let fullContent = '';
      let convId = conversationId || '';

      // Build history from previous messages for context
      const history = (chatMessages || []).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Use chatStreamWithActions for email/calendar action support
      await chatService.chatStreamWithActions(messageText, conversationId, {
        onSearchingMemories: () => {
          // Legacy callback - now handled by onStatus
        },
        onMemoriesFound: (memories) => {
          memoriesFound = memories;
        },
        onStatus: (status) => {
          logger.log('Status update:', status);
          // Update single status indicator (not a list)
          setCurrentStatus(status);
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
        onActionsTaken: (actions) => {
          actionsTakenFound = actions;
        },
        onComplete: (response) => {
          clearTimeout(safetyTimeout);
          convId = response.conversation_id;
          setCurrentStatus(null);
          setStreamingContent('');
          setIsLoading(false);

          posthog?.capture(ANALYTICS_EVENTS.MESSAGE_SENT, {
            message_length: messageText.length,
            has_memories: (response.memories_used?.length || 0) > 0,
            memories_count: response.memories_used?.length || 0,
            has_pending_actions: (response.pending_actions?.length || 0) > 0,
            pending_actions_count: response.pending_actions?.length || 0,
          });

          // Filter to only user-facing pending actions
          const userFacingActions = filterUserFacingActions(response.pending_actions);

          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response.response,
            memoriesUsed: response.memories_used,
            pendingActions: userFacingActions.length > 0 ? userFacingActions : undefined,
            actionsTaken: response.actions_taken?.length > 0 ? response.actions_taken : undefined,
            timestamp: new Date(),
            // Cognitive layer tracking
            outcomeId: response.outcome_id,
            sources: response.sources,
          };

          addChatMessage(assistantMessage);
          setLastConversationId(convId);

          // Auto-show review for first reviewable action
          if (userFacingActions.length > 0) {
            const firstPending = userFacingActions[0];
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
          clearTimeout(safetyTimeout);
          logger.error('Stream error:', error);
          setCurrentStatus(null);
          setStreamingContent('');
          setIsLoading(false);

          const errorMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Couldn't process that. ${error || 'Try again.'}`,
            timestamp: new Date(),
          };
          addChatMessage(errorMessage);
        },
      }, history);
    } catch (error: any) {
      clearTimeout(safetyTimeout);
      logger.error('sendMessage error:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Couldn't process that. ${error.message || 'Try again.'}`,
        timestamp: new Date(),
      };
      addChatMessage(errorMessage);
      setCurrentStatus(null);
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
    clearChatMessages();
  };

  useEffect(() => {
    if ((chatMessages || []).length > 0) {
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages, isLoading]);

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
              services={'services' in suggestion ? suggestion.services : undefined}
              onPress={() => {
                posthog?.capture(ANALYTICS_EVENTS.SUGGESTION_TAPPED, {
                  suggestion_text: suggestion.text,
                  services: 'services' in suggestion ? suggestion.services : null,
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

  // Handle briefing action tap - sends message to chat
  const handleBriefingAction = useCallback((actionPrompt: string) => {
    sendMessage(actionPrompt);
  }, []);

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={[styles.greetingText, { color: colors.textPrimary }]}>
        {getGreeting()}
      </Text>
      {/* Real proactive nudges from /v3/nudges */}
      <ProactiveNudges onNudgeTap={sendMessage} maxNudges={3} />
      {/* Horizontal scroll day briefing */}
      <DayBriefingScroll onItemPress={handleBriefingAction} />
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

    // Helper to clear pending action from messages to prevent re-clicks
    const clearPendingActionFromMessages = (actionId: string) => {
      setChatMessages(prevMessages =>
        prevMessages.map(msg => {
          if (!msg) return msg; // Safety check for undefined messages
          if (msg.pendingActions?.some(pa => pa.action_id === actionId)) {
            return {
              ...msg,
              pendingActions: msg.pendingActions.filter(pa => pa.action_id !== actionId),
            };
          }
          return msg;
        }).filter(Boolean) as ChatMessage[] // Filter out any undefined values
      );
    };

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

      // Always clear from messages to prevent re-clicks (whether success or already processed)
      clearPendingActionFromMessages(currentPendingAction.action_id);

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
        addChatMessage(successMessage);
        setActionToReview(null);
        setCurrentPendingAction(null);
      } else {
        // Clear UI state but show error
        setActionToReview(null);
        setCurrentPendingAction(null);
        Alert.alert('Error', result.message || 'Action failed');
      }
    } catch (error: any) {
      // Also clear on error to prevent stuck UI
      clearPendingActionFromMessages(currentPendingAction.action_id);
      setActionToReview(null);
      setCurrentPendingAction(null);
      Alert.alert('Error', error.message || 'Failed to execute action');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Handle cancel action from inline review
  const handleCancelAction = () => {
    // Capture action_id before any state changes to avoid closure issues
    const actionIdToRemove = currentPendingAction?.action_id;

    // Track action rejected
    posthog?.capture(ANALYTICS_EVENTS.ACTION_REJECTED, {
      action_type: actionToReview?.type || 'unknown',
      tool: currentPendingAction?.tool || 'unknown',
    });

    // Clear pending action from messages to prevent re-clicks
    if (actionIdToRemove) {
      setChatMessages(prevMessages =>
        prevMessages.map(msg => {
          if (!msg) return msg; // Safety check for undefined messages
          if (msg.pendingActions?.some(pa => pa.action_id === actionIdToRemove)) {
            return {
              ...msg,
              pendingActions: msg.pendingActions.filter(pa => pa.action_id !== actionIdToRemove),
            };
          }
          return msg;
        }).filter(Boolean) as ChatMessage[] // Filter out any undefined values
      );
    }

    setActionToReview(null);
    setCurrentPendingAction(null);
    const cancelMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Action cancelled.',
      timestamp: new Date(),
    };
    addChatMessage(cancelMessage);
  };

  // Handle feedback submission for cognitive layer responses
  const handleFeedback = useCallback(async (outcomeId: string, signal: 'positive' | 'negative') => {
    try {
      // Submit feedback to backend
      await chatService.submitFeedback(outcomeId, signal, 'explicit_feedback');

      // Update the message to show feedback was given
      const updatedMessages = (chatMessages || []).map(msg =>
        msg?.outcomeId === outcomeId
          ? { ...msg, feedbackGiven: signal }
          : msg
      ).filter(Boolean);
      setChatMessages(updatedMessages);

      // Track feedback
      posthog?.capture('response_feedback', {
        outcome_id: outcomeId,
        signal,
      });
    } catch (error) {
      logger.error('Failed to submit feedback:', error);
    }
  }, [chatMessages, setChatMessages, posthog]);

  // Handle email actions (reply, archive, star, etc.)
  const handleEmailAction = useCallback(async (action: any, email: any) => {
    try {
      logger.log('Email action:', action.type, 'for email:', email.subject);

      // Track the action
      posthog?.capture('email_action', {
        action: action.type,
        email_id: email.id,
      });

      // Handle different action types
      switch (action.type) {
        case 'reply':
          // Populate the input with a reply prompt
          setInputText(`Reply to ${email.from.split('<')[0].trim()}: `);
          break;

        case 'archive':
          // Send a message to archive the email
          await sendMessage(`Archive the email "${email.subject}" from ${email.from}`);
          break;

        case 'star':
          // Toggle star status
          await sendMessage(`${email.isStarred ? 'Unstar' : 'Star'} the email "${email.subject}"`);
          break;

        case 'markRead':
          // Mark as read
          await sendMessage(`Mark the email "${email.subject}" as read`);
          break;

        case 'delete':
          // Delete email
          await sendMessage(`Delete the email "${email.subject}"`);
          break;

        case 'forward':
          // Forward email
          setInputText(`Forward "${email.subject}" to `);
          break;

        case 'open':
          // Open email details
          await sendMessage(`Show me the full content of the email "${email.subject}" from ${email.from}`);
          break;

        default:
          logger.warn('Unknown email action:', action.type);
      }
    } catch (error) {
      logger.error('Email action failed:', error);
    }
  }, [sendMessage, posthog]);

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    // Safety check for undefined items
    if (!item) return null;

    const isUser = item.role === 'user';
    const prevMessage = chatMessages?.[index - 1];
    const showTimestamp = index === 0 ||
      (prevMessage &&
       new Date(item.timestamp).getTime() - new Date(prevMessage.timestamp).getTime() > 300000);

    return (
      <View style={styles.messageContainer}>
        {showTimestamp && (
          <Text style={[
            styles.messageTimestamp,
            { color: colors.textTertiary },
            isUser && styles.messageTimestampRight
          ]}>
            {formatTimestamp(new Date(item.timestamp))}
          </Text>
        )}
        <ChatBubble
          message={item}
          onReviewAction={handleReviewAction}
          onFeedback={handleFeedback}
          onEmailAction={handleEmailAction}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={['top']}>
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
            disabled={(chatMessages || []).length === 0}
            style={[styles.headerButton, { opacity: (chatMessages || []).length === 0 ? 0.3 : 1 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <Text style={[styles.clearText, { color: colors.accent }]}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {/* @ts-ignore - FlashList types issue with estimatedItemSize prop */}
        <FlashList<ChatMessage>
          ref={flashListRef}
          data={(chatMessages || []).filter(Boolean)}
          renderItem={renderMessage}
          keyExtractor={(item, index) => item?.id || `msg-${index}`}
          contentContainerStyle={styles.messagesList}
          ListEmptyComponent={renderEmptyState}
          ListHeaderComponent={
            (chatMessages || []).length > 0 ? (
              <View style={styles.briefingPillContainer}>
                <DailyBriefing
                  onActionPress={handleBriefingAction}
                  variant="pill"
                />
              </View>
            ) : null
          }
          onScrollBeginDrag={handleScroll}
          extraData={{ currentStatus, streamingContent, isLoading }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          {...{ estimatedItemSize: 100 } as any}
          ListFooterComponent={
            <View style={styles.footerContainer}>
              {/* Thinking indicator - shows immediately, updates dynamically */}
              {isLoading && !streamingContent && (
                <ThinkingIndicator
                  status={currentStatus?.message}
                  tool={currentStatus?.tool}
                  isActive={true}
                />
              )}
              {/* Streaming content as it arrives */}
              {streamingContent && (
                <Text style={[styles.streamingText, { color: colors.textPrimary }]}>{streamingContent}</Text>
              )}
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
          <View style={[styles.recordingIndicator, { backgroundColor: colors.fill }]}>
            <View style={[styles.recordingDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.recordingText, { color: colors.error }]}>Recording... Tap mic to stop</Text>
          </View>
        )}

        {/* Transcribing indicator - Glassmorphic iOS style */}
        {isTranscribing && (
          <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={styles.transcribingContainer}>
            <View style={[styles.transcribingContent, { backgroundColor: colors.fill }]}>
              <View style={[styles.transcribingPulse, { backgroundColor: colors.accentLight }]}>
                <Animated.View style={[styles.transcribingDot, { backgroundColor: colors.accent, transform: [{ scale: pulseAnim }] }]} />
              </View>
              <Text style={[styles.transcribingText, { color: colors.textPrimary }]}>Transcribing...</Text>
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
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing.sm), backgroundColor: colors.bgPrimary }]}>
          <View style={styles.inputRow}>
            <View style={[
              styles.inputWrapper,
              { backgroundColor: colors.fill },
              isFocused && { backgroundColor: colors.fillSecondary }
            ]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
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
                  isRecording && [styles.recordingButton, { shadowColor: colors.error }],
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
                      isRecording && [styles.micButtonRecording, { backgroundColor: colors.error }]
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
  },
  keyboardView: {
    flex: 1,
  },
  // Header - minimal iOS style
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  headerButton: {
    padding: spacing.xs,
  },
  clearText: {
    fontSize: 17,
    fontWeight: '400',
    letterSpacing: -0.41,
  },
  // Messages list
  messagesList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 140,
  },
  messageContainer: {
    marginBottom: spacing.lg,
  },
  messageTimestamp: {
    fontSize: 12,
    marginBottom: spacing.sm,
    letterSpacing: -0.08,
  },
  messageTimestampRight: {
    textAlign: 'right',
  },
  // Empty state - clean iOS style
  emptyState: {
    paddingTop: spacing.sm,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 34,
    marginBottom: spacing.xl,
    letterSpacing: 0.36,
  },
  briefingPillContainer: {
    marginBottom: spacing.sm,
  },
  // Suggest button
  suggestButtonContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // Suggestions overlay
  suggestionsOverlay: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordingText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.24,
  },
  transcribingContainer: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  transcribingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  transcribingPulse: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcribingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  transcribingText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.24,
  },
  // Input container - iOS style
  inputContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
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
    borderRadius: 24,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 48,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 17,
    letterSpacing: -0.41,
    maxHeight: 100,
    paddingVertical: spacing.sm,
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
  micButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  micButtonRecording: {},
  recordingButton: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
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
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.41,
  },
});
