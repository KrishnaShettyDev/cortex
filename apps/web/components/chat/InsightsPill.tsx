/**
 * InsightsPill Component
 * Individual insight badge/pill
 */

'use client';

import {
  AlertCircleIcon,
  TimeIcon,
  MailUnreadIcon,
  CalendarIcon,
  FlashIcon,
} from '@/components/icons';

export type InsightType = 'urgent' | 'follow_up' | 'unread' | 'upcoming' | 'action';

interface InsightsPillProps {
  type: InsightType;
  count: number;
  label: string;
  onClick: () => void;
}

export function InsightsPill({ type, count, label, onClick }: InsightsPillProps) {
  const getIcon = () => {
    switch (type) {
      case 'urgent':
        return <AlertCircleIcon className="w-4 h-4" />;
      case 'follow_up':
        return <TimeIcon className="w-4 h-4" />;
      case 'unread':
        return <MailUnreadIcon className="w-4 h-4" />;
      case 'upcoming':
        return <CalendarIcon className="w-4 h-4" />;
      case 'action':
        return <FlashIcon className="w-4 h-4" />;
      default:
        return <AlertCircleIcon className="w-4 h-4" />;
    }
  };

  const getColorClasses = () => {
    switch (type) {
      case 'urgent':
        return 'bg-error/20 text-error border-error/30';
      case 'follow_up':
        return 'bg-warning/20 text-warning border-warning/30';
      case 'unread':
        return 'bg-accent/20 text-accent border-accent/30';
      case 'upcoming':
        return 'bg-calendar/20 text-calendar border-calendar/30';
      case 'action':
        return 'bg-success/20 text-success border-success/30';
      default:
        return 'bg-accent/20 text-accent border-accent/30';
    }
  };

  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold active-opacity transition-colors ${getColorClasses()}`}
    >
      {getIcon()}
      <span>{count}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
