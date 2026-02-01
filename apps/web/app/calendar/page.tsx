/**
 * Calendar Page
 * Complete calendar view with Day/Week/Agenda modes
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarHeader,
  MiniCalendar,
  DateStripScroller,
  Timeline,
  EventModal,
  QuickAddInput,
  FindTimeSheet,
} from '@/components/calendar';
import { ArrowBackIcon, SearchIcon, AddIcon } from '@/components/icons';
import { Spinner, GlassCard } from '@/components/ui';
import { useCalendar } from '@/hooks/useCalendar';
import { getConflictingEvents } from '@/lib/calendar/helpers';
import type { ViewMode, CalendarEvent } from '@/types/calendar';

export default function CalendarPage() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isFindTimeOpen, setIsFindTimeOpen] = useState(false);

  const {
    events,
    allEvents,
    isLoading,
    error,
    isConnected,
    loadMonthEvents,
    invalidateCache,
  } = useCalendar(selectedDate);

  const handleRefresh = async () => {
    invalidateCache();
    await loadMonthEvents(true);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleQuickAdd = async (text: string) => {
    // TODO: Call API to parse and create event
    console.log('Quick add:', text);
    await handleRefresh();
  };

  const handleJoinMeeting = () => {
    if (selectedEvent?.meet_link) {
      window.open(selectedEvent.meet_link, '_blank');
    }
  };

  const conflictingEvents = selectedEvent
    ? getConflictingEvents(selectedEvent, allEvents)
    : [];

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-lg py-md border-b border-glass-border">
        <button
          onClick={() => router.back()}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
        >
          <ArrowBackIcon className="w-5 h-5 text-text-primary" />
        </button>

        <h1 className="text-lg font-semibold text-text-primary">Calendar</h1>

        <div className="flex items-center gap-sm">
          <button
            onClick={() => setIsFindTimeOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <SearchIcon className="w-5 h-5 text-text-primary" />
          </button>
          <button
            onClick={() => {
              // TODO: Open create event modal
              console.log('Add event');
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-accent hover:bg-accent-pressed active-opacity"
          >
            <AddIcon className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <GlassCard className="mx-lg mt-md p-md bg-warning/10 border-warning/30">
          <p className="text-sm text-warning">
            Google Calendar not connected. Go to Settings to connect.
          </p>
        </GlassCard>
      )}

      {/* Calendar Header */}
      <CalendarHeader
        selectedDate={selectedDate}
        viewMode={viewMode}
        onDateChange={setSelectedDate}
        onViewModeChange={setViewMode}
        onMonthPickerToggle={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
      />

      {/* Mini Calendar */}
      {isMonthPickerOpen && (
        <MiniCalendar
          selectedDate={selectedDate}
          events={allEvents}
          onDateSelect={(date) => {
            setSelectedDate(date);
            setIsMonthPickerOpen(false);
          }}
          isCollapsed={false}
          onToggleCollapse={() => setIsMonthPickerOpen(false)}
        />
      )}

      {/* Date Strip */}
      <DateStripScroller
        selectedDate={selectedDate}
        events={allEvents}
        onDateSelect={setSelectedDate}
      />

      {/* Quick Add */}
      <div className="px-lg py-md">
        <QuickAddInput onCreateEvent={handleQuickAdd} />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center px-lg">
          <p className="text-text-secondary text-sm text-center mb-md">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-lg py-sm bg-accent text-white rounded-lg hover:bg-accent-pressed active-opacity"
          >
            Retry
          </button>
        </div>
      )}

      {/* Timeline View */}
      {!isLoading && !error && viewMode === 'day' && (
        <Timeline
          events={events}
          selectedDate={selectedDate}
          onEventClick={handleEventClick}
        />
      )}

      {/* Week View */}
      {!isLoading && !error && viewMode === 'week' && (
        <div className="flex-1 overflow-y-auto">
          <p className="text-center text-text-secondary py-xl">
            Week view coming soon
          </p>
        </div>
      )}

      {/* Agenda View */}
      {!isLoading && !error && viewMode === 'agenda' && (
        <div className="flex-1 overflow-y-auto px-lg py-md space-y-sm">
          {events.length === 0 ? (
            <p className="text-center text-text-secondary py-xl">
              No events scheduled
            </p>
          ) : (
            events.map((event) => (
              <GlassCard
                key={event.id}
                onClick={() => handleEventClick(event)}
                className="p-md cursor-pointer hover:border-accent transition-colors"
              >
                <p className="font-semibold text-text-primary">{event.title}</p>
                <p className="text-sm text-text-secondary mt-1">
                  {new Date(event.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  {' - '}
                  {new Date(event.end_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </p>
                {event.location && (
                  <p className="text-xs text-text-tertiary mt-1">{event.location}</p>
                )}
              </GlassCard>
            ))
          )}
        </div>
      )}

      {/* Event Modal */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          conflictingEvents={conflictingEvents}
          onClose={() => setSelectedEvent(null)}
          onJoinMeeting={selectedEvent.meet_link ? handleJoinMeeting : undefined}
          onEdit={() => {
            // TODO: Open edit modal
            console.log('Edit event:', selectedEvent.id);
          }}
          onDelete={() => {
            // TODO: Delete event
            console.log('Delete event:', selectedEvent.id);
          }}
        />
      )}

      {/* Find Time Sheet */}
      {isFindTimeOpen && (
        <FindTimeSheet
          onClose={() => setIsFindTimeOpen(false)}
          onSelectSlot={(slot) => {
            console.log('Selected slot:', slot);
            setIsFindTimeOpen(false);
            // TODO: Open create event modal with pre-filled time
          }}
        />
      )}
    </div>
  );
}
