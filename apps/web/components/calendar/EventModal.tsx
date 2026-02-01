/**
 * EventModal Component
 * Full event details with join button, conflict warnings
 */

'use client';

import { CloseIcon, VideocamIcon, LocationIcon, PeopleIcon, TimeIcon, CalendarIcon, AlertCircleIcon } from '@/components/icons';
import { Button, GlassCard } from '@/components/ui';
import { MEETING_TYPE_CONFIG } from '@/lib/calendar/constants';
import { formatTimeRange } from '@/lib/calendar/helpers';
import type { CalendarEvent } from '@/types/calendar';

interface EventModalProps {
  event: CalendarEvent;
  conflictingEvents?: CalendarEvent[];
  onClose: () => void;
  onJoinMeeting?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function EventModal({
  event,
  conflictingEvents = [],
  onClose,
  onJoinMeeting,
  onEdit,
  onDelete,
}: EventModalProps) {
  const startTime = new Date(event.start_time);
  const endTime = new Date(event.end_time);
  const hasConflicts = conflictingEvents.length > 0;

  const meetingConfig = event.meeting_type
    ? MEETING_TYPE_CONFIG[event.meeting_type]
    : null;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-full md:max-w-lg max-h-[90vh] overflow-y-auto bg-bg-primary md:rounded-xl animate-slide-up md:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-lg py-md border-b border-glass-border">
          <h2 className="text-lg font-semibold text-text-primary">Event Details</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
          >
            <CloseIcon className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-lg space-y-lg">
          {/* Conflict Warning */}
          {hasConflicts && (
            <GlassCard className="p-md bg-warning/10 border-warning/30">
              <div className="flex items-start gap-md">
                <AlertCircleIcon className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-warning">Schedule Conflict</p>
                  <p className="text-xs text-text-secondary mt-1">
                    Overlaps with {conflictingEvents.length} other event{conflictingEvents.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Title */}
          <div>
            <h3 className="text-xl font-bold text-text-primary">{event.title}</h3>
            {event.description && (
              <p className="text-sm text-text-secondary mt-2">{event.description}</p>
            )}
          </div>

          {/* Date & Time */}
          <div className="space-y-md">
            <div className="flex items-start gap-md">
              <CalendarIcon className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-text-primary">{formatDate(startTime)}</p>
              </div>
            </div>

            <div className="flex items-start gap-md">
              <TimeIcon className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-text-primary">
                  {formatTimeRange(startTime, endTime)}
                </p>
              </div>
            </div>
          </div>

          {/* Meeting Link */}
          {event.meet_link && meetingConfig && (
            <div className="flex items-start gap-md">
              <VideocamIcon className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-text-primary">{meetingConfig.label}</p>
                {onJoinMeeting && (
                  <Button
                    onClick={onJoinMeeting}
                    size="sm"
                    className="mt-2"
                  >
                    Join Meeting
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Location */}
          {event.location && !event.meet_link && (
            <div className="flex items-start gap-md">
              <LocationIcon className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-text-primary">{event.location}</p>
              </div>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-start gap-md">
              <PeopleIcon className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-text-primary mb-2">
                  {event.attendees.length} attendees
                </p>
                <div className="space-y-1">
                  {event.attendees.slice(0, 5).map((attendee, idx) => (
                    <p key={idx} className="text-xs text-text-secondary">
                      {attendee}
                    </p>
                  ))}
                  {event.attendees.length > 5 && (
                    <p className="text-xs text-text-tertiary">
                      +{event.attendees.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Conflicting Events */}
          {hasConflicts && (
            <div>
              <p className="text-sm font-semibold text-text-primary mb-2">
                Conflicting Events
              </p>
              <div className="space-y-2">
                {conflictingEvents.map((conflict) => (
                  <GlassCard key={conflict.id} className="p-md">
                    <p className="text-sm font-medium text-text-primary">
                      {conflict.title}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {formatTimeRange(
                        new Date(conflict.start_time),
                        new Date(conflict.end_time)
                      )}
                    </p>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-md pt-md border-t border-glass-border">
            {onEdit && (
              <Button variant="secondary" onClick={onEdit} className="flex-1">
                Edit
              </Button>
            )}
            {onDelete && (
              <Button variant="danger" onClick={onDelete} className="flex-1">
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
