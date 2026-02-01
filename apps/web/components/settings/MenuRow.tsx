import React from 'react';
import { ChevronForwardIcon } from '@/components/icons';

export interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  iconColor?: string;
  rightElement?: React.ReactNode;
}

/**
 * MenuRow - Clickable menu item matching mobile settings
 */
export function MenuRow({
  icon,
  label,
  onClick,
  iconColor = 'text-text-secondary',
  rightElement,
}: MenuRowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-6 py-3 hover:bg-bg-tertiary active-opacity transition-colors text-left"
    >
      <div className={`w-7 h-7 flex items-center justify-center ${iconColor}`}>
        {icon}
      </div>
      <span className="flex-1 text-base text-text-primary">
        {label}
      </span>
      {rightElement || (
        <ChevronForwardIcon className="w-4 h-4 text-text-tertiary" />
      )}
    </button>
  );
}
