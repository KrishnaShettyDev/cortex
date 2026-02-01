/**
 * EmptyState Component
 * Welcome message with suggested prompts
 */

'use client';

import { GlassCard } from '@/components/ui';
import { SparklesIcon } from '@/components/icons';

interface SuggestedPrompt {
  icon: React.ReactNode;
  text: string;
  action: string;
}

interface EmptyStateProps {
  userName?: string;
  onPromptClick: (action: string) => void;
}

export function EmptyState({ userName, onPromptClick }: EmptyStateProps) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const suggestedPrompts: SuggestedPrompt[] = [
    {
      icon: '📧',
      text: 'Show me urgent emails',
      action: 'show_urgent_emails',
    },
    {
      icon: '📅',
      text: "What's on my calendar today?",
      action: 'show_calendar_today',
    },
    {
      icon: '✅',
      text: 'What do I need to follow up on?',
      action: 'show_follow_ups',
    },
    {
      icon: '🎯',
      text: 'Help me prioritize my day',
      action: 'prioritize_day',
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-lg pb-24">
      {/* Greeting */}
      <div className="text-center mb-xl">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/20 mb-lg">
          <SparklesIcon className="w-8 h-8 text-accent" />
        </div>
        <h1 className="text-3xl font-bold text-text-primary mb-sm">
          {getGreeting()}
          {userName && ', '}
          {userName && <span className="text-accent">{userName}</span>}
        </h1>
        <p className="text-text-secondary text-base">
          How can I help you today?
        </p>
      </div>

      {/* Suggested Prompts */}
      <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-md">
        {suggestedPrompts.map((prompt, idx) => (
          <GlassCard
            key={idx}
            onClick={() => onPromptClick(prompt.action)}
            className="p-lg cursor-pointer hover:border-accent transition-colors"
          >
            <div className="flex items-start gap-md">
              <span className="text-2xl">{prompt.icon}</span>
              <p className="text-sm text-text-primary font-medium">
                {prompt.text}
              </p>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
