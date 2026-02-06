-- Proactive Monitoring - Lean Schema

-- User settings
CREATE TABLE IF NOT EXISTS proactive_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_urgency TEXT NOT NULL DEFAULT 'high' CHECK (min_urgency IN ('critical', 'high', 'medium', 'low')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Event log
CREATE TABLE IF NOT EXISTS proactive_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('email', 'calendar')),
  title TEXT,
  body TEXT,
  sender TEXT,
  urgency TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proactive_events_user ON proactive_events(user_id, created_at DESC);

-- VIP / blocked senders
CREATE TABLE IF NOT EXISTS proactive_vip (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL DEFAULT 'vip' CHECK (type IN ('vip', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_proactive_vip_user ON proactive_vip(user_id);
