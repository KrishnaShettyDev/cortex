'use client';

import React from 'react';
import { useTheme } from '@/lib/theme';
import { PhonePortraitIcon, SunnyOutlineIcon, MoonOutlineIcon, CheckmarkIcon } from '@/components/icons';

/**
 * ThemeSelector - Theme selection section matching mobile settings
 */
export function ThemeSelector() {
  const { mode, setMode } = useTheme();

  const options = [
    { value: 'system' as const, label: 'System', icon: PhonePortraitIcon },
    { value: 'light' as const, label: 'Light', icon: SunnyOutlineIcon },
    { value: 'dark' as const, label: 'Dark', icon: MoonOutlineIcon },
  ];

  return (
    <div className="mt-2">
      <h3 className="px-6 py-2 text-sm text-text-tertiary">
        Appearance
      </h3>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setMode(value)}
          className="w-full flex items-center gap-4 px-6 py-3 hover:bg-bg-tertiary active-opacity transition-colors"
        >
          <div className="w-7 h-7 flex items-center justify-center text-text-secondary">
            <Icon className="w-5 h-5" />
          </div>
          <span className="flex-1 text-base text-text-primary text-left">
            {label}
          </span>
          {mode === value && (
            <CheckmarkIcon className="w-5 h-5 text-accent" />
          )}
        </button>
      ))}
    </div>
  );
}
