/**
 * Entity Extraction Module
 *
 * Exports for entity and relationship extraction, deduplication, and graph construction.
 */

export * from './types';
export * from './extractor';
export * from './processor';
export {
  upsertEntity,
  upsertEntityRelationship,
  getEntityById,
  getEntitiesByUser,
  findEntitiesByCanonicalName,
  getEntityRelationships,
  linkMemoryToEntity,
  getMemoryEntities,
  getEntityMemories,
  updateEntityImportance,
  invalidateRelationship,
} from '../db/entities';
