-- Migration: 0019_action_execution
-- Description: Add action logging and execution tracking

-- Action log table for audit trail
CREATE TABLE IF NOT EXISTS action_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  parameters TEXT NOT NULL, -- JSON
  result TEXT, -- JSON
  status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'failed'
  error TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for action log
CREATE INDEX IF NOT EXISTS idx_action_log_user ON action_log(user_id);
CREATE INDEX IF NOT EXISTS idx_action_log_action ON action_log(action);
CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at DESC);

-- Pending actions table for confirmation flow
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  action TEXT NOT NULL,
  parameters TEXT NOT NULL, -- JSON
  confirmation_message TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_user ON pending_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_expires ON pending_actions(expires_at);
