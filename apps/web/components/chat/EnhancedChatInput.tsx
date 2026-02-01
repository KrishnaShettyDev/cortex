/**
 * EnhancedChatInput Component
 * Message input with attachment and voice support
 */

'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { SendIcon, AttachIcon, MicIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';

interface EnhancedChatInputProps {
  onSendMessage: (message: string) => void;
  onAttachment?: () => void;
  onVoice?: () => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
}

export function EnhancedChatInput({
  onSendMessage,
  onAttachment,
  onVoice,
  placeholder = 'Message Cortex...',
  disabled = false,
  isLoading = false,
}: EnhancedChatInputProps) {
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!message.trim() || disabled || isLoading) return;

    onSendMessage(message.trim());
    setMessage('');

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <div className="border-t border-glass-border bg-bg-primary">
      <div className="max-w-4xl mx-auto px-lg py-md">
        <div className="flex items-end gap-sm bg-bg-secondary rounded-[24px] px-md py-sm border border-glass-border focus-within:border-accent transition-colors">
          {/* Attachment Button */}
          {onAttachment && (
            <button
              onClick={onAttachment}
              disabled={disabled || isLoading}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity disabled:opacity-50"
            >
              <AttachIcon className="w-5 h-5 text-text-secondary" />
            </button>
          )}

          {/* Text Input */}
          <textarea
            ref={inputRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            rows={1}
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none text-[15px] leading-[20px] py-2 max-h-[120px]"
            style={{ scrollbarWidth: 'thin' }}
          />

          {/* Send/Voice Button */}
          <div className="flex-shrink-0">
            {message.trim() ? (
              <button
                onClick={handleSend}
                disabled={disabled || isLoading}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-accent hover:bg-accent-pressed active-opacity disabled:opacity-50 transition-colors"
              >
                {isLoading ? (
                  <Spinner size="sm" />
                ) : (
                  <SendIcon className="w-5 h-5 text-white" />
                )}
              </button>
            ) : onVoice ? (
              <button
                onClick={onVoice}
                disabled={disabled || isLoading}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity disabled:opacity-50"
              >
                <MicIcon className="w-5 h-5 text-text-secondary" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Helper Text */}
        <p className="text-xs text-text-tertiary text-center mt-2">
          Cortex can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
