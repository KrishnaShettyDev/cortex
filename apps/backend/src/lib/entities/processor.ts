/**
 * Entity Processing Service
 *
 * Orchestrates entity extraction, deduplication, and storage.
 * Integrates with the memory processing pipeline.
 *
 * OPTIMIZED: Uses KV cache for fast entity lookup
 */

import { EntityExtractor } from './extractor';
import { EntityDeduplicator } from './deduplicator';
import type {
  EntityExtractionContext,
  EntityExtractionResult,
  ExtractedEntity,
  ExtractedRelationship,
} from './types';
import {
  upsertEntity,
  upsertEntityRelationship,
  linkMemoryToEntity,
  getEntitiesByUser,
  getEntityById,
} from '../db/entities';
import {
  getCachedEntities,
  updateEntityCache,
  type CachedEntity,
} from '../cache';

export class EntityProcessor {
  private extractor: EntityExtractor;
  private deduplicator: EntityDeduplicator;
  private db: D1Database;
  private ai: any;
  private cache?: KVNamespace;

  constructor(ai: any, db: D1Database, cache?: KVNamespace) {
    this.extractor = new EntityExtractor(ai);
    this.deduplicator = new EntityDeduplicator(db, ai);
    this.db = db;
    this.ai = ai;
    this.cache = cache;
  }

  /**
   * Process a memory for entity extraction
   *
   * OPTIMIZED FLOW:
   * 1. Try to get entities from KV cache first (fast)
   * 2. Fall back to DB query if cache miss
   * 3. Update cache with new entities after processing
   */
  async processMemory(
    memoryId: string,
    userId: string,
    containerTag: string,
    content: string,
    createdAt: string
  ): Promise<EntityExtractionResult> {
    console.log(`[EntityProcessor] Processing memory ${memoryId} for entities`);

    // STEP 1: Try cache first for known entities
    let knownEntities: any[] = [];
    let cacheHit = false;

    if (this.cache) {
      try {
        const cached = await getCachedEntities(this.cache, userId, containerTag);
        if (cached && cached.length > 0) {
          knownEntities = cached;
          cacheHit = true;
          console.log(`[EntityProcessor] Cache HIT: ${cached.length} entities`);
        }
      } catch (e) {
        console.warn('[EntityProcessor] Cache read failed, falling back to DB');
      }
    }

    // STEP 2: Fall back to DB query if cache miss
    if (!cacheHit) {
      console.log('[EntityProcessor] Cache MISS, querying DB');
      knownEntities = await getEntitiesByUser(this.db, userId, {
        container_tag: containerTag,
        limit: 100, // Top 100 most important entities
      });

      // Populate cache for next time (non-blocking)
      if (this.cache && knownEntities.length > 0) {
        updateEntityCache(this.cache, userId, containerTag, knownEntities.map(e => ({
          id: e.id,
          name: e.name,
          canonical_name: e.canonical_name || e.name.toLowerCase(),
          entity_type: e.entity_type,
          attributes: e.attributes || {},
          importance_score: e.importance_score || 0.5,
        }))).catch(err => console.warn('[EntityProcessor] Cache update failed:', err));
      }
    }

    // Build extraction context
    const context: EntityExtractionContext = {
      user_id: userId,
      container_tag: containerTag,
      memory_id: memoryId,
      created_at: createdAt,
      known_entities: knownEntities,
    };

    // Extract entities and relationships
    const extractionResult = await this.extractor.extract(content, context);

    console.log(
      `[EntityProcessor] Extracted ${extractionResult.entities.length} entities, ${extractionResult.relationships.length} relationships`
    );

    // Store entities and create links
    await this.storeExtractionResult(
      memoryId,
      userId,
      containerTag,
      extractionResult
    );

    return extractionResult;
  }

  /**
   * Store extraction result in database
   */
  private async storeExtractionResult(
    memoryId: string,
    userId: string,
    containerTag: string,
    result: EntityExtractionResult
  ): Promise<void> {
    // Map to store entity names to IDs
    const entityNameToId = new Map<string, string>();

    // 1. Store all entities (with deduplication)
    for (const extracted of result.entities) {
      try {
        // Check for duplicates
        const deduplicationResult = await this.deduplicator.findMatch(
          extracted,
          userId,
          containerTag
        );

        let entity;
        if (deduplicationResult.should_merge && deduplicationResult.matched_entity_id) {
          // Use existing entity
          console.log(
            `[EntityProcessor] Deduplicated: ${extracted.name} -> ${deduplicationResult.matched_entity_id} (${deduplicationResult.match_type}, confidence: ${deduplicationResult.confidence})`
          );
          entity = await getEntityById(this.db, deduplicationResult.matched_entity_id);
          if (!entity) {
            throw new Error(`Matched entity ${deduplicationResult.matched_entity_id} not found`);
          }

          // Update entity attributes if new information
          entity = await upsertEntity(this.db, {
            user_id: userId,
            container_tag: containerTag,
            name: extracted.name, // Keep latest name variant
            entity_type: extracted.entity_type,
            attributes: { ...entity.attributes, ...extracted.attributes }, // Merge attributes
            importance_score: Math.max(
              entity.importance_score,
              this.calculateImportanceScore(extracted)
            ),
          });
        } else {
          // Create new entity
          entity = await upsertEntity(this.db, {
            user_id: userId,
            container_tag: containerTag,
            name: extracted.name,
            entity_type: extracted.entity_type,
            attributes: extracted.attributes,
            importance_score: this.calculateImportanceScore(extracted),
          });
          console.log(
            `[EntityProcessor] Created new entity: ${extracted.name} (${extracted.entity_type})`
          );
        }

        entityNameToId.set(extracted.name, entity.id);

        // Link memory to entity
        const role = this.determineEntityRole(extracted, result);
        await linkMemoryToEntity(
          this.db,
          memoryId,
          entity.id,
          role,
          extracted.confidence
        );

        console.log(
          `[EntityProcessor] Stored entity: ${extracted.name} (${extracted.entity_type}) [${entity.id}]`
        );
      } catch (error) {
        console.error(
          `[EntityProcessor] Failed to store entity ${extracted.name}:`,
          error
        );
      }
    }

    // 2. Store all relationships
    for (const relationship of result.relationships) {
      try {
        const sourceId = entityNameToId.get(relationship.source_entity);
        const targetId = entityNameToId.get(relationship.target_entity);

        if (!sourceId || !targetId) {
          console.warn(
            `[EntityProcessor] Skipping relationship: entity not found (${relationship.source_entity} -> ${relationship.target_entity})`
          );
          continue;
        }

        await upsertEntityRelationship(this.db, {
          user_id: userId,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          relationship_type: relationship.relationship_type,
          attributes: relationship.attributes,
          source_memory_ids: [memoryId],
          confidence: relationship.confidence,
        });

        console.log(
          `[EntityProcessor] Stored relationship: ${relationship.source_entity} -[${relationship.relationship_type}]-> ${relationship.target_entity}`
        );
      } catch (error) {
        console.error(
          `[EntityProcessor] Failed to store relationship ${relationship.source_entity} -> ${relationship.target_entity}:`,
          error
        );
      }
    }
  }

  /**
   * Calculate importance score for entity
   */
  private calculateImportanceScore(entity: ExtractedEntity): number {
    let score = 0.5; // Base score

    // Boost by confidence
    score += entity.confidence * 0.2;

    // Boost if has rich attributes
    const attrCount = Object.keys(entity.attributes).length;
    score += Math.min(attrCount * 0.05, 0.2);

    // Boost by entity type (people and companies are usually more important)
    if (entity.entity_type === 'person' || entity.entity_type === 'company') {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  /**
   * Determine entity's role in memory
   */
  private determineEntityRole(
    entity: ExtractedEntity,
    result: EntityExtractionResult
  ): 'subject' | 'object' | 'mentioned' | 'context' {
    // If entity is source of many relationships, likely subject
    const outgoingRels = result.relationships.filter(
      (r) => r.source_entity === entity.name
    );
    const incomingRels = result.relationships.filter(
      (r) => r.target_entity === entity.name
    );

    if (outgoingRels.length > incomingRels.length) {
      return 'subject';
    }

    if (incomingRels.length > outgoingRels.length) {
      return 'object';
    }

    // If high confidence and mentioned multiple times
    if (entity.confidence > 0.8 && entity.mentions.length > 1) {
      return 'mentioned';
    }

    // Default to context
    return 'context';
  }
}

/**
 * Helper function to process memory entities
 */
export async function processMemoryEntities(
  env: { AI: any; DB: D1Database; CACHE?: KVNamespace },
  memoryId: string,
  userId: string,
  containerTag: string,
  content: string,
  createdAt: string
): Promise<EntityExtractionResult> {
  const processor = new EntityProcessor(env.AI, env.DB, env.CACHE);
  return processor.processMemory(
    memoryId,
    userId,
    containerTag,
    content,
    createdAt
  );
}
