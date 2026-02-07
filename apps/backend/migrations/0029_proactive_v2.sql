-- =============================================================================
-- Proactive V2: Real-Time Monitoring, Triggers, and MCP Support
-- =============================================================================

-- =============================================================================
-- P0: Real-Time Proactive Infrastructure
-- =============================================================================

-- Sync cursors for incremental polling (Gmail historyId, Calendar syncToken)
-- Used as fallback when webhooks are delayed/missed
CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,  -- 'gmail', 'googlecalendar', 'slack', 'notion'
  cursor_type TEXT NOT NULL,  -- 'history_id', 'sync_token', 'page_token'
  cursor_value TEXT NOT NULL,
  last_sync_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(user_id, provider, cursor_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_cursors_user ON sync_cursors(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_cursors_provider ON sync_cursors(user_id, provider);

-- Event deduplication cache (24h TTL, cleaned by cron)
-- Prevents duplicate notifications when webhook + polling both fire
CREATE TABLE IF NOT EXISTS seen_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_hash TEXT NOT NULL,  -- SHA256(provider + item_id + content_hash)
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(user_id, event_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seen_events_cleanup ON seen_events(created_at);
CREATE INDEX IF NOT EXISTS idx_seen_events_user ON seen_events(user_id);

-- Notification batch queue (smart batching for non-critical events)
-- Critical = immediate, High = 30s window, Medium = 1min window
CREATE TABLE IF NOT EXISTS notification_batch (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  events TEXT NOT NULL,  -- JSON array of pending event IDs
  flush_at TEXT NOT NULL,  -- When to send batch (ISO timestamp)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_batch_flush ON notification_batch(flush_at);
CREATE INDEX IF NOT EXISTS idx_notification_batch_user ON notification_batch(user_id);

-- LLM classification cache (reduces API costs for similar content)
-- 1h TTL for classification results
CREATE TABLE IF NOT EXISTS classification_cache (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,  -- SHA256 of normalized content
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  category TEXT,  -- 'otp', 'security', 'calendar', 'social', 'marketing', etc.
  action_required INTEGER DEFAULT 0,
  confidence REAL NOT NULL,
  llm_reasoning TEXT,  -- For debugging
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classification_cache_expires ON classification_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_classification_cache_hash ON classification_cache(content_hash);

-- =============================================================================
-- P1: Enhanced Notification Preferences
-- =============================================================================

-- Add new columns to existing notification_preferences table
-- These enable smart batching and quiet hours improvements
ALTER TABLE notification_preferences ADD COLUMN quiet_hours_weekday_only INTEGER DEFAULT 0;
ALTER TABLE notification_preferences ADD COLUMN morning_briefing_days TEXT DEFAULT '1,2,3,4,5';  -- Mon-Fri
ALTER TABLE notification_preferences ADD COLUMN evening_briefing_days TEXT DEFAULT '1,2,3,4,5';
ALTER TABLE notification_preferences ADD COLUMN critical_always_notify INTEGER DEFAULT 1;  -- Override quiet hours for critical
ALTER TABLE notification_preferences ADD COLUMN batch_non_urgent INTEGER DEFAULT 1;  -- Enable smart batching
ALTER TABLE notification_preferences ADD COLUMN digest_time TEXT DEFAULT '08:00';  -- Daily digest delivery time
ALTER TABLE notification_preferences ADD COLUMN enable_proactive_notifications INTEGER DEFAULT 1;

-- Expand proactive_settings with more granular controls
ALTER TABLE proactive_settings ADD COLUMN notify_otp INTEGER DEFAULT 1;
ALTER TABLE proactive_settings ADD COLUMN notify_calendar INTEGER DEFAULT 1;
ALTER TABLE proactive_settings ADD COLUMN notify_slack_dm INTEGER DEFAULT 1;
ALTER TABLE proactive_settings ADD COLUMN notify_notion INTEGER DEFAULT 1;
ALTER TABLE proactive_settings ADD COLUMN rate_limit_high INTEGER DEFAULT 20;  -- per hour
ALTER TABLE proactive_settings ADD COLUMN rate_limit_medium INTEGER DEFAULT 10;  -- per hour
ALTER TABLE proactive_settings ADD COLUMN rate_limit_low INTEGER DEFAULT 5;  -- per hour

-- Expand proactive_events source types
-- Need to recreate if CHECK constraint is strict (SQLite limitation)
-- Instead, we'll allow new sources in application logic

-- =============================================================================
-- P4: Natural Language Triggers
-- =============================================================================

-- User-defined triggers with natural language input
CREATE TABLE IF NOT EXISTS user_triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,  -- User-friendly name
  original_input TEXT NOT NULL,  -- "Remind me every weekday at 9am"
  cron_expression TEXT NOT NULL,  -- "0 9 * * 1-5"
  agent_id TEXT,  -- Which agent handles this (null = default proactive agent)
  action_type TEXT NOT NULL CHECK (action_type IN ('reminder', 'briefing', 'check', 'query', 'custom')),
  action_payload TEXT NOT NULL,  -- JSON with action parameters
  timezone TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TEXT,
  next_trigger_at TEXT,
  error_count INTEGER DEFAULT 0,  -- For circuit breaker
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_triggers_next ON user_triggers(next_trigger_at) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_user_triggers_user ON user_triggers(user_id);

-- Trigger execution log (audit trail)
CREATE TABLE IF NOT EXISTS trigger_execution_log (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  result TEXT,  -- JSON with execution result
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (trigger_id) REFERENCES user_triggers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trigger_execution_log_trigger ON trigger_execution_log(trigger_id, created_at DESC);

-- =============================================================================
-- P3: MCP Custom Integrations
-- =============================================================================

-- User-registered MCP server connections
CREATE TABLE IF NOT EXISTS mcp_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  server_url TEXT NOT NULL,  -- Webhook URL for the MCP server
  auth_type TEXT NOT NULL CHECK (auth_type IN ('none', 'api_key', 'oauth2', 'bearer')),
  auth_config TEXT,  -- JSON with auth parameters (encrypted at rest)
  capabilities TEXT NOT NULL DEFAULT '{}',  -- JSON: { tools: [], resources: [], prompts: [] }
  is_active INTEGER DEFAULT 1,
  last_health_check TEXT,
  health_status TEXT DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  error_count INTEGER DEFAULT 0,  -- For circuit breaker
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_integrations_user ON mcp_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_integrations_active ON mcp_integrations(is_active) WHERE is_active = 1;

-- MCP tool execution audit log (security + debugging)
CREATE TABLE IF NOT EXISTS mcp_execution_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_params TEXT,  -- JSON (sanitized, no secrets)
  output_result TEXT,  -- JSON (truncated if > 10KB)
  execution_time_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (integration_id) REFERENCES mcp_integrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_execution_log_user ON mcp_execution_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_execution_log_integration ON mcp_execution_log(integration_id, created_at DESC);

-- =============================================================================
-- P2: Proactive Chat Messages
-- =============================================================================

-- Proactive messages that appear in chat (linked to events)
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT,  -- Link to proactive_events
  trigger_id TEXT,  -- Link to user_triggers
  message_type TEXT NOT NULL CHECK (message_type IN ('notification', 'briefing', 'reminder', 'insight', 'action_result')),
  content TEXT NOT NULL,
  suggested_actions TEXT,  -- JSON array of action suggestions
  is_read INTEGER DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES proactive_events(id) ON DELETE SET NULL,
  FOREIGN KEY (trigger_id) REFERENCES user_triggers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_user ON proactive_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_messages_unread ON proactive_messages(user_id, is_read) WHERE is_read = 0;

-- =============================================================================
-- Cleanup Indices for Performance
-- =============================================================================

-- User activity tracking (for smart polling frequency)
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(updated_at DESC);
