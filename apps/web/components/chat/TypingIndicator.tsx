/**
 * TypingIndicator Component
 * Shows when assistant is typing
 */

'use client';

export function TypingIndicator() {
  return (
    <div className="flex justify-start mb-md">
      <div className="bg-bg-secondary rounded-[20px] rounded-tl-[4px] px-lg py-md">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" />
        </div>
      </div>
    </div>
  );
}
