/**
 * ChatBubble Component
 * User and assistant message bubbles
 */

'use client';

import { CheckmarkDoneIcon, CheckmarkIcon } from '@/components/icons';

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'error';

interface ChatBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: Date;
  status?: MessageStatus;
  isStreaming?: boolean;
}

export function ChatBubble({
  role,
  content,
  timestamp,
  status = 'sent',
  isStreaming = false,
}: ChatBubbleProps) {
  if (role === 'system') return null;

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-md`}>
      <div
        className={`max-w-[75%] md:max-w-[60%] ${
          isUser
            ? 'bg-accent text-white rounded-[20px] rounded-tr-[4px]'
            : 'bg-bg-secondary text-text-primary rounded-[20px] rounded-tl-[4px]'
        } px-lg py-md`}
      >
        {/* Message Content */}
        <p className="text-[15px] leading-[20px] whitespace-pre-wrap break-words">
          {content}
          {isStreaming && (
            <span className="inline-block w-1 h-4 ml-1 bg-current animate-pulse" />
          )}
        </p>

        {/* Timestamp & Status */}
        {timestamp && (
          <div
            className={`flex items-center gap-1 mt-1 text-xs ${
              isUser ? 'text-white/70 justify-end' : 'text-text-tertiary'
            }`}
          >
            <span>
              {timestamp.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </span>
            {isUser && status !== 'error' && (
              <span className="ml-1">
                {status === 'delivered' ? (
                  <CheckmarkDoneIcon className="w-4 h-4" />
                ) : (
                  <CheckmarkIcon className="w-4 h-4" />
                )}
              </span>
            )}
            {isUser && status === 'error' && (
              <span className="text-error">Failed</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
