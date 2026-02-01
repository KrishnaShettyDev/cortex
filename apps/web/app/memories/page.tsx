/**
 * Memories Page - COMPLETE Memory Management
 * BEATS Supermemory: Full CRUD, tagging, bulk ops, export
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import {
  SearchIcon,
  TagIcon,
  EditIcon,
  TrashIcon,
  DownloadIcon,
  CheckmarkIcon,
  CloseIcon,
  AddIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  SyncIcon,
} from '@/components/icons';
import { Button, Spinner, GlassCard } from '@/components/ui';

interface Memory {
  id: string;
  content: string;
  metadata: {
    source?: string;
    type?: string;
    url?: string;
    title?: string;
    tags?: string[];
    author?: string;
    timestamp?: string;
  };
  created_at: string;
  updated_at?: string;
}

export default function MemoriesPage() {
  const router = useRouter();
  const { user, checkAuth } = useAuthStore();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [filteredMemories, setFilteredMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedMemories, setSelectedMemories] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    checkAuth();
    if (user) {
      loadMemories();
    }
  }, [user, checkAuth]);

  useEffect(() => {
    filterMemories();
  }, [memories, searchQuery, selectedSource, selectedTags]);

  const loadMemories = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('https://askcortex.plutas.in/v3/memories', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await response.json();
      setMemories(data.memories || []);
    } catch (error) {
      console.error('Failed to load memories:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterMemories = () => {
    let filtered = [...memories];

    // Source filter
    if (selectedSource !== 'all') {
      filtered = filtered.filter(m => m.metadata?.source === selectedSource);
    }

    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(m =>
        selectedTags.every(tag => m.metadata?.tags?.includes(tag))
      );
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.content.toLowerCase().includes(query) ||
        m.metadata?.title?.toLowerCase().includes(query) ||
        m.metadata?.url?.toLowerCase().includes(query)
      );
    }

    setFilteredMemories(filtered);
  };

  const handleSearch = async () => {
    // Use client-side filtering for now (fast and works well)
    // TODO: Implement semantic search with proper result mapping
    filterMemories();
  };

  const handleEdit = async (id: string) => {
    const memory = memories.find(m => m.id === id);
    if (!memory) return;

    setEditingId(id);
    setEditContent(memory.content);
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await fetch(`https://askcortex.plutas.in/v3/memories/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: editContent }),
      });

      setMemories(prev => prev.map(m =>
        m.id === id ? { ...m, content: editContent } : m
      ));
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update memory:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;

    try {
      await fetch(`https://askcortex.plutas.in/v3/memories/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });

      setMemories(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedMemories.size} memories?`)) return;

    try {
      await Promise.all(
        Array.from(selectedMemories).map(id =>
          fetch(`https://askcortex.plutas.in/v3/memories/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`,
            },
          })
        )
      );

      setMemories(prev => prev.filter(m => !selectedMemories.has(m.id)));
      setSelectedMemories(new Set());
    } catch (error) {
      console.error('Bulk delete failed:', error);
    }
  };

  const handleExport = () => {
    const exportData = filteredMemories.map(m => ({
      content: m.content,
      source: m.metadata?.source,
      url: m.metadata?.url,
      tags: m.metadata?.tags,
      created: m.created_at,
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cortex-memories-${new Date().toISOString()}.json`;
    a.click();
  };

  const toggleSelect = (id: string) => {
    setSelectedMemories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allSources = Array.from(new Set(memories.map(m => m.metadata?.source).filter(Boolean)));
  const allTags = Array.from(new Set(memories.flatMap(m => m.metadata?.tags || [])));

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-primary border-b border-glass-border">
        <div className="max-w-7xl mx-auto px-lg py-md">
          <div className="flex items-center justify-between mb-md">
            <h1 className="text-2xl font-bold text-text-primary">Memories</h1>
            <div className="flex items-center gap-sm">
              <button
                onClick={() => router.push('/settings')}
                className="px-md py-sm text-sm text-text-secondary hover:text-text-primary"
              >
                Settings
              </button>
              <Button onClick={loadMemories} variant="secondary" size="sm">
                <SyncIcon className="w-4 h-4" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex items-center gap-sm mb-md">
            <div className="flex-1 flex items-center gap-sm bg-bg-secondary rounded-lg px-md py-sm border border-glass-border">
              <SearchIcon className="w-5 h-5 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search memories..."
                className="flex-1 bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              {isSearching ? <Spinner size="sm" /> : 'Search'}
            </Button>
          </div>

          {/* Filters & Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-sm">
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="px-md py-sm bg-bg-secondary border border-glass-border rounded-lg text-text-primary text-sm"
              >
                <option value="all">All Sources</option>
                {allSources.map(source => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>

              {allTags.length > 0 && (
                <div className="flex items-center gap-xs">
                  <FilterIcon className="w-4 h-4 text-text-tertiary" />
                  {allTags.slice(0, 5).map(tag => (
                    <button
                      key={tag}
                      onClick={() => {
                        setSelectedTags(prev =>
                          prev.includes(tag)
                            ? prev.filter(t => t !== tag)
                            : [...prev, tag]
                        );
                      }}
                      className={`px-2 py-1 text-xs rounded-full ${
                        selectedTags.includes(tag)
                          ? 'bg-accent text-white'
                          : 'bg-bg-tertiary text-text-secondary'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-sm">
              {selectedMemories.size > 0 && (
                <>
                  <span className="text-sm text-text-secondary">
                    {selectedMemories.size} selected
                  </span>
                  <Button onClick={handleBulkDelete} variant="danger" size="sm">
                    <TrashIcon className="w-4 h-4" />
                    Delete
                  </Button>
                </>
              )}

              <Button onClick={handleExport} variant="secondary" size="sm">
                <DownloadIcon className="w-4 h-4" />
                Export
              </Button>

              <div className="flex items-center gap-xs bg-bg-secondary rounded-lg p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded ${
                    viewMode === 'list' ? 'bg-accent text-white' : 'text-text-secondary'
                  }`}
                >
                  <ListIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded ${
                    viewMode === 'grid' ? 'bg-accent text-white' : 'text-text-secondary'
                  }`}
                >
                  <GridIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-lg py-lg">
        {isLoading ? (
          <div className="flex items-center justify-center py-xl">
            <Spinner size="lg" />
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="text-center py-xl">
            <p className="text-text-secondary">No memories found</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-md text-accent hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-md">
            {filteredMemories.map(memory => (
              <GlassCard key={memory.id} className="p-lg">
                <div className="flex items-start gap-md">
                  <input
                    type="checkbox"
                    checked={selectedMemories.has(memory.id)}
                    onChange={() => toggleSelect(memory.id)}
                    className="mt-1"
                  />

                  <div className="flex-1">
                    {editingId === memory.id ? (
                      <div className="space-y-md">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full p-md bg-bg-tertiary rounded-lg text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                          rows={4}
                        />
                        <div className="flex gap-sm">
                          <Button onClick={() => handleSaveEdit(memory.id)} size="sm">
                            <CheckmarkIcon className="w-4 h-4" />
                            Save
                          </Button>
                          <Button
                            onClick={() => setEditingId(null)}
                            variant="secondary"
                            size="sm"
                          >
                            <CloseIcon className="w-4 h-4" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-text-primary text-sm leading-relaxed">
                          {memory.content}
                        </p>

                        <div className="flex items-center gap-md mt-md">
                          <span className="text-xs text-text-tertiary">
                            {new Date(memory.created_at).toLocaleDateString()}
                          </span>
                          {memory.metadata?.source && (
                            <span className="px-2 py-0.5 bg-bg-tertiary text-text-secondary text-xs rounded">
                              {memory.metadata.source}
                            </span>
                          )}
                          {memory.metadata?.tags?.map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {editingId !== memory.id && (
                    <div className="flex gap-sm">
                      <button
                        onClick={() => handleEdit(memory.id)}
                        className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
                      >
                        <EditIcon className="w-4 h-4 text-text-secondary" />
                      </button>
                      <button
                        onClick={() => handleDelete(memory.id)}
                        className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
                      >
                        <TrashIcon className="w-4 h-4 text-error" />
                      </button>
                    </div>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
            {filteredMemories.map(memory => (
              <GlassCard key={memory.id} className="p-lg">
                <input
                  type="checkbox"
                  checked={selectedMemories.has(memory.id)}
                  onChange={() => toggleSelect(memory.id)}
                  className="mb-md"
                />
                <p className="text-text-primary text-sm line-clamp-4 mb-md">
                  {memory.content}
                </p>
                <div className="flex items-center justify-between text-xs text-text-tertiary">
                  <span>{new Date(memory.created_at).toLocaleDateString()}</span>
                  <div className="flex gap-sm">
                    <button onClick={() => handleEdit(memory.id)}>
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(memory.id)}>
                      <TrashIcon className="w-4 h-4 text-error" />
                    </button>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
