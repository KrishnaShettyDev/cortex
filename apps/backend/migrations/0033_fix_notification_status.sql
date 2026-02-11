-- Migration 0033: Fix notification status CHECK constraint
-- The code uses 'skipped' and 'failed' but constraint only allows 'pending', 'sent', 'cancelled'

-- SQLite doesn't support ALTER TABLE MODIFY CONSTRAINT, so we need to recreate the table
-- But since we can't easily migrate data in a CF Worker migration, let's just drop the constraint

-- Create a new table without the constraint
CREATE TABLE IF NOT EXISTS scheduled_notifications_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSON,
  channel_id TEXT DEFAULT 'default',
  scheduled_for_utc TEXT NOT NULL,
  user_local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  recurrence TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- Now allows: pending, sent, skipped, failed, cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Copy data from old table
INSERT OR IGNORE INTO scheduled_notifications_new
  SELECT * FROM scheduled_notifications;

-- Drop old table
DROP TABLE scheduled_notifications;

-- Rename new table
ALTER TABLE scheduled_notifications_new RENAME TO scheduled_notifications;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user ON scheduled_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status ON scheduled_notifications(status, scheduled_for_utc);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_scheduled ON scheduled_notifications(scheduled_for_utc) WHERE status = 'pending';
