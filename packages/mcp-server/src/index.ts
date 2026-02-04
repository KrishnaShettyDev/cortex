#!/usr/bin/env node

/**
 * Cortex MCP Server
 *
 * Model Context Protocol server for Claude Desktop integration.
 * Exposes Cortex memory as tools that Claude can use.
 *
 * BEATS Supermemory:
 * - Encrypted API keys (they use random URLs)
 * - Better error handling
 * - Richer tool set (search + add + profile)
 * - Faster responses (edge caching)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

// Environment variables
const CORTEX_API_URL = process.env.CORTEX_API_URL || 'https://askcortex.plutas.in';
const CORTEX_API_KEY = process.env.CORTEX_API_KEY;

if (!CORTEX_API_KEY) {
  console.error('Error: CORTEX_API_KEY environment variable is required');
  process.exit(1);
}

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'cortex_search',
    description: 'Search through user memories and context. Use this to recall information the user has previously saved.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in the user\'s memories',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_add_memory',
    description: 'Save information to the user\'s memory. Use this to remember important facts, preferences, or context.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to remember',
        },
        source: {
          type: 'string',
          description: 'Source of this memory (e.g., "claude_desktop", "conversation")',
          default: 'claude_desktop',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'cortex_get_profile',
    description: 'Get the user\'s profile including static facts (name, preferences) and dynamic context.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cortex_recall',
    description: 'Recall memories and format them for injection into the conversation context. Returns markdown-formatted context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What context to recall',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to include',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_get_entities',
    description: 'Get key people, places, and organizations from user memories. Use this to understand who and what matters to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by entity type (person, organization, place, concept)',
          enum: ['person', 'organization', 'place', 'concept'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entities to return (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'cortex_get_commitments',
    description: 'Get user commitments, promises, and tasks extracted from memories. Useful for understanding what the user needs to do.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status (pending, overdue, completed)',
          enum: ['pending', 'overdue', 'completed'],
          default: 'pending',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of commitments to return',
          default: 10,
        },
      },
    },
  },
  {
    name: 'cortex_get_nudges',
    description: 'Get proactive relationship nudges - reminders to follow up with people, at-risk relationships, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of nudges to return',
          default: 5,
        },
      },
    },
  },
  {
    name: 'cortex_get_learnings',
    description: 'Get auto-extracted learnings about the user - their preferences, habits, and patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (preferences, habits, skills, etc.)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of learnings to return',
          default: 10,
        },
      },
    },
  },
];

// API helper
async function cortexAPI<T = any>(endpoint: string, options: any = {}): Promise<T> {
  const url = `${CORTEX_API_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${CORTEX_API_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cortex API error (${response.status}): ${error}`);
  }

  return response.json() as Promise<T>;
}

// Tool handlers
async function handleSearchMemories(args: { query: string; limit?: number }) {
  const result = await cortexAPI<{ memories?: any[] }>('/v3/search', {
    method: 'POST',
    body: JSON.stringify({
      q: args.query,
      limit: args.limit || 5,
      includeProfile: false,
    }),
  });

  // Format results for Claude
  const memories = result.memories || [];
  if (memories.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No memories found for "${args.query}"`,
        },
      ],
    };
  }

  const formatted = memories
    .map((m: any, i: number) => `${i + 1}. ${m.content} (source: ${m.source}, score: ${m.score?.toFixed(2) || 'N/A'})`)
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text: `Found ${memories.length} memories:\n\n${formatted}`,
      },
    ],
  };
}

async function handleAddMemory(args: { content: string; source?: string }) {
  const result = await cortexAPI<{ id: string }>('/v3/memories', {
    method: 'POST',
    body: JSON.stringify({
      content: args.content,
      source: args.source || 'claude_desktop',
    }),
  });

  return {
    content: [
      {
        type: 'text',
        text: `✓ Memory saved (ID: ${result.id})`,
      },
    ],
  };
}

async function handleGetProfile() {
  const result = await cortexAPI<{ static?: string[]; dynamic?: string[] }>('/v3/profile');

  const staticFacts = result.static || [];
  const dynamicFacts = result.dynamic || [];

  let text = '# User Profile\n\n';

  if (staticFacts.length > 0) {
    text += '## Static Facts\n';
    text += staticFacts.map((f: string) => `- ${f}`).join('\n');
    text += '\n\n';
  }

  if (dynamicFacts.length > 0) {
    text += '## Dynamic Context\n';
    text += dynamicFacts.map((f: string) => `- ${f}`).join('\n');
  }

  if (staticFacts.length === 0 && dynamicFacts.length === 0) {
    text = 'No profile information available yet.';
  }

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

async function handleRecall(args: { query: string; limit?: number }) {
  const result = await cortexAPI<{ context?: string }>('/v3/recall', {
    method: 'POST',
    body: JSON.stringify({
      q: args.query,
      limit: args.limit || 10,
      format: 'markdown',
    }),
  });

  return {
    content: [
      {
        type: 'text',
        text: result.context || 'No relevant context found.',
      },
    ],
  };
}

async function handleGetEntities(args: { type?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (args.type) params.set('type', args.type);
  params.set('limit', String(args.limit || 10));

  const result = await cortexAPI<{ entities?: any[] }>(`/v3/entities?${params.toString()}`);
  const entities = result.entities || [];

  if (entities.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No entities found.',
        },
      ],
    };
  }

  let text = `# Key ${args.type ? args.type + 's' : 'Entities'}\n\n`;
  text += entities
    .map((e: any) => {
      const importance = e.importance_score ? ` (importance: ${(e.importance_score * 100).toFixed(0)}%)` : '';
      return `- **${e.name}** (${e.entity_type})${importance}`;
    })
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

async function handleGetCommitments(args: { status?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  params.set('limit', String(args.limit || 10));

  const result = await cortexAPI<{ commitments?: any[] }>(`/v3/commitments?${params.toString()}`);
  const commitments = result.commitments || [];

  if (commitments.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No ${args.status || ''} commitments found.`,
        },
      ],
    };
  }

  let text = `# ${(args.status || 'All').charAt(0).toUpperCase() + (args.status || 'all').slice(1)} Commitments\n\n`;
  text += commitments
    .map((c: any) => {
      const due = c.due_date ? ` (due: ${c.due_date})` : '';
      const status = c.status !== 'pending' ? ` [${c.status}]` : '';
      return `- ${c.title}${due}${status}`;
    })
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

async function handleGetNudges(args: { limit?: number }) {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 5));

  const result = await cortexAPI<{ nudges?: any[] }>(`/v3/relationships/nudges?${params.toString()}`);
  const nudges = result.nudges || [];

  if (nudges.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No relationship nudges at this time. All relationships are healthy!',
        },
      ],
    };
  }

  let text = '# Relationship Nudges\n\n';
  text += nudges
    .map((n: any) => {
      const priority = n.priority === 'high' ? '🔴' : n.priority === 'medium' ? '🟡' : '🟢';
      return `${priority} **${n.title}**\n   ${n.message}\n   → ${n.suggested_action}`;
    })
    .join('\n\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

async function handleGetLearnings(args: { category?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (args.category) params.set('category', args.category);
  params.set('limit', String(args.limit || 10));

  const result = await cortexAPI<{ learnings?: any[] }>(`/v3/learnings?${params.toString()}`);
  const learnings = result.learnings || [];

  if (learnings.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No learnings extracted yet. As you add more memories, patterns will be discovered.',
        },
      ],
    };
  }

  let text = '# User Learnings\n\n';
  text += learnings
    .map((l: any) => {
      const confidence = l.confidence ? ` (${(l.confidence * 100).toFixed(0)}% confidence)` : '';
      return `- [${l.category}] ${l.statement}${confidence}`;
    })
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

// Server setup
const server = new Server(
  {
    name: 'cortex',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cortex_search':
        return await handleSearchMemories(args as any);

      case 'cortex_add_memory':
        return await handleAddMemory(args as any);

      case 'cortex_get_profile':
        return await handleGetProfile();

      case 'cortex_recall':
        return await handleRecall(args as any);

      case 'cortex_get_entities':
        return await handleGetEntities(args as any);

      case 'cortex_get_commitments':
        return await handleGetCommitments(args as any);

      case 'cortex_get_nudges':
        return await handleGetNudges(args as any);

      case 'cortex_get_learnings':
        return await handleGetLearnings(args as any);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Cortex MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
