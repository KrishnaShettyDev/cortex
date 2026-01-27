/**
 * ChatBubble - Enhanced chat message component
 *
 * Features:
 * - Glassmorphic styling for better readability
 * - Rich content cards for Composio integration results (emails, calendar, etc.)
 * - Improved typography and spacing
 * - Blur effects for glass aesthetics
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
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
function RichContentFromAction({ action }: { action: ActionTaken }) {
  const result = action.result;

  // Email search results
  if (action.tool === 'search_emails' && result.emails?.length > 0) {
    const emails: EmailData[] = (result.emails as RawEmailResponse[]).map((e) => ({
      id: e.id,
      thread_id: e.thread_id,
      subject: e.subject,
      from: e.from,
      date: e.date,
      snippet: e.snippet,
      is_unread: e.is_unread,
    }));
    return <EmailList emails={emails} />;
  }

  // Email thread
  if (action.tool === 'get_email_thread' && result.messages?.length > 0) {
    const emails: EmailData[] = (result.messages as RawEmailResponse[]).map((m) => ({
      id: m.id,
      subject: m.subject,
      from: m.from,
      date: m.date,
      snippet: m.snippet || m.body?.substring(0, 150),
    }));
    return <EmailList emails={emails} />;
  }

  // Calendar events search
  if ((action.tool === 'get_calendar_events' || action.tool === 'search_calendar') && result.events?.length > 0) {
    const events: CalendarEventData[] = (result.events as RawCalendarEventResponse[]).map((e) => ({
      id: e.id,
      title: e.title || e.summary,
      start_time: e.start_time || e.start,
      end_time: e.end_time || e.end,
      location: e.location,
      attendees: e.attendees,
      event_url: e.event_url || e.htmlLink,
    }));
    return <CalendarEventList events={events} />;
  }

  // Free time slots
  if (action.tool === 'find_free_time' && result.free_slots?.length > 0) {
    const slots: TimeSlotData[] = (result.free_slots as RawTimeSlotResponse[]).map((s) => ({
      start: s.start,
      end: s.end,
      duration_minutes: s.duration_minutes,
    }));
    return <FreeTimeSlots slots={slots} />;
  }

  // Places search
  if (action.tool === 'search_places' && result.places?.length > 0) {
    const places: PlaceData[] = (result.places as RawPlaceResponse[]).map((p) => ({
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

// ============ MAIN CHAT BUBBLE COMPONENT ============
interface ChatBubbleProps {
  message: ChatMessage;
  onReviewAction?: (action: PendingAction) => void;
}

export function ChatBubble({ message, onReviewAction }: ChatBubbleProps) {
  const { colors: themeColors, isDark } = useTheme();
  const isUser = message.role === 'user';
  const hasActions = message.actionsTaken && message.actionsTaken.length > 0;
  const hasPendingActions = message.pendingActions && message.pendingActions.length > 0;

  const shouldShowPhoto = !isUser &&
    message.memoriesUsed?.some(m => m.photo_url && m.memory_type === 'photo') &&
    isResponseAboutPhoto(message.content);

  // Check if there's rich content from actions
  const hasRichContent = hasActions && message.actionsTaken!.some(action => {
    const result = action.result;
    return (
      (action.tool === 'search_emails' && result.emails?.length > 0) ||
      (action.tool === 'get_email_thread' && result.messages?.length > 0) ||
      ((action.tool === 'get_calendar_events' || action.tool === 'search_calendar') && result.events?.length > 0) ||
      (action.tool === 'find_free_time' && result.free_slots?.length > 0) ||
      (action.tool === 'search_places' && result.places?.length > 0)
    );
  });

  // User message
  if (isUser) {
    return (
      <View style={styles.userContainer}>
        <View style={[styles.userBubble, { backgroundColor: themeColors.accent + '25', borderColor: themeColors.accent + '40' }]}>
          <Text style={[styles.userText, { color: themeColors.textPrimary }]}>{message.content}</Text>
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

      {/* Message text with glassmorphic styling */}
      {message.content && (
        <View style={styles.assistantBubbleContainer}>
          <BlurView intensity={15} tint={isDark ? 'dark' : 'light'} style={styles.assistantBlur}>
            <View style={[styles.assistantBubble, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)', borderColor: themeColors.glassBorder }]}>
              <Text style={[styles.assistantText, { color: themeColors.textPrimary }]}>{message.content}</Text>
            </View>
          </BlurView>
        </View>
      )}

      {/* Rich content from action results */}
      {hasRichContent && (
        <View style={styles.richContentSection}>
          {message.actionsTaken!.map((action, index) => (
            <RichContentFromAction key={index} action={action} />
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
    </View>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  // User message container
  userContainer: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: colors.accent + '25',
    borderRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  userText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textPrimary,
    fontWeight: '400',
  },

  // Assistant message container
  assistantContainer: {
    alignSelf: 'flex-start',
    maxWidth: '95%',
  },
  assistantBubbleContainer: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: 4,
  },
  assistantBlur: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  assistantBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  assistantText: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
    fontWeight: '400',
    letterSpacing: 0.1,
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
});
