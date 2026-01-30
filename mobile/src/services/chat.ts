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
} from '../types';
import { logger } from '../utils/logger';
import { contextCaptureService, CurrentContext } from './contextCapture';

// Re-export StatusUpdate for convenience
export type { StatusUpdate } from './api';

// Streaming response that builds up during stream
export interface StreamingChatResponse {
  response: string;
  conversation_id: string;
  memories_used: MemoryReference[];
  pending_actions: PendingAction[];
  actions_taken: ActionTaken[];
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

class ChatService {
  /**
   * Send a chat message with streaming for real-time updates.
   *
   * NOTE: The new Cloudflare Workers backend doesn't support streaming yet,
   * so this simulates streaming by calling the regular endpoint and then
   * calling callbacks in sequence.
   */
  async chatStream(
    message: string,
    conversationId: string | undefined,
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    try {
      // Signal that we're starting to search
      callbacks.onSearchingMemories?.();

      // Call the non-streaming endpoint
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

      // Simulate streaming by calling callbacks in sequence
      callbacks.onMemoriesFound?.([]);

      // Simulate typing effect by streaming content in chunks
      const fullContent = response.response;
      const chunkSize = 20; // Characters per chunk
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        const chunk = fullContent.slice(i, i + chunkSize);
        callbacks.onContent?.(chunk, fullContent.slice(0, i + chunkSize));
        // Small delay to simulate streaming
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
      pending_actions: [],
    };
  }

  /**
   * Execute a pending action after user confirmation.
   * Optionally allows modifying the action arguments before execution.
   */
  async executeAction(
    actionId: string,
    tool: string,
    args: Record<string, any>,
    modifiedArgs?: Record<string, any>
  ): Promise<ExecuteActionResponse> {
    const body: ExecuteActionRequest = {
      action_id: actionId,
      tool,
      arguments: args,
    };

    if (modifiedArgs) {
      body.modified_arguments = modifiedArgs;
    }

    return api.request<ExecuteActionResponse>('/chat/execute-action', {
      method: 'POST',
      body,
    });
  }

  /**
   * Get smart contextual suggestions based on user's emails and calendar.
   * Returns personalized suggestions like "Reply to John about the project".
   */
  async getSuggestions(): Promise<SmartSuggestionsResponse> {
    return api.request<SmartSuggestionsResponse>('/chat/suggestions', {
      method: 'GET',
    });
  }

  /**
   * Get a dynamic, contextual greeting based on calendar and emails.
   * Returns a TARS-style greeting with relevant context.
   */
  async getGreeting(): Promise<GreetingResponse> {
    return api.request<GreetingResponse>('/chat/greeting', {
      method: 'GET',
    });
  }

  /**
   * Get proactive insights for the chat UI.
   *
   * Returns structured data for:
   * - Relationships needing attention
   * - Upcoming important dates (birthdays, anniversaries)
   * - Pending intentions/commitments
   * - Promises to keep
   * - Active pattern warnings
   * - Emotional state trends
   *
   * This data is shown as special UI cards in the chat interface.
   */
  async getInsights(): Promise<ProactiveInsightsResponse> {
    return api.request<ProactiveInsightsResponse>('/chat/insights', {
      method: 'GET',
    });
  }

  /**
   * Get actionable daily briefing for the chat UI.
   *
   * Returns structured data for:
   * - Calendar events needing attention
   * - Emails requiring response
   * - Upcoming reminders and deadlines
   * - Pattern-based insights
   * - Memory-based items (tests, assignments, meetings)
   *
   * Each item has an action_prompt for starting a new chat.
   */
  async getBriefing(): Promise<DailyBriefingResponse> {
    return api.request<DailyBriefingResponse>('/chat/briefing', {
      method: 'GET',
    });
  }
}

export const chatService = new ChatService();
