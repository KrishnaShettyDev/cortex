/**
 * MCP Client - JSON-RPC 2.0 Implementation
 *
 * Implements the Model Context Protocol using proper JSON-RPC 2.0.
 * Supports both Streamable HTTP and SSE transports.
 *
 * MCP Spec: https://modelcontextprotocol.io/specification
 */

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPCapabilities {
  tools: MCPTool[];
  resources: MCPResource[];
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, any>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const MCP_TIMEOUT_MS = 30_000;
const CLIENT_INFO = {
  name: 'Cortex',
  version: '1.0.0',
};
const PROTOCOL_VERSION = '2024-11-05';

/**
 * Send a JSON-RPC request to an MCP server
 * Handles both Streamable HTTP and SSE response formats
 */
async function mcpRequest(
  serverUrl: string,
  method: string,
  params?: Record<string, any>,
  authHeaders?: Record<string, string>
): Promise<any> {
  const requestId = Date.now();

  const body: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params: params || {},
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...authHeaders,
  };

  console.log(`[MCP Client] ${method} -> ${serverUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

  try {
    const response = await fetch(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE response - parse the stream for JSON-RPC response
      return await parseSSEResponse(response, requestId);
    } else {
      // Regular JSON response
      const data = await response.json() as JSONRPCResponse;

      if (data.error) {
        throw new Error(`JSON-RPC Error ${data.error.code}: ${data.error.message}`);
      }

      return data.result;
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('MCP request timed out');
    }
    throw error;
  }
}

/**
 * Parse SSE response stream for JSON-RPC result
 */
async function parseSSEResponse(response: Response, expectedId: number | string): Promise<any> {
  const text = await response.text();
  const lines = text.split('\n');

  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      currentData = line.slice(5).trim();

      // Try to parse as JSON-RPC response
      if (currentData) {
        try {
          const data = JSON.parse(currentData) as JSONRPCResponse;

          // Check if this is our response
          if (data.jsonrpc === '2.0' && (data.id === expectedId || data.result !== undefined)) {
            if (data.error) {
              throw new Error(`JSON-RPC Error ${data.error.code}: ${data.error.message}`);
            }
            return data.result;
          }
        } catch (e) {
          // Not valid JSON or not our response, continue
          if (e instanceof Error && e.message.includes('JSON-RPC Error')) {
            throw e;
          }
        }
      }
    } else if (line === '') {
      // Empty line = end of event, reset
      currentEvent = '';
      currentData = '';
    }
  }

  throw new Error('No valid JSON-RPC response found in SSE stream');
}

/**
 * Try to get SSE endpoint from server (for servers that require SSE handshake first)
 */
async function getSSEEndpoint(
  serverUrl: string,
  authHeaders?: Record<string, string>
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(serverUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        ...authHeaders,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const text = await response.text();

    // Look for endpoint event in SSE format
    const match = text.match(/event:\s*endpoint\s*\ndata:\s*(.+)/);
    if (match) {
      const endpoint = match[1].trim();
      // If relative URL, resolve against server URL
      if (endpoint.startsWith('/')) {
        const url = new URL(serverUrl);
        return `${url.origin}${endpoint}`;
      }
      return endpoint;
    }

    return null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Initialize connection with MCP server
 */
async function initializeConnection(
  serverUrl: string,
  authHeaders?: Record<string, string>
): Promise<void> {
  // Send initialize request
  const initResult = await mcpRequest(serverUrl, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    clientInfo: CLIENT_INFO,
  }, authHeaders);

  console.log('[MCP Client] Initialized:', initResult);

  // Send initialized notification (some servers require this)
  try {
    await mcpRequest(serverUrl, 'notifications/initialized', {}, authHeaders);
  } catch {
    // Not all servers require this notification
  }
}

/**
 * Discover tools from an MCP server
 * Returns list of available tools
 */
export async function discoverMCPTools(
  serverUrl: string,
  authHeaders?: Record<string, string>
): Promise<MCPCapabilities> {
  // Determine transport - try Streamable HTTP first
  let endpoint = serverUrl;

  // Check if server uses SSE handshake
  const sseEndpoint = await getSSEEndpoint(serverUrl, authHeaders);
  if (sseEndpoint) {
    console.log(`[MCP Client] Using SSE endpoint: ${sseEndpoint}`);
    endpoint = sseEndpoint;
  }

  // Initialize the connection
  await initializeConnection(endpoint, authHeaders);

  // List tools
  const toolsResult = await mcpRequest(endpoint, 'tools/list', {}, authHeaders);
  const tools: MCPTool[] = toolsResult?.tools || [];

  // List resources (optional, some servers don't have resources)
  let resources: MCPResource[] = [];
  try {
    const resourcesResult = await mcpRequest(endpoint, 'resources/list', {}, authHeaders);
    resources = resourcesResult?.resources || [];
  } catch {
    // Resources not supported or empty
  }

  console.log(`[MCP Client] Discovered ${tools.length} tools, ${resources.length} resources`);

  return { tools, resources };
}

/**
 * Call a tool on an MCP server
 */
export async function callMCPTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>,
  authHeaders?: Record<string, string>
): Promise<any> {
  // Determine transport
  let endpoint = serverUrl;
  const sseEndpoint = await getSSEEndpoint(serverUrl, authHeaders);
  if (sseEndpoint) {
    endpoint = sseEndpoint;
  }

  // Initialize first (stateless per request on Workers)
  await initializeConnection(endpoint, authHeaders);

  // Call the tool
  const result = await mcpRequest(endpoint, 'tools/call', {
    name: toolName,
    arguments: args,
  }, authHeaders);

  console.log(`[MCP Client] Tool ${toolName} result:`, result);

  return result;
}

/**
 * Read a resource from an MCP server
 */
export async function readMCPResource(
  serverUrl: string,
  uri: string,
  authHeaders?: Record<string, string>
): Promise<any> {
  // Determine transport
  let endpoint = serverUrl;
  const sseEndpoint = await getSSEEndpoint(serverUrl, authHeaders);
  if (sseEndpoint) {
    endpoint = sseEndpoint;
  }

  // Initialize
  await initializeConnection(endpoint, authHeaders);

  // Read resource
  const result = await mcpRequest(endpoint, 'resources/read', {
    uri,
  }, authHeaders);

  return result;
}

/**
 * Check if an MCP server is healthy
 */
export async function checkMCPHealth(
  serverUrl: string,
  authHeaders?: Record<string, string>
): Promise<boolean> {
  try {
    // Try to initialize - this validates the server is responding
    let endpoint = serverUrl;
    const sseEndpoint = await getSSEEndpoint(serverUrl, authHeaders);
    if (sseEndpoint) {
      endpoint = sseEndpoint;
    }

    await initializeConnection(endpoint, authHeaders);
    return true;
  } catch (error) {
    console.error('[MCP Client] Health check failed:', error);
    return false;
  }
}
