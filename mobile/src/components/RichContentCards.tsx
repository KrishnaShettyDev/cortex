/**
 * Rich Content Cards - Display Composio integration data beautifully
 *
 * Renders emails, calendar events, and other integration data
 * in glassmorphic cards within the chat interface.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Image } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing } from '../theme';
import { GmailIcon, GoogleCalendarIcon } from './ServiceIcons';

// ============ EMAIL CARD ============
interface EmailData {
  id?: string;
  thread_id?: string;
  subject: string;
  from: string;
  to?: string[];
  date?: string;
  snippet?: string;
  body?: string;
  is_unread?: boolean;
}

interface EmailCardProps {
  email: EmailData;
  onPress?: () => void;
}

export function EmailCard({ email, onPress }: EmailCardProps) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getSenderName = (from: string) => {
    // Extract name from "Name <email>" format
    const match = from.match(/^([^<]+)/);
    if (match) return match[1].trim();
    return from.split('@')[0];
  };

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <BlurView intensity={20} tint="dark" style={styles.blurContainer}>
        <View style={styles.cardContent}>
          {/* Header with icon and date */}
          <View style={styles.cardHeader}>
            <View style={styles.serviceIconContainer}>
              <GmailIcon size={18} />
            </View>
            <Text style={styles.dateText}>{formatDate(email.date)}</Text>
            {email.is_unread && <View style={styles.unreadDot} />}
          </View>

          {/* Sender */}
          <Text style={styles.senderText} numberOfLines={1}>
            {getSenderName(email.from)}
          </Text>

          {/* Subject */}
          <Text style={styles.subjectText} numberOfLines={1}>
            {email.subject || '(no subject)'}
          </Text>

          {/* Snippet */}
          {email.snippet && (
            <Text style={styles.snippetText} numberOfLines={2}>
              {email.snippet}
            </Text>
          )}
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

// ============ EMAIL LIST ============
interface EmailListProps {
  emails: EmailData[];
  onEmailPress?: (email: EmailData) => void;
  maxItems?: number;
}

export function EmailList({ emails, onEmailPress, maxItems = 3 }: EmailListProps) {
  const displayEmails = emails.slice(0, maxItems);
  const remaining = emails.length - maxItems;

  return (
    <View style={styles.listContainer}>
      {displayEmails.map((email, index) => (
        <EmailCard
          key={email.id || email.thread_id || index}
          email={email}
          onPress={() => onEmailPress?.(email)}
        />
      ))}
      {remaining > 0 && (
        <Text style={styles.remainingText}>+{remaining} more emails</Text>
      )}
    </View>
  );
}

// ============ CALENDAR EVENT CARD ============
interface CalendarEventData {
  id?: string;
  title: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  is_all_day?: boolean;
  event_url?: string;
}

interface CalendarEventCardProps {
  event: CalendarEventData;
  onPress?: () => void;
}

export function CalendarEventCard({ event, onPress }: CalendarEventCardProps) {
  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDateRange = () => {
    if (event.is_all_day) return 'All day';
    if (!event.start_time) return '';

    const start = formatTime(event.start_time);
    const end = event.end_time ? formatTime(event.end_time) : '';

    return end ? `${start} - ${end}` : start;
  };

  const getEventDate = () => {
    if (!event.start_time) return '';
    const date = new Date(event.start_time);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (event.event_url) {
      Linking.openURL(event.event_url);
    }
  };

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <BlurView intensity={20} tint="dark" style={styles.blurContainer}>
        <View style={styles.cardContent}>
          {/* Time bar */}
          <View style={styles.eventTimeBar}>
            <View style={[styles.eventTimeDot, { backgroundColor: colors.calendar }]} />
            <Text style={styles.eventTimeText}>{formatDateRange()}</Text>
            <Text style={styles.eventDateBadge}>{getEventDate()}</Text>
          </View>

          {/* Title with calendar icon */}
          <View style={styles.eventTitleRow}>
            <GoogleCalendarIcon size={16} />
            <Text style={styles.eventTitleText} numberOfLines={2}>
              {event.title}
            </Text>
          </View>

          {/* Location */}
          {event.location && (
            <View style={styles.eventDetailRow}>
              <Ionicons name="location-outline" size={14} color={colors.textTertiary} />
              <Text style={styles.eventDetailText} numberOfLines={1}>
                {event.location}
              </Text>
            </View>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <View style={styles.eventDetailRow}>
              <Ionicons name="people-outline" size={14} color={colors.textTertiary} />
              <Text style={styles.eventDetailText} numberOfLines={1}>
                {event.attendees.length} attendee{event.attendees.length > 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

// ============ CALENDAR EVENT LIST ============
interface CalendarEventListProps {
  events: CalendarEventData[];
  onEventPress?: (event: CalendarEventData) => void;
  maxItems?: number;
}

export function CalendarEventList({ events, onEventPress, maxItems = 3 }: CalendarEventListProps) {
  const displayEvents = events.slice(0, maxItems);
  const remaining = events.length - maxItems;

  return (
    <View style={styles.listContainer}>
      {displayEvents.map((event, index) => (
        <CalendarEventCard
          key={event.id || index}
          event={event}
          onPress={() => onEventPress?.(event)}
        />
      ))}
      {remaining > 0 && (
        <Text style={styles.remainingText}>+{remaining} more events</Text>
      )}
    </View>
  );
}

// ============ FREE TIME SLOTS ============
interface TimeSlotData {
  start: string;
  end: string;
  duration_minutes: number;
}

interface FreeTimeSlotsProps {
  slots: TimeSlotData[];
  onSlotPress?: (slot: TimeSlotData) => void;
  maxItems?: number;
}

export function FreeTimeSlots({ slots, onSlotPress, maxItems = 4 }: FreeTimeSlotsProps) {
  const displaySlots = slots.slice(0, maxItems);
  const remaining = slots.length - maxItems;

  const formatSlotTime = (slot: TimeSlotData) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);

    const dateStr = start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });

    return { dateStr, timeRange: `${startTime} - ${endTime}` };
  };

  return (
    <View style={styles.slotsContainer}>
      <View style={styles.slotsHeader}>
        <Ionicons name="time-outline" size={16} color={colors.accent} />
        <Text style={styles.slotsTitle}>Available Times</Text>
      </View>
      <View style={styles.slotsGrid}>
        {displaySlots.map((slot, index) => {
          const { dateStr, timeRange } = formatSlotTime(slot);
          return (
            <TouchableOpacity
              key={index}
              style={styles.slotChip}
              onPress={() => onSlotPress?.(slot)}
              activeOpacity={0.7}
            >
              <Text style={styles.slotDate}>{dateStr}</Text>
              <Text style={styles.slotTime}>{timeRange}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {remaining > 0 && (
        <Text style={styles.remainingText}>+{remaining} more slots</Text>
      )}
    </View>
  );
}

// ============ PLACES RESULT ============
interface PlaceData {
  name: string;
  address?: string;
  rating?: number;
  price_level?: number;
  types?: string[];
  distance?: string;
}

interface PlacesListProps {
  places: PlaceData[];
  onPlacePress?: (place: PlaceData) => void;
  maxItems?: number;
}

export function PlacesList({ places, onPlacePress, maxItems = 3 }: PlacesListProps) {
  const displayPlaces = places.slice(0, maxItems);
  const remaining = places.length - maxItems;

  return (
    <View style={styles.listContainer}>
      {displayPlaces.map((place, index) => (
        <TouchableOpacity
          key={index}
          style={styles.placeCard}
          onPress={() => onPlacePress?.(place)}
          activeOpacity={0.7}
        >
          <View style={styles.placeIconContainer}>
            <Ionicons name="location" size={18} color={colors.success} />
          </View>
          <View style={styles.placeContent}>
            <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
            {place.address && (
              <Text style={styles.placeAddress} numberOfLines={1}>{place.address}</Text>
            )}
            {place.rating && (
              <View style={styles.placeRating}>
                <Ionicons name="star" size={12} color="#FFD700" />
                <Text style={styles.placeRatingText}>{place.rating.toFixed(1)}</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      ))}
      {remaining > 0 && (
        <Text style={styles.remainingText}>+{remaining} more places</Text>
      )}
    </View>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  // Card container
  cardContainer: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  blurContainer: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  cardContent: {
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },

  // Card header
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  serviceIconContainer: {
    marginRight: spacing.xs,
  },
  dateText: {
    flex: 1,
    fontSize: 12,
    color: colors.textTertiary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },

  // Email specific
  senderText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subjectText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  snippetText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Event specific
  eventTimeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  eventTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  eventTimeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  eventDateBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  eventTitleText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  eventDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  eventDetailText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },

  // List container
  listContainer: {
    gap: spacing.sm,
  },
  remainingText: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // Free time slots
  slotsContainer: {
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  slotsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  slotsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  slotChip: {
    backgroundColor: colors.accent + '15',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.accent + '30',
  },
  slotDate: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  slotTime: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },

  // Places
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    gap: spacing.sm,
  },
  placeIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.success + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeContent: {
    flex: 1,
  },
  placeName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  placeAddress: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  placeRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
  },
  placeRatingText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});

export type { EmailData, CalendarEventData, TimeSlotData, PlaceData };
