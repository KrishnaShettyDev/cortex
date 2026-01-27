import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from './BottomSheet';
import { colors, gradients, spacing, borderRadius, useTheme } from '../theme';
import { integrationsService, TimeSlot } from '../services/integrations';
import { ParsedEvent } from './EventConfirmationModal';
import { logger } from '../utils/logger';

interface FindTimeSheetProps {
  visible: boolean;
  onClose: () => void;
  selectedDate: Date;
  onSlotSelected: (slot: TimeSlot) => void;
}

// Duration options in minutes
const DURATION_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
];

// Date range options
const DATE_RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: 'This Week', value: 'week' },
];

// Time range presets
const TIME_RANGE_OPTIONS = [
  { label: 'Morning', value: { start: 8, end: 12 }, icon: 'sunny-outline' },
  { label: 'Afternoon', value: { start: 12, end: 17 }, icon: 'partly-sunny-outline' },
  { label: 'Evening', value: { start: 17, end: 21 }, icon: 'moon-outline' },
  { label: 'Work Hours', value: { start: 9, end: 18 }, icon: 'briefcase-outline' },
];

export const FindTimeSheet: React.FC<FindTimeSheetProps> = ({
  visible,
  onClose,
  selectedDate,
  onSlotSelected,
}) => {
  const { colors: themeColors, gradients: themeGradients } = useTheme();
  const [duration, setDuration] = useState(30);
  const [dateRange, setDateRange] = useState<'today' | 'tomorrow' | 'week'>('today');
  const [timeRange, setTimeRange] = useState({ start: 9, end: 18 });
  const [isSearching, setIsSearching] = useState(false);
  const [freeSlots, setFreeSlots] = useState<TimeSlot[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get dates to search based on range
  const getDatesToSearch = useCallback((): Date[] => {
    const dates: Date[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (dateRange) {
      case 'today':
        dates.push(new Date(today));
        break;
      case 'tomorrow':
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dates.push(tomorrow);
        break;
      case 'week':
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          // Skip weekends for work hours
          if (timeRange.start === 9 && timeRange.end === 18) {
            if (date.getDay() !== 0 && date.getDay() !== 6) {
              dates.push(date);
            }
          } else {
            dates.push(date);
          }
        }
        break;
    }
    return dates;
  }, [dateRange, timeRange]);

  const handleSearch = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSearching(true);
    setError(null);
    setFreeSlots([]);
    setHasSearched(true);

    try {
      const dates = getDatesToSearch();
      const allSlots: TimeSlot[] = [];

      for (const date of dates) {
        const dateStr = date.toISOString().split('T')[0];
        const result = await integrationsService.getCalendarAvailability(
          dateStr,
          duration,
          timeRange.start,
          timeRange.end
        );

        if (result.success && result.free_slots) {
          allSlots.push(...result.free_slots);
        }
      }

      // Sort slots by start time
      allSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      setFreeSlots(allSlots);
    } catch (err: any) {
      logger.error('Error finding free time:', err);
      setError('Failed to find available times. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [duration, timeRange, getDatesToSearch]);

  const handleSlotPress = useCallback((slot: TimeSlot) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSlotSelected(slot);
    onClose();
  }, [onSlotSelected, onClose]);

  const formatSlotTime = (slot: TimeSlot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);

    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };

    return `${start.toLocaleTimeString('en-US', timeOptions)} - ${end.toLocaleTimeString('en-US', timeOptions)}`;
  };

  const formatSlotDate = (slot: TimeSlot) => {
    const date = new Date(slot.start);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Group slots by date
  const groupedSlots = useMemo(() => {
    const groups: { [key: string]: TimeSlot[] } = {};
    freeSlots.forEach(slot => {
      const dateKey = new Date(slot.start).toDateString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(slot);
    });
    return groups;
  }, [freeSlots]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="auto"
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="time-outline" size={24} color={themeColors.accent} />
          </View>
          <Text style={[styles.headerTitle, { color: themeColors.textPrimary }]}>Find Free Time</Text>
          <TouchableOpacity style={[styles.closeButton, { backgroundColor: themeColors.bgTertiary }]} onPress={onClose}>
            <Ionicons name="close" size={24} color={themeColors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Duration Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: themeColors.textTertiary }]}>Duration needed</Text>
          <View style={styles.chipRow}>
            {DURATION_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  { backgroundColor: themeColors.bgTertiary },
                  duration === option.value && styles.chipSelected,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDuration(option.value);
                }}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: themeColors.textSecondary },
                    duration === option.value && styles.chipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date Range Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: themeColors.textTertiary }]}>When</Text>
          <View style={styles.chipRow}>
            {DATE_RANGE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  { backgroundColor: themeColors.bgTertiary },
                  dateRange === option.value && styles.chipSelected,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDateRange(option.value as typeof dateRange);
                }}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: themeColors.textSecondary },
                    dateRange === option.value && styles.chipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Time Range Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: themeColors.textTertiary }]}>Time of day</Text>
          <View style={styles.timeRangeRow}>
            {TIME_RANGE_OPTIONS.map((option) => {
              const isSelected =
                timeRange.start === option.value.start &&
                timeRange.end === option.value.end;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.timeChip,
                    { backgroundColor: themeColors.bgTertiary },
                    isSelected && styles.timeChipSelected,
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTimeRange(option.value);
                  }}
                >
                  <Ionicons
                    name={option.icon as any}
                    size={16}
                    color={isSelected ? themeColors.accent : themeColors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.timeChipText,
                      { color: themeColors.textSecondary },
                      isSelected && styles.timeChipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Search Button */}
        <TouchableOpacity
          style={styles.searchButton}
          onPress={handleSearch}
          disabled={isSearching}
        >
          <LinearGradient
            colors={themeGradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.searchGradient}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="search" size={18} color="#fff" />
                <Text style={styles.searchButtonText}>Find Available Slots</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Results */}
        {hasSearched && !isSearching && (
          <View style={styles.resultsSection}>
            {error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={24} color={themeColors.error} />
                <Text style={[styles.errorText, { color: themeColors.error }]}>{error}</Text>
              </View>
            ) : freeSlots.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="calendar-outline" size={24} color={themeColors.textTertiary} />
                <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No available slots found</Text>
                <Text style={[styles.emptySubtext, { color: themeColors.textTertiary }]}>Try a different time range or date</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.resultsTitle, { color: themeColors.textPrimary }]}>
                  {freeSlots.length} slot{freeSlots.length !== 1 ? 's' : ''} available
                </Text>
                <ScrollView
                  style={styles.slotsList}
                  showsVerticalScrollIndicator={false}
                >
                  {Object.entries(groupedSlots).map(([dateKey, slots]) => (
                    <View key={dateKey}>
                      <Text style={[styles.dateHeader, { color: themeColors.textSecondary }]}>
                        {formatSlotDate(slots[0])}
                      </Text>
                      {slots.map((slot, index) => (
                        <TouchableOpacity
                          key={`${slot.start}-${index}`}
                          style={[styles.slotItem, { backgroundColor: themeColors.bgTertiary }]}
                          onPress={() => handleSlotPress(slot)}
                        >
                          <View style={styles.slotTimeContainer}>
                            <Ionicons
                              name="time-outline"
                              size={16}
                              color={themeColors.textSecondary}
                            />
                            <Text style={[styles.slotTime, { color: themeColors.textPrimary }]}>
                              {formatSlotTime(slot)}
                            </Text>
                          </View>
                          <View style={[styles.slotDuration, { backgroundColor: themeColors.bgSecondary }]}>
                            <Text style={[styles.slotDurationText, { color: themeColors.textTertiary }]}>
                              {slot.duration_minutes} min
                            </Text>
                          </View>
                          <Ionicons
                            name="add-circle-outline"
                            size={24}
                            color={themeColors.accent}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        )}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xl + 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(66, 133, 244, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: spacing.md,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: 'rgba(66, 133, 244, 0.15)',
    borderColor: '#4285F4',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: '#4285F4',
  },
  timeRangeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  timeChipSelected: {
    backgroundColor: 'rgba(66, 133, 244, 0.15)',
    borderColor: '#4285F4',
  },
  timeChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeChipTextSelected: {
    color: '#4285F4',
  },
  searchButton: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  searchGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  searchButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  resultsSection: {
    marginTop: spacing.lg,
  },
  resultsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  slotsList: {
    maxHeight: 250,
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  slotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  slotTimeContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slotTime: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  slotDuration: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.sm,
    marginRight: spacing.md,
  },
  slotDurationText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: borderRadius.md,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});

export default FindTimeSheet;
