/**
 * MCP (Model Context Protocol) Types
 *
 * Types for the MCP server that exposes Cortex capabilities
 * to external AI clients like Claude Desktop.
 */

// MCP Protocol Version
export const MCP_VERSION = '2024-11-05';

// JSON-RPC types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

// MCP Server Info
export interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}

// MCP Capabilities
export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

// MCP Tool Definition
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: any;
}

// MCP Resource Definition
export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

// MCP Prompt Definition
export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: TextContent | ImageContent | EmbeddedResource;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64
  mimeType: string;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: ResourceContents;
}

// MCP Request/Response types
export interface InitializeRequest {
  protocolVersion: string;
  capabilities: Record<string, any>;
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface InitializeResponse {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ServerInfo;
}

export interface ListToolsResponse {
  tools: Tool[];
}

export interface CallToolRequest {
  name: string;
  arguments?: Record<string, any>;
}

export interface CallToolResponse {
  content: (TextContent | ImageContent | EmbeddedResource)[];
  isError?: boolean;
}

export interface ListResourcesResponse {
  resources: Resource[];
}

export interface ReadResourceRequest {
  uri: string;
}

export interface ReadResourceResponse {
  contents: ResourceContents[];
}

export interface ListPromptsResponse {
  prompts: Prompt[];
}

export interface GetPromptRequest {
  name: string;
  arguments?: Record<string, string>;
}

export interface GetPromptResponse {
  description?: string;
  messages: PromptMessage[];
}
