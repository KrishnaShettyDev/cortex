import { useState } from 'react';
import { apiClient } from '@/lib/api/client';
import type { SearchResult } from '@/types/memory';

export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (query: string) => {
    if (!query.trim()) return;

    try {
      setIsSearching(true);
      setError(null);
      const response = await apiClient.searchMemories(query);
      setResults(response.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setResults([]);
    setError(null);
  };

  return {
    results,
    isSearching,
    error,
    search,
    clearSearch,
    hasResults: results.length > 0,
  };
}
