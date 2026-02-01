/**
 * Timeline Component
 * Hour-by-hour grid with current time indicator
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { START_HOUR, END_HOUR, HOUR_HEIGHT } from '@/lib/calendar/constants';
import { calculateEventLayout } from '@/lib/calendar/helpers';
import { EventBlock } from './EventBlock';
import type { CalendarEvent, EventWithLayout } from '@/types/calendar';

interface TimelineProps {
  events: CalendarEvent[];
  selectedDate: Date;
  onEventClick: (event: CalendarEvent) => void;
}

export function Timeline({ events, selectedDate, onEventClick }: TimelineProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToNow, setHasScrolledToNow] = useState(false);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current && !hasScrolledToNow) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      if (currentHour >= START_HOUR && currentHour <= END_HOUR) {
        const scrollTop = (currentHour - START_HOUR) * HOUR_HEIGHT + (currentMinute / 60) * HOUR_HEIGHT - 100;
        scrollRef.current.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        setHasScrolledToNow(true);
      }
    }
  }, [hasScrolledToNow]);

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const eventsWithLayout = calculateEventLayout(events);

  // Calculate current time position
  const isToday =
    currentTime.getDate() === selectedDate.getDate() &&
    currentTime.getMonth() === selectedDate.getMonth() &&
    currentTime.getFullYear() === selectedDate.getFullYear();

  const currentTimePosition = isToday
    ? ((currentTime.getHours() - START_HOUR) * HOUR_HEIGHT) +
      ((currentTime.getMinutes() / 60) * HOUR_HEIGHT)
    : -1;

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour} ${period}`;
  };

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto bg-bg-primary">
      <div className="flex relative">
        {/* Time labels */}
        <div className="flex-shrink-0 w-16 border-r border-glass-border">
          {hours.map((hour) => (
            <div
              key={hour}
              className="relative"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              <span className="absolute -top-2 right-2 text-xs text-text-tertiary">
                {formatHour(hour)}
              </span>
            </div>
          ))}
        </div>

        {/* Events container */}
        <div className="flex-1 relative">
          {/* Hour grid lines */}
          {hours.map((hour) => (
            <div
              key={hour}
              className="border-b border-glass-border"
              style={{ height: `${HOUR_HEIGHT}px` }}
            />
          ))}

          {/* Current time indicator */}
          {currentTimePosition >= 0 && (
            <div
              className="absolute left-0 right-0 z-10 flex items-center"
              style={{ top: `${currentTimePosition}px` }}
            >
              <div className="w-2 h-2 rounded-full bg-error" />
              <div className="flex-1 h-[2px] bg-error" />
            </div>
          )}

          {/* Events */}
          {eventsWithLayout.map((event) => (
            <EventBlock
              key={event.id}
              event={event}
              onClick={() => onEventClick(event)}
            />
          ))}

          {/* Empty state */}
          {events.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-text-tertiary text-sm">No events scheduled</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
