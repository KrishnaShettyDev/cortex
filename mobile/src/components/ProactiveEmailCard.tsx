/**
 * ProactiveEmailCard - Poke/Iris-style email display
 *
 * Rich, interactive email cards with quick actions.
 * Features:
 * - Sender avatar/initial with brand colors
 * - Priority/urgency badges
 * - Quick action buttons (Reply, Archive, Star, etc.)
 * - Expandable content
 * - Glassmorphic design
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { spacing, borderRadius, useTheme } from '../theme';
import { GmailIcon } from './ServiceIcons';

// ============ TYPES ============
export interface ProactiveEmailData {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  fromEmail?: string;
  to?: string[];
  date: string;
  snippet?: string;
  body?: string;
  isUnread?: boolean;
  isStarred?: boolean;
  isImportant?: boolean;
  labels?: string[];
  attachmentCount?: number;
}

export interface ProactiveEmailAction {
  type: 'reply' | 'archive' | 'star' | 'markRead' | 'delete' | 'snooze' | 'forward' | 'open';
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface ProactiveEmailCardProps {
  email: ProactiveEmailData;
  onAction?: (action: ProactiveEmailAction, email: ProactiveEmailData) => Promise<void>;
  onPress?: (email: ProactiveEmailData) => void;
  showActions?: boolean;
  compact?: boolean;
}

// ============ HELPER FUNCTIONS ============

const getInitials = (name: string): string => {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const getSenderName = (from: string): string => {
  // Extract name from "Name <email>" format
  const match = from.match(/^([^<]+)/);
  if (match) return match[1].trim();
  return from.split('@')[0];
};

const getSenderEmail = (from: string): string => {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1];
  return from;
};

const getAvatarColor = (email: string): string => {
  // Generate consistent color based on email
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#00CED1', '#FF7F50', '#9370DB', '#20B2AA',
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isUrgent = (email: ProactiveEmailData): boolean => {
  const urgentKeywords = ['urgent', 'asap', 'action required', 'immediate', 'critical'];
  const subject = email.subject.toLowerCase();
  const snippet = (email.snippet || '').toLowerCase();
  return urgentKeywords.some(keyword =>
    subject.includes(keyword) || snippet.includes(keyword)
  ) || email.isImportant === true;
};

// ============ DEFAULT ACTIONS ============
const DEFAULT_ACTIONS: ProactiveEmailAction[] = [
  { type: 'reply', label: 'Reply', icon: 'arrow-undo' },
  { type: 'archive', label: 'Archive', icon: 'archive' },
  { type: 'star', label: 'Star', icon: 'star-outline' },
  { type: 'markRead', label: 'Read', icon: 'checkmark-done' },
];

// ============ ACTION COLORS ============
const ACTION_STYLES: Record<string, { bg: string; text: string }> = {
  reply: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
  archive: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9CA3AF' },
  star: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  markRead: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22C55E' },
  delete: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
  snooze: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
  forward: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
  open: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
};

// ============ MAIN COMPONENT ============
export function ProactiveEmailCard({
  email,
  onAction,
  onPress,
  showActions = true,
  compact = false,
}: ProactiveEmailCardProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const senderName = getSenderName(email.from);
  const senderEmail = email.fromEmail || getSenderEmail(email.from);
  const avatarColor = getAvatarColor(senderEmail);
  const urgent = isUrgent(email);

  const handleAction = async (action: ProactiveEmailAction) => {
    if (!onAction || loadingAction) return;

    setLoadingAction(action.type);
    try {
      await onAction(action, email);
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePress = () => {
    if (onPress) {
      onPress(email);
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <View style={styles.container}>
      <BlurView
        intensity={20}
        tint={isDark ? 'dark' : 'light'}
        style={[
          styles.blurContainer,
          { borderColor: urgent ? themeColors.error + '40' : themeColors.glassBorder }
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePress}
          style={[
            styles.cardContent,
            { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)' }
          ]}
        >
          {/* Urgent indicator bar */}
          {urgent && (
            <View style={[styles.urgentBar, { backgroundColor: themeColors.error }]} />
          )}

          {/* Header Row */}
          <View style={styles.headerRow}>
            {/* Avatar */}
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{getInitials(senderName)}</Text>
            </View>

            {/* Sender & Meta */}
            <View style={styles.headerContent}>
              <View style={styles.senderRow}>
                <Text
                  style={[
                    styles.senderName,
                    { color: themeColors.textPrimary },
                    email.isUnread && styles.unreadText
                  ]}
                  numberOfLines={1}
                >
                  {senderName}
                </Text>
                {email.isStarred && (
                  <Ionicons name="star" size={14} color="#F59E0B" style={styles.starIcon} />
                )}
              </View>
              <Text style={[styles.dateText, { color: themeColors.textTertiary }]}>
                {formatDate(email.date)}
              </Text>
            </View>

            {/* Service Icon & Badges */}
            <View style={styles.badgeContainer}>
              {urgent && (
                <View style={[styles.urgentBadge, { backgroundColor: themeColors.error + '20' }]}>
                  <Text style={[styles.urgentBadgeText, { color: themeColors.error }]}>Urgent</Text>
                </View>
              )}
              {email.isUnread && (
                <View style={[styles.unreadDot, { backgroundColor: themeColors.accent }]} />
              )}
              <GmailIcon size={16} />
            </View>
          </View>

          {/* Subject */}
          <Text
            style={[
              styles.subject,
              { color: themeColors.textPrimary },
              email.isUnread && styles.unreadText
            ]}
            numberOfLines={compact ? 1 : 2}
          >
            {email.subject || '(no subject)'}
          </Text>

          {/* Snippet */}
          {email.snippet && !compact && (
            <Text
              style={[styles.snippet, { color: themeColors.textSecondary }]}
              numberOfLines={expanded ? undefined : 2}
            >
              {email.snippet}
            </Text>
          )}

          {/* Attachments indicator */}
          {email.attachmentCount && email.attachmentCount > 0 && (
            <View style={styles.attachmentRow}>
              <Ionicons name="attach" size={14} color={themeColors.textTertiary} />
              <Text style={[styles.attachmentText, { color: themeColors.textTertiary }]}>
                {email.attachmentCount} attachment{email.attachmentCount > 1 ? 's' : ''}
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          {showActions && (
            <View style={styles.actionsContainer}>
              <View style={[styles.actionsDivider, { backgroundColor: themeColors.separator }]} />
              <View style={styles.actionsRow}>
                {DEFAULT_ACTIONS.map((action) => {
                  const actionStyle = ACTION_STYLES[action.type];
                  const isLoading = loadingAction === action.type;
                  const isStarred = action.type === 'star' && email.isStarred;

                  return (
                    <TouchableOpacity
                      key={action.type}
                      style={[styles.actionButton, { backgroundColor: actionStyle.bg }]}
                      onPress={() => handleAction(action)}
                      disabled={!!loadingAction}
                      activeOpacity={0.7}
                    >
                      {isLoading ? (
                        <ActivityIndicator size="small" color={actionStyle.text} />
                      ) : (
                        <>
                          <Ionicons
                            name={isStarred ? 'star' : (action.icon || 'ellipsis-horizontal')}
                            size={14}
                            color={isStarred ? '#F59E0B' : actionStyle.text}
                          />
                          <Text style={[styles.actionLabel, { color: actionStyle.text }]}>
                            {action.label}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </TouchableOpacity>
      </BlurView>
    </View>
  );
}

// ============ EMAIL LIST COMPONENT ============
interface ProactiveEmailListProps {
  emails: ProactiveEmailData[];
  onAction?: (action: ProactiveEmailAction, email: ProactiveEmailData) => Promise<void>;
  onEmailPress?: (email: ProactiveEmailData) => void;
  maxItems?: number;
  showHeader?: boolean;
}

export function ProactiveEmailList({
  emails,
  onAction,
  onEmailPress,
  maxItems = 5,
  showHeader = true,
}: ProactiveEmailListProps) {
  const { colors: themeColors, isDark } = useTheme();
  const displayEmails = emails.slice(0, maxItems);
  const remaining = emails.length - maxItems;

  return (
    <View style={styles.listContainer}>
      {/* Header */}
      {showHeader && (
        <View style={styles.listHeader}>
          <View style={[styles.listHeaderIcon, { backgroundColor: '#EA4335' + '20' }]}>
            <GmailIcon size={18} />
          </View>
          <Text style={[styles.listHeaderTitle, { color: themeColors.textPrimary }]}>
            Today's Emails
          </Text>
          <Text style={[styles.listHeaderCount, { color: themeColors.textTertiary }]}>
            {emails.length} message{emails.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Email Cards */}
      {displayEmails.map((email, index) => (
        <ProactiveEmailCard
          key={email.id || email.threadId || index}
          email={email}
          onAction={onAction}
          onPress={onEmailPress}
        />
      ))}

      {/* Show More */}
      {remaining > 0 && (
        <TouchableOpacity
          style={[styles.showMoreButton, { backgroundColor: themeColors.fill }]}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-down" size={16} color={themeColors.accent} />
          <Text style={[styles.showMoreText, { color: themeColors.accent }]}>
            Show {remaining} more email{remaining > 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  blurContainer: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardContent: {
    padding: spacing.md,
    position: 'relative',
  },

  // Urgent indicator
  urgentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.lg,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  headerContent: {
    flex: 1,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  senderName: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  unreadText: {
    fontWeight: '600',
  },
  starIcon: {
    marginLeft: spacing.xs,
  },
  dateText: {
    fontSize: 12,
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  urgentBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  urgentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Content
  subject: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  snippet: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Attachments
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  attachmentText: {
    fontSize: 12,
  },

  // Actions
  actionsContainer: {
    marginTop: spacing.md,
  },
  actionsDivider: {
    height: 1,
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    minWidth: 60,
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },

  // List
  listContainer: {
    gap: spacing.sm,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  listHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  listHeaderTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  listHeaderCount: {
    fontSize: 13,
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
