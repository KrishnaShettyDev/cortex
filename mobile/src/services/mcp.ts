/**
 * MCP (Model Context Protocol) Service
 *
 * Manages external MCP server integrations for extending Cortex capabilities.
 * Users can add their own MCP servers to bring custom tools into Cortex.
 */

import { api } from './api';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPIntegration {
  id: string;
  name: string;
  description?: string;
  serverUrl: string;
  authType: 'none' | 'bearer' | 'api_key' | 'oauth2';
  capabilities: {
    toolCount: number;
    resourceCount: number;
    promptCount: number;
    tools: Array<{ name: string; description?: string }>;
  };
  isActive: boolean;
  lastHealthCheck?: string;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  errorCount?: number;
  lastError?: string;
  createdAt: string;
}

export interface AddMCPServerRequest {
  name: string;
  server_url: string;
  transport?: 'sse' | 'http';
  auth_type?: 'none' | 'bearer' | 'api_key';
  auth_token?: string;
}

export interface MCPListResponse {
  integrations: MCPIntegration[];
}

export interface MCPDiscoverResponse {
  success: boolean;
  capabilities: {
    tools: MCPTool[];
    resources?: Array<{ uri: string; name: string; description?: string }>;
    prompts?: Array<{ name: string; description?: string }>;
  };
  error?: string;
}

class MCPService {
  /**
   * List all MCP integrations for the user
   */
  async listIntegrations(): Promise<MCPIntegration[]> {
    const response = await api.request<MCPListResponse>('/mcp/integrations');
    return response.integrations || [];
  }

  /**
   * Add a new MCP server integration
   */
  async addServer(request: AddMCPServerRequest): Promise<MCPIntegration> {
    // Transform to camelCase for backend
    // Backend returns { success: true, integration: {...} }
    const response = await api.request<{ success: boolean; integration: MCPIntegration }>('/mcp/integrations', {
      method: 'POST',
      body: {
        name: request.name,
        serverUrl: request.server_url,
        transport: request.transport,
        authType: request.auth_type,
        authToken: request.auth_token,
      },
    });
    return response.integration;
  }

  /**
   * Discover tools from an MCP server
   */
  async discoverTools(integrationId: string): Promise<MCPDiscoverResponse> {
    return api.request<MCPDiscoverResponse>(`/mcp/integrations/${integrationId}/discover`, {
      method: 'POST',
    });
  }

  /**
   * Delete an MCP integration
   */
  async deleteIntegration(integrationId: string): Promise<void> {
    await api.request(`/mcp/integrations/${integrationId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Toggle active status of an MCP integration
   */
  async toggleActive(integrationId: string, isActive: boolean): Promise<MCPIntegration> {
    // Backend returns { success: true, integration: {...} }
    const response = await api.request<{ success: boolean; integration: MCPIntegration }>(`/mcp/integrations/${integrationId}`, {
      method: 'PATCH',
      body: { isActive },
    });
    return response.integration;
  }
}

export const mcpService = new MCPService();
