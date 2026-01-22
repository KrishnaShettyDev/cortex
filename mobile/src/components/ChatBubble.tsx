import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing } from '../theme';
import { ChatMessage, ActionTaken, MemoryReference, PendingAction } from '../types';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';

// Photo memory card with loading state
function PhotoMemoryCard({ photoUrl }: { photoUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <View style={[styles.photoMemoryCard, styles.photoMemoryError]}>
        <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
      </View>
    );
  }

  return (
    <View style={styles.photoMemoryCard}>
      {loading && (
        <View style={styles.photoLoading}>
          <ActivityIndicator size="small" color={colors.accent} />
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

interface ChatBubbleProps {
  message: ChatMessage;
  onReviewAction?: (action: PendingAction) => void;
}

function ActionCard({ action }: { action: ActionTaken }) {
  const getActionInfo = () => {
    switch (action.tool) {
      case 'create_calendar_event':
        return {
          icon: 'calendar' as const,
          useServiceIcon: 'calendar' as const,
          color: '#4285F4',
          title: 'Event Created',
          subtitle: action.arguments.title,
        };
      case 'update_calendar_event':
        return {
          icon: 'calendar-outline' as const,
          useServiceIcon: 'calendar' as const,
          color: '#34A853',
          title: 'Event Updated',
          subtitle: action.arguments.title || 'Calendar event',
        };
      case 'delete_calendar_event':
        return {
          icon: 'trash-outline' as const,
          useServiceIcon: null,
          color: '#EA4335',
          title: 'Event Deleted',
          subtitle: 'Calendar event removed',
        };
      case 'send_email':
        return {
          icon: 'mail' as const,
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Email Sent',
          subtitle: `To: ${action.arguments.to?.[0]?.email || 'recipient'}`,
        };
      case 'reply_to_email':
        return {
          icon: 'mail-outline' as const,
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Reply Sent',
          subtitle: 'Email reply sent',
        };
      case 'find_free_time':
        return {
          icon: 'time-outline' as const,
          useServiceIcon: 'calendar' as const,
          color: '#4285F4',
          title: 'Free Time Found',
          subtitle: `${action.result?.free_slots?.length || 0} slots available`,
        };
      case 'search_places':
        return {
          icon: 'location-outline' as const,
          useServiceIcon: null,
          color: '#34A853',
          title: 'Places Found',
          subtitle: `${action.result?.places?.length || 0} results`,
        };
      case 'search_emails':
        return {
          icon: 'search-outline' as const,
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Emails Found',
          subtitle: `${action.result?.emails?.length || 0} results`,
        };
      case 'get_email_thread':
        return {
          icon: 'chatbubbles-outline' as const,
          useServiceIcon: 'gmail' as const,
          color: '#EA4335',
          title: 'Thread Retrieved',
          subtitle: `${action.result?.messages?.length || 0} messages`,
        };
      case 'reschedule_events':
        return {
          icon: 'swap-horizontal-outline' as const,
          useServiceIcon: 'calendar' as const,
          color: '#FBBC04',
          title: 'Events Rescheduled',
          subtitle: action.result?.message || 'Events moved',
        };
      default:
        return {
          icon: 'checkmark-circle' as const,
          useServiceIcon: null,
          color: colors.success,
          title: 'Action Completed',
          subtitle: action.tool,
        };
    }
  };

  const info = getActionInfo();
  const isSuccess = action.result.success;

  const renderIcon = () => {
    if (!isSuccess) {
      return <Ionicons name="close-circle" size={16} color={colors.error} />;
    }
    if (info.useServiceIcon === 'gmail') {
      return <GmailIcon size={16} />;
    }
    if (info.useServiceIcon === 'calendar') {
      return <GoogleCalendarIcon size={16} />;
    }
    return <Ionicons name={info.icon} size={16} color={info.color} />;
  };

  const handlePress = () => {
    if (action.result.event_url) {
      Linking.openURL(action.result.event_url);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.actionCard, !isSuccess && styles.actionCardError]}
      onPress={handlePress}
      disabled={!action.result.event_url}
    >
      <View style={[styles.actionIcon, { backgroundColor: info.color + '20' }]}>
        {renderIcon()}
      </View>
      <View style={styles.actionContent}>
        <Text style={styles.actionTitle}>{isSuccess ? info.title : 'Action Failed'}</Text>
        <Text style={styles.actionSubtitle} numberOfLines={1}>
          {isSuccess ? info.subtitle : action.result.message}
        </Text>
      </View>
      {action.result.event_url && (
        <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
      )}
    </TouchableOpacity>
  );
}

function PendingActionCard({ action, onReview }: { action: PendingAction; onReview?: () => void }) {
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
        return {
          useServiceIcon: null,
          icon: 'ellipse' as const,
          color: colors.accent,
          title: 'Pending Action',
          subtitle: action.tool,
        };
    }
  };

  const info = getActionInfo();

  const renderIcon = () => {
    if (info.useServiceIcon === 'gmail') {
      return <GmailIcon size={16} />;
    }
    if (info.useServiceIcon === 'calendar') {
      return <GoogleCalendarIcon size={16} />;
    }
    return <Ionicons name={(info as any).icon || 'ellipse'} size={16} color={info.color} />;
  };

  return (
    <TouchableOpacity
      style={styles.pendingActionCard}
      onPress={onReview}
      activeOpacity={0.7}
    >
      <View style={[styles.actionIcon, { backgroundColor: info.color + '20' }]}>
        {renderIcon()}
      </View>
      <View style={styles.actionContent}>
        <Text style={styles.actionTitle}>{info.title}</Text>
        <Text style={styles.actionSubtitle} numberOfLines={1}>
          {info.subtitle}
        </Text>
      </View>
      <View style={styles.reviewButton}>
        <Text style={styles.reviewButtonText}>Review</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.accent} />
      </View>
    </TouchableOpacity>
  );
}

// Check if response content is specifically about showing/describing a photo
const isResponseAboutPhoto = (content: string): boolean => {
  const lowerContent = content.toLowerCase();

  // Strong indicators - phrases that definitely indicate we're talking about a photo
  const strongPhrases = [
    'here\'s the photo',
    'here is the photo',
    'this photo',
    'that photo',
    'the photo you',
    'photo of',
    'picture of',
    'image of',
    'photo from',
    'picture from',
    'photo shows',
    'picture shows',
    'in this photo',
    'in the photo',
    'in this picture',
    'in the picture',
    'your photo',
    'the image',
  ];

  // If any strong phrase matches, show the photo
  if (strongPhrases.some(phrase => lowerContent.includes(phrase))) {
    return true;
  }

  // Weak indicators - need at least 2 to show photo
  const weakKeywords = ['photo', 'picture', 'image', 'captured', 'snapshot'];
  const weakMatches = weakKeywords.filter(keyword => lowerContent.includes(keyword)).length;

  return weakMatches >= 2;
};

export function ChatBubble({ message, onReviewAction }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const hasActions = message.actionsTaken && message.actionsTaken.length > 0;
  const hasPendingActions = message.pendingActions && message.pendingActions.length > 0;

  // Only show photo if the response is actually about photos
  const shouldShowPhoto = !isUser &&
    message.memoriesUsed?.some(m => m.photo_url && m.memory_type === 'photo') &&
    isResponseAboutPhoto(message.content);

  return (
    <View style={[styles.container, isUser && styles.userContainer]}>
      {/* Completed actions (show before message for assistant) */}
      {!isUser && hasActions && (
        <View style={styles.actionsContainer}>
          {message.actionsTaken!.map((action, index) => (
            <ActionCard key={index} action={action} />
          ))}
        </View>
      )}

      {/* Pending actions needing review */}
      {!isUser && hasPendingActions && (
        <View style={styles.actionsContainer}>
          {message.pendingActions!.map((action, index) => (
            <PendingActionCard
              key={action.action_id || index}
              action={action}
              onReview={() => onReviewAction?.(action)}
            />
          ))}
        </View>
      )}

      {/* Message content - Iris style: no bubble for assistant, bubble for user */}
      {isUser ? (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      ) : (
        <Text style={styles.assistantText}>{message.content}</Text>
      )}

      {/* Show photo only when response is actually about the photo */}
      {shouldShowPhoto && (() => {
        const photoMemory = message.memoriesUsed!.find(m => m.photo_url && m.memory_type === 'photo');
        if (!photoMemory) return null;

        return (
          <View style={styles.photoMemoriesContainer}>
            <PhotoMemoryCard photoUrl={photoMemory.photo_url!} />
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  userContainer: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  // User message - right aligned, no bubble, subtle gray text
  userBubble: {
    alignSelf: 'flex-end',
  },
  userText: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  // Assistant text - no bubble, just clean white text
  assistantText: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  photoMemoriesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  photoMemoryCard: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    position: 'relative',
  },
  photoMemoryError: {
    width: 120,
    height: 120,
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
    width: 120,
    height: 120,
  },
  memoriesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: 4,
  },
  memoriesText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  actionsContainer: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    gap: spacing.sm,
  },
  actionCardError: {
    borderColor: colors.error + '40',
  },
  actionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  pendingActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent + '10',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accent + '30',
    gap: spacing.sm,
  },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.accent + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  reviewButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
});
