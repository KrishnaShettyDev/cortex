/**
 * FindTimeSheet Component
 * AI-powered free slot finder
 */

'use client';

import { useState } from 'react';
import { CloseIcon, TimeIcon, CalendarIcon } from '@/components/icons';
import { Button, Spinner, GlassCard } from '@/components/ui';
import type { TimeSlot } from '@/types/calendar';

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
      // TODO: Call API to find free slots
      // const response = await apiClient.findFreeTime(customDuration);
      // setFreeSlots(response.slots);

      // Mock data for now
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setFreeSlots([
        {
          start: new Date(Date.now() + 3600000).toISOString(),
          end: new Date(Date.now() + 3600000 + customDuration * 60000).toISOString(),
          duration: customDuration,
        },
        {
          start: new Date(Date.now() + 7200000).toISOString(),
          end: new Date(Date.now() + 7200000 + customDuration * 60000).toISOString(),
          duration: customDuration,
        },
      ]);
    } catch (error) {
      console.error('Failed to find free slots:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
