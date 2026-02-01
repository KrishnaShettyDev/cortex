/**
 * CalendarHeader Component
 * Month/year selector with view mode toggle
 */

'use client';

import { ChevronBackIcon, ChevronForwardIcon } from '@/components/icons';
import { MONTHS } from '@/lib/calendar/constants';
import type { ViewMode } from '@/types/calendar';

interface CalendarHeaderProps {
  selectedDate: Date;
  viewMode: ViewMode;
  onDateChange: (date: Date) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onMonthPickerToggle: () => void;
}

export function CalendarHeader({
  selectedDate,
  viewMode,
  onDateChange,
  onViewModeChange,
  onMonthPickerToggle,
}: CalendarHeaderProps) {
  const handlePrevious = () => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 3);
    }
    onDateChange(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(selectedDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 3);
    }
    onDateChange(newDate);
  };

  const monthYear = `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;

  return (
    <div className="flex items-center justify-between px-lg py-md bg-bg-primary">
      {/* Month/Year Selector */}
      <button
        onClick={onMonthPickerToggle}
        className="flex items-center gap-sm text-text-primary font-semibold text-lg active-opacity"
      >
        <span>{monthYear}</span>
      </button>

      {/* Navigation & View Mode */}
      <div className="flex items-center gap-md">
        {/* Previous/Next Buttons */}
        <div className="flex items-center gap-xs">
          <button
            onClick={handlePrevious}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <ChevronBackIcon className="w-5 h-5 text-text-primary" />
          </button>
          <button
            onClick={handleNext}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <ChevronForwardIcon className="w-5 h-5 text-text-primary" />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-bg-secondary rounded-lg p-1">
          <button
            onClick={() => onViewModeChange('day')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'day'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Day
          </button>
          <button
            onClick={() => onViewModeChange('week')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'week'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => onViewModeChange('agenda')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              viewMode === 'agenda'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Agenda
          </button>
        </div>
      </div>
    </div>
  );
}
