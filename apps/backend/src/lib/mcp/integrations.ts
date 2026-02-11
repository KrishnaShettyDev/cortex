/**
 * MCP (Model Context Protocol) Integration Service
 *
 * Allows users to connect custom MCP servers and execute tools.
 * Features:
 * - Server registration and discovery
 * - Tool execution with sandboxing
 * - Health monitoring
 * - Audit logging
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import {
  discoverMCPTools,
  callMCPTool,
  readMCPResource,
  checkMCPHealth,
  type MCPTool as MCPToolFromClient,
} from './client';

// =============================================================================
// TYPES
// =============================================================================

export interface MCPIntegration {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  serverUrl: string;
  authType: 'none' | 'api_key' | 'oauth2' | 'bearer';
  authConfig: Record<string, any> | null;
  capabilities: MCPCapabilities;
  isActive: boolean;
  lastHealthCheck: string | null;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  errorCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MCPCapabilities {
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface MCPExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTimeMs: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const MCP_EXECUTION_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_RESULT_SIZE = 10 * 1024; // 10KB max result size for logging

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * Register a new MCP server
 */
export async function registerMCPIntegration(
  db: D1Database,
  userId: string,
  data: {
    name: string;
    description?: string;
    serverUrl: string;
    authType: MCPIntegration['authType'];
    authConfig?: Record<string, any>;
  }
): Promise<MCPIntegration> {
  const id = nanoid();
  const now = new Date().toISOString();

  // Validate URL
  try {
    new URL(data.serverUrl);
  } catch {
    throw new Error('Invalid server URL');
  }

  await db.prepare(`
    INSERT INTO mcp_integrations (
      id, user_id, name, description, server_url,
      auth_type, auth_config, capabilities, is_active,
      health_status, error_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 1, 'unknown', 0, ?, ?)
  `).bind(
    id,
    userId,
    data.name,
    data.description || null,
    data.serverUrl,
    data.authType,
    data.authConfig ? JSON.stringify(data.authConfig) : null,
    now,
    now
  ).run();

  return {
    id,
    userId,
    name: data.name,
    description: data.description || null,
    serverUrl: data.serverUrl,
    authType: data.authType,
    authConfig: data.authConfig || null,
    capabilities: { tools: [], resources: [], prompts: [] },
    isActive: true,
    lastHealthCheck: null,
    healthStatus: 'unknown',
    errorCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get user's MCP integrations
 */
export async function getUserMCPIntegrations(
  db: D1Database,
  userId: string
): Promise<MCPIntegration[]> {
  const result = await db.prepare(`
    SELECT
      id, user_id, name, description, server_url,
      auth_type, auth_config, capabilities, is_active,
      last_health_check, health_status, error_count, last_error,
      created_at, updated_at
    FROM mcp_integrations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).bind(userId).all<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    server_url: string;
    auth_type: string;
    auth_config: string | null;
    capabilities: string;
    is_active: number;
    last_health_check: string | null;
    health_status: string;
    error_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>();

  return (result.results || []).map(row => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    serverUrl: row.server_url,
    authType: row.auth_type as MCPIntegration['authType'],
    authConfig: row.auth_config ? JSON.parse(row.auth_config) : null,
    capabilities: JSON.parse(row.capabilities || '{}'),
    isActive: row.is_active === 1,
    lastHealthCheck: row.last_health_check,
    healthStatus: row.health_status as MCPIntegration['healthStatus'],
    errorCount: row.error_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get a specific integration
 */
export async function getMCPIntegration(
  db: D1Database,
  userId: string,
  integrationId: string
): Promise<MCPIntegration | null> {
  const integrations = await getUserMCPIntegrations(db, userId);
  return integrations.find(i => i.id === integrationId) || null;
}

/**
 * Update an integration
 */
export async function updateMCPIntegration(
  db: D1Database,
  userId: string,
  integrationId: string,
  updates: Partial<{
    name: string;
    description: string;
    serverUrl: string;
    authConfig: Record<string, any>;
    isActive: boolean;
  }>
): Promise<boolean> {
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    values.push(updates.description);
  }
  if (updates.serverUrl !== undefined) {
    try {
      new URL(updates.serverUrl);
    } catch {
      throw new Error('Invalid server URL');
    }
    sets.push('server_url = ?');
    values.push(updates.serverUrl);
  }
  if (updates.authConfig !== undefined) {
    sets.push('auth_config = ?');
    values.push(JSON.stringify(updates.authConfig));
  }
  if (updates.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  values.push(integrationId, userId);

  const result = await db.prepare(`
    UPDATE mcp_integrations
    SET ${sets.join(', ')}
    WHERE id = ? AND user_id = ?
  `).bind(...values).run();

  return (result.meta?.changes || 0) > 0;
}

/**
 * Delete an integration
 */
export async function deleteMCPIntegration(
  db: D1Database,
  userId: string,
  integrationId: string
): Promise<boolean> {
  const result = await db.prepare(`
    DELETE FROM mcp_integrations WHERE id = ? AND user_id = ?
  `).bind(integrationId, userId).run();

  return (result.meta?.changes || 0) > 0;
}

// =============================================================================
// DISCOVERY
// =============================================================================

/**
 * Discover capabilities of an MCP server using JSON-RPC 2.0 protocol
 */
export async function discoverCapabilities(
  db: D1Database,
  userId: string,
  integrationId: string
): Promise<MCPCapabilities> {
  const integration = await getMCPIntegration(db, userId, integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }

  try {
    // Build auth headers
    const authHeaders = buildAuthHeaders(integration);

    // Use the new JSON-RPC client for discovery
    const discovered = await discoverMCPTools(integration.serverUrl, authHeaders);

    // Enhance tool descriptions with format hints based on server URL
    const enhancedTools = discovered.tools.map(t => {
      let description = t.description || t.name;

      // Add format hints for known MCP servers
      if (integration.serverUrl.includes('crypto.com')) {
        if (t.name.includes('ticker') || t.name.includes('price') || t.name.includes('instrument')) {
          description += '. IMPORTANT: Use format like BTCUSD, ETHUSD, BTCUSDT (no slashes or underscores between symbols).';
        }
      }

      return {
        name: t.name,
        description,
        inputSchema: t.inputSchema || {},
      };
    });

    const capabilities: MCPCapabilities = {
      tools: enhancedTools,
      resources: discovered.resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
      prompts: [], // MCP prompts are less common, skip for now
    };

    // Update integration with discovered capabilities
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE mcp_integrations
      SET capabilities = ?,
          last_health_check = ?,
          health_status = 'healthy',
          error_count = 0,
          last_error = NULL,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(
      JSON.stringify(capabilities),
      now,
      now,
      integrationId,
      userId
    ).run();

    console.log(`[MCP] Discovered ${capabilities.tools.length} tools for ${integration.name}`);
    return capabilities;
  } catch (error) {
    // Update integration with error
    const now = new Date().toISOString();
    const errorMsg = error instanceof Error ? error.message : String(error);
    await db.prepare(`
      UPDATE mcp_integrations
      SET last_health_check = ?,
          health_status = 'unhealthy',
          error_count = error_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(now, errorMsg, now, integrationId, userId).run();

    console.error(`[MCP] Discovery failed for ${integration.name}:`, errorMsg);
    throw error;
  }
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

/**
 * Execute an MCP tool using JSON-RPC 2.0 protocol
 */
export async function executeTool(
  db: D1Database,
  userId: string,
  integrationId: string,
  toolName: string,
  inputParams: Record<string, any>
): Promise<MCPExecutionResult> {
  const startTime = Date.now();

  const integration = await getMCPIntegration(db, userId, integrationId);
  if (!integration) {
    return {
      success: false,
      error: 'Integration not found',
      executionTimeMs: Date.now() - startTime,
    };
  }

  if (!integration.isActive) {
    return {
      success: false,
      error: 'Integration is disabled',
      executionTimeMs: Date.now() - startTime,
    };
  }

  // Verify tool exists
  const tool = integration.capabilities.tools.find(t => t.name === toolName);
  if (!tool) {
    return {
      success: false,
      error: `Tool "${toolName}" not found. Run discovery first.`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  try {
    const authHeaders = buildAuthHeaders(integration);

    // Use the new JSON-RPC client
    const responseData = await callMCPTool(
      integration.serverUrl,
      toolName,
      inputParams,
      authHeaders
    );

    const executionTimeMs = Date.now() - startTime;

    const result: MCPExecutionResult = {
      success: true,
      result: responseData,
      executionTimeMs,
    };

    await logExecution(db, userId, integrationId, toolName, inputParams, result);

    // Update health status
    await db.prepare(`
      UPDATE mcp_integrations
      SET last_health_check = datetime('now'),
          health_status = 'healthy',
          error_count = 0,
          last_error = NULL
      WHERE id = ?
    `).bind(integrationId).run();

    console.log(`[MCP] Tool ${toolName} executed in ${executionTimeMs}ms`);
    return result;
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const result: MCPExecutionResult = {
      success: false,
      error: errorMessage,
      executionTimeMs,
    };

    await logExecution(db, userId, integrationId, toolName, inputParams, result);

    // Update error count
    await db.prepare(`
      UPDATE mcp_integrations
      SET error_count = error_count + 1,
          last_error = ?,
          health_status = CASE
            WHEN error_count >= 4 THEN 'unhealthy'
            WHEN error_count >= 2 THEN 'degraded'
            ELSE health_status
          END
      WHERE id = ?
    `).bind(errorMessage, integrationId).run();

    console.error(`[MCP] Tool ${toolName} failed:`, errorMessage);
    return result;
  }
}

/**
 * Read an MCP resource using JSON-RPC 2.0 protocol
 */
export async function readResource(
  db: D1Database,
  userId: string,
  integrationId: string,
  uri: string
): Promise<MCPExecutionResult> {
  const startTime = Date.now();

  const integration = await getMCPIntegration(db, userId, integrationId);
  if (!integration) {
    return {
      success: false,
      error: 'Integration not found',
      executionTimeMs: Date.now() - startTime,
    };
  }

  try {
    const authHeaders = buildAuthHeaders(integration);

    // Use the new JSON-RPC client
    const responseData = await readMCPResource(
      integration.serverUrl,
      uri,
      authHeaders
    );

    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      result: responseData,
      executionTimeMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

/**
 * Perform health check on all active integrations using JSON-RPC initialize
 */
export async function healthCheckIntegrations(db: D1Database): Promise<void> {
  const integrations = await db.prepare(`
    SELECT id, user_id, server_url, auth_type, auth_config
    FROM mcp_integrations
    WHERE is_active = 1
  `).all<{
    id: string;
    user_id: string;
    server_url: string;
    auth_type: string;
    auth_config: string | null;
  }>();

  for (const row of integrations.results || []) {
    try {
      const integration: Partial<MCPIntegration> = {
        serverUrl: row.server_url,
        authType: row.auth_type as MCPIntegration['authType'],
        authConfig: row.auth_config ? JSON.parse(row.auth_config) : null,
      };

      const authHeaders = buildAuthHeaders(integration as MCPIntegration);

      // Use the new JSON-RPC client for health check
      const isHealthy = await checkMCPHealth(row.server_url, authHeaders);
      const status = isHealthy ? 'healthy' : 'unhealthy';

      await db.prepare(`
        UPDATE mcp_integrations
        SET last_health_check = datetime('now'),
            health_status = ?
        WHERE id = ?
      `).bind(status, row.id).run();
    } catch {
      await db.prepare(`
        UPDATE mcp_integrations
        SET last_health_check = datetime('now'),
            health_status = 'unhealthy'
        WHERE id = ?
      `).bind(row.id).run();
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function buildAuthHeaders(integration: MCPIntegration): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (integration.authType) {
    case 'api_key':
      if (integration.authConfig?.apiKey) {
        const headerName = integration.authConfig.headerName || 'X-API-Key';
        headers[headerName] = integration.authConfig.apiKey;
      }
      break;

    case 'bearer':
      if (integration.authConfig?.token) {
        headers['Authorization'] = `Bearer ${integration.authConfig.token}`;
      }
      break;

    case 'oauth2':
      if (integration.authConfig?.accessToken) {
        headers['Authorization'] = `Bearer ${integration.authConfig.accessToken}`;
      }
      break;
  }

  return headers;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function logExecution(
  db: D1Database,
  userId: string,
  integrationId: string,
  toolName: string,
  inputParams: Record<string, any>,
  result: MCPExecutionResult
): Promise<void> {
  const now = new Date().toISOString();

  // Sanitize input (remove potential secrets)
  const sanitizedInput = sanitizeForLogging(inputParams);

  // Truncate result if too large
  let resultStr: string | null = null;
  if (result.result) {
    const fullResult = JSON.stringify(result.result);
    resultStr = fullResult.length > MAX_RESULT_SIZE
      ? fullResult.substring(0, MAX_RESULT_SIZE) + '...[truncated]'
      : fullResult;
  }

  await db.prepare(`
    INSERT INTO mcp_execution_log (
      id, user_id, integration_id, tool_name,
      input_params, output_result, execution_time_ms,
      status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    nanoid(),
    userId,
    integrationId,
    toolName,
    JSON.stringify(sanitizedInput),
    resultStr,
    result.executionTimeMs,
    result.success ? 'success' : 'error',
    result.error || null,
    now
  ).run();
}

function sanitizeForLogging(obj: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'apikey', 'api_key', 'auth'];
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
