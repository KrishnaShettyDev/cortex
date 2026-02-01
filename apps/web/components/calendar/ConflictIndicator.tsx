/**
 * ConflictIndicator Component
 * Warning badge for overlapping events
 */

'use client';

import { AlertCircleIcon } from '@/components/icons';

interface ConflictIndicatorProps {
  count: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function ConflictIndicator({ count, size = 'md', className = '' }: ConflictIndicatorProps) {
  if (count === 0) return null;

  const sizeStyles = {
    sm: 'w-4 h-4 text-[10px]',
    md: 'w-5 h-5 text-xs',
    lg: 'w-6 h-6 text-sm',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div
      className={`flex items-center justify-center ${sizeStyles[size]} bg-warning text-white rounded-full ${className}`}
      title={`${count} conflict${count > 1 ? 's' : ''}`}
    >
      {count <= 3 ? (
        <AlertCircleIcon className={iconSizes[size]} />
      ) : (
        <span className="font-bold">{count}</span>
      )}
    </div>
  );
}
