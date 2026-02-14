import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { logger } from '../utils/logger';

// Global error handler for queries
const handleQueryError = (error: Error) => {
  logger.error('[React Query] Query error:', error.message);
};

// Global error handler for mutations
const handleMutationError = (error: Error) => {
  logger.error('[React Query] Mutation error:', error.message);
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
      // Data is fresh for 2 minutes (increased from 30s to reduce API calls)
      staleTime: 2 * 60 * 1000,
      // Keep unused data in cache for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Retry failed requests 2 times with exponential backoff
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Don't refetch on window focus - rely on push notifications
      refetchOnWindowFocus: false,
      // Don't refetch on mount if data exists in cache
      refetchOnMount: false,
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
    proactiveMessages: () => ['chat', 'proactiveMessages'] as const,
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
  // Autonomous Actions
  autonomousActions: {
    all: ['autonomousActions'] as const,
    pending: () => ['autonomousActions', 'pending'] as const,
    detail: (id: string) => ['autonomousActions', 'detail', id] as const,
    stats: () => ['autonomousActions', 'stats'] as const,
  },
  // Nudges (proactive intelligence)
  nudges: {
    all: ['nudges'] as const,
    list: () => ['nudges', 'list'] as const,
  },
};
