/**
 * DayBriefingCard Component
 * Individual briefing card (emails, calendar, etc.)
 */

'use client';

import { GlassCard } from '@/components/ui';
import { MailIcon, CalendarIcon, AlertCircleIcon, CheckmarkCircleIcon } from '@/components/icons';

export type BriefingType = 'emails' | 'calendar' | 'tasks' | 'reminders' | 'summary';

interface DayBriefingCardProps {
  type: BriefingType;
  title: string;
  description: string;
  count?: number;
  urgent?: boolean;
  onClick: () => void;
}

export function DayBriefingCard({
  type,
  title,
  description,
  count,
  urgent = false,
  onClick,
}: DayBriefingCardProps) {
  const getIcon = () => {
    switch (type) {
      case 'emails':
        return <MailIcon className="w-5 h-5" />;
      case 'calendar':
        return <CalendarIcon className="w-5 h-5" />;
      case 'tasks':
        return <CheckmarkCircleIcon className="w-5 h-5" />;
      case 'reminders':
        return <AlertCircleIcon className="w-5 h-5" />;
      default:
        return <MailIcon className="w-5 h-5" />;
    }
  };

  const getColor = () => {
    if (urgent) return 'text-error';
    switch (type) {
      case 'emails':
        return 'text-gmail';
      case 'calendar':
        return 'text-calendar';
      case 'tasks':
        return 'text-success';
      case 'reminders':
        return 'text-warning';
      default:
        return 'text-accent';
    }
  };

  return (
    <GlassCard
      onClick={onClick}
      className="flex-shrink-0 w-[280px] p-lg cursor-pointer hover:border-accent transition-colors"
    >
      <div className="flex items-start gap-md">
        {/* Icon */}
        <div className={`flex-shrink-0 ${getColor()}`}>{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-sm mb-1">
            <h4 className="font-semibold text-text-primary text-sm">{title}</h4>
            {count !== undefined && count > 0 && (
              <span
                className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-bold ${
                  urgent ? 'bg-error/20 text-error' : 'bg-accent/20 text-accent'
                }`}
              >
                {count}
              </span>
            )}
          </div>
          <p className="text-text-secondary text-xs line-clamp-2">{description}</p>
        </div>
      </div>
    </GlassCard>
  );
}
