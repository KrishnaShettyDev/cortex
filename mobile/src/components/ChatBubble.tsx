/**
 * ChatBubble - iMessage-style chat message component
 *
 * Features:
 * - Native iOS iMessage-style chat bubbles
 * - Rich content cards for Composio integration results (emails, calendar, etc.)
 * - Clean typography matching Apple HIG
 * - Bubble tails for user/assistant differentiation
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing, typography, useTheme } from '../theme';
import {
  ChatMessage,
  ActionTaken,
  MemoryReference,
  PendingAction,
  RawEmailResponse,
  RawCalendarEventResponse,
  RawTimeSlotResponse,
  RawPlaceResponse,
} from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';
import {
  EmailList,
  CalendarEventList,
  FreeTimeSlots,
  PlacesList,
  EmailData,
  CalendarEventData,
  TimeSlotData,
  PlaceData,
} from './RichContentCards';
import {
  ProactiveEmailList,
  ProactiveEmailData,
  ProactiveEmailAction,
} from './ProactiveEmailCard';

// ============ MARKDOWN LINK RENDERER ============
/**
 * Parse markdown links [text](url) and render as clickable elements
 */
function renderTextWithLinks(text: string, textStyle: any, linkColor: string): React.ReactNode {
  // Regex to match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = linkRegex.exec(text)) !== null) {
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`text-${keyIndex++}`} style={textStyle}>
          {text.slice(lastIndex, match.index)}
        </Text>
      );
    }

    // Add the link
    const linkText = match[1];
    const linkUrl = match[2];
    parts.push(
      <Text
        key={`link-${keyIndex++}`}
        style={[textStyle, { color: linkColor, textDecorationLine: 'underline' }]}
        onPress={() => Linking.openURL(linkUrl)}
      >
        {linkText}
      </Text>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last link
  if (lastIndex < text.length) {
    parts.push(
      <Text key={`text-${keyIndex++}`} style={textStyle}>
        {text.slice(lastIndex)}
      </Text>
    );
  }

  // If no links found, return the original text
  if (parts.length === 0) {
    return <Text style={textStyle}>{text}</Text>;
  }

  return <Text style={textStyle}>{parts}</Text>;
}

// ============ PHOTO MEMORY CARD ============
function PhotoMemoryCard({ photoUrl }: { photoUrl: string }) {
  const { colors: themeColors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <View style={[styles.photoMemoryCard, styles.photoMemoryError, { backgroundColor: themeColors.bgTertiary }]}>
        <Ionicons name="image-outline" size={24} color={themeColors.textTertiary} />
      </View>
    );
  }

  return (
    <View style={[styles.photoMemoryCard, { backgroundColor: themeColors.bgSecondary, borderColor: themeColors.glassBorder }]}>
      {loading && (
        <View style={[styles.photoLoading, { backgroundColor: themeColors.bgTertiary }]}>
          <ActivityIndicator size="small" color={themeColors.accent} />
        </View>
      )}
      <Image
        source={{ uri: photoUrl }}
        style={styles.memoryPhoto}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
      />
    </View>
  );
}

// ============ ACTION CARD (Completed actions) ============
function ActionCard({ action, colors }: { action: ActionTaken; colors: any }) {
  const getActionInfo = () => {
    switch (action.tool) {
      case 'create_calendar_event':
        return {
          useServiceIcon: 'calendar' as const,
          color: '#4285F4',
          title: 'Event Created',
          subtitle: action.arguments.title,
        };
      case 'update_calendar_event':
        return {
          useServiceIcon: 'calendar' as const,
          color: '#34A853',
          title: 'Event Updated',
          subtitle: action.arguments.title || 'Calendar event',
        };
      case 'delete_calendar_event':
        return {
          useServiceIcon: null,
          icon: 'trash-outline' as const,
          color: '#EA4335',
          title: 'Event Deleted',
          subtitle: 'Calendar event removed',
        };
      case 'send_email':
        return {
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Email Sent',
          subtitle: `To: ${action.arguments.to?.[0]?.email || 'recipient'}`,
        };
      case 'reply_to_email':
        return {
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Reply Sent',
          subtitle: 'Email reply sent',
        };
      default:
        return {
          useServiceIcon: null,
          icon: 'checkmark-circle' as const,
          color: colors.success,
          title: 'Action Completed',
          subtitle: action.tool.replace(/_/g, ' '),
        };
    }
  };

  const info = getActionInfo();
  const isSuccess = action.result.success;

  const renderIcon = () => {
    if (!isSuccess) {
      return <Ionicons name="close-circle" size={18} color={colors.error} />;
    }
    if (info.useServiceIcon === 'gmail') {
      return <GmailIcon size={18} />;
    }
    if (info.useServiceIcon === 'calendar') {
      return <GoogleCalendarIcon size={18} />;
    }
    return <Ionicons name={(info as any).icon || 'checkmark-circle'} size={18} color={info.color} />;
  };

  const handlePress = () => {
    if (action.result.event_url) {
      Linking.openURL(action.result.event_url);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.actionCard, { backgroundColor: colors.fill, borderColor: colors.glassBorder }, !isSuccess && styles.actionCardError]}
      onPress={handlePress}
      disabled={!action.result.event_url}
      activeOpacity={0.7}
    >
      <View style={[styles.actionIconContainer, { backgroundColor: info.color + '20' }]}>
        {renderIcon()}
      </View>
      <View style={styles.actionContent}>
        <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{isSuccess ? info.title : 'Action Failed'}</Text>
        <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {isSuccess ? info.subtitle : action.result.message}
        </Text>
      </View>
      {action.result.event_url && (
        <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

// ============ RICH CONTENT FROM ACTION RESULTS ============
function RichContentFromAction({ action, onEmailAction }: { action: ActionTaken; onEmailAction?: (emailAction: ProactiveEmailAction, email: ProactiveEmailData) => Promise<void> }) {
  const result = action.result as any;
  // Handle nested result structure: result.data contains the actual tool result
  const data = (result.data || result) as any;

  // Check for toolResults (from multi-agent system) first
  const toolResults = data.toolResults || {};
  const emailToolResult = toolResults['search_emails'] || toolResults['gmail_search'];
  const calendarToolResult = toolResults['get_calendar_events'] || toolResults['calendar_get_events'];
  const freeTimeToolResult = toolResults['find_free_time'] || toolResults['calendar_find_free_time'];

  const toolName = emailToolResult?._tool || calendarToolResult?._tool || freeTimeToolResult?._tool || data._tool || action.tool;

  // Email search results - use ProactiveEmailList for rich, interactive cards
  const emailsArray = emailToolResult?.emails || data.emails || result.emails;
  if (emailsArray && emailsArray.length > 0) {
    const emails: ProactiveEmailData[] = (emailsArray as RawEmailResponse[]).map((e) => ({
      id: e.id || e.thread_id || '',
      threadId: e.thread_id || '',
      subject: e.subject || '(no subject)',
      from: e.from || '',
      date: e.date || new Date().toISOString(),
      snippet: e.snippet || '',
      body: e.body,
      isUnread: e.is_unread,
      isStarred: e.is_starred,
      isImportant: e.is_important,
      labels: e.labels,
      attachmentCount: e.attachment_count,
    }));
    return <ProactiveEmailList emails={emails} onAction={onEmailAction} />;
  }

  // Email thread - also use ProactiveEmailList
  const messagesArray = data.messages || result.messages;
  if ((toolName === 'get_email_thread' || toolName === 'gmail_get_thread') && messagesArray && messagesArray.length > 0) {
    const emails: ProactiveEmailData[] = (messagesArray as RawEmailResponse[]).map((m) => ({
      id: m.id || '',
      threadId: m.thread_id || '',
      subject: m.subject || '(no subject)',
      from: m.from || '',
      date: m.date || new Date().toISOString(),
      snippet: m.snippet || m.body?.substring(0, 150) || '',
      body: m.body,
      isUnread: m.is_unread,
    }));
    return <ProactiveEmailList emails={emails} onAction={onEmailAction} showHeader={false} />;
  }

  // Calendar events search
  const eventsArray = calendarToolResult?.events || data.events || result.events;
  if (eventsArray && eventsArray.length > 0) {
    const events: CalendarEventData[] = (eventsArray as RawCalendarEventResponse[]).map((e) => ({
      id: e.id,
      title: e.title || e.summary || '',
      start_time: e.start_time || e.start || '',
      end_time: e.end_time || e.end || '',
      location: e.location,
      attendees: e.attendees,
      event_url: e.event_url || e.htmlLink,
    }));
    return <CalendarEventList events={events} />;
  }

  // Free time slots
  const slotsArray = freeTimeToolResult?.free_slots || data.free_slots || result.free_slots;
  if (slotsArray && slotsArray.length > 0) {
    const slots: TimeSlotData[] = (slotsArray as RawTimeSlotResponse[]).map((s) => ({
      start: s.start || s.start_time || '',
      end: s.end || s.end_time || '',
      duration_minutes: s.duration_minutes || 0,
    }));
    return <FreeTimeSlots slots={slots} />;
  }

  // Places search
  const placesArray = data.places || result.places;
  if ((toolName === 'search_places' || toolName === 'places_search') && placesArray && placesArray.length > 0) {
    const places: PlaceData[] = (placesArray as RawPlaceResponse[]).map((p) => ({
      name: p.name,
      address: p.address || p.formatted_address,
      rating: p.rating,
      price_level: p.price_level,
      types: p.types,
    }));
    return <PlacesList places={places} />;
  }

  return null;
}

// ============ PENDING ACTION CARD ============
// Actions that can be reviewed/edited before execution
const REVIEWABLE_ACTIONS = ['send_email', 'create_calendar_event'];

function PendingActionCard({ action, onReview, colors }: { action: PendingAction; onReview?: () => void; colors: any }) {
  const isReviewable = REVIEWABLE_ACTIONS.includes(action.tool);

  const getActionInfo = () => {
    switch (action.tool) {
      case 'create_calendar_event':
        return {
          useServiceIcon: 'calendar' as const,
          color: '#4285F4',
          title: 'Create Event',
          subtitle: action.arguments.title,
        };
      case 'send_email':
        return {
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Send Email',
          subtitle: `To: ${action.arguments.to?.[0]?.email || 'recipient'}`,
        };
      case 'update_calendar_event':
        return {
          useServiceIcon: 'calendar' as const,
          color: '#34A853',
          title: 'Update Event',
          subtitle: action.arguments.title || 'Calendar event',
        };
      case 'delete_calendar_event':
        return {
          useServiceIcon: null,
          icon: 'trash-outline' as const,
          color: '#EA4335',
          title: 'Delete Event',
          subtitle: 'Remove calendar event',
        };
      case 'reply_to_email':
        return {
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Reply to Email',
          subtitle: 'Send reply in thread',
        };
      case 'reschedule_events':
        return {
          useServiceIcon: 'calendar' as const,
          color: '#FBBC04',
          title: 'Reschedule Events',
          subtitle: `${action.arguments.events?.length || 0} events`,
        };
      default:
        // Don't show pending card for non-user-facing actions
        return null;
    }
  };

  const info = getActionInfo();

  // Don't render cards for internal/non-user-facing actions
  if (!info) {
    return null;
  }

  const renderIcon = () => {
    if (info.useServiceIcon === 'gmail') {
      return <GmailIcon size={18} />;
    }
    if (info.useServiceIcon === 'calendar') {
      return <GoogleCalendarIcon size={18} />;
    }
    return <Ionicons name={(info as any).icon || 'ellipse'} size={18} color={info.color} />;
  };

  return (
    <TouchableOpacity
      style={[styles.pendingActionCard, { backgroundColor: colors.accent + '08', borderColor: colors.accent + '25' }]}
      onPress={isReviewable ? onReview : undefined}
      activeOpacity={isReviewable ? 0.7 : 1}
      disabled={!isReviewable}
    >
      <View style={[styles.actionIconContainer, { backgroundColor: info.color + '20' }]}>
        {renderIcon()}
      </View>
      <View style={styles.actionContent}>
        <Text style={[styles.actionTitle, { color: colors.textPrimary }]}>{info.title}</Text>
        <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {info.subtitle}
        </Text>
      </View>
      {isReviewable && (
        <View style={[styles.reviewButton, { backgroundColor: colors.accent + '20' }]}>
          <Text style={[styles.reviewButtonText, { color: colors.accent }]}>Review</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </View>
      )}
    </TouchableOpacity>
  );
}

// ============ RESPONSE ABOUT PHOTO CHECK ============
const isResponseAboutPhoto = (content: string): boolean => {
  const lowerContent = content.toLowerCase();

  const strongPhrases = [
    'here\'s the photo', 'here is the photo', 'this photo', 'that photo',
    'the photo you', 'photo of', 'picture of', 'image of', 'photo from',
    'picture from', 'photo shows', 'picture shows', 'in this photo',
    'in the photo', 'in this picture', 'in the picture', 'your photo', 'the image',
  ];

  if (strongPhrases.some(phrase => lowerContent.includes(phrase))) {
    return true;
  }

  const weakKeywords = ['photo', 'picture', 'image', 'captured', 'snapshot'];
  const weakMatches = weakKeywords.filter(keyword => lowerContent.includes(keyword)).length;

  return weakMatches >= 2;
};

// ============ FEEDBACK BUTTONS ============
function FeedbackButtons({
  outcomeId,
  feedbackGiven,
  onFeedback,
  colors,
}: {
  outcomeId: string;
  feedbackGiven?: 'positive' | 'negative' | 'neutral';
  onFeedback: (outcomeId: string, signal: 'positive' | 'negative') => void;
  colors: any;
}) {
  if (feedbackGiven) {
    // Show confirmation after feedback
    return (
      <View style={styles.feedbackConfirmation}>
        <Ionicons
          name={feedbackGiven === 'positive' ? 'checkmark-circle' : 'close-circle'}
          size={14}
          color={feedbackGiven === 'positive' ? colors.success : colors.textTertiary}
        />
        <Text style={[styles.feedbackConfirmText, { color: colors.textTertiary }]}>
          {feedbackGiven === 'positive' ? 'Thanks!' : 'Noted'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.feedbackContainer}>
      <Text style={[styles.feedbackLabel, { color: colors.textTertiary }]}>Was this helpful?</Text>
      <View style={styles.feedbackButtons}>
        <TouchableOpacity
          style={[styles.feedbackButton, { borderColor: colors.success + '40' }]}
          onPress={() => onFeedback(outcomeId, 'positive')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="thumbs-up-outline" size={16} color={colors.success} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.feedbackButton, { borderColor: colors.textTertiary + '40' }]}
          onPress={() => onFeedback(outcomeId, 'negative')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="thumbs-down-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ============ MAIN CHAT BUBBLE COMPONENT ============
interface ChatBubbleProps {
  message: ChatMessage;
  onReviewAction?: (action: PendingAction) => void;
  onFeedback?: (outcomeId: string, signal: 'positive' | 'negative') => void;
  onEmailAction?: (action: ProactiveEmailAction, email: ProactiveEmailData) => Promise<void>;
}

export function ChatBubble({ message, onReviewAction, onFeedback, onEmailAction }: ChatBubbleProps) {
  const { colors: themeColors, isDark } = useTheme();
  const isUser = message.role === 'user';
  const hasActions = message.actionsTaken && message.actionsTaken.length > 0;
  const hasPendingActions = message.pendingActions && message.pendingActions.length > 0;

  const shouldShowPhoto = !isUser &&
    message.memoriesUsed?.some(m => m.photo_url && m.memory_type === 'photo') &&
    isResponseAboutPhoto(message.content);

  // Check if there's rich content from actions
  const hasRichContent = hasActions && message.actionsTaken!.some(action => {
    const result = action.result as any;
    // Handle nested result structure: result.data contains the actual tool result
    const data = (result.data || result) as any;

    // Check for toolResults (from multi-agent system)
    const toolResults = data.toolResults || {};
    const emailToolResult = toolResults['search_emails'] || toolResults['gmail_search'];
    const calendarToolResult = toolResults['get_calendar_events'] || toolResults['calendar_get_events'];
    const freeTimeToolResult = toolResults['find_free_time'] || toolResults['calendar_find_free_time'];

    const emails = emailToolResult?.emails || data.emails || result.emails;
    const messages = data.messages || result.messages;
    const events = calendarToolResult?.events || data.events || result.events;
    const freeSlots = freeTimeToolResult?.free_slots || data.free_slots || result.free_slots;
    const places = data.places || result.places;

    return (
      (emails?.length ?? 0) > 0 ||
      (messages?.length ?? 0) > 0 ||
      (events?.length ?? 0) > 0 ||
      (freeSlots?.length ?? 0) > 0 ||
      (places?.length ?? 0) > 0
    );
  });

  // User message - iMessage style blue bubble
  if (isUser) {
    return (
      <View style={styles.userContainer}>
        <View style={[styles.userBubble, { backgroundColor: themeColors.accent }]}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  // Assistant message
  return (
    <View style={styles.assistantContainer}>
      {/* Pending actions (needs review) */}
      {hasPendingActions && (
        <View style={styles.actionsSection}>
          {message.pendingActions!.map((action, index) => (
            <PendingActionCard
              key={action.action_id || index}
              action={action}
              onReview={() => onReviewAction?.(action)}
              colors={themeColors}
            />
          ))}
        </View>
      )}

      {/* Completed action badges (without rich content) */}
      {hasActions && !hasRichContent && (
        <View style={styles.actionsSection}>
          {message.actionsTaken!.map((action, index) => (
            <ActionCard key={index} action={action} colors={themeColors} />
          ))}
        </View>
      )}

      {/* Message text - iMessage style gray bubble */}
      {message.content && (
        <View style={[styles.assistantBubble, { backgroundColor: isDark ? '#3A3A3C' : '#E9E9EB' }]}>
          {renderTextWithLinks(message.content, [styles.assistantText, { color: isDark ? '#FFFFFF' : '#000000' }], themeColors.accent)}
        </View>
      )}

      {/* Rich content from action results */}
      {hasRichContent && (
        <View style={styles.richContentSection}>
          {message.actionsTaken!.map((action, index) => (
            <RichContentFromAction key={index} action={action} onEmailAction={onEmailAction} />
          ))}
        </View>
      )}

      {/* Photo memory */}
      {shouldShowPhoto && (() => {
        const photoMemory = message.memoriesUsed!.find(m => m.photo_url && m.memory_type === 'photo');
        if (!photoMemory) return null;

        return (
          <View style={styles.photoSection}>
            <PhotoMemoryCard photoUrl={photoMemory.photo_url!} />
          </View>
        );
      })()}

      {/* Feedback buttons for cognitive layer responses */}
      {message.outcomeId && onFeedback && (
        <FeedbackButtons
          outcomeId={message.outcomeId}
          feedbackGiven={message.feedbackGiven}
          onFeedback={onFeedback}
          colors={themeColors}
        />
      )}
    </View>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  // User message container - iMessage style (right side, blue)
  userContainer: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    marginBottom: 2,
  },
  userBubble: {
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
    fontWeight: '400',
    letterSpacing: -0.41,
  },

  // Assistant message container - iMessage style (left side, gray)
  assistantContainer: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    marginBottom: 2,
  },
  assistantBubble: {
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 4,
  },
  assistantText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: -0.41,
  },

  // Actions section
  actionsSection: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },

  // Action card styles
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    gap: spacing.sm,
  },
  actionCardError: {
    borderColor: colors.error + '40',
    backgroundColor: colors.error + '10',
  },
  actionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Pending action styles
  pendingActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '08',
    borderRadius: borderRadius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.accent + '25',
    gap: spacing.sm,
  },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.accent + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  reviewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },

  // Rich content section
  richContentSection: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },

  // Photo section
  photoSection: {
    marginTop: spacing.sm,
  },
  photoMemoryCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  photoMemoryError: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  photoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
    zIndex: 1,
  },
  memoryPhoto: {
    width: 140,
    height: 140,
  },

  // Feedback buttons
  feedbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  feedbackLabel: {
    fontSize: 12,
    fontWeight: '400',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  feedbackButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  feedbackConfirmation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  feedbackConfirmText: {
    fontSize: 12,
    fontWeight: '400',
  },
});
