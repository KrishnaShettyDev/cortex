/**
 * EventBlock Component
 * Individual event card with meeting type, time, attendees
 */

'use client';

import { START_HOUR, HOUR_HEIGHT, MEETING_TYPE_CONFIG, CONFLICT_COLOR } from '@/lib/calendar/constants';
import { formatTimeRange } from '@/lib/calendar/helpers';
import { VideocamIcon, LocationIcon, PeopleIcon } from '@/components/icons';
import type { EventWithLayout } from '@/types/calendar';

interface EventBlockProps {
  event: EventWithLayout;
  onClick: () => void;
}

export function EventBlock({ event, onClick }: EventBlockProps) {
  const startTime = new Date(event.start_time);
  const endTime = new Date(event.end_time);

  // Calculate position and height
  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const endHour = endTime.getHours() + endTime.getMinutes() / 60;
  const top = (startHour - START_HOUR) * HOUR_HEIGHT;
  const height = (endHour - startHour) * HOUR_HEIGHT;

  // Calculate width and left position for overlapping events
  const width = event.totalColumns > 1 ? `${100 / event.totalColumns}%` : '100%';
  const left = event.totalColumns > 1 ? `${(event.column / event.totalColumns) * 100}%` : '0';

  // Get meeting type config
  const meetingConfig = event.meeting_type
    ? MEETING_TYPE_CONFIG[event.meeting_type]
    : null;

  const backgroundColor = meetingConfig?.bgColor || 'rgba(10, 132, 255, 0.1)';
  const borderColor = meetingConfig?.borderColor || '#0A84FF';
  const textColor = meetingConfig?.color || '#0A84FF';

  // Check if event is short (less than 45 minutes)
  const isShortEvent = height < 45;

  return (
    <button
      onClick={onClick}
      className="absolute px-2 py-1.5 rounded-lg border-l-[3px] active-opacity transition-all hover:shadow-lg overflow-hidden"
      style={{
        top: `${top}px`,
        height: `${Math.max(height, 30)}px`,
        width,
        left,
        backgroundColor,
        borderColor,
      }}
    >
      <div className="flex flex-col h-full text-left">
        {/* Title */}
        <p
          className="font-semibold text-sm line-clamp-1"
          style={{ color: textColor }}
        >
          {event.title}
        </p>

        {!isShortEvent && (
          <>
            {/* Time */}
            <p className="text-xs text-text-secondary mt-0.5">
              {formatTimeRange(startTime, endTime)}
            </p>

            {/* Meeting type & location */}
            <div className="flex items-center gap-2 mt-1 text-xs text-text-tertiary">
              {event.meet_link && (
                <div className="flex items-center gap-1">
                  <VideocamIcon className="w-3 h-3" />
                  <span>{meetingConfig?.label || 'Meeting'}</span>
                </div>
              )}
              {event.location && !event.meet_link && (
                <div className="flex items-center gap-1">
                  <LocationIcon className="w-3 h-3" />
                  <span className="line-clamp-1">{event.location}</span>
                </div>
              )}
            </div>

            {/* Attendees count */}
            {event.attendees && event.attendees.length > 0 && (
              <div className="flex items-center gap-1 mt-1 text-xs text-text-tertiary">
                <PeopleIcon className="w-3 h-3" />
                <span>{event.attendees.length} attendees</span>
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}
