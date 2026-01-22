// SQLite Database Schema for Offline Support

export const SCHEMA_VERSION = 1;

// Create tables SQL
export const CREATE_TABLES_SQL = `
  -- Memories table for offline caching
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    memory_type TEXT DEFAULT 'note',
    source TEXT,
    media_url TEXT,
    entities TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    synced INTEGER DEFAULT 0,
    pending_delete INTEGER DEFAULT 0
  );

  -- Chat messages table
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    action_type TEXT,
    action_data TEXT,
    created_at TEXT NOT NULL,
    synced INTEGER DEFAULT 0
  );

  -- Mutation queue for offline operations
  CREATE TABLE IF NOT EXISTS mutation_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    payload TEXT,
    headers TEXT,
    created_at TEXT NOT NULL,
    retries INTEGER DEFAULT 0,
    last_error TEXT,
    status TEXT DEFAULT 'pending'
  );

  -- Sync metadata
  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Create indexes for faster queries
  CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memories_synced ON memories(synced);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_mutation_queue_status ON mutation_queue(status);
`;

// Migration queries for schema updates
export const MIGRATIONS: Record<number, string[]> = {
  1: [CREATE_TABLES_SQL],
};

// Table types for TypeScript
export interface LocalMemory {
  id: string;
  content: string;
  memory_type: string;
  source?: string;
  media_url?: string;
  entities?: string; // JSON string of entities array
  created_at: string;
  updated_at?: string;
  synced: number; // 0 = not synced, 1 = synced
  pending_delete: number; // 0 = active, 1 = marked for deletion
}

export interface LocalChatMessage {
  id: string;
  conversation_id?: string;
  role: 'user' | 'assistant';
  content: string;
  action_type?: string;
  action_data?: string; // JSON string
  created_at: string;
  synced: number;
}

export interface MutationQueueItem {
  id: number;
  type: 'create_memory' | 'delete_memory' | 'send_message' | 'execute_action';
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  payload?: string; // JSON string
  headers?: string; // JSON string
  created_at: string;
  retries: number;
  last_error?: string;
  status: 'pending' | 'processing' | 'failed' | 'completed';
}

export interface SyncMetadata {
  key: string;
  value: string;
  updated_at: string;
}
