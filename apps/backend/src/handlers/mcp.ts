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
import { verifyApiKey } from '../lib/api-keys';
import {
  registerMCPIntegration,
  getUserMCPIntegrations,
  getMCPIntegration,
  updateMCPIntegration,
  deleteMCPIntegration,
  discoverCapabilities,
  executeTool,
  readResource,
  type MCPIntegration,
} from '../lib/mcp/integrations';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Authenticate MCP requests via API key
 * SECURITY: Uses SHA-256 hashing for key verification
 */
async function authenticateMCPRequest(
  c: any
): Promise<{ userId: string } | null> {
  // Check for API key in header
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return null;
  }

  // Verify API key (hashes input and compares against stored hash)
  const result = await verifyApiKey(c.env.DB, apiKey);

  if (!result.valid || !result.userId) {
    return null;
  }

  return { userId: result.userId };
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

// =============================================================================
// USER-DEFINED MCP INTEGRATIONS
// These routes allow users to connect their own MCP servers
// =============================================================================

/**
 * GET /mcp/integrations - List user's custom MCP integrations
 */
app.get('/integrations', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;

  try {
    const integrations = await getUserMCPIntegrations(c.env.DB, userId);
    return c.json({
      success: true,
      integrations: integrations.map(formatIntegrationResponse),
    });
  } catch (error) {
    console.error('[MCP API] List error:', error);
    return c.json({ success: false, error: 'Failed to list integrations' }, 500);
  }
});

/**
 * POST /mcp/integrations - Register a new MCP server
 */
app.post('/integrations', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;

  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      serverUrl: string;
      authType: 'none' | 'api_key' | 'oauth2' | 'bearer';
      authConfig?: Record<string, any>;
    }>();

    if (!body.name || !body.serverUrl) {
      return c.json({ success: false, error: 'Name and server URL are required' }, 400);
    }

    const integration = await registerMCPIntegration(c.env.DB, userId, {
      name: body.name,
      description: body.description,
      serverUrl: body.serverUrl,
      authType: body.authType || 'none',
      authConfig: body.authConfig,
    });

    return c.json({
      success: true,
      integration: formatIntegrationResponse(integration),
    });
  } catch (error) {
    console.error('[MCP API] Register error:', error);
    const message = error instanceof Error ? error.message : 'Failed to register integration';
    return c.json({ success: false, error: message }, 400);
  }
});

/**
 * GET /mcp/integrations/:id - Get a specific integration
 */
app.get('/integrations/:id', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;
  const integrationId = c.req.param('id');

  try {
    const integration = await getMCPIntegration(c.env.DB, userId, integrationId);
    if (!integration) {
      return c.json({ success: false, error: 'Integration not found' }, 404);
    }

    return c.json({
      success: true,
      integration: formatIntegrationResponse(integration),
    });
  } catch (error) {
    console.error('[MCP API] Get error:', error);
    return c.json({ success: false, error: 'Failed to get integration' }, 500);
  }
});

/**
 * PATCH /mcp/integrations/:id - Update an integration
 */
app.patch('/integrations/:id', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;
  const integrationId = c.req.param('id');

  try {
    const body = await c.req.json<{
      name?: string;
      description?: string;
      serverUrl?: string;
      authConfig?: Record<string, any>;
      isActive?: boolean;
    }>();

    const success = await updateMCPIntegration(c.env.DB, userId, integrationId, body);
    if (!success) {
      return c.json({ success: false, error: 'Integration not found' }, 404);
    }

    const integration = await getMCPIntegration(c.env.DB, userId, integrationId);
    return c.json({
      success: true,
      integration: integration ? formatIntegrationResponse(integration) : null,
    });
  } catch (error) {
    console.error('[MCP API] Update error:', error);
    return c.json({ success: false, error: 'Failed to update integration' }, 400);
  }
});

/**
 * DELETE /mcp/integrations/:id - Delete an integration
 */
app.delete('/integrations/:id', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;
  const integrationId = c.req.param('id');

  try {
    const success = await deleteMCPIntegration(c.env.DB, userId, integrationId);
    if (!success) {
      return c.json({ success: false, error: 'Integration not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('[MCP API] Delete error:', error);
    return c.json({ success: false, error: 'Failed to delete integration' }, 500);
  }
});

/**
 * POST /mcp/integrations/:id/discover - Discover server capabilities
 */
app.post('/integrations/:id/discover', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;
  const integrationId = c.req.param('id');

  try {
    const capabilities = await discoverCapabilities(c.env.DB, userId, integrationId);
    return c.json({ success: true, capabilities });
  } catch (error) {
    console.error('[MCP API] Discover error:', error);
    const message = error instanceof Error ? error.message : 'Failed to discover capabilities';
    return c.json({ success: false, error: message }, 500);
  }
});

/**
 * POST /mcp/integrations/:id/execute - Execute a tool
 */
app.post('/integrations/:id/execute', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;

  const integrationId = c.req.param('id');

  try {
    const body = await c.req.json<{
      toolName: string;
      arguments?: Record<string, any>;
    }>();

    if (!body.toolName) {
      return c.json({ success: false, error: 'Tool name is required' }, 400);
    }

    const result = await executeTool(
      c.env.DB,
      userId,
      integrationId,
      body.toolName,
      body.arguments || {}
    );

    return c.json({
      success: result.success,
      result: result.result,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    });
  } catch (error) {
    console.error('[MCP API] Execute error:', error);
    return c.json({ success: false, error: 'Failed to execute tool' }, 500);
  }
});

/**
 * POST /mcp/integrations/:id/resources/read - Read a resource
 */
app.post('/integrations/:id/resources/read', async (c) => {
  const jwtPayload = c.get('jwtPayload');
  if (!jwtPayload?.sub) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const userId = jwtPayload.sub;
  const integrationId = c.req.param('id');

  try {
    const body = await c.req.json<{ uri: string }>();
    if (!body.uri) {
      return c.json({ success: false, error: 'URI is required' }, 400);
    }

    const result = await readResource(c.env.DB, userId, integrationId, body.uri);
    return c.json({
      success: result.success,
      result: result.result,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    });
  } catch (error) {
    console.error('[MCP API] Read resource error:', error);
    return c.json({ success: false, error: 'Failed to read resource' }, 500);
  }
});

// Helper function for formatting integration responses
function formatIntegrationResponse(integration: MCPIntegration) {
  return {
    id: integration.id,
    name: integration.name,
    description: integration.description,
    serverUrl: integration.serverUrl,
    authType: integration.authType,
    capabilities: {
      toolCount: integration.capabilities.tools?.length || 0,
      resourceCount: integration.capabilities.resources?.length || 0,
      promptCount: integration.capabilities.prompts?.length || 0,
      tools: (integration.capabilities.tools || []).map(t => ({
        name: t.name,
        description: t.description,
      })),
    },
    isActive: integration.isActive,
    lastHealthCheck: integration.lastHealthCheck,
    healthStatus: integration.healthStatus,
    errorCount: integration.errorCount,
    lastError: integration.lastError,
    createdAt: integration.createdAt,
  };
}

export default app;
