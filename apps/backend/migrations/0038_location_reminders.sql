-- Location-based reminders
-- Uses client-side geofencing (iOS/Android native)
-- Server stores reminder metadata, device handles location monitoring

CREATE TABLE IF NOT EXISTS location_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Location details
  name TEXT NOT NULL,                    -- "Home", "Work", "Gym", "Starbucks on Main St"
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters INTEGER DEFAULT 100,     -- Geofence radius (min 100m for reliability)

  -- Reminder content
  message TEXT NOT NULL,                 -- "Take out the trash", "Buy milk"

  -- Trigger conditions
  trigger_on TEXT DEFAULT 'enter',       -- 'enter', 'exit', 'both'

  -- State
  status TEXT DEFAULT 'active',          -- 'active', 'triggered', 'snoozed', 'completed', 'deleted'
  triggered_at TEXT,                     -- When it was last triggered
  trigger_count INTEGER DEFAULT 0,       -- How many times triggered (for recurring)

  -- Recurrence
  is_recurring INTEGER DEFAULT 0,        -- 1 = remind every time, 0 = one-time
  snooze_until TEXT,                     -- If snoozed, when to re-enable

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for efficient user queries
CREATE INDEX IF NOT EXISTS idx_location_reminders_user
  ON location_reminders(user_id, status);

-- Index for sync queries (get active reminders for a user)
CREATE INDEX IF NOT EXISTS idx_location_reminders_active
  ON location_reminders(user_id, status, updated_at)
  WHERE status = 'active';

-- Known locations table (user's saved places)
-- These can be reused across reminders
CREATE TABLE IF NOT EXISTS known_locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  name TEXT NOT NULL,                    -- "Home", "Work", "Mom's House"
  type TEXT,                             -- 'home', 'work', 'gym', 'cafe', 'other'
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters INTEGER DEFAULT 100,

  -- Address (optional, for display)
  address TEXT,

  -- Usage tracking
  use_count INTEGER DEFAULT 0,
  last_used_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for user's locations
CREATE INDEX IF NOT EXISTS idx_known_locations_user
  ON known_locations(user_id);

-- Unique constraint on user + name (can't have two "Home" locations)
CREATE UNIQUE INDEX IF NOT EXISTS idx_known_locations_unique_name
  ON known_locations(user_id, name);
