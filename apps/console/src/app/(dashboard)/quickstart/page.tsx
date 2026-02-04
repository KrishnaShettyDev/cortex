'use client';

import { useState } from 'react';
import { CodeBlock } from '@/components/CodeBlock';

// Code snippets based on actual SDK implementations:
// - packages/core/src/client.ts (CortexClient class)
// - packages/python/cortex_memory/client.py (CortexClient, MemoriesClient, CognitiveClient)

const tabs = ['TypeScript', 'Python', 'MCP', 'cURL'] as const;
type Tab = (typeof tabs)[number];

const codeSnippets: Record<Tab, { code: string; language: string }> = {
  TypeScript: {
    language: 'typescript',
    code: `npm install @cortex/memory

import { CortexClient } from '@cortex/memory';

const cortex = new CortexClient({ apiKey: 'YOUR_API_KEY' });

// Add a memory
const memory = await cortex.memories.create({
  content: "User prefers dark mode for all editors",
  source: "manual"
});

// Search memories
const results = await cortex.memories.search({
  query: "editor preferences"
});

// Recall context with profile
const context = await cortex.recall({
  query: "What are my preferences?",
  include_profile: true
});

// Get cognitive insights
const beliefs = await cortex.beliefs.list();
const learnings = await cortex.learnings.list();
const commitments = await cortex.commitments.list({ status: "pending" });`,
  },
  Python: {
    language: 'python',
    code: `pip install cortex-memory

from cortex_memory import CortexClient

cortex = CortexClient(api_key="YOUR_API_KEY")

# Add a memory
memory = cortex.memories.add(
    "User prefers dark mode for all editors",
    source="manual"
)

# Search memories
results = cortex.memories.search("editor preferences")

# Recall context with profile
context = cortex.recall(
    query="What are my preferences?",
    include_profile=True
)

# Get cognitive insights
beliefs = cortex.cognitive.beliefs()
learnings = cortex.cognitive.learnings()
commitments = cortex.cognitive.commitments(status="pending")`,
  },
  MCP: {
    language: 'json',
    code: `{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["-y", "@cortex/mcp"],
      "env": {
        "CORTEX_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}

// Save to:
// - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
// - Cursor: ~/.cursor/mcp.json

// Available tools:
// - cortex_search: Search memories
// - cortex_add_memory: Save new information
// - cortex_get_profile: Get user profile
// - cortex_recall: Recall with context
// - cortex_get_entities: Knowledge graph
// - cortex_get_commitments: Pending tasks
// - cortex_get_nudges: Relationship nudges
// - cortex_get_learnings: Auto-extracted learnings`,
  },
  cURL: {
    language: 'bash',
    code: `# Add a memory
curl -X POST https://askcortex.plutas.in/v3/memories \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "User prefers dark mode", "source": "api"}'

# Search memories
curl -X POST https://askcortex.plutas.in/v3/search \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "editor preferences", "limit": 10}'

# Recall with context
curl -X POST https://askcortex.plutas.in/v3/recall \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "What are my preferences?", "include_profile": true}'

# Get user profile
curl https://askcortex.plutas.in/v3/profile \\
  -H "Authorization: Bearer YOUR_API_KEY"

# List beliefs
curl https://askcortex.plutas.in/v3/beliefs \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
};

export default function QuickstartPage() {
  const [activeTab, setActiveTab] = useState<Tab>('TypeScript');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Quickstart</h1>
        <p className="text-zinc-400 mt-1">
          Get started with the Cortex API in minutes
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Code Block */}
      <CodeBlock
        code={codeSnippets[activeTab].code}
        language={codeSnippets[activeTab].language}
      />

      {/* Additional Resources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-zinc-100 mb-2">TypeScript SDK</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Full-featured SDK with TypeScript support, automatic retries, and comprehensive types.
          </p>
          <code className="text-sm text-indigo-400 font-mono">npm install @cortex/memory</code>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-zinc-100 mb-2">Python SDK</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Pythonic interface with dataclasses, context managers, and async support.
          </p>
          <code className="text-sm text-indigo-400 font-mono">pip install cortex-memory</code>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-zinc-100 mb-2">MCP Server</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Use Cortex with Claude Desktop, Cursor, and other MCP-compatible AI clients.
          </p>
          <code className="text-sm text-indigo-400 font-mono">npx @cortex/mcp</code>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-lg font-medium text-zinc-100 mb-2">REST API</h3>
          <p className="text-sm text-zinc-400 mb-4">
            Direct HTTP access for any language or platform. Bearer token authentication.
          </p>
          <code className="text-sm text-indigo-400 font-mono">https://askcortex.plutas.in/v3</code>
        </div>
      </div>
    </div>
  );
}
