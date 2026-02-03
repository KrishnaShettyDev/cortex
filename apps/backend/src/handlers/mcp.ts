/**
 * MCP API Handler
 *
 * HTTP endpoint for the Model Context Protocol server.
 * Allows external AI clients to connect to Cortex.
 *
 * Authentication: API key in header
 * Protocol: JSON-RPC 2.0 over HTTP POST
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { createMCPServer, type JsonRpcRequest } from '../lib/mcp';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Authenticate MCP requests via API key
 */
async function authenticateMCPRequest(
  c: any
): Promise<{ userId: string } | null> {
  // Check for API key in header
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return null;
  }

  // Look up API key
  const keyRecord = await c.env.DB.prepare(
    'SELECT user_id, expires_at FROM api_keys WHERE key_hash = ? AND is_active = 1'
  ).bind(apiKey).first() as { user_id: string; expires_at: string | null } | null;

  if (!keyRecord) {
    return null;
  }

  // Check expiration
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return null;
  }

  return { userId: keyRecord.user_id };
}

/**
 * GET /mcp
 * MCP server info and capabilities
 */
app.get('/', async (c) => {
  return c.json({
    name: 'Cortex MCP Server',
    version: '1.0.0',
    protocol: 'Model Context Protocol',
    protocolVersion: '2024-11-05',
    description: 'Access your personal knowledge base and execute actions through AI clients',
    authentication: 'API key required (x-api-key header)',
    endpoints: {
      rpc: 'POST /mcp/rpc',
      sse: 'GET /mcp/sse (Server-Sent Events)',
    },
    tools: [
      'recall_memories - Search personal knowledge base',
      'add_memory - Store new information',
      'get_briefing - Daily briefing',
      'get_commitments - Pending tasks',
      'get_entities - Knowledge graph',
      'send_email - Send email (Gmail)',
      'create_calendar_event - Create event (Google Calendar)',
      'search_emails - Search emails',
    ],
    resources: [
      'cortex://profile - User profile',
      'cortex://learnings - AI learnings',
      'cortex://beliefs - User beliefs',
      'cortex://entities - Entity graph',
    ],
    prompts: [
      'briefing - Daily briefing prompt',
      'meeting_prep - Meeting preparation',
      'relationship_summary - Relationship context',
    ],
  });
});

/**
 * POST /mcp/rpc
 * JSON-RPC 2.0 endpoint for MCP protocol
 */
app.post('/rpc', async (c) => {
  // Authenticate
  const auth = await authenticateMCPRequest(c);
  if (!auth) {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'Unauthorized: Invalid or missing API key',
        },
      },
      401
    );
  }

  try {
    const request: JsonRpcRequest = await c.req.json();

    // Validate JSON-RPC format
    if (request.jsonrpc !== '2.0' || !request.method) {
      return c.json({
        jsonrpc: '2.0',
        id: request.id || null,
        error: {
          code: -32600,
          message: 'Invalid Request: Missing jsonrpc or method',
        },
      });
    }

    // Create MCP server for this user
    const server = createMCPServer({
      db: c.env.DB,
      composioApiKey: c.env.COMPOSIO_API_KEY,
      userId: auth.userId,
      vectorize: c.env.VECTORIZE,
      ai: c.env.AI,
    });

    // Handle request
    const response = await server.handleRequest(request);

    return c.json(response);
  } catch (error: any) {
    console.error('[MCP] RPC error:', error);
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`,
      },
    });
  }
});

/**
 * GET /mcp/sse
 * Server-Sent Events endpoint for real-time MCP
 */
app.get('/sse', async (c) => {
  // Authenticate
  const auth = await authenticateMCPRequest(c);
  if (!auth) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  // Create MCP server
  const server = createMCPServer({
    db: c.env.DB,
    composioApiKey: c.env.COMPOSIO_API_KEY,
    userId: auth.userId,
    vectorize: c.env.VECTORIZE,
    ai: c.env.AI,
  });

  // Send initial connection event
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send server info
      const initMessage = JSON.stringify({
        type: 'connection',
        server: {
          name: 'cortex-memory',
          version: '1.0.0',
          protocolVersion: '2024-11-05',
        },
      });
      controller.enqueue(encoder.encode(`data: ${initMessage}\n\n`));

      // Keep connection alive
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 30000);

      // Note: In a real implementation, we'd listen for incoming messages
      // and route them through the MCP server. For now, this just maintains
      // the connection for real-time notifications.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

/**
 * POST /mcp/batch
 * Batch multiple MCP requests
 */
app.post('/batch', async (c) => {
  // Authenticate
  const auth = await authenticateMCPRequest(c);
  if (!auth) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const requests: JsonRpcRequest[] = await c.req.json();

    if (!Array.isArray(requests)) {
      return c.json({
        error: 'Invalid batch request: expected array',
      }, 400);
    }

    // Create MCP server
    const server = createMCPServer({
      db: c.env.DB,
      composioApiKey: c.env.COMPOSIO_API_KEY,
      userId: auth.userId,
      vectorize: c.env.VECTORIZE,
      ai: c.env.AI,
    });

    // Process all requests
    const responses = await Promise.all(
      requests.map((request) => server.handleRequest(request))
    );

    return c.json(responses);
  } catch (error: any) {
    console.error('[MCP] Batch error:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
