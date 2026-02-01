/**
 * AutonomousActionCard Component
 * Iris-style action suggestion card with one-tap approve/dismiss
 */

'use client';

import { useState } from 'react';
import { GlassCard, Spinner } from '@/components/ui';
import {
  MailIcon,
  CalendarIcon,
  TimeIcon,
  AlertCircleIcon,
  CheckmarkIcon,
  CloseIcon,
} from '@/components/icons';
import type { AutonomousAction, EmailPayload, CalendarPayload } from '@/types/autonomousActions';

interface AutonomousActionCardProps {
  action: AutonomousAction;
  onApprove: (actionId: string, modifications?: Record<string, unknown>) => void;
  onDismiss: (actionId: string, reason?: string) => void;
  isLoading?: boolean;
}

export function AutonomousActionCard({
  action,
  onApprove,
  onDismiss,
  isLoading = false,
}: AutonomousActionCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState(action.action_payload);

  const handleApprove = () => {
    const modifications = isEditing ? (editedPayload as unknown as Record<string, unknown>) : undefined;
    onApprove(action.id, modifications);
  };

  const getIcon = () => {
    switch (action.action_type) {
      case 'email_reply':
      case 'follow_up':
        return <MailIcon className="w-5 h-5 text-gmail" />;
      case 'calendar_create':
      case 'calendar_reschedule':
        return <CalendarIcon className="w-5 h-5 text-calendar" />;
      case 'meeting_prep':
        return <TimeIcon className="w-5 h-5 text-accent" />;
      case 'reminder':
        return <AlertCircleIcon className="w-5 h-5 text-warning" />;
      default:
        return <CheckmarkIcon className="w-5 h-5 text-accent" />;
    }
  };

  const getActionLabel = () => {
    switch (action.action_type) {
      case 'email_reply':
        return 'Send';
      case 'calendar_create':
        return 'Create';
      case 'calendar_reschedule':
        return 'Reschedule';
      case 'meeting_prep':
        return 'Prepare';
      case 'reminder':
        return 'Set Reminder';
      default:
        return 'Confirm';
    }
  };

  const renderContent = () => {
    if (action.action_type === 'email_reply' || action.action_type === 'follow_up') {
      const payload = action.action_payload as EmailPayload;
      return (
        <div className="space-y-sm">
          <div>
            <p className="text-xs text-text-tertiary">To:</p>
            <p className="text-sm text-text-primary">{payload.to}</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Subject:</p>
            <p className="text-sm text-text-primary">{payload.subject}</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Message:</p>
            {isEditing ? (
              <textarea
                value={(editedPayload as EmailPayload).body}
                onChange={(e) =>
                  setEditedPayload({ ...editedPayload, body: e.target.value } as EmailPayload)
                }
                className="w-full mt-1 px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                rows={4}
              />
            ) : (
              <p className="text-sm text-text-secondary mt-1 line-clamp-3">{payload.body}</p>
            )}
          </div>
        </div>
      );
    }

    if (
      action.action_type === 'calendar_create' ||
      action.action_type === 'calendar_reschedule'
    ) {
      const payload = action.action_payload as CalendarPayload;
      return (
        <div className="space-y-sm">
          <div>
            <p className="text-xs text-text-tertiary">Title:</p>
            <p className="text-sm text-text-primary">{payload.title}</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Time:</p>
            <p className="text-sm text-text-primary">
              {new Date(payload.start_time).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
              {' - '}
              {new Date(payload.end_time).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
          {payload.location && (
            <div>
              <p className="text-xs text-text-tertiary">Location:</p>
              <p className="text-sm text-text-primary">{payload.location}</p>
            </div>
          )}
          {payload.attendees && payload.attendees.length > 0 && (
            <div>
              <p className="text-xs text-text-tertiary">Attendees:</p>
              <p className="text-sm text-text-primary">{payload.attendees.length} people</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <p className="text-sm text-text-secondary">{action.description}</p>
    );
  };

  const confidenceColor =
    action.confidence_score >= 0.8
      ? 'text-success'
      : action.confidence_score >= 0.6
      ? 'text-warning'
      : 'text-error';

  return (
    <GlassCard className="p-lg">
      {/* Header */}
      <div className="flex items-start gap-md mb-md">
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-text-primary text-sm mb-1">{action.title}</h4>
          <p className="text-xs text-text-tertiary">{action.reason}</p>
        </div>
        <div className={`flex-shrink-0 text-xs font-semibold ${confidenceColor}`}>
          {Math.round(action.confidence_score * 100)}%
        </div>
      </div>

      {/* Content */}
      <div className="mb-md">{renderContent()}</div>

      {/* Actions */}
      <div className="flex items-center gap-sm">
        {(action.action_type === 'email_reply' || action.action_type === 'follow_up') && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg transition-colors"
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
        )}

        <button
          onClick={() => onDismiss(action.id)}
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg font-medium text-sm hover:bg-bg-tertiary/80 active-opacity disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <CloseIcon className="w-4 h-4" />
          Dismiss
        </button>

        <button
          onClick={handleApprove}
          disabled={isLoading}
          className="flex-1 px-4 py-2 bg-accent text-white rounded-lg font-medium text-sm hover:bg-accent-pressed active-opacity disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <Spinner size="sm" />
          ) : (
            <>
              <CheckmarkIcon className="w-4 h-4" />
              {getActionLabel()}
            </>
          )}
        </button>
      </div>
    </GlassCard>
  );
}
