/**
 * QuickAddInput Component
 * Natural language event creation
 */

'use client';

import { useState } from 'react';
import { AddIcon, SendIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';

interface QuickAddInputProps {
  onCreateEvent: (text: string) => Promise<void>;
  placeholder?: string;
}

export function QuickAddInput({
  onCreateEvent,
  placeholder = 'Add event (e.g., "Team meeting tomorrow at 2pm")',
}: QuickAddInputProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await onCreateEvent(input);
      setInput('');
      setIsExpanded(false);
    } catch (error) {
      console.error('Failed to create event:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full flex items-center gap-md px-lg py-md bg-bg-secondary rounded-lg border border-glass-border hover:border-accent/50 active-opacity transition-colors"
      >
        <AddIcon className="w-5 h-5 text-accent" />
        <span className="text-sm text-text-secondary">{placeholder}</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-md px-lg py-md bg-bg-secondary rounded-lg border-2 border-accent">
        <AddIcon className="w-5 h-5 text-accent flex-shrink-0" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => {
            if (!input.trim()) {
              setIsExpanded(false);
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none"
          autoFocus
          disabled={isLoading}
        />
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          input.trim() && (
            <button
              type="submit"
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-pressed active-opacity"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          )
        )}
      </div>
    </form>
  );
}
