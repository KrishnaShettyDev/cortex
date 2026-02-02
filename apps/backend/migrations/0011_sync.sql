-- Migration 0011: Sync Infrastructure
-- Purpose: Track sync status, cursors for delta sync, and sync logs
-- Date: 2024-01-15

-- Sync Connections: Tracks active sync connections per user per provider
CREATE TABLE IF NOT EXISTS sync_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL CHECK(provider IN ('gmail', 'google_calendar')),

  -- Composio account ID
  composio_account_id TEXT NOT NULL,

  -- Sync configuration
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  sync_enabled INTEGER DEFAULT 1 CHECK(sync_enabled IN (0, 1)),
  sync_frequency TEXT DEFAULT 'hourly' CHECK(sync_frequency IN ('realtime', 'hourly', 'daily', 'manual')),

  -- Sync state
  last_sync_at TEXT,
  next_sync_at TEXT,
  sync_cursor TEXT, -- Provider-specific cursor for delta sync (Gmail: historyId, Calendar: syncToken)

  -- Sync statistics (JSON)
  sync_stats TEXT, -- { items_synced, errors, last_duration_ms, last_error }

  -- Metadata
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, provider, container_tag)
);

CREATE INDEX idx_sync_connections_user ON sync_connections(user_id);
CREATE INDEX idx_sync_connections_next_sync ON sync_connections(next_sync_at) WHERE sync_enabled = 1 AND is_active = 1;
CREATE INDEX idx_sync_connections_provider ON sync_connections(provider);
CREATE INDEX idx_sync_connections_active ON sync_connections(user_id, provider) WHERE is_active = 1;

-- Sync Logs: Detailed log of each sync run
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,

  -- Sync details
  sync_type TEXT NOT NULL CHECK(sync_type IN ('full', 'delta', 'manual', 'scheduled')),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),

  -- Performance metrics
  items_processed INTEGER DEFAULT 0,
  memories_created INTEGER DEFAULT 0,
  profiles_discovered INTEGER DEFAULT 0,

  -- Error tracking
  errors TEXT, -- JSON array of error messages
  error_count INTEGER DEFAULT 0,

  -- Timing
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,

  -- Cursor state
  cursor_before TEXT, -- Cursor at start of sync
  cursor_after TEXT,  -- Cursor at end of sync

  -- Metadata
  trigger_source TEXT, -- 'scheduled', 'manual', 'webhook', 'initial'
  metadata TEXT, -- JSON for additional context

  FOREIGN KEY (connection_id) REFERENCES sync_connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_logs_connection ON sync_logs(connection_id, started_at DESC);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_started ON sync_logs(started_at DESC);
CREATE INDEX idx_sync_logs_failed ON sync_logs(connection_id, status) WHERE status = 'failed';

-- Sync Items: Track individual items synced (for deduplication)
CREATE TABLE IF NOT EXISTS sync_items (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,

  -- Item identification
  provider_item_id TEXT NOT NULL, -- Gmail message ID, Calendar event ID
  item_type TEXT NOT NULL CHECK(item_type IN ('email', 'calendar_event')),

  -- Associated memory
  memory_id TEXT,

  -- Item metadata
  subject TEXT, -- Email subject or event title
  sender_email TEXT, -- For emails
  event_date TEXT, -- For calendar events

  -- Sync info
  first_synced_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  sync_count INTEGER DEFAULT 1,

  -- Hash for change detection
  content_hash TEXT, -- SHA256 of content to detect changes

  FOREIGN KEY (connection_id) REFERENCES sync_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL,
  UNIQUE(connection_id, provider_item_id)
);

CREATE INDEX idx_sync_items_connection ON sync_items(connection_id);
CREATE INDEX idx_sync_items_provider_id ON sync_items(provider_item_id);
CREATE INDEX idx_sync_items_memory ON sync_items(memory_id);
CREATE INDEX idx_sync_items_synced ON sync_items(connection_id, last_synced_at DESC);
CREATE INDEX idx_sync_items_type ON sync_items(connection_id, item_type);

-- Sync Webhooks: Track webhook registrations (for push notifications)
CREATE TABLE IF NOT EXISTS sync_webhooks (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,

  -- Webhook details
  provider_webhook_id TEXT, -- Gmail channel ID, Calendar webhook ID
  webhook_url TEXT NOT NULL,
  webhook_secret TEXT, -- For signature verification

  -- State
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  expires_at TEXT, -- When webhook registration expires

  -- Stats
  events_received INTEGER DEFAULT 0,
  last_event_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (connection_id) REFERENCES sync_connections(id) ON DELETE CASCADE,
  UNIQUE(connection_id)
);

CREATE INDEX idx_sync_webhooks_connection ON sync_webhooks(connection_id);
CREATE INDEX idx_sync_webhooks_expires ON sync_webhooks(expires_at) WHERE is_active = 1;

-- Migration: Migrate existing integrations to sync_connections
INSERT INTO sync_connections (
  id,
  user_id,
  container_tag,
  provider,
  composio_account_id,
  is_active,
  sync_enabled,
  sync_frequency,
  last_sync_at,
  created_at,
  updated_at
)
SELECT
  lower(hex(randomblob(8))) || '-' || lower(hex(randomblob(4))) || '-4' || substr(lower(hex(randomblob(4))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(4))),2) || '-' || lower(hex(randomblob(12))) as id,
  user_id,
  'default' as container_tag,
  provider,
  access_token as composio_account_id,
  connected as is_active,
  connected as sync_enabled,
  'hourly' as sync_frequency,
  last_sync as last_sync_at,
  created_at,
  updated_at
FROM integrations
WHERE provider IN ('gmail', 'googlecalendar')
  AND connected = 1
  AND NOT EXISTS (
    SELECT 1 FROM sync_connections sc
    WHERE sc.user_id = integrations.user_id
      AND sc.provider = integrations.provider
  );
