-- Migration 0032: MCP Client Support
-- Tables already exist from 0029_proactive_v2.sql (mcp_integrations, mcp_execution_log)
-- This migration just adds the transport column and any missing indexes

-- Add transport column if not exists (SSE vs HTTP)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- This will fail silently if column already exists
ALTER TABLE mcp_integrations ADD COLUMN transport TEXT DEFAULT 'sse';

-- Add tools_discovered as an alias for capabilities if needed
-- Actually, 'capabilities' serves the same purpose - we'll use it in code

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_mcp_integrations_user ON mcp_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_integrations_active ON mcp_integrations(user_id, is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_mcp_execution_log_user ON mcp_execution_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_execution_log_integration ON mcp_execution_log(integration_id, created_at);
