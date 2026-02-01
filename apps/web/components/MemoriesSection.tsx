import type { Memory, SearchResult } from '@/types/memory';
import { MemoryCard } from './MemoryCard';

interface MemoriesSectionProps {
  memories: Memory[];
  searchResults: SearchResult[];
  isLoading: boolean;
  onClearSearch: () => void;
  onAddMemory: () => void;
}

export function MemoriesSection({
  memories,
  searchResults,
  isLoading,
  onClearSearch,
  onAddMemory,
}: MemoriesSectionProps) {
  if (searchResults.length > 0) {
    return <SearchResults results={searchResults} onClear={onClearSearch} />;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (memories.length === 0) {
    return <EmptyState onAddMemory={onAddMemory} />;
  }

  return <MemoryGrid memories={memories} />;
}

function SearchResults({ results, onClear }: { results: SearchResult[]; onClear: () => void }) {
  return (
    <section className="pt-16 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-zinc-400">
          Search Results ({results.length})
        </h2>
        <button onClick={onClear} className="text-sm text-blue-500 hover:text-blue-400">
          Clear search
        </button>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {results.map((result) => (
          <MemoryCard key={result.id} memory={result} showScore />
        ))}
      </div>
    </section>
  );
}

function MemoryGrid({ memories }: { memories: Memory[] }) {
  return (
    <section className="pt-16 space-y-4">
      <h2 className="text-xl font-medium text-zinc-400">Your Memories</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {memories.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} />
        ))}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="text-center pt-32">
      <div className="animate-pulse text-zinc-400">Loading memories...</div>
    </div>
  );
}

function EmptyState({ onAddMemory }: { onAddMemory: () => void }) {
  return (
    <div className="text-center pt-32">
      <button onClick={onAddMemory} className="text-blue-500 hover:text-blue-400 underline">
        Add your first memory
      </button>
    </div>
  );
}
