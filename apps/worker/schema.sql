-- Cortex D1 Database Schema
-- Clean, simple, no bloat

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_users_email ON users(email);

-- Memories table (core data)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT, -- 'chat', 'email', 'calendar', 'manual'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_source ON memories(source);

-- Memory metadata (separate for flexibility)
CREATE TABLE IF NOT EXISTS memory_metadata (
  memory_id TEXT PRIMARY KEY,
  entities TEXT, -- JSON array of entity names
  location_lat REAL,
  location_lon REAL,
  location_name TEXT,
  people TEXT, -- JSON array of people names
  tags TEXT, -- JSON array of tags
  timestamp TEXT, -- Event timestamp (when it happened)
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Integrations (Google, Apple)
CREATE TABLE IF NOT EXISTS integrations (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'google' or 'apple'
  connected INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  last_sync TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_integrations_user ON integrations(user_id);

-- Sessions (JWT refresh tokens)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token);

-- Note: Vector embeddings will be stored in Cloudflare Vectorize (separate service)
-- This keeps D1 lean and fast
