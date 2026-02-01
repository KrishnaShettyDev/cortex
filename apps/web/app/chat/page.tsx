/**
 * Chat Page
 * Enhanced chat interface with briefings, insights, and AI responses
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
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
}

export default function ChatPage() {
  const router = useRouter();
  const { user, checkAuth } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mock data - replace with API calls
  const [briefingItems] = useState<BriefingItem[]>([
    {
      id: '1',
      type: 'emails',
      title: 'Urgent Emails',
      description: '3 emails need your attention from Sarah, John, and the team',
      count: 3,
      urgent: true,
    },
    {
      id: '2',
      type: 'calendar',
      title: 'Upcoming Meetings',
      description: 'Team standup in 30 minutes, 1:1 with manager at 2pm',
      count: 5,
    },
    {
      id: '3',
      type: 'tasks',
      title: 'Follow-ups',
      description: '2 people are waiting for your response',
      count: 2,
    },
  ]);

  const [insights] = useState<InsightData[]>([
    { type: 'urgent', count: 3, label: 'Urgent' },
    { type: 'follow_up', count: 2, label: 'Follow-ups' },
    { type: 'unread', count: 12, label: 'Unread' },
    { type: 'upcoming', count: 5, label: 'Today' },
  ]);

  // Autonomous actions - mock data
  const [autonomousActions, setAutonomousActions] = useState<AutonomousAction[]>([
    {
      id: '1',
      action_type: 'email_reply',
      title: 'Reply to Sarah',
      description: 'Draft email reply about Q4 budget discussion',
      action_payload: {
        thread_id: 'thread_123',
        to: 'sarah@company.com',
        subject: 'Re: Q4 Budget Discussion',
        body: "Hi Sarah,\n\nThanks for bringing this up. I've reviewed the budget proposal and I think we can allocate an additional 15% to the marketing initiatives you mentioned.\n\nLet's schedule a call this week to discuss the details.\n\nBest,",
      },
      reason: 'Sarah usually expects a reply within 2 hours',
      confidence_score: 0.85,
      priority_score: 85,
      source_type: 'email',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: '2',
      action_type: 'calendar_create',
      title: 'Schedule Focus Time',
      description: 'Block 2 hours for deep work tomorrow morning',
      action_payload: {
        title: 'Focus Time - Project Review',
        start_time: new Date(Date.now() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 24 * 60 * 60 * 1000 + 11 * 60 * 60 * 1000).toISOString(),
        description: 'Dedicated time for project review and planning',
      },
      reason: 'You have no meetings tomorrow morning and mentioned needing focus time',
      confidence_score: 0.75,
      priority_score: 70,
      source_type: 'pattern',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  ]);

  const [isActionLoading, setIsActionLoading] = useState(false);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, router]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    // Add user message
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
      // TODO: Call API to send message
      // const response = await apiClient.sendMessage(content);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update message status
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMessage.id ? { ...msg, status: 'sent' as MessageStatus } : msg
        )
      );

      // Show typing indicator
      setIsTyping(true);

      // Simulate assistant response
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm here to help! I can assist you with your emails, calendar, tasks, and more. What would you like to know?",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Update message status to error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMessage.id ? { ...msg, status: 'error' as MessageStatus } : msg
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleBriefingClick = (item: BriefingItem) => {
    // Send as message
    handleSendMessage(`Show me ${item.title.toLowerCase()}`);
  };

  const handleInsightClick = (insight: InsightData) => {
    // Send as message
    handleSendMessage(`Show me ${insight.label.toLowerCase()} items`);
  };

  const handlePromptClick = (action: string) => {
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
  };

  const handleApproveAction = async (
    actionId: string,
    modifications?: Record<string, unknown>
  ) => {
    setIsActionLoading(true);
    setLoadingActionId(actionId);

    try {
      // TODO: Call API to execute action
      // const result = await apiClient.approveAction(actionId, modifications);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Remove action from list
      setAutonomousActions((prev) => prev.filter((a) => a.id !== actionId));

      // Add success message to chat
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
      // Show error message
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
  };

  const handleDismissAction = async (actionId: string, reason?: string) => {
    setIsActionLoading(true);
    setLoadingActionId(actionId);

    try {
      // TODO: Call API to dismiss action
      // await apiClient.dismissAction(actionId, reason);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Remove action from list
      setAutonomousActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (error) {
      console.error('Failed to dismiss action:', error);
    } finally {
      setIsActionLoading(false);
      setLoadingActionId(null);
    }
  };

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
            {/* Autonomous Actions - Show at top when no messages */}
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
            {/* Autonomous Actions + Briefing - Show at top before messages */}
            {messages.length <= 1 && (
              <>
                <AutonomousActionsList
                  actions={autonomousActions}
                  onApprove={handleApproveAction}
                  onDismiss={handleDismissAction}
                  isLoading={isActionLoading}
                  loadingActionId={loadingActionId || undefined}
                />
                <DayBriefingScroll
                  items={briefingItems}
                  onItemClick={handleBriefingClick}
                />
                <InsightsPillRow
                  insights={insights}
                  onInsightClick={handleInsightClick}
                />
              </>
            )}

            {/* Messages */}
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

      {/* Chat Input - Fixed at bottom */}
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
