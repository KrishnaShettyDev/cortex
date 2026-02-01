/**
 * DateStripScroller Component
 * Horizontal scrollable days with event indicators
 */

'use client';

import { useEffect, useRef } from 'react';
import { DAYS_SHORT } from '@/lib/calendar/constants';
import { isSameDay } from '@/lib/calendar/helpers';
import type { CalendarEvent } from '@/types/calendar';

interface DateStripScrollerProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onDateSelect: (date: Date) => void;
  daysToShow?: number;
}

export function DateStripScroller({
  selectedDate,
  events,
  onDateSelect,
  daysToShow = 14,
}: DateStripScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Generate days array centered around selected date
  const days = Array.from({ length: daysToShow }, (_, i) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() - Math.floor(daysToShow / 2) + i);
    return date;
  });

  // Auto-scroll to selected date
  useEffect(() => {
    if (scrollRef.current) {
      const selectedIndex = days.findIndex((date) => isSameDay(date, selectedDate));
      if (selectedIndex !== -1) {
        const itemWidth = 60; // DATE_STRIP_ITEM_WIDTH
        const scrollLeft = selectedIndex * itemWidth - scrollRef.current.offsetWidth / 2 + itemWidth / 2;
        scrollRef.current.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }
  }, [selectedDate]);

  const getEventCountForDate = (date: Date) => {
    return events.filter((event) => isSameDay(new Date(event.start_time), date)).length;
  };

  return (
    <div className="bg-bg-primary border-b border-glass-border">
      <div
        ref={scrollRef}
        className="flex gap-sm px-lg py-md overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {days.map((date, idx) => {
          const isSelected = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, new Date());
          const eventCount = getEventCountForDate(date);

          return (
            <button
              key={idx}
              onClick={() => onDateSelect(date)}
              className={`flex-shrink-0 w-[60px] flex flex-col items-center gap-1 py-2 rounded-lg active-opacity transition-colors ${
                isSelected
                  ? 'bg-accent'
                  : isToday
                  ? 'bg-accent/20'
                  : 'hover:bg-bg-tertiary'
              }`}
            >
              {/* Day name */}
              <span
                className={`text-xs font-medium ${
                  isSelected ? 'text-white' : isToday ? 'text-accent' : 'text-text-secondary'
                }`}
              >
                {DAYS_SHORT[date.getDay()]}
              </span>

              {/* Day number */}
              <span
                className={`text-lg font-semibold ${
                  isSelected ? 'text-white' : isToday ? 'text-accent' : 'text-text-primary'
                }`}
              >
                {date.getDate()}
              </span>

              {/* Event indicator dots */}
              {eventCount > 0 && (
                <div className="flex gap-0.5">
                  {Array.from({ length: Math.min(eventCount, 3) }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-1 rounded-full ${
                        isSelected ? 'bg-white' : 'bg-accent'
                      }`}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
