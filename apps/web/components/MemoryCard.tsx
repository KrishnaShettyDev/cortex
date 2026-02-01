import type { Memory, SearchResult } from '@/types/memory';

interface MemoryCardProps {
  memory: Memory | SearchResult;
  showScore?: boolean;
}

export function MemoryCard({ memory, showScore = false }: MemoryCardProps) {
  const score = 'score' in memory ? memory.score : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors">
      <p className="text-zinc-200 line-clamp-3">{memory.content}</p>

      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
        <span>{memory.source_type || 'note'}</span>
        <span>•</span>
        {showScore && score !== null ? (
          <span>Relevance: {Math.round(score * 100)}%</span>
        ) : (
          <span>{new Date(memory.created_at).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
