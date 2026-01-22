import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { memoryService } from '../services/memory';
import { Memory, CreateMemoryInput } from '../types';

// Fetch paginated memories with infinite scroll
export const useMemories = (limit = 20) => {
  return useInfiniteQuery({
    queryKey: queryKeys.memories.list({ limit }),
    queryFn: async ({ pageParam = 0 }) => {
      const response = await memoryService.getMemories(limit, pageParam);
      return response;
    },
    getNextPageParam: (lastPage, allPages) => {
      // If we got fewer items than limit, there are no more pages
      if (lastPage.memories.length < limit) {
        return undefined;
      }
      return allPages.length * limit;
    },
    initialPageParam: 0,
  });
};

// Fetch single memory
export const useMemory = (id: string) => {
  return useQuery({
    queryKey: queryKeys.memories.detail(id),
    queryFn: () => memoryService.getMemory(id),
    enabled: !!id,
  });
};

// Search memories
export const useSearchMemories = (query: string, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.memories.search(query),
    queryFn: () => memoryService.searchMemories(query),
    enabled: enabled && query.length > 0,
    // Keep previous data while fetching new results
    placeholderData: (previousData) => previousData,
    // Shorter stale time for search results
    staleTime: 10 * 1000,
  });
};

// Create memory mutation with optimistic update
export const useCreateMemory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMemoryInput) => memoryService.createMemory(input),
    onMutate: async (newMemory) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.memories.all });

      // Snapshot previous value
      const previousMemories = queryClient.getQueryData(
        queryKeys.memories.list()
      );

      // Optimistically add the new memory
      queryClient.setQueryData(
        queryKeys.memories.list(),
        (old: any) => {
          if (!old) return old;
          const optimisticMemory: Memory = {
            id: `temp-${Date.now()}`,
            content: newMemory.content,
            memory_type: newMemory.memory_type || 'note',
            created_at: new Date().toISOString(),
            entities: [],
          };
          return {
            ...old,
            pages: [
              {
                ...old.pages[0],
                memories: [optimisticMemory, ...old.pages[0].memories],
              },
              ...old.pages.slice(1),
            ],
          };
        }
      );

      return { previousMemories };
    },
    onError: (_err, _newMemory, context) => {
      // Rollback on error
      if (context?.previousMemories) {
        queryClient.setQueryData(
          queryKeys.memories.list(),
          context.previousMemories
        );
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
    },
  });
};

// Delete memory mutation with optimistic update
export const useDeleteMemory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => memoryService.deleteMemory(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.memories.all });

      const previousMemories = queryClient.getQueryData(
        queryKeys.memories.list()
      );

      // Optimistically remove the memory
      queryClient.setQueryData(
        queryKeys.memories.list(),
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              memories: page.memories.filter((m: Memory) => m.id !== deletedId),
            })),
          };
        }
      );

      return { previousMemories };
    },
    onError: (_err, _deletedId, context) => {
      if (context?.previousMemories) {
        queryClient.setQueryData(
          queryKeys.memories.list(),
          context.previousMemories
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
    },
  });
};
