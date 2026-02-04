'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brain, Key, Activity, BookOpen, Code, Github } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { StatCard } from '@/components/StatCard';
import { CodeBlock } from '@/components/CodeBlock';

const quickStartCode = `import { CortexClient } from '@cortex/memory';

const cortex = new CortexClient({ apiKey: 'YOUR_API_KEY' });

// Add a memory
const memory = await cortex.memories.create({
  content: "User prefers dark mode",
  source: "manual"
});

// Search memories
const results = await cortex.memories.search({ query: "preferences" });`;

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    memories: { value: '—', loading: true },
    keys: { value: '—', loading: true },
    calls: { value: '—', loading: false }, // No endpoint for this
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const [memoriesRes, keysRes] = await Promise.all([
          api.memories.count().catch(() => null),
          api.keys.list().catch(() => null),
        ]);

        setStats({
          memories: {
            value: memoriesRes?.total?.toString() ?? memoriesRes?.memories?.length?.toString() ?? '0',
            loading: false,
          },
          keys: {
            value: keysRes?.api_keys?.length?.toString() ?? '0',
            loading: false,
          },
          calls: { value: '—', loading: false }, // TODO: Backend needs GET /v3/stats
        });
      } catch {
        setStats({
          memories: { value: '—', loading: false },
          keys: { value: '—', loading: false },
          calls: { value: '—', loading: false },
        });
      }
    }

    loadStats();
  }, []);

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">
          Welcome back, {firstName}
        </h1>
        <p className="text-zinc-400 mt-1">
          Here&apos;s an overview of your Cortex workspace
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Memories"
          value={stats.memories.value}
          icon={Brain}
          loading={stats.memories.loading}
        />
        <StatCard
          title="API Keys"
          value={stats.keys.value}
          icon={Key}
          loading={stats.keys.loading}
        />
        <StatCard
          title="API Calls Today"
          value={stats.calls.value}
          icon={Activity}
          loading={stats.calls.loading}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium text-zinc-100">Quick Start</h2>
        <CodeBlock code={quickStartCode} language="typescript" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="https://docs.askcortex.in"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800/50 transition-colors"
        >
          <BookOpen className="w-5 h-5 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-zinc-200">Documentation</p>
            <p className="text-xs text-zinc-500">Learn the API</p>
          </div>
        </Link>
        <Link
          href="/quickstart"
          className="flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800/50 transition-colors"
        >
          <Code className="w-5 h-5 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-zinc-200">Quickstart</p>
            <p className="text-xs text-zinc-500">Code examples</p>
          </div>
        </Link>
        <Link
          href="https://github.com/plutaslab/cortex"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800/50 transition-colors"
        >
          <Github className="w-5 h-5 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-zinc-200">GitHub</p>
            <p className="text-xs text-zinc-500">View source</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
