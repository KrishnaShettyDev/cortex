import {
  CREATE_TABLES_SQL,
  SCHEMA_VERSION,
  LocalMemory,
  LocalChatMessage,
  MutationQueueItem,
} from './schema';

// Database state
let db: any = null;
let isSupported = false;
let initAttempted = false;

// Check if native module is available without importing the full module
const checkNativeModuleAvailable = (): boolean => {
  try {
    // Try to access the native module registry
    const { NativeModulesProxy } = require('expo-modules-core');
    return NativeModulesProxy?.ExpoSQLite != null;
  } catch {
    return false;
  }
};

// Initialize database
export const initDatabase = async (): Promise<void> => {
  if (initAttempted) return;
  initAttempted = true;

  // Check if native module is available before trying to import
  if (!checkNativeModuleAvailable()) {
    console.log('SQLite native module not available - offline support disabled');
    isSupported = false;
    return;
  }

  try {
    const SQLite = await import('expo-sqlite');

    if (typeof SQLite?.openDatabaseAsync !== 'function') {
      console.log('SQLite openDatabaseAsync not available - offline support disabled');
      isSupported = false;
      return;
    }

    db = await SQLite.openDatabaseAsync('cortex.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await runMigrations();
    isSupported = true;
    console.log('Database initialized successfully');
  } catch (error) {
    console.log('SQLite initialization failed - offline support disabled');
    isSupported = false;
    db = null;
  }
};

// Check if database is available
export const isDatabaseAvailable = (): boolean => {
  return isSupported && db !== null;
};

// Run database migrations
const runMigrations = async (): Promise<void> => {
  if (!db) return;

  let currentVersion = 0;
  try {
    const result = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_metadata WHERE key = ?',
      ['schema_version']
    );
    if (result) {
      currentVersion = parseInt(result.value, 10);
    }
  } catch {
    // Table doesn't exist yet
  }

  if (currentVersion < SCHEMA_VERSION) {
    await db.execAsync(CREATE_TABLES_SQL);
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
      ['schema_version', SCHEMA_VERSION.toString(), new Date().toISOString()]
    );
    console.log('Database migrated from', currentVersion, 'to', SCHEMA_VERSION);
  }
};

// Close database
export const closeDatabase = async (): Promise<void> => {
  if (db) {
    await db.closeAsync();
    db = null;
  }
};

// ============ Memory Operations ============

export const saveMemoryLocally = async (memory: LocalMemory): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO memories (id, content, memory_type, source, media_url, entities, created_at, updated_at, synced, pending_delete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memory.id,
      memory.content,
      memory.memory_type,
      memory.source || null,
      memory.media_url || null,
      memory.entities || null,
      memory.created_at,
      memory.updated_at || null,
      memory.synced,
      memory.pending_delete,
    ]
  );
};

export const getLocalMemories = async (limit = 50, offset = 0): Promise<LocalMemory[]> => {
  if (!db) return [];
  return db.getAllAsync<LocalMemory>(
    `SELECT * FROM memories WHERE pending_delete = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
};

export const getLocalMemory = async (id: string): Promise<LocalMemory | null> => {
  if (!db) return null;
  return db.getFirstAsync<LocalMemory>('SELECT * FROM memories WHERE id = ?', [id]);
};

export const markMemoryForDeletion = async (id: string): Promise<void> => {
  if (!db) return;
  await db.runAsync('UPDATE memories SET pending_delete = 1, synced = 0 WHERE id = ?', [id]);
};

export const deleteLocalMemory = async (id: string): Promise<void> => {
  if (!db) return;
  await db.runAsync('DELETE FROM memories WHERE id = ?', [id]);
};

export const getUnsyncedMemories = async (): Promise<LocalMemory[]> => {
  if (!db) return [];
  return db.getAllAsync<LocalMemory>('SELECT * FROM memories WHERE synced = 0');
};

export const markMemorySynced = async (id: string): Promise<void> => {
  if (!db) return;
  await db.runAsync('UPDATE memories SET synced = 1 WHERE id = ?', [id]);
};

// ============ Chat Message Operations ============

export const saveChatMessageLocally = async (message: LocalChatMessage): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, content, action_type, action_data, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.conversation_id || null,
      message.role,
      message.content,
      message.action_type || null,
      message.action_data || null,
      message.created_at,
      message.synced,
    ]
  );
};

export const getChatMessages = async (conversationId?: string, limit = 50): Promise<LocalChatMessage[]> => {
  if (!db) return [];
  if (conversationId) {
    return db.getAllAsync<LocalChatMessage>(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?',
      [conversationId, limit]
    );
  }
  return db.getAllAsync<LocalChatMessage>(
    'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
};

// ============ Mutation Queue Operations ============

export const addToMutationQueue = async (
  mutation: Omit<MutationQueueItem, 'id' | 'created_at' | 'retries' | 'status'>
): Promise<number> => {
  if (!db) return -1;
  const result = await db.runAsync(
    `INSERT INTO mutation_queue (type, endpoint, method, payload, headers, created_at, retries, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')`,
    [
      mutation.type,
      mutation.endpoint,
      mutation.method,
      mutation.payload || null,
      mutation.headers || null,
      new Date().toISOString(),
    ]
  );
  return result.lastInsertRowId;
};

export const getPendingMutations = async (): Promise<MutationQueueItem[]> => {
  if (!db) return [];
  return db.getAllAsync<MutationQueueItem>(
    `SELECT * FROM mutation_queue WHERE status = 'pending' ORDER BY created_at ASC`
  );
};

export const updateMutationStatus = async (
  id: number,
  status: MutationQueueItem['status'],
  error?: string
): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `UPDATE mutation_queue SET status = ?, last_error = ?, retries = retries + 1 WHERE id = ?`,
    [status, error || null, id]
  );
};

export const deleteMutation = async (id: number): Promise<void> => {
  if (!db) return;
  await db.runAsync('DELETE FROM mutation_queue WHERE id = ?', [id]);
};

export const clearCompletedMutations = async (): Promise<void> => {
  if (!db) return;
  await db.runAsync(`DELETE FROM mutation_queue WHERE status = 'completed'`);
};

// ============ Sync Metadata Operations ============

export const getSyncMetadata = async (key: string): Promise<string | null> => {
  if (!db) return null;
  const result = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_metadata WHERE key = ?',
    [key]
  );
  return result?.value || null;
};

export const setSyncMetadata = async (key: string, value: string): Promise<void> => {
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, value, new Date().toISOString()]
  );
};

// ============ Utility Operations ============

export const clearAllData = async (): Promise<void> => {
  if (!db) return;
  await db.execAsync(`
    DELETE FROM memories;
    DELETE FROM chat_messages;
    DELETE FROM mutation_queue;
    DELETE FROM sync_metadata WHERE key != 'schema_version';
  `);
  console.log('All local data cleared');
};

export const getDatabaseStats = async (): Promise<{
  memoriesCount: number;
  unsyncedCount: number;
  pendingMutations: number;
}> => {
  if (!db) return { memoriesCount: 0, unsyncedCount: 0, pendingMutations: 0 };

  const [memories, unsynced, mutations] = await Promise.all([
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM memories'),
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM memories WHERE synced = 0'),
    db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM mutation_queue WHERE status = 'pending'`),
  ]);

  return {
    memoriesCount: memories?.count || 0,
    unsyncedCount: unsynced?.count || 0,
    pendingMutations: mutations?.count || 0,
  };
};
