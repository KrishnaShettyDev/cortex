/**
 * Memory Database Operations
 *
 * Implements Supermemory-style memory management:
 * - Versioning (updates create new versions)
 * - Relationships (updates, extends, derives)
 * - Soft delete (forgotten memories)
 * - Container scoping (multi-tenancy)
 */

import { nanoid } from 'nanoid';

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  source: string;
  version: number;
  is_latest: 1 | 0;
  parent_memory_id: string | null;
  root_memory_id: string | null;
  container_tag: string;
  processing_status: 'queued' | 'embedding' | 'extracting' | 'indexing' | 'done' | 'failed';
  processing_error: string | null;
  is_forgotten: 0 | 1;
  forget_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryRelation {
  id: string;
  from_memory_id: string;
  to_memory_id: string;
  relation_type: 'updates' | 'extends' | 'derives';
  created_at: string;
}

export interface CreateMemoryOptions {
  userId: string;
  content: string;
  source?: string;
  containerTag?: string;
  metadata?: {
    entities?: string[];
    location?: { lat: number; lon: number; name: string };
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

export interface UpdateMemoryOptions {
  memoryId: string;
  newContent: string;
  relationType: 'updates' | 'extends';
}

/**
 * Create a new memory
 */
export async function createMemory(
  db: D1Database,
  options: CreateMemoryOptions
): Promise<Memory> {
  const id = nanoid();
  const now = new Date().toISOString();

  const memory: Memory = {
    id,
    user_id: options.userId,
    content: options.content,
    source: options.source || 'manual',
    version: 1,
    is_latest: 1,
    parent_memory_id: null,
    root_memory_id: null,
    container_tag: options.containerTag || 'default',
    processing_status: 'queued',
    processing_error: null,
    is_forgotten: 0,
    forget_after: null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO memories (id, user_id, content, source, version, is_latest, parent_memory_id, root_memory_id, container_tag, processing_status, processing_error, is_forgotten, forget_after, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      memory.id,
      memory.user_id,
      memory.content,
      memory.source,
      memory.version,
      memory.is_latest,
      memory.parent_memory_id,
      memory.root_memory_id,
      memory.container_tag,
      memory.processing_status,
      memory.processing_error,
      memory.is_forgotten,
      memory.forget_after,
      memory.created_at,
      memory.updated_at
    )
    .run();

  // Add metadata if provided
  if (options.metadata) {
    await db
      .prepare(
        `INSERT INTO memory_metadata (memory_id, entities, location_lat, location_lon, location_name, people, tags, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        options.metadata.entities ? JSON.stringify(options.metadata.entities) : null,
        options.metadata.location?.lat || null,
        options.metadata.location?.lon || null,
        options.metadata.location?.name || null,
        options.metadata.people ? JSON.stringify(options.metadata.people) : null,
        options.metadata.tags ? JSON.stringify(options.metadata.tags) : null,
        options.metadata.timestamp || null
      )
      .run();
  }

  return memory;
}

/**
 * Update an existing memory (creates new version)
 */
export async function updateMemory(
  db: D1Database,
  options: UpdateMemoryOptions
): Promise<Memory> {
  // Get the current memory
  const current = await db
    .prepare('SELECT * FROM memories WHERE id = ? AND is_latest = 1')
    .bind(options.memoryId)
    .first<Memory>();

  if (!current) {
    throw new Error('Memory not found or not latest version');
  }

  const now = new Date().toISOString();
  const newId = nanoid();
  const rootId = current.root_memory_id || current.id;

  // Create new version
  const newVersion: Memory = {
    id: newId,
    user_id: current.user_id,
    content: options.newContent,
    source: current.source,
    version: current.version + 1,
    is_latest: 1,
    parent_memory_id: current.id,
    root_memory_id: rootId,
    container_tag: current.container_tag,
    is_forgotten: 0,
    forget_after: null,
    created_at: now,
    updated_at: now,
  };

  // Start transaction: mark old as not latest, insert new version, create relation
  await db.batch([
    db
      .prepare('UPDATE memories SET is_latest = 0, updated_at = ? WHERE id = ?')
      .bind(now, current.id),
    db
      .prepare(
        `INSERT INTO memories (id, user_id, content, source, version, is_latest, parent_memory_id, root_memory_id, container_tag, is_forgotten, forget_after, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newVersion.id,
        newVersion.user_id,
        newVersion.content,
        newVersion.source,
        newVersion.version,
        newVersion.is_latest,
        newVersion.parent_memory_id,
        newVersion.root_memory_id,
        newVersion.container_tag,
        newVersion.is_forgotten,
        newVersion.forget_after,
        newVersion.created_at,
        newVersion.updated_at
      ),
    db
      .prepare(
        `INSERT INTO memory_relations (id, from_memory_id, to_memory_id, relation_type, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(nanoid(), newId, current.id, options.relationType, now),
  ]);

  return newVersion;
}

/**
 * Get latest memories for a user
 */
export async function getLatestMemories(
  db: D1Database,
  userId: string,
  options?: {
    containerTag?: string;
    limit?: number;
    offset?: number;
  }
): Promise<Memory[]> {
  let query = `SELECT * FROM memories WHERE user_id = ? AND is_latest = 1 AND is_forgotten = 0`;
  const params: any[] = [userId];

  if (options?.containerTag) {
    query += ` AND container_tag = ?`;
    params.push(options.containerTag);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(options?.limit || 50, options?.offset || 0);

  const result = await db.prepare(query).bind(...params).all<Memory>();
  return result.results || [];
}

/**
 * Get memory by ID
 */
export async function getMemoryById(
  db: D1Database,
  memoryId: string
): Promise<Memory | null> {
  const result = await db
    .prepare('SELECT * FROM memories WHERE id = ?')
    .bind(memoryId)
    .first<Memory>();

  return result;
}

/**
 * Get memory version history
 */
export async function getMemoryHistory(
  db: D1Database,
  memoryId: string
): Promise<Memory[]> {
  // Get root ID
  const memory = await getMemoryById(db, memoryId);
  if (!memory) return [];

  const rootId = memory.root_memory_id || memory.id;

  // Get all versions in chain
  const result = await db
    .prepare(
      'SELECT * FROM memories WHERE id = ? OR root_memory_id = ? ORDER BY version DESC'
    )
    .bind(rootId, rootId)
    .all<Memory>();

  return result.results || [];
}

/**
 * Soft delete (forget) a memory
 */
export async function forgetMemory(
  db: D1Database,
  memoryId: string
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare('UPDATE memories SET is_forgotten = 1, updated_at = ? WHERE id = ?')
    .bind(now, memoryId)
    .run();
}

/**
 * Search memories by content (simple text search, vector search in separate module)
 */
export async function searchMemories(
  db: D1Database,
  userId: string,
  query: string,
  options?: {
    containerTag?: string;
    limit?: number;
  }
): Promise<Memory[]> {
  let sql = `
    SELECT * FROM memories
    WHERE user_id = ?
      AND is_latest = 1
      AND is_forgotten = 0
      AND content LIKE ?
  `;
  const params: any[] = [userId, `%${query}%`];

  if (options?.containerTag) {
    sql += ` AND container_tag = ?`;
    params.push(options.containerTag);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(options?.limit || 20);

  const result = await db.prepare(sql).bind(...params).all<Memory>();
  return result.results || [];
}

/**
 * Get memory relationships
 */
export async function getMemoryRelations(
  db: D1Database,
  memoryId: string
): Promise<MemoryRelation[]> {
  const result = await db
    .prepare(
      `SELECT * FROM memory_relations
       WHERE from_memory_id = ? OR to_memory_id = ?`
    )
    .bind(memoryId, memoryId)
    .all<MemoryRelation>();

  return result.results || [];
}

/**
 * Create a relationship between two memories
 */
export async function createMemoryRelation(
  db: D1Database,
  fromMemoryId: string,
  toMemoryId: string,
  relationType: 'updates' | 'extends' | 'derives'
): Promise<MemoryRelation> {
  const id = nanoid();
  const now = new Date().toISOString();

  const relation: MemoryRelation = {
    id,
    from_memory_id: fromMemoryId,
    to_memory_id: toMemoryId,
    relation_type: relationType,
    created_at: now,
  };

  await db
    .prepare(
      `INSERT INTO memory_relations (id, from_memory_id, to_memory_id, relation_type, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, fromMemoryId, toMemoryId, relationType, now)
    .run();

  return relation;
}
