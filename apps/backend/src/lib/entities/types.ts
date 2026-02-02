/**
 * Entity Extraction Types
 *
 * Types for entity and relationship extraction from memory content.
 * Supports people, companies, projects, places, events with flexible attributes.
 */

export type EntityType = 'person' | 'company' | 'project' | 'place' | 'event' | 'other';

export type RelationshipType =
  | 'works_for'
  | 'reports_to'
  | 'founded'
  | 'invested_in'
  | 'met_at'
  | 'collaborates_with'
  | 'part_of'
  | 'manages'
  | 'attends'
  | 'located_in'
  | 'owns';

export type EntityRole = 'subject' | 'object' | 'mentioned' | 'context';

/**
 * Extracted entity from LLM
 */
export interface ExtractedEntity {
  name: string;
  entity_type: EntityType;
  attributes: Record<string, any>;
  confidence: number;
  mentions: string[]; // Text snippets where entity was mentioned
}

/**
 * Extracted relationship between entities
 */
export interface ExtractedRelationship {
  source_entity: string; // Entity name
  target_entity: string; // Entity name
  relationship_type: RelationshipType;
  attributes: Record<string, any>;
  confidence: number;
  evidence: string; // Text snippet supporting this relationship
}

/**
 * Result of entity extraction
 */
export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  extraction_metadata: {
    model: string;
    timestamp: string;
    total_entities: number;
    total_relationships: number;
    processing_time_ms: number;
  };
}

/**
 * Stored entity in database
 */
export interface Entity {
  id: string;
  user_id: string;
  container_tag: string;
  name: string;
  canonical_name: string; // Normalized for deduplication
  entity_type: EntityType;
  attributes: Record<string, any>;
  importance_score: number;
  mention_count: number;
  created_at: string;
  updated_at: string;
  last_mentioned: string | null;
}

/**
 * Stored relationship in database
 */
export interface EntityRelationship {
  id: string;
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: RelationshipType;
  attributes: Record<string, any>;
  valid_from: string;
  valid_to: string | null;
  source_memory_ids: string[]; // Array of memory IDs supporting this relationship
  confidence: number;
  created_at: string;
  updated_at: string;
}

/**
 * Memory-entity link
 */
export interface MemoryEntity {
  memory_id: string;
  entity_id: string;
  role: EntityRole;
  confidence: number;
}

/**
 * Entity extraction context
 */
export interface EntityExtractionContext {
  user_id: string;
  container_tag: string;
  memory_id: string;
  created_at: string;
  known_entities?: Entity[]; // For disambiguation
}

/**
 * LLM extraction prompt response schema
 */
export interface LLMExtractionResponse {
  entities: Array<{
    name: string;
    entity_type: EntityType;
    attributes: Record<string, any>;
    confidence: number;
    mentions: string[];
  }>;
  relationships: Array<{
    source_entity: string;
    target_entity: string;
    relationship_type: RelationshipType;
    attributes: Record<string, any>;
    confidence: number;
    evidence: string;
  }>;
}

/**
 * Entity deduplication result
 */
export interface DeduplicationResult {
  matched_entity_id: string | null;
  match_type: 'exact' | 'fuzzy' | 'embedding' | 'llm' | 'none';
  confidence: number;
  should_merge: boolean;
}

/**
 * Error types
 */
export class EntityExtractionError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'EntityExtractionError';
  }
}

export class EntityDeduplicationError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'EntityDeduplicationError';
  }
}
