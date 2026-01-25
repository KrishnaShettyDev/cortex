import { api, StreamCallbacks, StatusUpdate } from './api';
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
}

// Streaming chat callbacks matching what the UI needs
export interface ChatStreamCallbacks {
  onSearchingMemories?: () => void;
  onMemoriesFound?: (memories: MemoryReference[]) => void;
  onStatus?: (status: StatusUpdate) => void;
  onContent?: (content: string, fullContent: string) => void;
  onPendingActions?: (actions: PendingAction[]) => void;
  onComplete?: (response: StreamingChatResponse) => void;
  onError?: (error: string) => void;
}

class ChatService {
  /**
   * Send a chat message with streaming for real-time updates.
   * Shows real-time status as AI searches memories and generates response.
   *
   * Context Reinstatement (Phase 2.2):
   * Automatically captures current context (location, time, etc.) and sends
   * it with the request. This enables encoding specificity principle where
   * memories matching current context are prioritized.
   */
  async chatStream(
    message: string,
    conversationId: string | undefined,
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    // Track state during streaming
    let memoriesUsed: MemoryReference[] = [];
    let pendingActions: PendingAction[] = [];
    let fullContent = '';
    let convId = conversationId || '';

    // Signal that we're starting to search
    callbacks.onSearchingMemories?.();

    // Capture current context for context reinstatement
    let context: CurrentContext | undefined;
    try {
      context = await contextCaptureService.captureContext();
      logger.debug('[ChatService] Captured context for reinstatement:', context);
    } catch (error) {
      logger.warn('[ChatService] Failed to capture context:', error);
    }

    const streamCallbacks: StreamCallbacks = {
      onMemories: (memories) => {
        memoriesUsed = memories;
        callbacks.onMemoriesFound?.(memoriesUsed);
      },
      onStatus: (status) => {
        // Forward status updates for real-time reasoning display
        logger.debug('[ChatService] Received status from API:', status);
        callbacks.onStatus?.(status);
      },
      onContent: (content) => {
        fullContent += content;
        callbacks.onContent?.(content, fullContent);
      },
      onPendingActions: (actions) => {
        pendingActions = actions;
        callbacks.onPendingActions?.(pendingActions);
      },
      onDone: (data) => {
        convId = data.conversation_id;
        callbacks.onComplete?.({
          response: fullContent,
          conversation_id: convId,
          memories_used: memoriesUsed,
          pending_actions: pendingActions,
        });
      },
      onError: callbacks.onError,
    };

    await api.streamRequest(
      '/chat/stream',
      {
        message,
        conversation_id: conversationId,
        context, // Send context for reinstatement
      },
      streamCallbacks
    );
  }

  /**
   * Regular non-streaming chat (fallback).
   * Also captures context for context reinstatement.
   */
  async chat(
    message: string,
    conversationId?: string
  ): Promise<ChatResponse> {
    // Capture current context for context reinstatement
    let context: CurrentContext | undefined;
    try {
      context = await contextCaptureService.captureContext();
    } catch (error) {
      logger.warn('[ChatService] Failed to capture context:', error);
    }

    const response = await api.request<ChatResponse>('/chat', {
      method: 'POST',
      body: {
        message,
        conversation_id: conversationId,
        context, // Send context for reinstatement
      },
    });

    return response;
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
