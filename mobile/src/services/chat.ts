import { api, StreamCallbacks, StatusUpdate, ActionTaken } from './api';
import {
  ChatResponse,
  ExecuteActionRequest,
  ExecuteActionResponse,
  SmartSuggestionsResponse,
  GreetingResponse,
  MemoryReference,
  PendingAction,
  ProactiveInsightsResponse,
  DailyBriefingResponse,
  BriefingItem,
} from '../types';
import { logger } from '../utils/logger';

// Re-export StatusUpdate for convenience
export type { StatusUpdate } from './api';

// Streaming response that builds up during stream
export interface StreamingChatResponse {
  response: string;
  conversation_id: string;
  memories_used: MemoryReference[];
  pending_actions: PendingAction[];
  actions_taken: ActionTaken[];
  // Cognitive layer tracking
  outcome_id?: string;
  sources?: {
    memories: number;
    learnings: number;
    beliefs: number;
  };
}

// Streaming chat callbacks matching what the UI needs
export interface ChatStreamCallbacks {
  onSearchingMemories?: () => void;
  onMemoriesFound?: (memories: MemoryReference[]) => void;
  onStatus?: (status: StatusUpdate) => void;
  onContent?: (content: string, fullContent: string) => void;
  onPendingActions?: (actions: PendingAction[]) => void;
  onActionsTaken?: (actions: ActionTaken[]) => void;
  onComplete?: (response: StreamingChatResponse) => void;
  onError?: (error: string) => void;
}

// Action-enhanced chat response (Iris/Poke-style)
export interface ActionChatResponse {
  response: string;
  memories_used: number;
  model: string;
  actions?: {
    pending: ActionPendingItem[];
    executed: ActionExecutedItem[];
  };
  queryResults?: any;
}

export interface ActionPendingItem {
  id: string;
  action: string;
  parameters: Record<string, any>;
  confirmationMessage: string;
  confidence: number;
  expiresAt: string;
}

export interface ActionExecutedItem {
  success: boolean;
  action: string;
  message: string;
  result?: any;
  error?: string;
}

// Types for cognitive layer responses
interface SessionContext {
  topBeliefs: Array<{ id: string; proposition: string; confidence: number }>;
  topLearnings: Array<{ id: string; insight: string; confidence: number }>;
  recentOutcomes: { total: number; positiveRate: number };
  pendingItems: {
    unresolvedConflicts: number;
    weakenedBeliefs: number;
    uncertainLearnings: number;
  };
}

interface Nudge {
  id: string;
  entity_id: string;
  entity_name: string;
  nudge_type: string;
  priority: string;
  title: string;
  message: string;
  suggested_action: string;
}

interface Commitment {
  id: string;
  content: string;
  type: string;
  status: string;
  due_date: string | null;
  entity_name: string | null;
}

// Proactive message types (Poke/Iris-style)
export interface ProactiveMessage {
  id: string;
  messageType: 'notification' | 'briefing' | 'reminder' | 'insight' | 'action_result';
  content: string;
  suggestedActions: SuggestedAction[];
  isRead: boolean;
  createdAt: string;
  eventId?: string;
  triggerId?: string;
}

export interface SuggestedAction {
  type: string;
  label: string;
  payload?: Record<string, any>;
}

class ChatService {
  /**
   * Send a chat message with memory-augmented context.
   * Uses /api/chat which searches memories and generates a response.
   */
  async chatStream(
    message: string,
    conversationId: string | undefined,
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    try {
      const response = await api.request<{
        response: string;
        memories_used: number;
        model: string;
      }>('/api/chat', {
        method: 'POST',
        body: {
          message,
          model: 'gpt-4o-mini',
          contextLimit: 5,
        },
      });

      callbacks.onMemoriesFound?.([]);

      const fullContent = response.response;
      const chunkSize = 20;
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        const chunk = fullContent.slice(i, i + chunkSize);
        callbacks.onContent?.(chunk, fullContent.slice(0, i + chunkSize));
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      callbacks.onComplete?.({
        response: fullContent,
        conversation_id: conversationId || '',
        memories_used: [],
        pending_actions: [],
        actions_taken: [],
      });
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error.message : 'Chat failed');
    }
  }

  /**
   * Submit feedback for an outcome (thumbs up/down).
   * This helps improve the cognitive layer's responses over time.
   */
  async submitFeedback(
    outcomeId: string,
    signal: 'positive' | 'negative' | 'neutral',
    source: string = 'explicit_feedback'
  ): Promise<{ success: boolean }> {
    try {
      await api.request(`/v3/outcomes/${outcomeId}/feedback`, {
        method: 'POST',
        body: { signal, source },
      });
      return { success: true };
    } catch (error) {
      logger.error('ChatService: Failed to submit feedback', error);
      return { success: false };
    }
  }

  /**
   * Regular non-streaming chat (fallback).
   * Uses the new Cloudflare Workers backend.
   */
  async chat(
    message: string,
    conversationId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    model?: string,
    contextLimit?: number
  ): Promise<ChatResponse> {
    const response = await api.request<{
      response: string;
      memories_used: number;
      model: string;
    }>('/api/chat', {
      method: 'POST',
      body: {
        message,
        history,
        model: model || 'gpt-4o-mini',
        contextLimit: contextLimit || 5,
      },
    });

    // Transform to ChatResponse format
    return {
      response: response.response,
      conversation_id: conversationId || '',
      memories_used: [],
      actions_taken: [],
      pending_actions: [],
    };
  }

  /**
   * Execute a pending action after user confirmation.
   * Maps to commitment completion for now.
   */
  async executeAction(
    actionId: string,
    tool: string,
    args: Record<string, any>,
    modifiedArgs?: Record<string, any>
  ): Promise<ExecuteActionResponse> {
    // If it's a commitment completion, use the v3 endpoint
    if (tool === 'complete_commitment' || tool === 'commitment') {
      try {
        await api.request(`/v3/commitments/${actionId}/complete`, {
          method: 'POST',
        });
        return {
          success: true,
          message: 'Commitment marked as completed',
          result: { completed: true },
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to complete action',
          result: {},
        };
      }
    }

    // Fallback: try the old endpoint (will likely fail)
    const body: ExecuteActionRequest = {
      action_id: actionId,
      tool,
      arguments: args,
    };

    if (modifiedArgs) {
      body.modified_arguments = modifiedArgs;
    }

    try {
      return await api.request<ExecuteActionResponse>('/chat/execute-action', {
        method: 'POST',
        body,
      });
    } catch (error) {
      logger.warn('ChatService: execute-action endpoint not implemented');
      return {
        success: false,
        message: 'Action execution not available',
        result: {},
      };
    }
  }

  /**
   * Action-enhanced chat (Iris/Poke-style)
   * Parses natural language for calendar/email actions
   */
  async chatWithActions(
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: {
      model?: string;
      contextLimit?: number;
      autoExecuteQueries?: boolean;
    }
  ): Promise<ActionChatResponse> {
    const response = await api.request<ActionChatResponse>('/api/chat/actions', {
      method: 'POST',
      body: {
        message,
        history,
        model: options?.model || 'gpt-4o-mini',
        contextLimit: options?.contextLimit || 5,
        autoExecuteQueries: options?.autoExecuteQueries ?? true,
      },
    });

    return response;
  }

  /**
   * Confirm a pending action (calendar event, email, etc.)
   */
  async confirmPendingAction(actionId: string): Promise<{
    success: boolean;
    action: string;
    message: string;
    result?: any;
    error?: string;
  }> {
    return api.request(`/api/actions/${actionId}/confirm`, {
      method: 'POST',
    });
  }

  /**
   * Cancel a pending action
   */
  async cancelPendingAction(actionId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return api.request(`/api/actions/${actionId}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * Stream chat with action support
   * This provides Iris/Poke-style chat with calendar/email action capabilities
   */
  async chatStreamWithActions(
    message: string,
    conversationId: string | undefined,
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    try {
      callbacks.onSearchingMemories?.();
      callbacks.onStatus?.({ step: 'searching', message: 'Understanding your request...' });

      const response = await this.chatWithActions(message);

      callbacks.onMemoriesFound?.([]);

      // Check if there are pending actions that need confirmation
      if (response.actions?.pending && response.actions.pending.length > 0) {
        callbacks.onStatus?.({ step: 'processing', message: 'Action requires confirmation...' });

        // Convert to PendingAction format
        const pendingActions: PendingAction[] = response.actions.pending.map(p => ({
          action_id: p.id,
          tool: p.action,
          arguments: p.parameters,
        }));

        callbacks.onPendingActions?.(pendingActions);
      }

      // Check if actions were executed
      if (response.actions?.executed && response.actions.executed.length > 0) {
        const actionsTaken: ActionTaken[] = response.actions.executed.map(e => ({
          tool: e.action,
          arguments: {},
          result: {
            success: e.success,
            data: e.result,
            message: e.message,
          },
        }));

        callbacks.onActionsTaken?.(actionsTaken);
      }

      callbacks.onStatus?.({ step: 'generating', message: 'Generating response...' });

      // Stream the response content
      const fullContent = response.response;
      const chunkSize = 20;
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        const chunk = fullContent.slice(i, i + chunkSize);
        callbacks.onContent?.(chunk, fullContent.slice(0, i + chunkSize));
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      callbacks.onComplete?.({
        response: fullContent,
        conversation_id: conversationId || '',
        memories_used: [],
        pending_actions: response.actions?.pending?.map(p => ({
          action_id: p.id,
          tool: p.action,
          arguments: p.parameters,
        })) || [],
        actions_taken: response.actions?.executed?.map(e => ({
          tool: e.action,
          arguments: {},
          result: {
            success: e.success,
            data: e.result,
            message: e.message,
          },
        })) || [],
      });
    } catch (error) {
      logger.error('ChatService: chatStreamWithActions failed', error);
      // Fall back to regular chat
      await this.chatStreamFallback(message, conversationId, callbacks);
    }
  }

  /**
   * Get smart contextual suggestions (nudges from the relationship layer).
   * Uses v3/nudges endpoint instead of the stub.
   */
  async getSuggestions(): Promise<SmartSuggestionsResponse> {
    try {
      const response = await api.request<{ nudges: Nudge[] }>('/v3/nudges', {
        method: 'GET',
      });

      // Transform nudges to suggestions format
      const suggestions = (response.nudges || []).map(nudge => ({
        id: nudge.id,
        text: nudge.title,
        description: nudge.message,
        action_prompt: nudge.suggested_action,
        priority: nudge.priority,
        type: nudge.nudge_type,
      }));

      return { suggestions };
    } catch (error) {
      logger.warn('ChatService: Failed to fetch suggestions from /v3/nudges', error);
      return { suggestions: [] };
    }
  }

  /**
   * Get a dynamic, contextual greeting.
   */
  async getGreeting(): Promise<GreetingResponse> {
    const hour = new Date().getHours();
    let timeGreeting: string;
    if (hour < 12) {
      timeGreeting = 'Good morning';
    } else if (hour < 17) {
      timeGreeting = 'Good afternoon';
    } else {
      timeGreeting = 'Good evening';
    }

    try {
      // Try to get briefing for contextual message
      const response = await api.request<{
        commitments?: { todayCount?: number; overdue?: any[] };
        nudges?: any[];
      }>('/v3/briefing', { method: 'GET' });

      const overdueCount = response.commitments?.overdue?.length || 0;
      const todayCount = response.commitments?.todayCount || 0;
      const nudgeCount = response.nudges?.length || 0;

      let contextualMessage: string | null = null;
      if (overdueCount > 0) {
        contextualMessage = `You have ${overdueCount} overdue commitment${overdueCount > 1 ? 's' : ''}.`;
      } else if (todayCount > 0) {
        contextualMessage = `${todayCount} thing${todayCount > 1 ? 's' : ''} on your plate today.`;
      } else if (nudgeCount > 0) {
        contextualMessage = `${nudgeCount} relationship nudge${nudgeCount > 1 ? 's' : ''} for you.`;
      }

      return {
        greeting: `${timeGreeting}!`,
        contextual_message: contextualMessage,
      };
    } catch (error) {
      return {
        greeting: `${timeGreeting}!`,
        contextual_message: null,
      };
    }
  }

  /**
   * Get proactive insights for the chat UI.
   * Combines data from learnings, beliefs, and outcomes.
   */
  async getInsights(): Promise<ProactiveInsightsResponse> {
    try {
      // Fetch from multiple v3 endpoints in parallel
      const [outcomeStats, learningsProfile, commitments] = await Promise.all([
        api.request<{
          total: number;
          bySignal: Record<string, number>;
          feedbackRate: number;
          positiveRate: number;
        }>('/v3/outcomes/stats', { method: 'GET' }).catch(() => null),
        api.request<Record<string, any[]>>('/v3/learnings/profile', { method: 'GET' }).catch(() => null),
        api.request<{ commitments: Commitment[] }>('/v3/commitments/overdue', { method: 'GET' }).catch(() => null),
      ]);

      // Count pending items
      const overdueCommitments = commitments?.commitments?.length || 0;
      const totalLearnings = learningsProfile ? Object.values(learningsProfile).flat().length : 0;

      return {
        total_attention_needed: overdueCommitments,
        urgent_emails: 0, // No email endpoint yet
        pending_commitments: overdueCommitments,
        important_dates: 0, // Would come from entities
        // Extended data
        outcome_stats: outcomeStats || undefined,
        learning_count: totalLearnings,
      };
    } catch (error) {
      logger.warn('ChatService: Failed to fetch insights', error);
      return {
        total_attention_needed: 0,
        urgent_emails: 0,
        pending_commitments: 0,
        important_dates: 0,
      };
    }
  }

  /**
   * Get actionable daily briefing for the chat UI.
   * Uses the consolidated /v3/briefing endpoint for efficient single-call data fetch.
   */
  async getBriefing(): Promise<DailyBriefingResponse> {
    try {
      // Use consolidated briefing endpoint
      const response = await api.request<{
        greeting: string;
        commitments: {
          upcoming: Commitment[];
          overdue: Commitment[];
          todayCount: number;
        };
        nudges: Nudge[];
        cognitive: {
          recentLearnings: Array<{ id: string; insight: string; confidence: number }>;
          topBeliefs: Array<{ id: string; proposition: string; current_confidence: number }>;
          outcomeStats: { total: number; positiveRate: number };
        };
        sleepCompute: {
          lastRun: string | null;
          context: SessionContext | null;
        };
        stats: {
          totalMemories: number;
          totalEntities: number;
          totalLearnings: number;
          totalBeliefs: number;
        };
      }>('/v3/briefing', { method: 'GET' });

      // Build briefing items from the response
      const items: BriefingItem[] = [];

      // Add overdue commitments as high urgency
      response.commitments.overdue.forEach((c: Commitment) => {
        items.push({
          id: c.id,
          type: 'deadline',
          title: c.content,
          subtitle: `Overdue${c.entity_name ? ` - ${c.entity_name}` : ''}`,
          urgency_score: 90,
          action_prompt: `Help me complete: ${c.content}`,
          icon: 'alert-circle',
          urgency: 'high',
        });
      });

      // Add today's commitments
      response.commitments.upcoming.slice(0, 5).forEach((c: Commitment) => {
        const isToday = c.due_date && new Date(c.due_date).toDateString() === new Date().toDateString();
        items.push({
          id: c.id,
          type: 'reminder',
          title: c.content,
          subtitle: c.entity_name || 'Personal',
          urgency_score: isToday ? 70 : 50,
          action_prompt: `Help me complete: ${c.content}`,
          icon: 'checkmark-circle',
          urgency: isToday ? 'medium' : 'low',
        });
      });

      // Add relationship nudges
      response.nudges.slice(0, 3).forEach((n: Nudge) => {
        items.push({
          id: n.id,
          type: 'meeting',
          title: n.title,
          subtitle: n.message,
          urgency_score: n.priority === 'high' ? 80 : n.priority === 'medium' ? 60 : 40,
          action_prompt: n.suggested_action,
          icon: 'people',
          urgency: n.priority as 'high' | 'medium' | 'low',
        });
      });

      // Add recent learnings as insights (if available)
      const recentLearnings = response.cognitive?.recentLearnings || [];
      recentLearnings.slice(0, 2).forEach((l: { id: string; insight: string; confidence: number }) => {
        items.push({
          id: l.id,
          type: 'memory',
          title: 'New Insight',
          subtitle: l.insight,
          urgency_score: 30,
          action_prompt: `Tell me more about: ${l.insight}`,
          icon: 'bulb',
          urgency: 'low',
        });
      });

      // Sort by urgency score
      items.sort((a, b) => b.urgency_score - a.urgency_score);

      // Build summary
      const overdueCount = response.commitments.overdue.length;
      const todayCount = response.commitments.todayCount;
      const nudgeCount = response.nudges.length;

      let summary = response.greeting;
      if (overdueCount > 0 || todayCount > 0 || nudgeCount > 0) {
        const parts = [];
        if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
        if (todayCount > 0) parts.push(`${todayCount} due today`);
        if (nudgeCount > 0) parts.push(`${nudgeCount} relationship check-in${nudgeCount > 1 ? 's' : ''}`);
        summary = `You have ${parts.join(', ')}.`;
      }

      return {
        summary,
        items,
        total_count: items.length,
        has_urgent: overdueCount > 0,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.warn('ChatService: Failed to fetch briefing from /v3/briefing', error);
      // Fallback to legacy method if consolidated endpoint fails
      return this.getBriefingLegacy();
    }
  }

  /**
   * Legacy briefing method - fallback if consolidated endpoint fails.
   */
  private async getBriefingLegacy(): Promise<DailyBriefingResponse> {
    try {
      const [upcomingCommitments, nudges] = await Promise.all([
        api.request<{ commitments: Commitment[] }>('/v3/commitments/upcoming', { method: 'GET' }).catch(() => ({ commitments: [] })),
        api.request<{ nudges: Nudge[] }>('/v3/nudges', { method: 'GET' }).catch(() => ({ nudges: [] })),
      ]);

      const items: BriefingItem[] = [];

      upcomingCommitments.commitments.slice(0, 5).forEach(c => {
        items.push({
          id: c.id,
          type: 'reminder',
          title: c.content,
          subtitle: c.entity_name || 'Personal',
          urgency_score: 50,
          action_prompt: `Help me complete: ${c.content}`,
          icon: 'checkmark-circle',
        });
      });

      nudges.nudges.slice(0, 3).forEach(n => {
        items.push({
          id: n.id,
          type: 'meeting',
          title: n.title,
          subtitle: n.message,
          urgency_score: 40,
          action_prompt: n.suggested_action,
          icon: 'people',
        });
      });

      return {
        summary: 'Your day looks good!',
        items,
        total_count: items.length,
        has_urgent: false,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.warn('ChatService: Legacy briefing also failed', error);
      return {
        summary: 'Your day looks good!',
        items: [],
        total_count: 0,
        has_urgent: false,
        generated_at: new Date().toISOString(),
      };
    }
  }

  // =============================================================================
  // PROACTIVE MESSAGES (Poke/Iris-style)
  // =============================================================================

  /**
   * Fetch proactive messages for the chat UI.
   * These are system-initiated messages (notifications, reminders, insights).
   */
  async getProactiveMessages(options?: {
    unreadOnly?: boolean;
    limit?: number;
  }): Promise<ProactiveMessage[]> {
    try {
      const params = new URLSearchParams();
      if (options?.unreadOnly) params.append('unread', 'true');
      if (options?.limit) params.append('limit', options.limit.toString());

      const response = await api.request<{
        success: boolean;
        messages: Array<{
          id: string;
          message_type: string;
          content: string;
          suggested_actions: string;
          is_read: number;
          created_at: string;
          event_id?: string;
          trigger_id?: string;
        }>;
      }>(`/proactive/messages?${params.toString()}`, { method: 'GET' });

      return (response.messages || []).map(msg => ({
        id: msg.id,
        messageType: msg.message_type as ProactiveMessage['messageType'],
        content: msg.content,
        suggestedActions: JSON.parse(msg.suggested_actions || '[]'),
        isRead: msg.is_read === 1,
        createdAt: msg.created_at,
        eventId: msg.event_id,
        triggerId: msg.trigger_id,
      }));
    } catch (error) {
      logger.warn('ChatService: Failed to fetch proactive messages', error);
      return [];
    }
  }

  /**
   * Mark a proactive message as read.
   */
  async markProactiveMessageRead(messageId: string): Promise<boolean> {
    try {
      await api.request(`/proactive/messages/${messageId}/read`, {
        method: 'POST',
      });
      return true;
    } catch (error) {
      logger.warn('ChatService: Failed to mark message as read', error);
      return false;
    }
  }

  /**
   * Execute a suggested action from a proactive message.
   */
  async executeProactiveAction(
    messageId: string,
    actionType: string,
    payload?: Record<string, any>
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const response = await api.request<{
        success: boolean;
        result?: any;
        error?: string;
      }>(`/proactive/messages/${messageId}/action`, {
        method: 'POST',
        body: { actionType, payload },
      });
      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Action failed',
      };
    }
  }

  /**
   * Get unread proactive message count for badge display.
   */
  async getUnreadProactiveCount(): Promise<number> {
    try {
      const response = await api.request<{
        success: boolean;
        count: number;
      }>('/proactive/messages/unread-count', { method: 'GET' });
      return response.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Poll for new proactive messages (used by mobile app).
   * Returns only messages created after the given timestamp.
   */
  async pollProactiveMessages(since?: string): Promise<ProactiveMessage[]> {
    try {
      const params = new URLSearchParams();
      if (since) params.append('since', since);
      params.append('limit', '10');

      const response = await api.request<{
        success: boolean;
        messages: Array<{
          id: string;
          message_type: string;
          content: string;
          suggested_actions: string;
          is_read: number;
          created_at: string;
          event_id?: string;
          trigger_id?: string;
        }>;
      }>(`/proactive/messages/poll?${params.toString()}`, { method: 'GET' });

      return (response.messages || []).map(msg => ({
        id: msg.id,
        messageType: msg.message_type as ProactiveMessage['messageType'],
        content: msg.content,
        suggestedActions: JSON.parse(msg.suggested_actions || '[]'),
        isRead: msg.is_read === 1,
        createdAt: msg.created_at,
        eventId: msg.event_id,
        triggerId: msg.trigger_id,
      }));
    } catch (error) {
      logger.warn('ChatService: Failed to poll proactive messages', error);
      return [];
    }
  }

  // =============================================================================
  // USER TRIGGERS (Natural language scheduling)
  // =============================================================================

  /**
   * Create a new trigger from natural language.
   * Example: "Remind me every weekday at 9am to check emails"
   */
  async createTrigger(input: string, options?: {
    name?: string;
    timezone?: string;
  }): Promise<{
    success: boolean;
    trigger?: {
      id: string;
      name: string;
      cronExpression: string;
      humanReadable: string;
      nextTriggerAt: string;
    };
    error?: string;
  }> {
    try {
      const response = await api.request<{
        success: boolean;
        trigger: {
          id: string;
          name: string;
          cronExpression: string;
          humanReadable: string;
          nextTriggerAt: string;
        };
        error?: string;
      }>('/v3/triggers', {
        method: 'POST',
        body: {
          input,
          name: options?.name,
          timezone: options?.timezone,
        },
      });
      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create trigger',
      };
    }
  }

  /**
   * Get list of user's triggers.
   */
  async getTriggers(): Promise<Array<{
    id: string;
    name: string;
    humanReadable: string;
    isActive: boolean;
    nextTriggerAt: string | null;
    lastTriggeredAt: string | null;
  }>> {
    try {
      const response = await api.request<{
        success: boolean;
        triggers: Array<{
          id: string;
          name: string;
          humanReadable: string;
          isActive: boolean;
          nextTriggerAt: string | null;
          lastTriggeredAt: string | null;
        }>;
      }>('/v3/triggers', { method: 'GET' });
      return response.triggers || [];
    } catch (error) {
      logger.warn('ChatService: Failed to fetch triggers', error);
      return [];
    }
  }

  /**
   * Pause or resume a trigger.
   */
  async toggleTrigger(triggerId: string, isActive: boolean): Promise<boolean> {
    try {
      await api.request(`/v3/triggers/${triggerId}`, {
        method: 'PATCH',
        body: { isActive },
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete a trigger.
   */
  async deleteTrigger(triggerId: string): Promise<boolean> {
    try {
      await api.request(`/v3/triggers/${triggerId}`, {
        method: 'DELETE',
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const chatService = new ChatService();
