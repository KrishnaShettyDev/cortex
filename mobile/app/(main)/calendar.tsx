import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Dimensions,
  Animated,
  Linking,
  Pressable,
  Modal,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { integrationsService, CalendarEventItem, MeetingType, TimeSlot, CreateCalendarEventRequest } from '../../src/services';
import { colors, gradients, spacing, borderRadius } from '../../src/theme';
import { GradientIcon, CalendarSkeletonLoader } from '../../src/components';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';
import { ConflictIndicator, ConflictBanner, CONFLICT_COLOR, CONFLICT_BORDER_COLOR } from '../../src/components/ConflictIndicator';
import { detectConflicts, getConflictingEvents, ConflictInfo } from '../../src/utils/calendarConflicts';
import { QuickAddInput } from '../../src/components/QuickAddInput';
import { FindTimeSheet } from '../../src/components/FindTimeSheet';
import { EventConfirmationModal, ParsedEvent } from '../../src/components/EventConfirmationModal';
import { useCalendarStore } from '../../src/stores/calendarStore';
import {
  START_HOUR,
  END_HOUR,
  HOUR_HEIGHT,
  MONTHS,
  MONTHS_SHORT,
  DAYS,
  DAYS_SHORT,
  DAYS_SINGLE,
  WEEK_VIEW_DAYS,
  DATE_STRIP_ITEM_WIDTH,
  DATE_STRIP_DAYS_VISIBLE,
  SWIPE_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
  ViewMode,
  EventWithLayout,
  getDaysInMonth,
  getFirstDayOfMonth,
  generateCalendarDays,
  getWeekViewDates,
  formatWeekRange,
  calculateEventLayout,
  formatTimeRange,
  isSameDay,
} from '../../src/utils/calendarHelpers';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

// Meeting type logo and color configuration
// Using official Google logos (local assets)
// IMPORTANT: Run `npx expo start --clear` to pick up new assets
const GOOGLE_MEET_LOGO = require('../../assets/google-meet-logo.png');
const GOOGLE_CALENDAR_LOGO = require('../../assets/google-calendar-logo.png');

const MEETING_TYPE_CONFIG: Record<MeetingType, {
  logo: any;
  fallbackIcon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}> = {
  google_meet: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Google Meet'
  },
  zoom: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  teams: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  webex: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  video: {
    logo: GOOGLE_MEET_LOGO,
    fallbackIcon: 'videocam',
    color: '#00897B',
    bgColor: 'rgba(0, 137, 123, 0.15)',
    borderColor: '#00897B',
    label: 'Video Meeting'
  },
  offline: {
    logo: GOOGLE_CALENDAR_LOGO,
    fallbackIcon: 'calendar',
    color: '#4285F4',
    bgColor: 'rgba(66, 133, 244, 0.15)',
    borderColor: '#4285F4',
    label: 'Event'
  },
};

// Date Strip Scroller Component - horizontal scrollable week with tappable dates

interface DateStripProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  cachedEvents: CalendarEventItem[];
}

const DateStripScroller: React.FC<DateStripProps> = ({ selectedDate, onDateSelect, cachedEvents }) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const [centerDate, setCenterDate] = useState(new Date());

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
    <View style={dateStripStyles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={dateStripStyles.scrollContent}
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
                dateStripStyles.dateItem,
                isSelected && dateStripStyles.dateItemSelected,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDateSelect(date);
              }}
              activeOpacity={0.7}
            >
              <Text style={[
                dateStripStyles.dayLetter,
                isToday && dateStripStyles.dayLetterToday,
                isSelected && dateStripStyles.dayLetterSelected,
              ]}>
                {DAYS_SINGLE[dayOfWeek]}
              </Text>
              <View style={[
                dateStripStyles.dateCircle,
                isToday && !isSelected && dateStripStyles.dateCircleToday,
                isSelected && dateStripStyles.dateCircleSelected,
              ]}>
                <Text style={[
                  dateStripStyles.dateNumber,
                  isToday && dateStripStyles.dateNumberToday,
                  isSelected && dateStripStyles.dateNumberSelected,
                ]}>
                  {date.getDate()}
                </Text>
              </View>
              {hasEvents && !isSelected && (
                <View style={dateStripStyles.eventDot} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const dateStripStyles = StyleSheet.create({
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

// Meeting Type Logo Component
const MeetingTypeLogo = ({
  meetingType,
  size = 16,
}: {
  meetingType: MeetingType;
  size?: number;
}) => {
  const config = MEETING_TYPE_CONFIG[meetingType];

  // Show local logo image
  if (config.logo) {
    return (
      <Image
        source={config.logo}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  // Fallback to icon
  return (
    <Ionicons
      name={config.fallbackIcon as any}
      size={size}
      color={config.color}
    />
  );
};

// Animated view for swipe
const AnimatedView = Reanimated.createAnimatedComponent(View);

export default function CalendarScreen() {
  const posthog = usePostHog();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolledToTime = useRef(false);

  // Find Time Sheet state
  const [showFindTimeSheet, setShowFindTimeSheet] = useState(false);
  const [showNewEventModal, setShowNewEventModal] = useState(false);
  const [newEventData, setNewEventData] = useState<ParsedEvent | null>(null);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  // Mini calendar expanded state
  const [isMiniCalendarExpanded, setIsMiniCalendarExpanded] = useState(false);

  // Swipe gesture animation values
  const translateX = useSharedValue(0);
  const isGestureActive = useSharedValue(false);

  // Use calendar store for caching events across navigation
  const {
    events: cachedEvents,
    isLoading,
    error,
    isConnected,
    cachedMonthKey,
    setEvents,
    setLoading,
    setError,
    setConnected,
    isCacheValid,
    invalidateCache,
  } = useCalendarStore();

  // Get current month key for cache invalidation
  const currentMonthKey = useMemo(() => {
    return `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  }, [selectedDate]);

  // Filter events for selected date from cache (INSTANT - no API call)
  const events = useMemo(() => {
    return cachedEvents.filter(event => {
      const eventDate = new Date(event.start_time);
      return isSameDay(eventDate, selectedDate);
    });
  }, [cachedEvents, selectedDate]);

  // Group events by date for week view (INSTANT - from cache)
  const weekEvents = useMemo(() => {
    const eventsByDate = new Map<string, CalendarEventItem[]>();
    cachedEvents.forEach(event => {
      const eventDate = new Date(event.start_time);
      const dateKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;
      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, []);
      }
      eventsByDate.get(dateKey)!.push(event);
    });
    return eventsByDate;
  }, [cachedEvents]);

  // Detect conflicts between events (client-side)
  const eventConflicts = useMemo(() => {
    return detectConflicts(cachedEvents);
  }, [cachedEvents]);

  // Get conflicts for selected event (for modal display)
  const selectedEventConflicts = useMemo(() => {
    if (!selectedEvent) return [];
    return getConflictingEvents(selectedEvent, cachedEvents);
  }, [selectedEvent, cachedEvents]);

  // Track calendar viewed
  useEffect(() => {
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_VIEWED);
  }, []);

  // State for the calendar picker view
  const [pickerMonth, setPickerMonth] = useState(new Date().getMonth());
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const monthScrollRef = useRef<ScrollView>(null);

  // Get week dates for week view (3 days centered around selected date)
  const weekDates = useMemo(() => getWeekViewDates(selectedDate), [selectedDate]);

  // Format the selected date for display
  const dateDisplay = useMemo(() => {
    const day = selectedDate.getDate();
    const dayName = DAYS[selectedDate.getDay()];
    const month = MONTHS[selectedDate.getMonth()];
    const isToday = isSameDay(selectedDate, new Date());
    return { day, dayName, month, isToday };
  }, [selectedDate]);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to current time when loaded (only once per date)
  useEffect(() => {
    if (!isLoading && isConnected && !error && dateDisplay.isToday && !hasScrolledToTime.current) {
      const hours = new Date().getHours();
      // Scroll to 2 hours before current time for context
      const scrollToHour = Math.max(hours - 2, START_HOUR);
      const scrollY = (scrollToHour - START_HOUR) * HOUR_HEIGHT;

      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: scrollY, animated: true });
      }, 300);
      hasScrolledToTime.current = true;
    }
  }, [isLoading, isConnected, error, dateDisplay.isToday]);

  // Reset scroll flag when date changes
  useEffect(() => {
    hasScrolledToTime.current = false;
  }, [selectedDate]);

  // Load events when MONTH changes (not every date change!)
  useEffect(() => {
    // Only fetch if cache is invalid for this month
    if (!isCacheValid(currentMonthKey)) {
      loadMonthEvents();
    }
  }, [currentMonthKey]);

  // Initial load - only if cache is not valid
  useEffect(() => {
    if (!isCacheValid(currentMonthKey)) {
      loadMonthEvents();
    }
  }, []);

  const loadMonthEvents = useCallback(async (forceRefresh = false) => {
    // Skip if cache is valid and not forcing refresh
    if (!forceRefresh && isCacheValid(currentMonthKey)) {
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Check connection status first
      const status = await integrationsService.getStatus();
      setConnected(status.google.calendar_connected);

      if (!status.google.calendar_connected) {
        setEvents([], currentMonthKey);
        setLoading(false);
        return;
      }

      // Fetch events for the ENTIRE MONTH (plus a few days before/after for week view)
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();

      // Start from a few days before month start (for week view)
      const startOfMonth = new Date(year, month, 1);
      startOfMonth.setDate(startOfMonth.getDate() - 7);
      startOfMonth.setHours(0, 0, 0, 0);

      // End a few days after month end (for week view)
      const endOfMonth = new Date(year, month + 1, 0);
      endOfMonth.setDate(endOfMonth.getDate() + 7);
      endOfMonth.setHours(23, 59, 59, 999);

      const response = await integrationsService.getCalendarEvents(startOfMonth, endOfMonth);

      if (response.success) {
        setEvents(response.events, currentMonthKey);
        setError(null);
      } else {
        setEvents([], currentMonthKey);
        setError(response.message || 'Failed to load events');
      }
    } catch (err: any) {
      console.error('Failed to load calendar events:', err);
      setEvents([], currentMonthKey);
      // Show user-friendly error message
      if (err.message?.includes('timed out')) {
        setError('Loading took too long. Please try again.');
      } else if (err.message?.includes('connection')) {
        setError('Connection issue. Please check your network.');
      } else {
        setError('Could not load events. Pull down to retry.');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedDate, currentMonthKey, isCacheValid, setEvents, setLoading, setError, setConnected]);

  const onRefresh = useCallback(() => {
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_REFRESHED);
    setIsRefreshing(true);
    // Force refresh by clearing cache
    invalidateCache();
    loadMonthEvents(true);
  }, [loadMonthEvents]);

  const goToToday = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDate(new Date());
  }, []);

  const goToPreviousDay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  }, [selectedDate]);

  const goToNextDay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  }, [selectedDate]);

  // Week navigation (move by WEEK_VIEW_DAYS instead of 7)
  const goToPreviousWeek = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - WEEK_VIEW_DAYS);
    setSelectedDate(newDate);
  }, [selectedDate]);

  const goToNextWeek = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + WEEK_VIEW_DAYS);
    setSelectedDate(newDate);
  }, [selectedDate]);

  // Swipe gesture for date navigation
  const swipeGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onStart(() => {
      isGestureActive.value = true;
    })
    .onUpdate((event) => {
      // Limit the translation for a subtle drag effect
      translateX.value = event.translationX * 0.3;
    })
    .onEnd((event) => {
      const shouldNavigate =
        Math.abs(event.translationX) > SWIPE_THRESHOLD ||
        Math.abs(event.velocityX) > SWIPE_VELOCITY_THRESHOLD;

      if (shouldNavigate) {
        if (event.translationX > 0 || event.velocityX > SWIPE_VELOCITY_THRESHOLD) {
          // Swipe right - go to previous
          runOnJS(viewMode === 'day' ? goToPreviousDay : goToPreviousWeek)();
        } else {
          // Swipe left - go to next
          runOnJS(viewMode === 'day' ? goToNextDay : goToNextWeek)();
        }
      }

      // Reset position with spring animation
      translateX.value = withSpring(0, {
        damping: 20,
        stiffness: 200,
      });
      isGestureActive.value = false;
    }), [viewMode, goToPreviousDay, goToNextDay, goToPreviousWeek, goToNextWeek]);

  // Animated style for swipe feedback
  const animatedContentStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
      opacity: interpolate(
        Math.abs(translateX.value),
        [0, 50],
        [1, 0.9],
        Extrapolation.CLAMP
      ),
    };
  });

  // Handle slot selection from Find Time Sheet
  const handleSlotSelected = useCallback((slot: TimeSlot) => {
    // Pre-fill event data with the selected time slot
    setNewEventData({
      title: '',
      start_time: slot.start,
      end_time: slot.end,
    });
    setShowNewEventModal(true);
  }, []);

  // Handle tap-to-create event on empty time slot
  const handleTapToCreate = useCallback((hour: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_EVENT_TAPPED, {
      action: 'tap_to_create',
      hour,
    });

    const startTime = new Date(selectedDate);
    startTime.setHours(hour, 0, 0, 0);

    const endTime = new Date(selectedDate);
    endTime.setHours(hour + 1, 0, 0, 0);

    setNewEventData({
      title: '',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });
    setShowNewEventModal(true);
  }, [selectedDate, posthog]);

  // Toggle mini calendar
  const toggleMiniCalendar = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsMiniCalendarExpanded(!isMiniCalendarExpanded);
  }, [isMiniCalendarExpanded]);

  // Handle event creation from Find Time Sheet
  const handleCreateNewEvent = useCallback(async (event: ParsedEvent) => {
    setIsCreatingEvent(true);
    try {
      const request: CreateCalendarEventRequest = {
        title: event.title || 'New Event',
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        description: event.description,
        send_notifications: true,
      };

      const response = await integrationsService.createCalendarEvent(request);

      if (response.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowNewEventModal(false);
        setNewEventData(null);
        // Refresh calendar
        invalidateCache();
        loadMonthEvents(true);
      }
    } catch (error) {
      console.error('Error creating event:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCreatingEvent(false);
    }
  }, [invalidateCache, loadMonthEvents]);

  // Toggle view mode
  const toggleViewMode = () => {
    const newMode = viewMode === 'day' ? 'week' : 'day';
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_VIEW_TOGGLED, {
      from_view: viewMode,
      to_view: newMode,
    });
    setViewMode(newMode);
  };

  // Month picker navigation
  const goToPreviousMonth = () => {
    if (pickerMonth === 0) {
      setPickerMonth(11);
      setPickerYear(pickerYear - 1);
    } else {
      setPickerMonth(pickerMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (pickerMonth === 11) {
      setPickerMonth(0);
      setPickerYear(pickerYear + 1);
    } else {
      setPickerMonth(pickerMonth + 1);
    }
  };

  const selectMonthFromPicker = (monthIndex: number) => {
    setPickerMonth(monthIndex);
  };

  const selectDayFromPicker = (day: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(pickerYear, pickerMonth, day);
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_DATE_SELECTED, {
      date: newDate.toISOString().split('T')[0],
    });
    setSelectedDate(newDate);
    setShowMonthPicker(false);
  };

  // Open month picker with current selected date
  const openMonthPicker = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerMonth(selectedDate.getMonth());
    setPickerYear(selectedDate.getFullYear());
    setShowMonthPicker(true);
  }, [selectedDate]);

  // Pull down gesture for month picker
  const pullDownY = useSharedValue(0);
  const PULL_DOWN_THRESHOLD = 60;

  const pullDownGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([10, 100])
    .failOffsetX([-10, 10])
    .onUpdate((event) => {
      if (event.translationY > 0 && !showMonthPicker) {
        pullDownY.value = Math.min(event.translationY * 0.5, 80);
      }
    })
    .onEnd((event) => {
      if (event.translationY > PULL_DOWN_THRESHOLD && !showMonthPicker) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
        runOnJS(openMonthPicker)();
      }
      pullDownY.value = withSpring(0, { damping: 20, stiffness: 200 });
    }), [showMonthPicker, openMonthPicker]);

  // Animated style for pull-down indicator
  const pullDownIndicatorStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(pullDownY.value, [0, 30, 60], [0, 0.5, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(pullDownY.value, [0, 60], [-20, 0], Extrapolation.CLAMP) },
        { scale: interpolate(pullDownY.value, [0, 60], [0.5, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  // Generate calendar days for picker
  const calendarDays = useMemo(() => {
    return generateCalendarDays(pickerYear, pickerMonth);
  }, [pickerYear, pickerMonth]);

  // Calculate position for current time indicator
  const currentTimePosition = useMemo(() => {
    if (!isSameDay(selectedDate, currentTime)) return null;

    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();

    if (hours < START_HOUR || hours > END_HOUR) return null;

    const totalMinutes = (hours - START_HOUR) * 60 + minutes;
    return (totalMinutes / 60) * HOUR_HEIGHT;
  }, [selectedDate, currentTime]);

  // Calculate event position and height
  const getEventStyle = (event: CalendarEventItem) => {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);

    const startHours = start.getHours() + start.getMinutes() / 60;
    const endHours = end.getHours() + end.getMinutes() / 60;

    const clampedStart = Math.max(startHours, START_HOUR);
    const clampedEnd = Math.min(endHours, END_HOUR + 1);

    const top = (clampedStart - START_HOUR) * HOUR_HEIGHT;
    const height = Math.max((clampedEnd - clampedStart) * HOUR_HEIGHT, 30);

    return { top, height };
  };

  const formatEventTime = (event: CalendarEventItem) => {
    const start = new Date(event.start_time);
    const hours = start.getHours();
    const minutes = start.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  };

  const renderHourLabels = () => {
    const hours = [];
    for (let i = START_HOUR; i <= END_HOUR; i++) {
      const ampm = i >= 12 ? 'PM' : 'AM';
      const displayHour = i % 12 || 12;
      hours.push(
        <View key={i} style={styles.hourRow}>
          <Text style={styles.hourLabel}>{displayHour} {ampm}</Text>
          <View style={styles.hourLine} />
        </View>
      );
    }
    return hours;
  };

  // Render tappable hour slots for creating events
  const renderTappableHourSlots = () => {
    const slots = [];
    for (let i = START_HOUR; i <= END_HOUR; i++) {
      // Check if this hour has any events
      const hourHasEvent = events.some(event => {
        const start = new Date(event.start_time);
        const end = new Date(event.end_time);
        const hourStart = i;
        const hourEnd = i + 1;
        return start.getHours() < hourEnd && end.getHours() >= hourStart;
      });

      slots.push(
        <TouchableOpacity
          key={`slot-${i}`}
          style={[
            styles.tappableHourSlot,
            { top: (i - START_HOUR) * HOUR_HEIGHT },
          ]}
          onPress={() => handleTapToCreate(i)}
          activeOpacity={0.3}
        >
          {!hourHasEvent && (
            <View style={styles.tapToCreateHint}>
              <Ionicons name="add" size={14} color={colors.textTertiary} />
            </View>
          )}
        </TouchableOpacity>
      );
    }
    return slots;
  };

  // Render Agenda View
  const renderAgendaView = () => {
    // Get events for the next 14 days
    const agendaDays: { date: Date; events: CalendarEventItem[] }[] = [];
    const startDate = new Date(selectedDate);

    for (let i = 0; i < 14; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);

      const dayEvents = cachedEvents.filter(event => {
        const eventDate = new Date(event.start_time);
        return isSameDay(eventDate, date);
      }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      agendaDays.push({ date, events: dayEvents });
    }

    return (
      <ScrollView
        style={styles.agendaScrollView}
        contentContainerStyle={styles.agendaContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {agendaDays.map(({ date, events: dayEvents }, dayIndex) => {
          const isToday = isSameDay(date, new Date());
          const dayName = DAYS[date.getDay()];
          const monthDay = `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;

          return (
            <View key={dayIndex} style={styles.agendaDaySection}>
              {/* Day Header */}
              <View style={styles.agendaDayHeader}>
                <View style={styles.agendaDayHeaderLeft}>
                  <Text style={[
                    styles.agendaDayName,
                    isToday && styles.agendaDayNameToday,
                  ]}>
                    {isToday ? 'Today' : dayName}
                  </Text>
                  <Text style={styles.agendaMonthDay}>{monthDay}</Text>
                </View>
                {isToday && (
                  <View style={styles.todayIndicator}>
                    <View style={styles.todayDot} />
                  </View>
                )}
              </View>

              {/* Events or Empty State */}
              {dayEvents.length > 0 ? (
                <View style={styles.agendaEventsList}>
                  {dayEvents.map((event) => {
                    const meetingType = (event.meeting_type as MeetingType) || 'offline';
                    const typeConfig = MEETING_TYPE_CONFIG[meetingType];
                    const startTime = new Date(event.start_time);
                    const endTime = new Date(event.end_time);
                    const conflictInfo = eventConflicts.get(event.id);

                    return (
                      <TouchableOpacity
                        key={event.id}
                        style={[
                          styles.agendaEventCard,
                          conflictInfo && styles.agendaEventCardConflict,
                        ]}
                        onPress={() => {
                          setSelectedEvent(event);
                          setShowEventModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[
                          styles.agendaEventColorBar,
                          { backgroundColor: conflictInfo ? CONFLICT_COLOR : typeConfig.color },
                        ]} />
                        <View style={styles.agendaEventContent}>
                          <View style={styles.agendaEventHeader}>
                            <MeetingTypeLogo meetingType={meetingType} size={16} />
                            <Text style={styles.agendaEventTitle} numberOfLines={1}>
                              {event.title}
                            </Text>
                            {conflictInfo && (
                              <ConflictIndicator size="small" />
                            )}
                          </View>
                          <Text style={styles.agendaEventTime}>
                            {formatTimeRange(startTime, endTime)}
                          </Text>
                          {event.location && (
                            <View style={styles.agendaEventLocation}>
                              <Ionicons name="location-outline" size={12} color={colors.textTertiary} />
                              <Text style={styles.agendaEventLocationText} numberOfLines={1}>
                                {event.location}
                              </Text>
                            </View>
                          )}
                        </View>
                        {event.meet_link && (
                          <TouchableOpacity
                            style={[styles.agendaJoinButton, { backgroundColor: typeConfig.color }]}
                            onPress={() => event.meet_link && Linking.openURL(event.meet_link)}
                          >
                            <Text style={styles.agendaJoinText}>Join</Text>
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.agendaEmptyDay}
                  onPress={() => {
                    setSelectedDate(date);
                    setViewMode('day');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.agendaEmptyText}>No events</Text>
                  <View style={styles.agendaAddHint}>
                    <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
                    <Text style={styles.agendaAddText}>Tap to add</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // Calculate event layout for overlapping events
  const eventsWithLayout = useMemo(() => calculateEventLayout(events), [events]);

  // Component for individual event - handles touch properly
  const EventBlock = ({ event, top, height, leftPercent, eventWidth, hasConflict, conflictCount }: {
    event: EventWithLayout;
    top: number;
    height: number;
    leftPercent: number;
    eventWidth: number;
    hasConflict?: boolean;
    conflictCount?: number;
  }) => {
    const meetingType = (event.meeting_type as MeetingType) || 'offline';
    const typeConfig = MEETING_TYPE_CONFIG[meetingType];
    const eventColor = event.color || typeConfig.color;
    const startDate = new Date(event.start_time);
    const endDate = new Date(event.end_time);
    const hasMeetLink = !!event.meet_link;
    const isVideoMeeting = meetingType !== 'offline';
    // Use conflict color for border if there's a conflict
    const borderColor = hasConflict ? CONFLICT_BORDER_COLOR : typeConfig.borderColor;

    const handleEventPress = () => {
      posthog?.capture(ANALYTICS_EVENTS.CALENDAR_EVENT_TAPPED, {
        event_title: event.title,
        meeting_type: meetingType,
      });
      // Show event details modal instead of navigating to chat
      setSelectedEvent(event);
      setShowEventModal(true);
    };

    const handleJoinMeet = () => {
      if (event.meet_link) {
        posthog?.capture(ANALYTICS_EVENTS.CALENDAR_MEET_JOINED, {
          event_title: event.title,
          meeting_type: meetingType,
        });
        Linking.openURL(event.meet_link);
      }
    };

    return (
      <View
        style={[
          styles.eventBlock,
          {
            top,
            height,
            left: `${leftPercent}%`,
            width: `${eventWidth - 1}%`,
            backgroundColor: hasConflict ? 'rgba(245, 158, 11, 0.1)' : typeConfig.bgColor,
            borderLeftColor: borderColor,
            borderLeftWidth: hasConflict ? 4 : 3,
          },
        ]}
      >
        {/* Conflict Indicator */}
        {hasConflict && (
          <View style={styles.conflictBadge}>
            <ConflictIndicator size="small" />
          </View>
        )}
        {/* Main content - tappable to show details */}
        <Pressable
          style={styles.eventContentPressable}
          onPress={handleEventPress}
        >
          {/* Title Row with Meeting Type Logo */}
          <View style={styles.eventTitleRow}>
            <MeetingTypeLogo meetingType={meetingType} size={16} />
            <Text style={[styles.eventTitle, { color: typeConfig.color }]} numberOfLines={1}>
              {event.title}
            </Text>
          </View>

          {/* Time Range */}
          {height > 35 && (
            <Text style={styles.eventTime}>
              {formatTimeRange(startDate, endDate)}
            </Text>
          )}

          {/* Location */}
          {height > 55 && event.location && (
            <View style={styles.eventDetailRow}>
              <Ionicons name="location-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.eventLocation} numberOfLines={1}>
                {event.location}
              </Text>
            </View>
          )}

          {/* Attendees */}
          {height > 75 && event.attendees && event.attendees.length > 0 && (
            <View style={styles.eventDetailRow}>
              <Ionicons name="people-outline" size={11} color={colors.textTertiary} />
              <Text style={styles.eventAttendees} numberOfLines={1}>
                {event.attendees.length} guest{event.attendees.length > 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Join Button for video meetings */}
        {hasMeetLink && (
          <Pressable
            style={[styles.meetJoinButton, { backgroundColor: typeConfig.color }]}
            onPress={handleJoinMeet}
          >
            <MeetingTypeLogo meetingType={meetingType} size={14} />
            {height > 45 && <Text style={styles.meetJoinText}>Join</Text>}
          </Pressable>
        )}
      </View>
    );
  };

  const renderEvents = () => {
    return eventsWithLayout.map((event) => {
      const { top, height } = getEventStyle(event);
      const eventWidth = (100 / event.totalColumns);
      const leftPercent = event.column * eventWidth;
      const conflictInfo = eventConflicts.get(event.id);

      return (
        <EventBlock
          key={event.id}
          event={event}
          top={top}
          height={height}
          leftPercent={leftPercent}
          eventWidth={eventWidth}
          hasConflict={!!conflictInfo}
          conflictCount={conflictInfo?.conflictsWith.length}
        />
      );
    });
  };

  // Get events for a specific date in week view
  const getEventsForDate = (date: Date): CalendarEventItem[] => {
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return weekEvents.get(dateKey) || [];
  };

  // Week Event Block Component
  const WeekEventBlock = ({ event, top, height, leftPercent, eventWidth, hasConflict, conflictCount }: {
    event: EventWithLayout;
    top: number;
    height: number;
    leftPercent: number;
    eventWidth: number;
    hasConflict?: boolean;
    conflictCount?: number;
  }) => {
    const meetingType = (event.meeting_type as MeetingType) || 'offline';
    const typeConfig = MEETING_TYPE_CONFIG[meetingType];
    const eventColor = event.color || typeConfig.color;
    const hasMeetLink = !!event.meet_link;
    const borderColor = hasConflict ? CONFLICT_BORDER_COLOR : typeConfig.borderColor;

    const handleEventPress = () => {
      posthog?.capture(ANALYTICS_EVENTS.CALENDAR_EVENT_TAPPED, {
        event_title: event.title,
        view_mode: 'week',
        meeting_type: meetingType,
      });
      // Show event details modal
      setSelectedEvent(event);
      setShowEventModal(true);
    };

    const handleJoinMeet = () => {
      if (event.meet_link) {
        posthog?.capture(ANALYTICS_EVENTS.CALENDAR_MEET_JOINED, {
          event_title: event.title,
          meeting_type: meetingType,
        });
        Linking.openURL(event.meet_link);
      }
    };

    return (
      <View
        style={[
          styles.weekEventBlock,
          {
            top,
            height: Math.max(height, 30),
            left: `${leftPercent}%`,
            width: `${eventWidth - 1}%`,
            backgroundColor: hasConflict ? 'rgba(245, 158, 11, 0.1)' : typeConfig.bgColor,
            borderLeftColor: borderColor,
            borderLeftWidth: hasConflict ? 3 : 2,
          },
        ]}
      >
        {hasConflict && (
          <View style={styles.weekConflictBadge}>
            <Ionicons name="warning" size={10} color={CONFLICT_COLOR} />
          </View>
        )}
        <Pressable style={styles.weekEventContent} onPress={handleEventPress}>
          <View style={styles.weekEventTitleRow}>
            <MeetingTypeLogo meetingType={meetingType} size={12} />
            <Text style={[styles.weekEventTitle, { color: typeConfig.color }]} numberOfLines={2}>
              {event.title}
            </Text>
          </View>
          {height > 45 && (
            <Text style={styles.weekEventTime}>{formatEventTime(event)}</Text>
          )}
        </Pressable>
        {hasMeetLink && (
          <Pressable
            style={[styles.weekMeetButton, { backgroundColor: typeConfig.color }]}
            onPress={handleJoinMeet}
          >
            <MeetingTypeLogo meetingType={meetingType} size={12} />
          </Pressable>
        )}
      </View>
    );
  };

  // Render events for a specific day column in week view
  const renderWeekDayEvents = (date: Date) => {
    const dayEvents = getEventsForDate(date);
    const eventsLayout = calculateEventLayout(dayEvents);

    return eventsLayout.map((event) => {
      const { top, height } = getEventStyle(event);
      const eventWidth = (100 / event.totalColumns);
      const leftPercent = event.column * eventWidth;
      const conflictInfo = eventConflicts.get(event.id);

      return (
        <WeekEventBlock
          key={event.id}
          event={event}
          top={top}
          height={height}
          leftPercent={leftPercent}
          eventWidth={eventWidth}
          hasConflict={!!conflictInfo}
          conflictCount={conflictInfo?.conflictsWith.length}
        />
      );
    });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.monthSelector}
            onPress={toggleMiniCalendar}
          >
            <Text style={styles.monthText}>{dateDisplay.month} {selectedDate.getFullYear()}</Text>
            <Ionicons
              name={isMiniCalendarExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <GradientIcon size={28} />
        </View>

        {/* Mini Calendar (Collapsible) */}
        {isMiniCalendarExpanded && (
          <View style={styles.miniCalendarContainer}>
            {/* Month/Year Header with Navigation */}
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{MONTHS[pickerMonth]} {pickerYear}</Text>
              <View style={styles.pickerNavButtons}>
                <TouchableOpacity onPress={goToPreviousMonth} style={styles.pickerNavButton}>
                  <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={goToNextMonth} style={styles.pickerNavButton}>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Day Headers */}
            <View style={styles.dayHeaderRow}>
              {DAYS_SHORT.map((day) => (
                <View key={day} style={styles.dayHeaderCell}>
                  <Text style={styles.dayHeaderText}>{day}</Text>
                </View>
              ))}
            </View>

            {/* Calendar Grid */}
            <View style={styles.calendarGrid}>
              {calendarDays.map((day, index) => {
                const isToday = day !== null &&
                  pickerYear === new Date().getFullYear() &&
                  pickerMonth === new Date().getMonth() &&
                  day === new Date().getDate();
                const isSelected = day !== null &&
                  pickerYear === selectedDate.getFullYear() &&
                  pickerMonth === selectedDate.getMonth() &&
                  day === selectedDate.getDate();

                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.calendarDayCell,
                      isSelected && styles.calendarDayCellSelected,
                    ]}
                    onPress={() => {
                      if (day !== null) {
                        selectDayFromPicker(day);
                        setIsMiniCalendarExpanded(false);
                      }
                    }}
                    disabled={day === null}
                    activeOpacity={0.7}
                  >
                    {day !== null && (
                      <Text
                        style={[
                          styles.calendarDayText,
                          isToday && styles.calendarDayTextToday,
                          isSelected && styles.calendarDayTextSelected,
                        ]}
                      >
                        {day}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

      {/* Date Strip Scroller */}
      {!isMiniCalendarExpanded && (
        <DateStripScroller
          selectedDate={selectedDate}
          onDateSelect={setSelectedDate}
          cachedEvents={cachedEvents}
        />
      )}

      {/* View Mode Controls */}
      <View style={styles.viewModeBar}>
        {/* View Mode Segmented Control */}
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[
              styles.segmentButton,
              viewMode === 'day' && styles.segmentButtonActive,
            ]}
            onPress={() => setViewMode('day')}
          >
            <Text style={[
              styles.segmentText,
              viewMode === 'day' && styles.segmentTextActive,
            ]}>Day</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentButton,
              viewMode === 'week' && styles.segmentButtonActive,
            ]}
            onPress={() => setViewMode('week')}
          >
            <Text style={[
              styles.segmentText,
              viewMode === 'week' && styles.segmentTextActive,
            ]}>3 Day</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentButton,
              viewMode === 'agenda' && styles.segmentButtonActive,
            ]}
            onPress={() => setViewMode('agenda')}
          >
            <Text style={[
              styles.segmentText,
              viewMode === 'agenda' && styles.segmentTextActive,
            ]}>Agenda</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} />

        {!dateDisplay.isToday && (
          <TouchableOpacity onPress={goToToday} style={styles.todayButton}>
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
        )}

        {/* Find Time Button */}
        <TouchableOpacity
          style={styles.findTimeButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowFindTimeSheet(true);
          }}
        >
          <Ionicons name="time-outline" size={16} color="#4285f4" />
        </TouchableOpacity>
      </View>

      {/* Calendar Content */}
      {isLoading ? (
        <CalendarSkeletonLoader />
      ) : !isConnected ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Calendar not connected</Text>
          <Text style={styles.emptyText}>
            Connect your Google Calendar to see your events here.
          </Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => router.push('/(main)/settings')}
          >
            <Text style={styles.connectButtonText}>Connect Calendar</Text>
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Could not load events</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              invalidateCache();
              loadMonthEvents(true);
            }}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : viewMode === 'agenda' ? (
        // Agenda List View
        renderAgendaView()
      ) : viewMode === 'day' ? (
        // Day View with Swipe Gesture
        <GestureDetector gesture={swipeGesture}>
          <AnimatedView style={[{ flex: 1 }, animatedContentStyle]}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.accent}
                />
              }
            >
              <View style={styles.timelineContainer}>
                {/* Hour labels and grid */}
                <View style={styles.hoursColumn}>
                  {renderHourLabels()}
                </View>

                {/* Events area */}
                <View style={styles.eventsColumn}>
                  {/* Hour grid lines */}
                  {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                    <View
                      key={i}
                      style={[styles.gridLine, { top: i * HOUR_HEIGHT }]}
                    />
                  ))}

                  {/* Tappable hour slots for creating events */}
                  {renderTappableHourSlots()}

                  {/* Current time indicator */}
                  {currentTimePosition !== null && (
                    <View style={[styles.currentTimeLine, { top: currentTimePosition }]}>
                      <View style={styles.currentTimeDot} />
                      <View style={styles.currentTimeBar} />
                    </View>
                  )}

                  {/* Events */}
                  {renderEvents()}
                </View>
              </View>
            </ScrollView>
          </AnimatedView>
        </GestureDetector>
      ) : (
        // Week View with Swipe Gesture
        <GestureDetector gesture={swipeGesture}>
          <AnimatedView style={[{ flex: 1 }, animatedContentStyle]}>
            {/* Week Day Headers */}
            <View style={styles.weekDayHeaders}>
              <View style={styles.weekHourSpacer} />
              {weekDates.map((date, index) => {
                const isToday = isSameDay(date, new Date());
                const isSelected = isSameDay(date, selectedDate);
                const dayOfWeek = date.getDay(); // 0-6 (Sun-Sat)
                return (
                  <TouchableOpacity
                    key={index}
                    style={styles.weekDayHeader}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedDate(date);
                      setViewMode('day');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.weekDayLetter, isToday && styles.weekDayLetterToday]}>
                      {DAYS_SINGLE[dayOfWeek]}
                    </Text>
                    <View style={[
                      styles.weekDayNumberContainer,
                      isToday && styles.weekDayNumberContainerToday,
                    ]}>
                      <Text style={[
                        styles.weekDayNumber,
                        isToday && styles.weekDayNumberToday,
                      ]}>
                        {date.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Week Timeline */}
            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.accent}
                />
              }
            >
              <View style={styles.weekTimelineContainer}>
                {/* Hour labels */}
                <View style={styles.weekHoursColumn}>
                  {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => {
                    const hour = START_HOUR + i;
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const displayHour = hour % 12 || 12;
                    return (
                      <View key={i} style={styles.weekHourRow}>
                        <Text style={styles.weekHourLabel}>{displayHour} {ampm}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Day columns */}
                <View style={styles.weekDaysContainer}>
                  {weekDates.map((date, dayIndex) => {
                    const isToday = isSameDay(date, new Date());
                    return (
                      <View
                        key={dayIndex}
                        style={[
                          styles.weekDayColumn,
                          dayIndex < weekDates.length - 1 && styles.weekDayColumnBorder,
                        ]}
                      >
                        {/* Hour grid lines */}
                        {Array.from({ length: END_HOUR - START_HOUR + 1 }).map((_, i) => (
                          <View
                            key={i}
                            style={[styles.weekGridLine, { top: i * HOUR_HEIGHT }]}
                          />
                        ))}

                        {/* Current time indicator for today */}
                        {isToday && currentTimePosition !== null && (
                          <View style={[styles.weekCurrentTimeLine, { top: currentTimePosition }]} />
                        )}

                        {/* Events for this day */}
                        {renderWeekDayEvents(date)}
                      </View>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
          </AnimatedView>
        </GestureDetector>
      )}

      {/* Event Details Modal */}
      <Modal
        visible={showEventModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEventModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowEventModal(false)}
        >
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {selectedEvent && (() => {
              const meetingType = (selectedEvent.meeting_type as MeetingType) || 'offline';
              const typeConfig = MEETING_TYPE_CONFIG[meetingType];
              const startDate = new Date(selectedEvent.start_time);
              const endDate = new Date(selectedEvent.end_time);
              const hasMeetLink = !!selectedEvent.meet_link;

              return (
                <>
                  {/* Modal Header */}
                  <View style={styles.modalHeader}>
                    <MeetingTypeLogo meetingType={meetingType} size={40} />
                    <TouchableOpacity
                      style={styles.modalCloseButton}
                      onPress={() => setShowEventModal(false)}
                    >
                      <Ionicons name="close" size={24} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  {/* Event Title */}
                  <Text style={styles.modalTitle}>{selectedEvent.title}</Text>

                  {/* Meeting Type Label */}
                  <View style={styles.modalTypeLabel}>
                    <Text style={[styles.modalTypeLabelText, { color: typeConfig.color }]}>
                      {typeConfig.label}
                    </Text>
                  </View>

                  {/* Conflict Warning */}
                  {selectedEventConflicts.length > 0 && (
                    <View style={styles.conflictWarningSection}>
                      <ConflictBanner conflictCount={selectedEventConflicts.length} />
                      <View style={styles.conflictEventsList}>
                        {selectedEventConflicts.slice(0, 3).map((conflictEvent) => {
                          const conflictStart = new Date(conflictEvent.start_time);
                          const conflictEnd = new Date(conflictEvent.end_time);
                          return (
                            <View key={conflictEvent.id} style={styles.conflictEventItem}>
                              <View style={styles.conflictEventDot} />
                              <Text style={styles.conflictEventTitle} numberOfLines={1}>
                                {conflictEvent.title}
                              </Text>
                              <Text style={styles.conflictEventTime}>
                                {conflictStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                {' - '}
                                {conflictEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                              </Text>
                            </View>
                          );
                        })}
                        {selectedEventConflicts.length > 3 && (
                          <Text style={styles.conflictMoreText}>
                            +{selectedEventConflicts.length - 3} more conflicts
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Date & Time */}
                  <View style={styles.modalSection}>
                    <View style={styles.modalSectionIcon}>
                      <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                    </View>
                    <View style={styles.modalSectionContent}>
                      <Text style={styles.modalSectionTitle}>
                        {startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </Text>
                      <Text style={styles.modalSectionSubtitle}>
                        {formatTimeRange(startDate, endDate)}
                      </Text>
                    </View>
                  </View>

                  {/* Location */}
                  {selectedEvent.location && (
                    <View style={styles.modalSection}>
                      <View style={styles.modalSectionIcon}>
                        <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
                      </View>
                      <View style={styles.modalSectionContent}>
                        <Text style={styles.modalSectionTitle}>{selectedEvent.location}</Text>
                      </View>
                    </View>
                  )}

                  {/* Guests/Attendees */}
                  {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                    <View style={styles.modalSection}>
                      <View style={styles.modalSectionIcon}>
                        <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
                      </View>
                      <View style={styles.modalSectionContent}>
                        <Text style={styles.modalSectionTitle}>
                          {selectedEvent.attendees.length} Guest{selectedEvent.attendees.length > 1 ? 's' : ''}
                        </Text>
                        <View style={styles.modalGuestList}>
                          {selectedEvent.attendees.slice(0, 5).map((guest, index) => (
                            <View key={index} style={styles.modalGuestItem}>
                              <View style={styles.modalGuestAvatar}>
                                <Text style={styles.modalGuestAvatarText}>
                                  {guest.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <Text style={styles.modalGuestName} numberOfLines={1}>{guest}</Text>
                            </View>
                          ))}
                          {selectedEvent.attendees.length > 5 && (
                            <Text style={styles.modalMoreGuests}>
                              +{selectedEvent.attendees.length - 5} more
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Description */}
                  {selectedEvent.description && (
                    <View style={styles.modalSection}>
                      <View style={styles.modalSectionIcon}>
                        <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
                      </View>
                      <View style={styles.modalSectionContent}>
                        <Text style={styles.modalDescription} numberOfLines={3}>
                          {selectedEvent.description}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Action Buttons */}
                  <View style={styles.modalActions}>
                    {hasMeetLink && (
                      <TouchableOpacity
                        style={[styles.modalJoinButton, { backgroundColor: typeConfig.color }]}
                        onPress={() => {
                          if (selectedEvent.meet_link) {
                            posthog?.capture(ANALYTICS_EVENTS.CALENDAR_MEET_JOINED, {
                              event_title: selectedEvent.title,
                              meeting_type: meetingType,
                            });
                            Linking.openURL(selectedEvent.meet_link);
                            setShowEventModal(false);
                          }
                        }}
                      >
                        <MeetingTypeLogo meetingType={meetingType} size={20} />
                        <Text style={styles.modalJoinButtonText}>Join {typeConfig.label}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.modalSecondaryButton}
                      onPress={() => {
                        setShowEventModal(false);
                        router.push({
                          pathname: '/(main)/chat',
                          params: { query: `Tell me about my "${selectedEvent.title}" event` },
                        });
                      }}
                    >
                      <Ionicons name="chatbubble-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.modalSecondaryButtonText}>Ask Cortex</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick Add Input */}
      <QuickAddInput
        selectedDate={selectedDate}
        onEventCreated={() => loadMonthEvents(true)}
      />

      {/* Find Time Sheet */}
      <FindTimeSheet
        visible={showFindTimeSheet}
        onClose={() => setShowFindTimeSheet(false)}
        selectedDate={selectedDate}
        onSlotSelected={handleSlotSelected}
      />

      {/* New Event Modal (from Find Time) */}
      <EventConfirmationModal
        visible={showNewEventModal}
        event={newEventData}
        isLoading={false}
        isCreating={isCreatingEvent}
        onConfirm={handleCreateNewEvent}
        onCancel={() => {
          setShowNewEventModal(false);
          setNewEventData(null);
        }}
      />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  headerButton: {
    padding: spacing.xs,
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  monthText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  navButton: {
    padding: spacing.xs,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  dayCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  dayCircleToday: {
    borderColor: '#4285f4',
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dayNumberToday: {
    color: '#4285f4',
  },
  dayName: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  todayButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
  },
  todayText: {
    fontSize: 14,
    color: '#4285f4',
    fontWeight: '500',
  },
  findTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    backgroundColor: 'rgba(66, 133, 244, 0.1)',
    borderRadius: borderRadius.full,
  },
  findTimeText: {
    fontSize: 13,
    color: '#4285f4',
    fontWeight: '500',
  },
  gridButton: {
    padding: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  connectButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: '#4285f4',
    borderRadius: borderRadius.lg,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  timelineContainer: {
    flexDirection: 'row',
    paddingTop: spacing.md,
  },
  hoursColumn: {
    width: 60,
  },
  hourRow: {
    height: HOUR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hourLabel: {
    fontSize: 12,
    color: colors.textTertiary,
    width: 50,
    textAlign: 'right',
    paddingRight: spacing.sm,
    marginTop: -6,
  },
  hourLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.glassBorder,
  },
  eventsColumn: {
    flex: 1,
    position: 'relative',
    minHeight: (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT,
    marginRight: spacing.md,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.glassBorder,
  },
  currentTimeLine: {
    position: 'absolute',
    left: -10,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  currentTimeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4285f4',
  },
  currentTimeBar: {
    flex: 1,
    height: 2,
    backgroundColor: '#4285f4',
  },
  eventBlock: {
    position: 'absolute',
    borderRadius: borderRadius.sm,
    borderLeftWidth: 3,
    padding: spacing.xs,
    overflow: 'hidden',
  },
  eventContent: {
    flex: 1,
  },
  eventContentPressable: {
    flex: 1,
    paddingRight: 50, // Space for meet button
  },
  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  meetIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 137, 123, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTime: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  eventDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  eventLocation: {
    fontSize: 10,
    color: colors.textTertiary,
    flex: 1,
  },
  eventAttendees: {
    fontSize: 10,
    color: colors.textTertiary,
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meetJoinButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00897B',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    zIndex: 100,
    elevation: 5,
  },
  meetJoinText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  conflictBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    zIndex: 50,
  },
  weekConflictBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    zIndex: 50,
  },
  conflictBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  meetingTypeIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTypeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  modalTypeLabel: {
    marginBottom: spacing.lg,
  },
  modalTypeLabelText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Conflict Warning Styles
  conflictWarningSection: {
    marginBottom: spacing.lg,
  },
  conflictEventsList: {
    marginTop: spacing.sm,
    paddingLeft: spacing.sm,
  },
  conflictEventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  conflictEventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: CONFLICT_COLOR,
  },
  conflictEventTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  conflictEventTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  conflictMoreText: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  modalSection: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  modalSectionIcon: {
    width: 32,
    marginRight: spacing.sm,
    paddingTop: 2,
  },
  modalSectionContent: {
    flex: 1,
  },
  modalSectionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  modalSectionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  modalGuestList: {
    marginTop: spacing.sm,
  },
  modalGuestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  modalGuestAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  modalGuestAvatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalGuestName: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  modalMoreGuests: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalJoinButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    gap: spacing.xs,
  },
  modalJoinButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  modalSecondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.bgTertiary,
    gap: spacing.xs,
  },
  modalSecondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  weekMeetButton: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#00897B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
    position: 'absolute',
    right: 2,
    top: 2,
    zIndex: 10,
  },
  // Month Picker Styles
  monthPickerContainer: {
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    paddingBottom: spacing.md,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pickerNavButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
  },
  calendarDayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayCellSelected: {
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.full,
  },
  calendarDayText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  calendarDayTextToday: {
    color: '#4285f4',
    fontWeight: '700',
  },
  calendarDayTextSelected: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  calendarDayTextPast: {
    color: colors.textTertiary,
  },
  monthChipsScroll: {
    marginTop: spacing.md,
  },
  monthChipsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  monthChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgSecondary,
    marginRight: spacing.xs,
  },
  monthChipSelected: {
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  monthChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  monthChipTextSelected: {
    color: colors.textPrimary,
  },
  // Week View Styles (3-day view with larger columns)
  weekRangeText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginHorizontal: spacing.sm,
  },
  gridButtonActive: {
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.sm,
  },
  weekDayHeaders: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    paddingVertical: spacing.sm,
  },
  weekHourSpacer: {
    width: 50,
  },
  weekDayHeader: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  weekDayLetter: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  weekDayLetterToday: {
    color: '#4285f4',
  },
  weekDayNumberContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDayNumberContainerToday: {
    backgroundColor: '#4285f4',
  },
  weekDayNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  weekDayNumberToday: {
    color: colors.bgPrimary,
  },
  weekTimelineContainer: {
    flexDirection: 'row',
  },
  weekHoursColumn: {
    width: 50,
  },
  weekHourRow: {
    height: HOUR_HEIGHT,
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  weekHourLabel: {
    fontSize: 10,
    color: colors.textTertiary,
    textAlign: 'right',
    paddingRight: spacing.xs,
    marginTop: -5,
  },
  weekDaysContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  weekDayColumn: {
    flex: 1,
    position: 'relative',
    minHeight: (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT,
  },
  weekDayColumnBorder: {
    borderRightWidth: 1,
    borderRightColor: colors.glassBorder,
  },
  weekGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.glassBorder,
  },
  weekCurrentTimeLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#4285f4',
    zIndex: 10,
  },
  weekEventBlock: {
    position: 'absolute',
    borderRadius: borderRadius.sm,
    borderLeftWidth: 2,
    paddingHorizontal: 3,
    paddingVertical: 2,
    paddingRight: 20, // Space for meet button
    overflow: 'hidden',
  },
  weekEventContent: {
    flex: 1,
  },
  weekEventTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  weekEventTitle: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  weekEventTime: {
    fontSize: 9,
    color: colors.textSecondary,
    marginTop: 1,
  },
  // Pull Down Indicator Styles
  pullDownIndicator: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  pullDownChevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pullDownText: {
    fontSize: 12,
    color: colors.textTertiary,
    fontWeight: '500',
  },

  // Mini Calendar Container
  miniCalendarContainer: {
    backgroundColor: colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    paddingBottom: spacing.md,
  },

  // View Mode Bar
  viewModeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },

  // Segmented Control
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.sm,
    padding: 2,
  },
  segmentButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm - 2,
  },
  segmentButtonActive: {
    backgroundColor: colors.bgTertiary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textTertiary,
  },
  segmentTextActive: {
    color: colors.textPrimary,
  },

  // Tappable Hour Slots
  tappableHourSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  tapToCreateHint: {
    opacity: 0,
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.sm,
    padding: 4,
  },

  // Agenda View Styles
  agendaScrollView: {
    flex: 1,
  },
  agendaContent: {
    paddingBottom: spacing.xl,
  },
  agendaDaySection: {
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  agendaDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgSecondary,
  },
  agendaDayHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  agendaDayName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  agendaDayNameToday: {
    color: '#4285f4',
  },
  agendaMonthDay: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  todayIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4285f4',
  },
  agendaEventsList: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  agendaEventCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgTertiary,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  agendaEventCardConflict: {
    borderWidth: 1,
    borderColor: CONFLICT_BORDER_COLOR,
  },
  agendaEventColorBar: {
    width: 4,
  },
  agendaEventContent: {
    flex: 1,
    padding: spacing.md,
  },
  agendaEventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  agendaEventTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  agendaEventTime: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  agendaEventLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  agendaEventLocationText: {
    fontSize: 12,
    color: colors.textTertiary,
    flex: 1,
  },
  agendaJoinButton: {
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agendaJoinText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  agendaEmptyDay: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agendaEmptyText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  agendaAddHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  agendaAddText: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: '500',
  },
});
