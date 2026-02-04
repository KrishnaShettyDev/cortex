'use client';

import { useEffect, useState } from 'react';
import { Key, Plus, Copy, Check, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create key state
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadKeys = async () => {
    try {
      setLoading(true);
      const result = await api.keys.list();
      setKeys(result.api_keys || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const result = await api.keys.create(keyName.trim());
      setNewKey(result.key);
      setKeyName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismissNewKey = () => {
    setNewKey(null);
    setShowCreate(false);
    loadKeys();
  };

  const handleDelete = async (keyId: string) => {
    setDeleting(true);
    setError(null);
    try {
      await api.keys.delete(keyId);
      setKeys(keys.filter((k) => k.id !== keyId));
      setDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">API Keys</h1>
          <p className="text-zinc-400 mt-1">
            Manage your API keys for accessing the Cortex API
          </p>
        </div>
        {!showCreate && !newKey && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Key
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Create Key Form */}
      {showCreate && !newKey && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-medium text-zinc-100 mb-4">Create New API Key</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="keyName" className="block text-sm text-zinc-400 mb-2">
                Key Name
              </label>
              <input
                id="keyName"
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g., Production, Development"
                className="w-full bg-zinc-800 border border-zinc-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                disabled={creating}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating || !keyName.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md px-4 py-2 text-sm font-medium transition-colors"
              >
                {creating ? 'Creating...' : 'Create Key'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md px-4 py-2 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Key Display */}
      {newKey && (
        <div className="bg-zinc-900 border border-emerald-500/30 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Key className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-zinc-100">API Key Created</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Copy this key now. You won&apos;t be able to see it again.
              </p>
            </div>
          </div>

          <div className="relative">
            <div className="bg-zinc-800 border border-zinc-700 rounded-md p-4 font-mono text-sm text-emerald-400 break-all">
              {newKey}
            </div>
            <button
              onClick={handleCopy}
              className="absolute top-3 right-3 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded-md transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">Save this key securely. It won&apos;t be shown again.</span>
          </div>

          <button
            onClick={handleDismissNewKey}
            className="mt-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      )}

      {/* Keys Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <p className="text-zinc-500 text-sm">Loading keys...</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400">No API keys yet</p>
            <p className="text-zinc-500 text-sm mt-1">
              Create one to start using the Cortex API
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-zinc-800/50">
              <tr>
                <th className="text-left text-xs font-medium text-zinc-400 px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-zinc-400 px-4 py-3">Key</th>
                <th className="text-left text-xs font-medium text-zinc-400 px-4 py-3">Created</th>
                <th className="text-left text-xs font-medium text-zinc-400 px-4 py-3">Last Used</th>
                <th className="text-right text-xs font-medium text-zinc-400 px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-200">{key.name}</span>
                      {!key.is_active && (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                          Revoked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-sm text-zinc-400 font-mono">{key.prefix}...</code>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-zinc-400">{formatDate(key.created_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-zinc-500">{formatDate(key.last_used_at)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {deleteId === key.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm text-zinc-400">Delete?</span>
                        <button
                          onClick={() => handleDelete(key.id)}
                          disabled={deleting}
                          className="text-red-400 hover:text-red-300 text-sm font-medium"
                        >
                          {deleting ? 'Deleting...' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          className="text-zinc-400 hover:text-zinc-300 text-sm"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteId(key.id)}
                        className="text-zinc-500 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
                        title="Delete key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
