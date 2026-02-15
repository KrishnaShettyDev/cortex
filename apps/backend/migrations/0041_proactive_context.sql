-- Migration: Proactive Context System
-- Adds tables for meeting prep notifications and proactive messages

-- Calendar Events Table (for meeting prep notifications)
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  attendees TEXT DEFAULT '[]', -- JSON array of email addresses
  location TEXT,
  description TEXT,
  event_url TEXT,
  prep_notification_sent INTEGER DEFAULT 0,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start ON calendar_events(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_prep ON calendar_events(start_time, prep_notification_sent);

-- Proactive Messages Table (for in-app proactive notifications)
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_type TEXT NOT NULL, -- 'meeting_prep', 'email_alert', 'insight', 'nudge'
  content TEXT NOT NULL,
  metadata TEXT DEFAULT '{}', -- JSON with additional data
  suggested_actions TEXT DEFAULT '[]', -- JSON array of action buttons
  read_at TEXT,
  dismissed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_user ON proactive_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_messages_unread ON proactive_messages(user_id, read_at) WHERE read_at IS NULL;

-- Add latitude/longitude columns to users if not exists
-- These are used for location-aware features
-- Note: SQLite doesn't support IF NOT EXISTS for columns, so we check first

-- Add prep_notification_sent to sync_items if it doesn't exist
-- This tracks whether we've sent a meeting prep notification
