import { api, StreamCallbacks, StatusUpdate } from './api';
import {
  ChatResponse,
  ExecuteActionRequest,
  ExecuteActionResponse,
  SmartSuggestionsResponse,
  GreetingResponse,
  MemoryReference,
  PendingAction,
} from '../types';

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

    const streamCallbacks: StreamCallbacks = {
      onMemories: (memories) => {
        memoriesUsed = memories.map((m: any) => ({
          id: m.id,
          content: m.content,
          memory_type: m.memory_type,
          memory_date: m.memory_date,
          photo_url: m.photo_url,
          audio_url: m.audio_url,
        }));
        callbacks.onMemoriesFound?.(memoriesUsed);
      },
      onStatus: (status) => {
        // Forward status updates for real-time reasoning display
        console.log('[ChatService] Received status from API:', status);
        callbacks.onStatus?.(status);
      },
      onContent: (content) => {
        fullContent += content;
        callbacks.onContent?.(content, fullContent);
      },
      onPendingActions: (actions) => {
        pendingActions = actions.map((a: any) => ({
          action_id: a.action_id,
          tool: a.tool,
          arguments: a.arguments,
        }));
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
      },
      streamCallbacks
    );
  }

  /**
   * Regular non-streaming chat (fallback).
   */
  async chat(
    message: string,
    conversationId?: string
  ): Promise<ChatResponse> {
    const response = await api.request<ChatResponse>('/chat', {
      method: 'POST',
      body: {
        message,
        conversation_id: conversationId,
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
}

export const chatService = new ChatService();
