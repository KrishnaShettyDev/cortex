/**
 * DateStripScroller - Horizontal scrollable date selector
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CalendarEventItem } from '../services';
import { colors, spacing, borderRadius } from '../theme';
import {
  DAYS_SINGLE,
  DATE_STRIP_ITEM_WIDTH,
  isSameDay,
} from '../utils/calendarHelpers';

interface DateStripProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  cachedEvents: CalendarEventItem[];
}

export const DateStripScroller: React.FC<DateStripProps> = ({
  selectedDate,
  onDateSelect,
  cachedEvents,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const [centerDate] = useState(new Date());

  // Generate 21 days (3 weeks) centered around center date
  const dates = useMemo(() => {
    const result: Date[] = [];
    const start = new Date(centerDate);
    start.setDate(start.getDate() - 10);

    for (let i = 0; i < 21; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      result.push(d);
    }
    return result;
  }, [centerDate]);

  // Check if a date has events
  const dateHasEvents = useCallback((date: Date): boolean => {
    return cachedEvents.some(event => {
      const eventDate = new Date(event.start_time);
      return eventDate.getFullYear() === date.getFullYear() &&
             eventDate.getMonth() === date.getMonth() &&
             eventDate.getDate() === date.getDate();
    });
  }, [cachedEvents]);

  // Scroll to center when date changes
  useEffect(() => {
    const index = dates.findIndex(d => isSameDay(d, selectedDate));
    if (index !== -1 && scrollViewRef.current) {
      const scrollX = (index - 3) * DATE_STRIP_ITEM_WIDTH;
      scrollViewRef.current.scrollTo({ x: Math.max(0, scrollX), animated: true });
    }
  }, [selectedDate, dates]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={DATE_STRIP_ITEM_WIDTH}
      >
        {dates.map((date, index) => {
          const isToday = isSameDay(date, new Date());
          const isSelected = isSameDay(date, selectedDate);
          const hasEvents = dateHasEvents(date);
          const dayOfWeek = date.getDay();

          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.dateItem,
                isSelected && styles.dateItemSelected,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDateSelect(date);
              }}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.dayLetter,
                isToday && styles.dayLetterToday,
                isSelected && styles.dayLetterSelected,
              ]}>
                {DAYS_SINGLE[dayOfWeek]}
              </Text>
              <View style={[
                styles.dateCircle,
                isToday && !isSelected && styles.dateCircleToday,
                isSelected && styles.dateCircleSelected,
              ]}>
                <Text style={[
                  styles.dateNumber,
                  isToday && styles.dateNumberToday,
                  isSelected && styles.dateNumberSelected,
                ]}>
                  {date.getDate()}
                </Text>
              </View>
              {hasEvents && !isSelected && (
                <View style={styles.eventDot} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  scrollContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dateItem: {
    width: DATE_STRIP_ITEM_WIDTH,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dateItemSelected: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.lg,
  },
  dayLetter: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textTertiary,
    marginBottom: 4,
  },
  dayLetterToday: {
    color: '#4285f4',
  },
  dayLetterSelected: {
    color: colors.textPrimary,
  },
  dateCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCircleToday: {
    borderWidth: 2,
    borderColor: '#4285f4',
  },
  dateCircleSelected: {
    backgroundColor: '#4285f4',
  },
  dateNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateNumberToday: {
    color: '#4285f4',
  },
  dateNumberSelected: {
    color: '#fff',
  },
  eventDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 4,
  },
});
