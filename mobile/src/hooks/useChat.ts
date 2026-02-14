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
    // Greeting stays fresh for 15 minutes - doesn't need frequent updates
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
    // Don't refetch on focus - greeting changes slowly
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Fetch chat suggestions with auto-refresh
export const useChatSuggestions = () => {
  return useQuery({
    queryKey: queryKeys.chat.suggestions(),
    queryFn: () => chatService.getSuggestions(),
    // Suggestions stay fresh longer to reduce API calls
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes cache
    // Reduced polling - rely on push notifications for real-time updates
    refetchInterval: 10 * 60 * 1000, // 10 minutes (reduced from 2 min)
    // Don't refetch on every focus - too aggressive
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

// Fetch daily briefing with caching
export const useBriefing = () => {
  return useQuery({
    queryKey: ['briefing'],
    queryFn: () => chatService.getBriefing(),
    // Briefing stays fresh for 10 minutes
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
    // Don't refetch on every focus or mount - data changes slowly
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
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
