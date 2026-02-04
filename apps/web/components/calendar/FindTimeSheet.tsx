/**
 * FindTimeSheet Component
 * Calendar-based free slot finder
 */

'use client';

import { useState } from 'react';
import { CloseIcon, TimeIcon, CalendarIcon } from '@/components/icons';
import { Button, Spinner, GlassCard } from '@/components/ui';
import { apiClient } from '@/lib/api/client';
import type { TimeSlot, CalendarEvent } from '@/types/calendar';

interface FindTimeSheetProps {
  onClose: () => void;
  onSelectSlot: (slot: TimeSlot) => void;
  duration?: number; // minutes
}

export function FindTimeSheet({
  onClose,
  onSelectSlot,
  duration = 60,
}: FindTimeSheetProps) {
  const [customDuration, setCustomDuration] = useState(duration);
  const [isLoading, setIsLoading] = useState(false);
  const [freeSlots, setFreeSlots] = useState<TimeSlot[]>([]);

  const handleFindSlots = async () => {
    setIsLoading(true);
    try {
      // Fetch events for the next 7 days
      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const response = await apiClient.getCalendarEvents({
        start: now.toISOString(),
        end: weekLater.toISOString(),
      });

      const events = response.events || [];
      const slots = findFreeSlots(events, customDuration, now, weekLater);
      setFreeSlots(slots.slice(0, 10)); // Limit to 10 slots
    } catch (error) {
      console.error('Failed to find free slots:', error);
      // Fallback to showing next available slots assuming no events
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

      setFreeSlots([
        {
          start: nextHour.toISOString(),
          end: new Date(nextHour.getTime() + customDuration * 60000).toISOString(),
          duration: customDuration,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  function findFreeSlots(
    events: CalendarEvent[],
    durationMins: number,
    rangeStart: Date,
    rangeEnd: Date
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const workdayStart = 9; // 9 AM
    const workdayEnd = 18; // 6 PM

    // Sort events by start time
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    // Iterate through each day in the range
    const currentDay = new Date(rangeStart);
    currentDay.setHours(workdayStart, 0, 0, 0);

    while (currentDay < rangeEnd && slots.length < 10) {
      // Skip weekends
      if (currentDay.getDay() === 0 || currentDay.getDay() === 6) {
        currentDay.setDate(currentDay.getDate() + 1);
        currentDay.setHours(workdayStart, 0, 0, 0);
        continue;
      }

      const dayEnd = new Date(currentDay);
      dayEnd.setHours(workdayEnd, 0, 0, 0);

      // Get events for this day
      const dayEvents = sortedEvents.filter((e) => {
        const eventStart = new Date(e.start_time);
        return eventStart.toDateString() === currentDay.toDateString();
      });

      // Find gaps in the day
      let slotStart = new Date(currentDay);
      if (slotStart < rangeStart) {
        slotStart = new Date(rangeStart);
        slotStart.setMinutes(Math.ceil(slotStart.getMinutes() / 15) * 15, 0, 0);
      }

      for (const event of dayEvents) {
        const eventStart = new Date(event.start_time);
        const eventEnd = new Date(event.end_time);

        // Check if there's a gap before this event
        const gapMinutes = (eventStart.getTime() - slotStart.getTime()) / 60000;
        if (gapMinutes >= durationMins && slotStart >= currentDay) {
          slots.push({
            start: slotStart.toISOString(),
            end: new Date(slotStart.getTime() + durationMins * 60000).toISOString(),
            duration: durationMins,
          });
        }

        // Move slot start to after this event
        if (eventEnd > slotStart) {
          slotStart = new Date(eventEnd);
        }
      }

      // Check for gap at end of day
      const remainingMinutes = (dayEnd.getTime() - slotStart.getTime()) / 60000;
      if (remainingMinutes >= durationMins && slotStart < dayEnd) {
        slots.push({
          start: slotStart.toISOString(),
          end: new Date(slotStart.getTime() + durationMins * 60000).toISOString(),
          duration: durationMins,
        });
      }

      // Move to next day
      currentDay.setDate(currentDay.getDate() + 1);
      currentDay.setHours(workdayStart, 0, 0, 0);
    }

    return slots;
  }

  const formatSlotTime = (slot: TimeSlot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);

    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const date = start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    return { date, time: `${startTime} - ${endTime}` };
  };

  const durationOptions = [15, 30, 45, 60, 90, 120];

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-bg-primary md:rounded-xl animate-slide-up md:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-lg py-md border-b border-glass-border">
          <h2 className="text-lg font-semibold text-text-primary">Find Free Time</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <CloseIcon className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-lg space-y-lg">
          {/* Duration Selector */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-md">
              Meeting Duration
            </label>
            <div className="grid grid-cols-3 gap-sm">
              {durationOptions.map((mins) => (
                <button
                  key={mins}
                  onClick={() => setCustomDuration(mins)}
                  className={`px-md py-sm rounded-lg text-sm font-medium transition-colors ${
                    customDuration === mins
                      ? 'bg-accent text-white'
                      : 'bg-bg-secondary text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  {mins} min
                </button>
              ))}
            </div>
          </div>

          {/* Find Button */}
          <Button
            onClick={handleFindSlots}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? <Spinner size="sm" /> : 'Find Available Slots'}
          </Button>

          {/* Free Slots */}
          {freeSlots.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary mb-md">
                Available Time Slots
              </p>
              <div className="space-y-sm">
                {freeSlots.map((slot, idx) => {
                  const { date, time } = formatSlotTime(slot);
                  return (
                    <GlassCard
                      key={idx}
                      onClick={() => onSelectSlot(slot)}
                      className="p-md cursor-pointer hover:border-accent transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-md">
                          <div className="flex flex-col items-center gap-1">
                            <CalendarIcon className="w-5 h-5 text-accent" />
                            <TimeIcon className="w-4 h-4 text-text-tertiary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-text-primary">
                              {date}
                            </p>
                            <p className="text-xs text-text-secondary mt-1">
                              {time}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" variant="secondary">
                          Select
                        </Button>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && freeSlots.length === 0 && (
            <div className="text-center py-xl">
              <p className="text-sm text-text-tertiary">
                Select a duration and tap &ldquo;Find Available Slots&rdquo; to see free time in your calendar
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
