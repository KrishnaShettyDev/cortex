/**
 * MiniCalendar Component
 * Collapsible month grid for date selection
 */

'use client';

import { useState } from 'react';
import { ChevronBackIcon, ChevronForwardIcon, ChevronUpIcon, ChevronDownIcon } from '@/components/icons';
import { MONTHS, DAYS_SINGLE } from '@/lib/calendar/constants';
import { generateCalendarDays, isSameDay } from '@/lib/calendar/helpers';
import type { CalendarEvent } from '@/types/calendar';

interface MiniCalendarProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onDateSelect: (date: Date) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function MiniCalendar({
  selectedDate,
  events,
  onDateSelect,
  isCollapsed = false,
  onToggleCollapse,
}: MiniCalendarProps) {
  const [viewDate, setViewDate] = useState(new Date(selectedDate));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const calendarDays = generateCalendarDays(year, month);

  const hasEventsOnDate = (day: number) => {
    const date = new Date(year, month, day);
    return events.some((event) => isSameDay(new Date(event.start_time), date));
  };

  const handlePreviousMonth = () => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setViewDate(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setViewDate(newDate);
  };

  const handleDayClick = (day: number) => {
    const newDate = new Date(year, month, day);
    onDateSelect(newDate);
  };

  return (
    <div className="bg-bg-secondary border-b border-glass-border">
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between px-lg py-sm">
        <div className="flex items-center gap-sm">
          <button
            onClick={handlePreviousMonth}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <ChevronBackIcon className="w-4 h-4 text-text-primary" />
          </button>
          <span className="text-sm font-semibold text-text-primary min-w-[120px] text-center">
            {MONTHS[month]} {year}
          </span>
          <button
            onClick={handleNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <ChevronForwardIcon className="w-4 h-4 text-text-primary" />
          </button>
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            {isCollapsed ? (
              <ChevronDownIcon className="w-4 h-4 text-text-secondary" />
            ) : (
              <ChevronUpIcon className="w-4 h-4 text-text-secondary" />
            )}
          </button>
        )}
      </div>

      {/* Calendar Grid */}
      {!isCollapsed && (
        <div className="px-lg pb-md">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAYS_SINGLE.map((day, idx) => (
              <div key={idx} className="text-center text-xs text-text-tertiary font-medium py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const date = new Date(year, month, day);
              const isSelected = isSameDay(date, selectedDate);
              const isToday = isSameDay(date, new Date());
              const hasEvents = hasEventsOnDate(day);

              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center relative active-opacity transition-colors ${
                    isSelected
                      ? 'bg-accent text-white'
                      : isToday
                      ? 'bg-accent/20 text-accent'
                      : 'hover:bg-bg-tertiary text-text-primary'
                  }`}
                >
                  <span className="text-sm">{day}</span>
                  {hasEvents && !isSelected && (
                    <div className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" />
                  )}
                  {hasEvents && isSelected && (
                    <div className="absolute bottom-1 w-1 h-1 rounded-full bg-white" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
