import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { chatService } from '../services/chat';
import { ChatMessage } from '../types';
import { useAppStore } from '../stores/appStore';

// Fetch dynamic greeting based on calendar and emails
export const useGreeting = () => {
  return useQuery({
    queryKey: queryKeys.chat.greeting(),
    queryFn: () => chatService.getGreeting(),
    // Greeting stays fresh for 5 minutes
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Refresh when app comes to foreground
    refetchOnWindowFocus: true,
    // Get fresh data on mount
    refetchOnMount: 'always',
  });
};

// Fetch chat suggestions with auto-refresh
export const useChatSuggestions = () => {
  return useQuery({
    queryKey: queryKeys.chat.suggestions(),
    queryFn: () => chatService.getSuggestions(),
    // Real-time suggestions: shorter stale time
    staleTime: 30 * 1000, // 30 seconds
    // Auto-refresh every 2 minutes to catch new sync data
    refetchInterval: 2 * 60 * 1000, // 2 minutes
    // Refresh when app comes to foreground
    refetchOnWindowFocus: true,
    // Get fresh data on mount
    refetchOnMount: 'always',
  });
};

// Send message mutation
export const useSendMessage = () => {
  const queryClient = useQueryClient();
  const { lastConversationId, setLastConversationId } = useAppStore();

  return useMutation({
    mutationFn: async ({
      message,
      conversationId,
    }: {
      message: string;
      conversationId?: string;
    }) => {
      const response = await chatService.chat(
        message,
        conversationId || lastConversationId || undefined
      );
      return response;
    },
    onSuccess: (data) => {
      // Update conversation ID if returned
      if (data.conversation_id) {
        setLastConversationId(data.conversation_id);
      }
      // Invalidate suggestions as they might change based on conversation
      queryClient.invalidateQueries({
        queryKey: queryKeys.chat.suggestions(),
      });
    },
  });
};

// Execute action mutation
export const useExecuteAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      actionId,
      tool,
      args,
      modifiedArgs,
    }: {
      actionId: string;
      tool: string;
      args: Record<string, unknown>;
      modifiedArgs?: Record<string, unknown>;
    }) => {
      return chatService.executeAction(actionId, tool, args, modifiedArgs);
    },
    onSuccess: () => {
      // Invalidate relevant queries after action execution
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.chat.suggestions() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.status(),
      });
    },
  });
};

// Local chat message state management (for UI)
interface ChatState {
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
}

// This can be used with Zustand for local chat state
// For now, export types for component usage
export type { ChatMessage };

// Fetch proactive messages (Poke/Iris-style)
export const useProactiveMessages = () => {
  return useQuery({
    queryKey: queryKeys.chat.proactiveMessages(),
    queryFn: () => chatService.getProactiveMessages({ unreadOnly: false, limit: 10 }),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
};
