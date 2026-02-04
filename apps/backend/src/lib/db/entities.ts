/**
 * Entity Database Operations
 *
 * Operations for managing entities, relationships, and memory-entity links.
 * Supports knowledge graph construction and entity deduplication.
 */

import { nanoid } from 'nanoid';
import type {
  Entity,
  EntityRelationship,
  MemoryEntity,
  ExtractedEntity,
  ExtractedRelationship,
  EntityRole,
  DeduplicationResult,
} from '../entities/types';
import { EntityExtractor } from '../entities/extractor';

/**
 * Create or update an entity
 */
export async function upsertEntity(
  db: D1Database,
  entity: {
    user_id: string;
    container_tag: string;
    name: string;
    entity_type: string;
    attributes: Record<string, any>;
    importance_score?: number;
  }
): Promise<Entity> {
  const canonical_name = EntityExtractor.generateCanonicalName(entity.name);
  const now = new Date().toISOString();

  // Check if entity exists
  const existing = await db
    .prepare(
      'SELECT * FROM entities WHERE user_id = ? AND canonical_name = ? AND entity_type = ?'
    )
    .bind(entity.user_id, canonical_name, entity.entity_type)
    .first<Entity>();

  if (existing) {
    // Update existing entity
    await db
      .prepare(
        `UPDATE entities
         SET name = ?, attributes = ?, importance_score = ?, mention_count = mention_count + 1, last_mentioned = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        entity.name,
        JSON.stringify(entity.attributes),
        entity.importance_score || existing.importance_score,
        now,
        now,
        existing.id
      )
      .run();

    return {
      ...existing,
      name: entity.name,
      attributes: entity.attributes,
      mention_count: existing.mention_count + 1,
      last_mentioned: now,
      updated_at: now,
    };
  }

  // Create new entity
  const id = nanoid();
  await db
    .prepare(
      `INSERT INTO entities (id, user_id, container_tag, name, canonical_name, entity_type, attributes, importance_score, mention_count, created_at, updated_at, last_mentioned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      entity.user_id,
      entity.container_tag,
      entity.name,
      canonical_name,
      entity.entity_type,
      JSON.stringify(entity.attributes),
      entity.importance_score || 0.5,
      1, // Initial mention count
      now,
      now,
      now
    )
    .run();

  return {
    id,
    user_id: entity.user_id,
    container_tag: entity.container_tag,
    name: entity.name,
    canonical_name,
    entity_type: entity.entity_type,
    attributes: entity.attributes,
    importance_score: entity.importance_score || 0.5,
    mention_count: 1,
    created_at: now,
    updated_at: now,
    last_mentioned: now,
  };
}

/**
 * Get entity by ID
 * SECURITY: Always requires userId to prevent cross-tenant data access
 */
export async function getEntityById(
  db: D1Database,
  entityId: string,
  userId: string
): Promise<Entity | null> {
  const result = await db
    .prepare('SELECT * FROM entities WHERE id = ? AND user_id = ?')
    .bind(entityId, userId)
    .first<any>();

  if (!result) return null;

  return {
    ...result,
    attributes: JSON.parse(result.attributes || '{}'),
  };
}

/**
 * Find entities by canonical name (for deduplication)
 */
export async function findEntitiesByCanonicalName(
  db: D1Database,
  userId: string,
  canonicalName: string,
  entityType?: string
): Promise<Entity[]> {
  const query = entityType
    ? 'SELECT * FROM entities WHERE user_id = ? AND canonical_name = ? AND entity_type = ?'
    : 'SELECT * FROM entities WHERE user_id = ? AND canonical_name = ?';

  const bindings = entityType
    ? [userId, canonicalName, entityType]
    : [userId, canonicalName];

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<any>();

  return (result.results || []).map((e) => ({
    ...e,
    attributes: JSON.parse(e.attributes || '{}'),
  }));
}

/**
 * Get entities by user
 */
export async function getEntitiesByUser(
  db: D1Database,
  userId: string,
  options?: {
    entity_type?: string;
    container_tag?: string;
    limit?: number;
    offset?: number;
  }
): Promise<Entity[]> {
  let query = 'SELECT * FROM entities WHERE user_id = ?';
  const bindings: any[] = [userId];

  if (options?.entity_type) {
    query += ' AND entity_type = ?';
    bindings.push(options.entity_type);
  }

  if (options?.container_tag) {
    query += ' AND container_tag = ?';
    bindings.push(options.container_tag);
  }

  query += ' ORDER BY importance_score DESC, mention_count DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    bindings.push(options.limit);
  }

  if (options?.offset) {
    query += ' OFFSET ?';
    bindings.push(options.offset);
  }

  const result = await db.prepare(query).bind(...bindings).all<any>();

  return (result.results || []).map((e) => ({
    ...e,
    attributes: JSON.parse(e.attributes || '{}'),
  }));
}

/**
 * Create or update entity relationship
 */
export async function upsertEntityRelationship(
  db: D1Database,
  relationship: {
    user_id: string;
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    attributes?: Record<string, any>;
    source_memory_ids: string[];
    confidence?: number;
  }
): Promise<EntityRelationship> {
  const now = new Date().toISOString();

  // Check if relationship exists
  const existing = await db
    .prepare(
      `SELECT * FROM entity_relationships
       WHERE source_entity_id = ? AND target_entity_id = ? AND relationship_type = ? AND valid_to IS NULL`
    )
    .bind(
      relationship.source_entity_id,
      relationship.target_entity_id,
      relationship.relationship_type
    )
    .first<any>();

  if (existing) {
    // Update existing relationship
    const updatedMemoryIds = [
      ...new Set([
        ...JSON.parse(existing.source_memory_ids || '[]'),
        ...relationship.source_memory_ids,
      ]),
    ];

    await db
      .prepare(
        `UPDATE entity_relationships
         SET attributes = ?, source_memory_ids = ?, confidence = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        JSON.stringify(relationship.attributes || {}),
        JSON.stringify(updatedMemoryIds),
        relationship.confidence || existing.confidence,
        now,
        existing.id
      )
      .run();

    return {
      ...existing,
      attributes: relationship.attributes || JSON.parse(existing.attributes || '{}'),
      source_memory_ids: updatedMemoryIds,
      confidence: relationship.confidence || existing.confidence,
      updated_at: now,
    };
  }

  // Create new relationship
  const id = nanoid();
  await db
    .prepare(
      `INSERT INTO entity_relationships (id, user_id, source_entity_id, target_entity_id, relationship_type, attributes, valid_from, valid_to, source_memory_ids, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      relationship.user_id,
      relationship.source_entity_id,
      relationship.target_entity_id,
      relationship.relationship_type,
      JSON.stringify(relationship.attributes || {}),
      now,
      null, // valid_to - NULL means still valid
      JSON.stringify(relationship.source_memory_ids),
      relationship.confidence || 0.8,
      now,
      now
    )
    .run();

  return {
    id,
    user_id: relationship.user_id,
    source_entity_id: relationship.source_entity_id,
    target_entity_id: relationship.target_entity_id,
    relationship_type: relationship.relationship_type,
    attributes: relationship.attributes || {},
    valid_from: now,
    valid_to: null,
    source_memory_ids: relationship.source_memory_ids,
    confidence: relationship.confidence || 0.8,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get relationships for an entity
 */
export async function getEntityRelationships(
  db: D1Database,
  entityId: string,
  options?: {
    direction?: 'outgoing' | 'incoming' | 'both';
    relationship_type?: string;
    valid_at?: string; // Get relationships valid at specific time
  }
): Promise<EntityRelationship[]> {
  let query = '';
  const bindings: any[] = [];

  if (options?.direction === 'outgoing' || options?.direction === 'both' || !options?.direction) {
    query += 'SELECT * FROM entity_relationships WHERE source_entity_id = ?';
    bindings.push(entityId);
  }

  if (options?.direction === 'both') {
    query += ' UNION ';
  }

  if (options?.direction === 'incoming' || options?.direction === 'both') {
    if (!query) {
      query = 'SELECT * FROM entity_relationships WHERE target_entity_id = ?';
      bindings.push(entityId);
    } else {
      query += 'SELECT * FROM entity_relationships WHERE target_entity_id = ?';
      bindings.push(entityId);
    }
  }

  // Filter by relationship type
  if (options?.relationship_type) {
    // Append to both parts of UNION if applicable
    const typeFilter = ' AND relationship_type = ?';
    if (query.includes('UNION')) {
      const parts = query.split('UNION');
      query = parts[0] + typeFilter + ' UNION ' + parts[1] + typeFilter;
      bindings.splice(1, 0, options.relationship_type);
      bindings.push(options.relationship_type);
    } else {
      query += typeFilter;
      bindings.push(options.relationship_type);
    }
  }

  // Filter by temporal validity
  if (options?.valid_at) {
    const validFilter = ' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)';
    if (query.includes('UNION')) {
      const parts = query.split('UNION');
      query = parts[0] + validFilter + ' UNION ' + parts[1] + validFilter;
      bindings.splice(bindings.length / 2, 0, options.valid_at, options.valid_at);
      bindings.push(options.valid_at, options.valid_at);
    } else {
      query += validFilter;
      bindings.push(options.valid_at, options.valid_at);
    }
  } else {
    // Default: only current relationships
    const currentFilter = ' AND valid_to IS NULL';
    if (query.includes('UNION')) {
      const parts = query.split('UNION');
      query = parts[0] + currentFilter + ' UNION ' + parts[1] + currentFilter;
    } else {
      query += currentFilter;
    }
  }

  const result = await db.prepare(query).bind(...bindings).all<any>();

  return (result.results || []).map((r) => ({
    ...r,
    attributes: JSON.parse(r.attributes || '{}'),
    source_memory_ids: JSON.parse(r.source_memory_ids || '[]'),
  }));
}

/**
 * Link memory to entity
 */
export async function linkMemoryToEntity(
  db: D1Database,
  memoryId: string,
  entityId: string,
  role: EntityRole,
  confidence: number = 0.9
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO memory_entities (memory_id, entity_id, role, confidence)
       VALUES (?, ?, ?, ?)`
    )
    .bind(memoryId, entityId, role, confidence)
    .run();
}

/**
 * Get entities linked to a memory
 */
export async function getMemoryEntities(
  db: D1Database,
  memoryId: string
): Promise<Array<Entity & { role: EntityRole; confidence: number }>> {
  const result = await db
    .prepare(
      `SELECT e.*, me.role, me.confidence
       FROM entities e
       JOIN memory_entities me ON e.id = me.entity_id
       WHERE me.memory_id = ?
       ORDER BY me.confidence DESC`
    )
    .bind(memoryId)
    .all<any>();

  return (result.results || []).map((e) => ({
    ...e,
    attributes: JSON.parse(e.attributes || '{}'),
  }));
}

/**
 * Get memories linked to an entity
 */
export async function getEntityMemories(
  db: D1Database,
  entityId: string,
  limit: number = 50
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT memory_id FROM memory_entities
       WHERE entity_id = ?
       ORDER BY confidence DESC
       LIMIT ?`
    )
    .bind(entityId, limit)
    .all<{ memory_id: string }>();

  return (result.results || []).map((r) => r.memory_id);
}

/**
 * Update entity importance score
 */
export async function updateEntityImportance(
  db: D1Database,
  entityId: string,
  importanceScore: number
): Promise<void> {
  await db
    .prepare(
      'UPDATE entities SET importance_score = ?, updated_at = ? WHERE id = ?'
    )
    .bind(importanceScore, new Date().toISOString(), entityId)
    .run();
}

/**
 * Invalidate relationship (set valid_to)
 */
export async function invalidateRelationship(
  db: D1Database,
  relationshipId: string,
  validTo?: string
): Promise<void> {
  const validToDate = validTo || new Date().toISOString();
  await db
    .prepare(
      'UPDATE entity_relationships SET valid_to = ?, updated_at = ? WHERE id = ?'
    )
    .bind(validToDate, new Date().toISOString(), relationshipId)
    .run();
}

// ============================================================================
// BATCH OPERATIONS - Optimized for N+1 query prevention
// ============================================================================

/**
 * Get multiple entities by IDs in a single query
 * SECURITY: Always requires userId to prevent cross-tenant data access
 *
 * OPTIMIZATION: Single query instead of N queries
 */
export async function getEntitiesByIds(
  db: D1Database,
  entityIds: string[],
  userId: string
): Promise<Map<string, Entity>> {
  if (entityIds.length === 0) {
    return new Map();
  }

  // SQLite has a limit on number of placeholders, batch if needed
  const BATCH_SIZE = 100;
  const result = new Map<string, Entity>();

  for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
    const batch = entityIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    const queryResult = await db
      .prepare(
        `SELECT * FROM entities WHERE id IN (${placeholders}) AND user_id = ?`
      )
      .bind(...batch, userId)
      .all<any>();

    for (const row of queryResult.results || []) {
      result.set(row.id, {
        ...row,
        attributes: JSON.parse(row.attributes || '{}'),
      });
    }
  }

  return result;
}

/**
 * Find entities by multiple canonical names in a single query
 * SECURITY: Always requires userId to prevent cross-tenant data access
 *
 * OPTIMIZATION: Single query for deduplication lookup
 */
export async function findEntitiesByCanonicalNames(
  db: D1Database,
  userId: string,
  canonicalNames: string[]
): Promise<Map<string, Entity[]>> {
  if (canonicalNames.length === 0) {
    return new Map();
  }

  const BATCH_SIZE = 100;
  const result = new Map<string, Entity[]>();

  for (let i = 0; i < canonicalNames.length; i += BATCH_SIZE) {
    const batch = canonicalNames.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    const queryResult = await db
      .prepare(
        `SELECT * FROM entities WHERE user_id = ? AND canonical_name IN (${placeholders})`
      )
      .bind(userId, ...batch)
      .all<any>();

    for (const row of queryResult.results || []) {
      const entity: Entity = {
        ...row,
        attributes: JSON.parse(row.attributes || '{}'),
      };

      const existing = result.get(row.canonical_name) || [];
      existing.push(entity);
      result.set(row.canonical_name, existing);
    }
  }

  return result;
}

/**
 * Batch link memory to multiple entities
 *
 * OPTIMIZATION: Uses D1 batch for single round-trip
 */
export async function batchLinkMemoryToEntities(
  db: D1Database,
  memoryId: string,
  links: Array<{
    entityId: string;
    role: EntityRole;
    confidence: number;
  }>
): Promise<void> {
  if (links.length === 0) {
    return;
  }

  // Use D1 batch for atomic operation
  const statements = links.map((link) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO memory_entities (memory_id, entity_id, role, confidence)
         VALUES (?, ?, ?, ?)`
      )
      .bind(memoryId, link.entityId, link.role, link.confidence)
  );

  await db.batch(statements);
}

/**
 * Batch upsert entities
 *
 * OPTIMIZATION: Single batch operation for multiple entities
 * Returns a map of entity name -> entity for linking
 */
export async function batchUpsertEntities(
  db: D1Database,
  userId: string,
  containerTag: string,
  entities: Array<{
    name: string;
    entityType: string;
    attributes: Record<string, any>;
    importanceScore: number;
  }>
): Promise<Map<string, Entity>> {
  if (entities.length === 0) {
    return new Map();
  }

  const now = new Date().toISOString();
  const result = new Map<string, Entity>();

  // First, find all existing entities by canonical name
  const canonicalNames = entities.map((e) =>
    EntityExtractor.generateCanonicalName(e.name)
  );
  const existingMap = await findEntitiesByCanonicalNames(db, userId, canonicalNames);

  // Separate into updates and inserts
  const updates: D1PreparedStatement[] = [];
  const inserts: D1PreparedStatement[] = [];
  const entityMap = new Map<string, Entity>();

  for (const entity of entities) {
    const canonicalName = EntityExtractor.generateCanonicalName(entity.name);
    const existingList = existingMap.get(canonicalName) || [];
    const existing = existingList.find((e) => e.entity_type === entity.entityType);

    if (existing) {
      // Update existing
      updates.push(
        db
          .prepare(
            `UPDATE entities
             SET name = ?, attributes = ?, importance_score = ?, mention_count = mention_count + 1, last_mentioned = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            entity.name,
            JSON.stringify(entity.attributes),
            Math.max(entity.importanceScore, existing.importance_score),
            now,
            now,
            existing.id
          )
      );

      const updated: Entity = {
        ...existing,
        name: entity.name,
        attributes: entity.attributes,
        importance_score: Math.max(entity.importanceScore, existing.importance_score),
        mention_count: existing.mention_count + 1,
        last_mentioned: now,
        updated_at: now,
      };
      entityMap.set(entity.name, updated);
      result.set(entity.name, updated);
    } else {
      // Insert new
      const id = nanoid();
      inserts.push(
        db
          .prepare(
            `INSERT INTO entities (id, user_id, container_tag, name, canonical_name, entity_type, attributes, importance_score, mention_count, created_at, updated_at, last_mentioned)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            userId,
            containerTag,
            entity.name,
            canonicalName,
            entity.entityType,
            JSON.stringify(entity.attributes),
            entity.importanceScore,
            1,
            now,
            now,
            now
          )
      );

      const newEntity: Entity = {
        id,
        user_id: userId,
        container_tag: containerTag,
        name: entity.name,
        canonical_name: canonicalName,
        entity_type: entity.entityType,
        attributes: entity.attributes,
        importance_score: entity.importanceScore,
        mention_count: 1,
        created_at: now,
        updated_at: now,
        last_mentioned: now,
      };
      entityMap.set(entity.name, newEntity);
      result.set(entity.name, newEntity);
    }
  }

  // Execute batch operations
  const allStatements = [...updates, ...inserts];
  if (allStatements.length > 0) {
    await db.batch(allStatements);
  }

  return result;
}

/**
 * Batch upsert relationships
 *
 * OPTIMIZATION: Single batch operation for multiple relationships
 */
export async function batchUpsertRelationships(
  db: D1Database,
  userId: string,
  memoryId: string,
  relationships: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    relationshipType: string;
    attributes?: Record<string, any>;
    confidence?: number;
  }>
): Promise<void> {
  if (relationships.length === 0) {
    return;
  }

  const now = new Date().toISOString();

  // First, find existing relationships
  const checks = relationships.map((r) =>
    `(source_entity_id = '${r.sourceEntityId}' AND target_entity_id = '${r.targetEntityId}' AND relationship_type = '${r.relationshipType}')`
  );

  const existingResult = await db
    .prepare(
      `SELECT id, source_entity_id, target_entity_id, relationship_type, source_memory_ids
       FROM entity_relationships
       WHERE (${checks.join(' OR ')}) AND valid_to IS NULL`
    )
    .all<any>();

  const existingMap = new Map<string, any>();
  for (const row of existingResult.results || []) {
    const key = `${row.source_entity_id}:${row.target_entity_id}:${row.relationship_type}`;
    existingMap.set(key, row);
  }

  // Build batch statements
  const statements: D1PreparedStatement[] = [];

  for (const rel of relationships) {
    const key = `${rel.sourceEntityId}:${rel.targetEntityId}:${rel.relationshipType}`;
    const existing = existingMap.get(key);

    if (existing) {
      // Update existing
      const updatedMemoryIds = [
        ...new Set([...JSON.parse(existing.source_memory_ids || '[]'), memoryId]),
      ];

      statements.push(
        db
          .prepare(
            `UPDATE entity_relationships
             SET attributes = ?, source_memory_ids = ?, confidence = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            JSON.stringify(rel.attributes || {}),
            JSON.stringify(updatedMemoryIds),
            rel.confidence || 0.8,
            now,
            existing.id
          )
      );
    } else {
      // Insert new
      const id = nanoid();
      statements.push(
        db
          .prepare(
            `INSERT INTO entity_relationships (id, user_id, source_entity_id, target_entity_id, relationship_type, attributes, valid_from, valid_to, source_memory_ids, confidence, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            userId,
            rel.sourceEntityId,
            rel.targetEntityId,
            rel.relationshipType,
            JSON.stringify(rel.attributes || {}),
            now,
            null,
            JSON.stringify([memoryId]),
            rel.confidence || 0.8,
            now,
            now
          )
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}
