-- Migration: Add encrypted token columns to integrations table
-- This is part of the security hardening to encrypt OAuth tokens at rest
--
-- Migration strategy:
-- 1. Add encrypted columns (this migration)
-- 2. Code reads from encrypted first, falls back to plaintext
-- 3. Code lazy-migrates plaintext to encrypted on read
-- 4. After all tokens migrated, a future migration will drop plaintext columns

-- Add encrypted token columns to integrations
ALTER TABLE integrations ADD COLUMN encrypted_access_token TEXT;
ALTER TABLE integrations ADD COLUMN encrypted_refresh_token TEXT;

-- Add encrypted auth config column to mcp_integrations
ALTER TABLE mcp_integrations ADD COLUMN encrypted_auth_config TEXT;

-- Create sync_state table for incremental sync tracking (Block 8)
CREATE TABLE IF NOT EXISTS sync_state (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  last_history_id TEXT,
  last_sync_token TEXT,
  last_sync_at TEXT,
  sync_errors INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
);

-- Create dead_letter_queue table (Block 3)
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'notification', 'webhook', 'trigger', 'sync'
  payload TEXT NOT NULL, -- JSON stringified original data
  error TEXT NOT NULL,
  attempts INTEGER DEFAULT 1,
  max_attempts INTEGER DEFAULT 3,
  next_retry_at TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dlq_retry ON dead_letter_queue(next_retry_at)
  WHERE attempts < max_attempts AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dlq_type ON dead_letter_queue(type, created_at);

-- Create cron_metrics table for observability (Block 2)
CREATE TABLE IF NOT EXISTS cron_metrics (
  id TEXT PRIMARY KEY,
  cron_interval TEXT NOT NULL, -- 'every_minute', 'every_5_min', etc.
  task_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success', 'error', 'timeout', 'skipped'
  duration_ms INTEGER,
  llm_calls INTEGER DEFAULT 0,
  error TEXT,
  metadata TEXT, -- JSON for additional metrics
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cron_metrics_interval ON cron_metrics(cron_interval, created_at);
CREATE INDEX IF NOT EXISTS idx_cron_metrics_task ON cron_metrics(task_name, created_at);

-- Add index for sync_state lookups
CREATE INDEX IF NOT EXISTS idx_sync_state_stale ON sync_state(last_sync_at)
  WHERE last_sync_at < datetime('now', '-30 minutes');
