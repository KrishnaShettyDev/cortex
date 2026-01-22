import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Dimensions,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { integrationsService, CalendarEventItem } from '../../src/services';
import { colors, gradients, spacing, borderRadius } from '../../src/theme';
import { GradientIcon } from '../../src/components/GradientIcon';
import { usePostHog } from 'posthog-react-native';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Hours to display (full 24 hours: 12 AM to 11 PM)
const START_HOUR = 0;
const END_HOUR = 23;
const HOUR_HEIGHT = 60;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const goBack = () => {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(main)/chat');
  }
};

// Helper to get days in a month
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Helper to get first day of month (0 = Sunday)
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// Generate calendar grid for a month - always 6 rows (42 cells) for consistent height
function generateCalendarDays(year: number, month: number): (number | null)[] {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days: (number | null)[] = [];

  // Add empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  // Add days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  // Always pad to exactly 42 cells (6 rows) for consistent height
  while (days.length < 42) {
    days.push(null);
  }

  return days;
}

// Number of days to show in week view (3 days like the design)
const WEEK_VIEW_DAYS = 3;

// Get dates for week view (3 days centered around selected date)
function getWeekViewDates(date: Date): Date[] {
  const dates: Date[] = [];

  // Start 1 day before selected date (so selected is in middle for 3-day view)
  const startDate = new Date(date);
  startDate.setDate(date.getDate() - 1);

  for (let i = 0; i < WEEK_VIEW_DAYS; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d);
  }

  return dates;
}

// Format date range for week view header
function formatWeekRange(dates: Date[]): string {
  if (dates.length === 0) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  const monthShort = MONTHS_SHORT[first.getMonth()];
  return `${monthShort} ${first.getDate()} - ${last.getDate()}`;
}

// Single letter day names for week view
const DAYS_SINGLE = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type ViewMode = 'day' | 'week';

export default function CalendarScreen() {
  const posthog = usePostHog();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [weekEvents, setWeekEvents] = useState<Map<string, CalendarEventItem[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolledToTime = useRef(false);

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

  // Load events when date or view mode changes
  useEffect(() => {
    loadEvents();
  }, [selectedDate, viewMode]);

  const loadEvents = useCallback(async () => {
    setError(null);

    try {
      // Check connection status first
      const status = await integrationsService.getStatus();
      setIsConnected(status.google.calendar_connected);

      if (!status.google.calendar_connected) {
        setEvents([]);
        setWeekEvents(new Map());
        setIsLoading(false);
        return;
      }

      if (viewMode === 'day') {
        // Get events for the selected date only
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        const response = await integrationsService.getCalendarEvents(startOfDay, endOfDay);

        if (response.success) {
          setEvents(response.events);
          setError(null);
        } else {
          setEvents([]);
          setError(response.message || 'Failed to load events');
        }
      } else {
        // Week view - get events for the displayed days
        const weekStart = new Date(weekDates[0]);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekDates[weekDates.length - 1]);
        weekEnd.setHours(23, 59, 59, 999);

        const response = await integrationsService.getCalendarEvents(weekStart, weekEnd);

        if (response.success) {
          // Group events by date
          const eventsByDate = new Map<string, CalendarEventItem[]>();

          response.events.forEach(event => {
            const eventDate = new Date(event.start_time);
            const dateKey = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`;

            if (!eventsByDate.has(dateKey)) {
              eventsByDate.set(dateKey, []);
            }
            eventsByDate.get(dateKey)!.push(event);
          });

          setWeekEvents(eventsByDate);
          setError(null);
        } else {
          setWeekEvents(new Map());
          setError(response.message || 'Failed to load events');
        }
      }
    } catch (err: any) {
      console.error('Failed to load calendar events:', err);
      setEvents([]);
      setWeekEvents(new Map());
      // Show user-friendly error message
      if (err.message?.includes('timed out')) {
        setError('Loading took too long. Please try again.');
      } else if (err.message?.includes('connection')) {
        setError('Connection issue. Please check your network.');
      } else {
        setError('Could not load events. Pull down to retry.');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedDate, viewMode, weekDates]);

  const onRefresh = useCallback(() => {
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_REFRESHED);
    setIsRefreshing(true);
    loadEvents();
  }, [loadEvents]);

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const goToPreviousDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 1);
    setSelectedDate(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 1);
    setSelectedDate(newDate);
  };

  // Week navigation (move by WEEK_VIEW_DAYS instead of 7)
  const goToPreviousWeek = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - WEEK_VIEW_DAYS);
    setSelectedDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + WEEK_VIEW_DAYS);
    setSelectedDate(newDate);
  };

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
    const newDate = new Date(pickerYear, pickerMonth, day);
    posthog?.capture(ANALYTICS_EVENTS.CALENDAR_DATE_SELECTED, {
      date: newDate.toISOString().split('T')[0],
    });
    setSelectedDate(newDate);
    setShowMonthPicker(false);
  };

  // Open month picker with current selected date
  const openMonthPicker = () => {
    setPickerMonth(selectedDate.getMonth());
    setPickerYear(selectedDate.getFullYear());
    setShowMonthPicker(true);
  };

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

  const renderEvents = () => {
    return events.map((event) => {
      const { top, height } = getEventStyle(event);
      const eventColor = event.color || '#4285f4';

      return (
        <TouchableOpacity
          key={event.id}
          style={[
            styles.eventBlock,
            {
              top,
              height,
              backgroundColor: eventColor + '20',
              borderLeftColor: eventColor,
            },
          ]}
          activeOpacity={0.7}
          onPress={() => {
            // Track event tap
            posthog?.capture(ANALYTICS_EVENTS.CALENDAR_EVENT_TAPPED, {
              event_title: event.title,
            });
            // Navigate to chat to ask about this event
            router.push({
              pathname: '/(main)/chat',
              params: { query: `Tell me about my "${event.title}" event` },
            });
          }}
        >
          <Text style={[styles.eventTitle, { color: eventColor }]} numberOfLines={1}>
            {event.title}
          </Text>
          {height > 40 && (
            <Text style={styles.eventTime}>{formatEventTime(event)}</Text>
          )}
          {height > 60 && event.location && (
            <Text style={styles.eventLocation} numberOfLines={1}>
              {event.location}
            </Text>
          )}
        </TouchableOpacity>
      );
    });
  };

  // Get events for a specific date in week view
  const getEventsForDate = (date: Date): CalendarEventItem[] => {
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return weekEvents.get(dateKey) || [];
  };

  // Render events for a specific day column in week view
  const renderWeekDayEvents = (date: Date) => {
    const dayEvents = getEventsForDate(date);

    return dayEvents.map((event) => {
      const { top, height } = getEventStyle(event);
      const eventColor = event.color || '#4285f4';

      return (
        <TouchableOpacity
          key={event.id}
          style={[
            styles.weekEventBlock,
            {
              top,
              height: Math.max(height, 30),
              backgroundColor: eventColor + '25',
              borderLeftColor: eventColor,
            },
          ]}
          activeOpacity={0.7}
          onPress={() => {
            posthog?.capture(ANALYTICS_EVENTS.CALENDAR_EVENT_TAPPED, {
              event_title: event.title,
              view_mode: 'week',
            });
            router.push({
              pathname: '/(main)/chat',
              params: { query: `Tell me about my "${event.title}" event` },
            });
          }}
        >
          <Text style={[styles.weekEventTitle, { color: eventColor }]} numberOfLines={2}>
            {event.title}
          </Text>
          {height > 45 && (
            <Text style={styles.weekEventTime}>{formatEventTime(event)}</Text>
          )}
        </TouchableOpacity>
      );
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerButton}>
          <Ionicons name="menu" size={24} color={colors.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.monthSelector}
          onPress={openMonthPicker}
        >
          <Text style={styles.monthText}>{dateDisplay.month}</Text>
          <Ionicons
            name={showMonthPicker ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textPrimary}
          />
        </TouchableOpacity>

        <GradientIcon size={28} />
      </View>

      {/* Month Picker Overlay */}
      {showMonthPicker && (
        <View style={styles.monthPickerContainer}>
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
              const isPastMonth = day !== null &&
                (pickerYear < new Date().getFullYear() ||
                  (pickerYear === new Date().getFullYear() && pickerMonth < new Date().getMonth()));

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.calendarDayCell,
                    isSelected && styles.calendarDayCellSelected,
                  ]}
                  onPress={() => day !== null && selectDayFromPicker(day)}
                  disabled={day === null}
                  activeOpacity={0.7}
                >
                  {day !== null && (
                    <Text
                      style={[
                        styles.calendarDayText,
                        isToday && styles.calendarDayTextToday,
                        isSelected && styles.calendarDayTextSelected,
                        isPastMonth && styles.calendarDayTextPast,
                      ]}
                    >
                      {day}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Month Selector Chips */}
          <ScrollView
            ref={monthScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.monthChipsScroll}
            contentContainerStyle={styles.monthChipsContent}
          >
            {MONTHS_SHORT.map((month, index) => {
              const isSelected = index === pickerMonth;
              return (
                <TouchableOpacity
                  key={month}
                  style={[
                    styles.monthChip,
                    isSelected && styles.monthChipSelected,
                  ]}
                  onPress={() => selectMonthFromPicker(index)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.monthChipText,
                      isSelected && styles.monthChipTextSelected,
                    ]}
                  >
                    {month}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Date Navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity
          onPress={viewMode === 'day' ? goToPreviousDay : goToPreviousWeek}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        {viewMode === 'day' ? (
          <View style={styles.dateDisplay}>
            <View style={[styles.dayCircle, dateDisplay.isToday && styles.dayCircleToday]}>
              <Text style={[styles.dayNumber, dateDisplay.isToday && styles.dayNumberToday]}>
                {dateDisplay.day}
              </Text>
            </View>
            <Text style={styles.dayName}>{dateDisplay.dayName}</Text>
          </View>
        ) : (
          <Text style={styles.weekRangeText}>{formatWeekRange(weekDates)}</Text>
        )}

        <TouchableOpacity
          onPress={viewMode === 'day' ? goToNextDay : goToNextWeek}
          style={styles.navButton}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {!dateDisplay.isToday && (
          <TouchableOpacity onPress={goToToday} style={styles.todayButton}>
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.gridButton, viewMode === 'week' && styles.gridButtonActive]}
          onPress={toggleViewMode}
        >
          <Ionicons
            name={viewMode === 'day' ? 'calendar-outline' : 'today-outline'}
            size={20}
            color={viewMode === 'week' ? '#4285f4' : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Calendar Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading calendar...</Text>
        </View>
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
              setIsLoading(true);
              loadEvents();
            }}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : viewMode === 'day' ? (
        // Day View
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
      ) : (
        // Week View
        <>
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
        </>
      )}

      {/* Bottom Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Ask Cortex"
            placeholderTextColor={colors.textTertiary}
            onFocus={() => router.push('/(main)/chat')}
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={() => router.push('/(main)/chat')}
          >
            <LinearGradient
              colors={gradients.primary as [string, string, ...string[]]}
              style={styles.sendButtonGradient}
            >
              <Ionicons name="send" size={18} color={colors.bgPrimary} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
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
    left: 4,
    right: 4,
    borderRadius: borderRadius.sm,
    borderLeftWidth: 3,
    padding: spacing.xs,
    overflow: 'hidden',
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  eventLocation: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
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
    left: 2,
    right: 2,
    borderRadius: borderRadius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  weekEventTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  weekEventTime: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  inputContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  sendButton: {
    marginLeft: spacing.sm,
  },
  sendButtonGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
