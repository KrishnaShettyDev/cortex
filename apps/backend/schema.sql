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

-- Memories table (temporal facts with versioning)
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT, -- 'chat', 'email', 'calendar', 'manual', 'auto'

  -- Versioning (Supermemory pattern)
  version INTEGER NOT NULL DEFAULT 1,
  is_latest INTEGER NOT NULL DEFAULT 1, -- Boolean: 1 = current version
  parent_memory_id TEXT, -- Previous version
  root_memory_id TEXT, -- Original memory in chain

  -- Container scoping (multi-tenancy)
  container_tag TEXT DEFAULT 'default',

  -- Processing status (async pipeline)
  processing_status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'embedding', 'extracting', 'indexing', 'done', 'failed'
  processing_error TEXT, -- Error message if failed

  -- Soft delete
  is_forgotten INTEGER NOT NULL DEFAULT 0,
  forget_after TEXT, -- ISO timestamp for auto-deletion

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
  FOREIGN KEY (root_memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_created ON memories(created_at);
CREATE INDEX idx_memories_source ON memories(source);
CREATE INDEX idx_memories_latest ON memories(is_latest) WHERE is_latest = 1;
CREATE INDEX idx_memories_container ON memories(container_tag);
CREATE INDEX idx_memories_user_container ON memories(user_id, container_tag);

-- Memory relationships (updates, extends, derives)
CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL, -- 'updates', 'extends', 'derives'
  created_at TEXT NOT NULL,

  FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_relations_from ON memory_relations(from_memory_id);
CREATE INDEX idx_memory_relations_to ON memory_relations(to_memory_id);

-- Memory metadata (entities, location, people)
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

-- Documents (knowledge base)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL, -- 'pdf', 'url', 'code', 'text', 'image'
  source_url TEXT, -- Original URL or file path

  -- Container scoping
  container_tag TEXT DEFAULT 'default',

  -- Processing status
  status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'extracting', 'chunking', 'embedding', 'done', 'failed'
  error_message TEXT,

  -- Metadata
  file_size INTEGER,
  mime_type TEXT,
  metadata TEXT, -- JSON: author, created_date, etc

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_container ON documents(container_tag);
CREATE INDEX idx_documents_status ON documents(status);

-- Document chunks (smart chunking)
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,

  -- Chunk metadata
  chunk_type TEXT, -- 'section', 'paragraph', 'code_block', 'table'
  start_offset INTEGER,
  end_offset INTEGER,

  created_at TEXT NOT NULL,

  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);

-- User profiles (auto-extracted facts)
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_type TEXT NOT NULL, -- 'static' or 'dynamic'
  fact TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5, -- 0.0 to 1.0

  -- Container scoping
  container_tag TEXT DEFAULT 'default',

  -- Source tracking
  source_memory_ids TEXT, -- JSON array of memory IDs that support this fact

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_profiles_user ON user_profiles(user_id);
CREATE INDEX idx_profiles_type ON user_profiles(profile_type);
CREATE INDEX idx_profiles_container ON user_profiles(container_tag);

-- Container tags (projects/spaces for organizing memories)
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tag TEXT NOT NULL, -- Unique identifier like 'work', 'personal', 'project_x'
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, tag)
);

CREATE INDEX idx_containers_user ON containers(user_id);

-- Integrations (Google, Apple, OAuth providers)
CREATE TABLE IF NOT EXISTS integrations (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'google', 'apple', 'slack', 'github', 'linear'
  connected INTEGER NOT NULL DEFAULT 0, -- 0 or 1 (boolean)
  email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  last_sync TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_integrations_user ON integrations(user_id);

-- API keys (for developer access)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of actual key
  name TEXT NOT NULL,
  prefix TEXT NOT NULL, -- First 8 chars for display (e.g., "sm_1234")
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

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
