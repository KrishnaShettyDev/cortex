/**
 * Chat Page
 * AI-powered chat interface with recall, briefings, and autonomous actions
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { apiClient } from '@/lib/api/client';
import {
  ChatBubble,
  TypingIndicator,
  DayBriefingScroll,
  InsightsPillRow,
  EnhancedChatInput,
  EmptyState,
  AutonomousActionsList,
  BriefingItem,
  InsightData,
  MessageRole,
  MessageStatus,
} from '@/components/chat';
import { SettingsOutlineIcon, MenuIcon } from '@/components/icons';
import { Spinner } from '@/components/ui';
import type { AutonomousAction } from '@/types/autonomousActions';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  status?: MessageStatus;
  sources?: Array<{ id: string; content: string; score: number }>;
}

export default function ChatPage() {
  const router = useRouter();
  const { user, checkAuth } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [briefingItems, setBriefingItems] = useState<BriefingItem[]>([]);
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [autonomousActions, setAutonomousActions] = useState<AutonomousAction[]>([]);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, router]);

  useEffect(() => {
    if (user) {
      loadBriefingData();
    }
  }, [user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  async function loadBriefingData(): Promise<void> {
    try {
      const [briefingRes, actionsRes] = await Promise.allSettled([
        apiClient.getBriefing(),
        apiClient.getAutonomousActions(),
      ]);

      if (briefingRes.status === 'fulfilled') {
        const data = briefingRes.value;
        setBriefingItems(
          data.urgent_items?.map((item, i) => ({
            id: String(i),
            type: item.type as 'emails' | 'calendar' | 'tasks',
            title: item.title,
            description: item.description,
            count: item.count,
            urgent: item.type === 'emails',
          })) || []
        );
        setInsights(
          data.insights?.map((i) => ({
            type: i.type as InsightData['type'],
            count: i.count,
            label: i.label,
          })) || []
        );
      }

      if (actionsRes.status === 'fulfilled') {
        setAutonomousActions(actionsRes.value || []);
      }
    } catch (error) {
      console.error('Failed to load briefing:', error);
    }
  }

  async function handleSendMessage(content: string): Promise<void> {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);

    try {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMessage.id ? { ...msg, status: 'sent' as MessageStatus } : msg
        )
      );

      setIsTyping(true);

      const response = await apiClient.recall(content);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        sources: response.sources,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMessage.id ? { ...msg, status: 'error' as MessageStatus } : msg
        )
      );
    } finally {
      setIsTyping(false);
      setIsSending(false);
    }
  }

  function handleBriefingClick(item: BriefingItem): void {
    handleSendMessage(`Show me ${item.title.toLowerCase()}`);
  }

  function handleInsightClick(insight: InsightData): void {
    handleSendMessage(`Show me ${insight.label.toLowerCase()} items`);
  }

  function handlePromptClick(action: string): void {
    const prompts: Record<string, string> = {
      show_urgent_emails: 'Show me urgent emails',
      show_calendar_today: "What's on my calendar today?",
      show_follow_ups: 'What do I need to follow up on?',
      prioritize_day: 'Help me prioritize my day',
    };

    const prompt = prompts[action];
    if (prompt) {
      handleSendMessage(prompt);
    }
  }

  async function handleApproveAction(
    actionId: string,
    modifications?: Record<string, unknown>
  ): Promise<void> {
    setIsActionLoading(true);
    setLoadingActionId(actionId);

    try {
      await apiClient.approveAction(actionId, modifications);

      setAutonomousActions((prev) => prev.filter((a) => a.id !== actionId));

      const action = autonomousActions.find((a) => a.id === actionId);
      if (action) {
        const successMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `✅ ${action.title} completed successfully!`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, successMessage]);
      }
    } catch (error) {
      console.error('Failed to approve action:', error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '❌ Failed to execute action. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsActionLoading(false);
      setLoadingActionId(null);
    }
  }

  async function handleDismissAction(actionId: string, reason?: string): Promise<void> {
    setIsActionLoading(true);
    setLoadingActionId(actionId);

    try {
      await apiClient.dismissAction(actionId, reason);
      setAutonomousActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (error) {
      console.error('Failed to dismiss action:', error);
    } finally {
      setIsActionLoading(false);
      setLoadingActionId(null);
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <Spinner size="lg" />
      </div>
    );
  }

  const firstName = user.name?.split(' ')[0] || user.email.split('@')[0];

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-lg py-md border-b border-glass-border">
        <button
          onClick={() => router.push('/dashboard')}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
        >
          <MenuIcon className="w-6 h-6 text-text-primary" />
        </button>

        <h1 className="text-lg font-semibold text-text-primary">Cortex</h1>

        <button
          onClick={() => router.push('/settings')}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-tertiary active-opacity"
        >
          <SettingsOutlineIcon className="w-6 h-6 text-text-primary" />
        </button>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col">
            <div className="pt-lg">
              <AutonomousActionsList
                actions={autonomousActions}
                onApprove={handleApproveAction}
                onDismiss={handleDismissAction}
                isLoading={isActionLoading}
                loadingActionId={loadingActionId || undefined}
              />
            </div>
            <EmptyState userName={firstName} onPromptClick={handlePromptClick} />
          </div>
        ) : (
          <div className="py-lg">
            {messages.length <= 1 && (
              <>
                <AutonomousActionsList
                  actions={autonomousActions}
                  onApprove={handleApproveAction}
                  onDismiss={handleDismissAction}
                  isLoading={isActionLoading}
                  loadingActionId={loadingActionId || undefined}
                />
                <DayBriefingScroll items={briefingItems} onItemClick={handleBriefingClick} />
                <InsightsPillRow insights={insights} onInsightClick={handleInsightClick} />
              </>
            )}

            <div className="px-lg">
              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  timestamp={message.timestamp}
                  status={message.status}
                />
              ))}

              {isTyping && <TypingIndicator />}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Chat Input */}
      <div className="flex-shrink-0">
        <EnhancedChatInput
          onSendMessage={handleSendMessage}
          disabled={isSending}
          isLoading={isSending}
          placeholder="Message Cortex..."
        />
      </div>
    </div>
  );
}
