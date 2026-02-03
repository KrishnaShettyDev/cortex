-- Push Notifications Infrastructure
-- Stores device tokens, notification preferences, and delivery tracking

-- Device push tokens (users can have multiple devices)
CREATE TABLE IF NOT EXISTS push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = 1;

-- User notification preferences (extends user profile)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,

  -- Timezone (IANA format: America/New_York, Asia/Kolkata, etc.)
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- Feature toggles
  enable_morning_briefing INTEGER DEFAULT 1,
  enable_evening_briefing INTEGER DEFAULT 1,
  enable_meeting_prep INTEGER DEFAULT 1,
  enable_email_alerts INTEGER DEFAULT 1,
  enable_commitment_reminders INTEGER DEFAULT 1,
  enable_pattern_warnings INTEGER DEFAULT 1,
  enable_reconnection_nudges INTEGER DEFAULT 1,
  enable_memory_insights INTEGER DEFAULT 1,
  enable_important_dates INTEGER DEFAULT 1,
  enable_smart_reminders INTEGER DEFAULT 1,

  -- Timing (stored in user's local time, HH:MM format)
  morning_briefing_time TEXT DEFAULT '08:00',
  evening_briefing_time TEXT DEFAULT '18:00',
  meeting_prep_minutes_before INTEGER DEFAULT 30,

  -- Budget and quiet hours
  max_notifications_per_day INTEGER DEFAULT 8,
  quiet_hours_enabled INTEGER DEFAULT 0,
  quiet_hours_start TEXT DEFAULT '22:00',
  quiet_hours_end TEXT DEFAULT '07:00',

  -- Tracking
  notifications_sent_today INTEGER DEFAULT 0,
  last_notification_date TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(user_id);

-- Notification delivery log (for tracking and debugging)
CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  push_token_id TEXT,

  -- Notification details
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSON,

  -- Delivery status
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'dismissed')),
  expo_ticket_id TEXT,
  expo_receipt_status TEXT,
  error_message TEXT,

  -- Timing
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (push_token_id) REFERENCES push_tokens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notification_log_scheduled ON notification_log(scheduled_for) WHERE status = 'pending';

-- Scheduled notifications (for future delivery)
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Notification content
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSON,
  channel_id TEXT DEFAULT 'default',

  -- Scheduling
  scheduled_for_utc TEXT NOT NULL,
  user_local_time TEXT NOT NULL,
  timezone TEXT NOT NULL,

  -- Recurrence (null for one-time)
  recurrence TEXT CHECK (recurrence IN ('daily', 'weekly', 'monthly', NULL)),

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due ON scheduled_notifications(scheduled_for_utc, status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user ON scheduled_notifications(user_id, status);
