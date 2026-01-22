import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

// Global error handler for queries
const handleQueryError = (error: Error) => {
  console.error('[React Query] Query error:', error.message);
};

// Global error handler for mutations
const handleMutationError = (error: Error) => {
  console.error('[React Query] Mutation error:', error.message);
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleQueryError,
  }),
  mutationCache: new MutationCache({
    onError: handleMutationError,
  }),
  defaultOptions: {
    queries: {
      // Data is fresh for 30 seconds
      staleTime: 30 * 1000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Refetch on window focus (useful when app comes to foreground)
      refetchOnWindowFocus: true,
      // Don't refetch on mount if data is fresh
      refetchOnMount: true,
      // Network mode - always try to fetch
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Retry mutations once
      retry: 1,
      retryDelay: 1000,
      networkMode: 'offlineFirst',
    },
  },
});

// Query keys factory for type-safe cache management
export const queryKeys = {
  // Memories
  memories: {
    all: ['memories'] as const,
    list: (params?: { limit?: number; offset?: number }) =>
      ['memories', 'list', params] as const,
    detail: (id: string) => ['memories', 'detail', id] as const,
    search: (query: string) => ['memories', 'search', query] as const,
  },
  // Chat
  chat: {
    all: ['chat'] as const,
    suggestions: () => ['chat', 'suggestions'] as const,
    conversation: (id?: string) => ['chat', 'conversation', id] as const,
    greeting: () => ['chat', 'greeting'] as const,
  },
  // Integrations
  integrations: {
    all: ['integrations'] as const,
    status: () => ['integrations', 'status'] as const,
  },
  // User
  user: {
    all: ['user'] as const,
    profile: () => ['user', 'profile'] as const,
  },
};
