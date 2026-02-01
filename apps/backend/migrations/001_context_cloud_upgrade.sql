-- Migration: Upgrade to Context Cloud architecture
-- This migration transforms Cortex from simple memory storage to a full context cloud

-- Step 1: Add new columns to existing memories table
ALTER TABLE memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN parent_memory_id TEXT;
ALTER TABLE memories ADD COLUMN root_memory_id TEXT;
ALTER TABLE memories ADD COLUMN container_tag TEXT DEFAULT 'default';
ALTER TABLE memories ADD COLUMN is_forgotten INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN forget_after TEXT;

-- Step 2: Create new indexes on memories
CREATE INDEX IF NOT EXISTS idx_memories_latest ON memories(is_latest) WHERE is_latest = 1;
CREATE INDEX IF NOT EXISTS idx_memories_container ON memories(container_tag);
CREATE INDEX IF NOT EXISTS idx_memories_user_container ON memories(user_id, container_tag);

-- Step 3: Create memory_relations table
CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_relations_from ON memory_relations(from_memory_id);
CREATE INDEX idx_memory_relations_to ON memory_relations(to_memory_id);

-- Step 4: Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  container_tag TEXT DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  file_size INTEGER,
  mime_type TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_container ON documents(container_tag);
CREATE INDEX idx_documents_status ON documents(status);

-- Step 5: Create document_chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);

-- Step 6: Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_type TEXT NOT NULL,
  fact TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  container_tag TEXT DEFAULT 'default',
  source_memory_ids TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_profiles_user ON user_profiles(user_id);
CREATE INDEX idx_profiles_type ON user_profiles(profile_type);
CREATE INDEX idx_profiles_container ON user_profiles(container_tag);

-- Step 7: Create containers table
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, tag)
);

CREATE INDEX idx_containers_user ON containers(user_id);

-- Step 8: Create default container for all existing users
INSERT INTO containers (id, user_id, tag, name, description, created_at, updated_at)
SELECT
  'default_' || id,
  id,
  'default',
  'Default',
  'Default container for all memories',
  created_at,
  created_at
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM containers WHERE user_id = users.id AND tag = 'default'
);

-- Step 9: Update integrations table with new columns
ALTER TABLE integrations ADD COLUMN token_expires_at TEXT;

-- Step 10: Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
