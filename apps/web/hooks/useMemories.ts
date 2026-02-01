import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import type { Memory } from '@/types/memory';

export function useMemories(userId?: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      setError(null);
      const response = await apiClient.getMemories();
      setMemories(response.memories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
      console.error('Failed to load memories:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const addMemory = async (content: string) => {
    await apiClient.addMemory(content);
    await loadMemories();
  };

  useEffect(() => {
    if (userId) {
      loadMemories();
    }
  }, [userId]);

  return {
    memories,
    isLoading,
    error,
    reload: loadMemories,
    addMemory,
  };
}
