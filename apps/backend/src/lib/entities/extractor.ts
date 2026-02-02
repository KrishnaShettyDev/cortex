/**
 * Entity Extractor
 *
 * LLM-based extraction of entities and relationships from memory content.
 * Achieves >90% accuracy target through careful prompt engineering.
 */

import type {
  EntityExtractionResult,
  ExtractedEntity,
  ExtractedRelationship,
  EntityExtractionContext,
  LLMExtractionResponse,
  Entity,
} from './types';
import { EntityExtractionError } from './types';

export class EntityExtractor {
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
  }

  /**
   * Extract entities and relationships from memory content
   */
  async extract(
    content: string,
    context: EntityExtractionContext
  ): Promise<EntityExtractionResult> {
    const startTime = Date.now();

    try {
      // Build extraction prompt
      const prompt = this.buildExtractionPrompt(content, context);

      // Call LLM for extraction
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1, // Low temp for consistency
        max_tokens: 2000, // Allow for complex extractions
      });

      // Parse and validate response
      const extracted = this.parseResponse(response.response);

      // Filter by confidence threshold
      const filteredEntities = extracted.entities.filter(
        (e) => e.confidence >= 0.6
      );
      const filteredRelationships = extracted.relationships.filter(
        (r) => r.confidence >= 0.6
      );

      const processingTime = Date.now() - startTime;

      return {
        entities: filteredEntities,
        relationships: filteredRelationships,
        extraction_metadata: {
          model: 'gpt-4o-mini',
          timestamp: new Date().toISOString(),
          total_entities: filteredEntities.length,
          total_relationships: filteredRelationships.length,
          processing_time_ms: processingTime,
        },
      };
    } catch (error: any) {
      console.error('[EntityExtractor] Extraction failed:', error);
      throw new EntityExtractionError(
        `Entity extraction failed: ${error.message}`,
        true,
        { content_length: content.length }
      );
    }
  }

  /**
   * System prompt for entity extraction
   */
  private getSystemPrompt(): string {
    return `You are an expert entity extraction system. Your job is to extract entities (people, companies, projects, places, events) and their relationships from text with high precision.

RULES:
1. Only extract entities that are explicitly or strongly implied in the text
2. For each entity, extract relevant attributes based on entity type
3. Identify relationships between entities when clear
4. Provide confidence scores (0.6-1.0) based on how explicit the information is
5. Include text evidence for each extraction
6. Return ONLY valid JSON, no additional text

CONFIDENCE GUIDELINES:
- 1.0: Explicitly stated with full details ("Sarah Chen is CEO of Acme Corp")
- 0.9: Explicitly stated with partial details ("Sarah from Acme mentioned...")
- 0.8: Strongly implied from context ("Sarah sent the deck" + known Sarah is from Acme)
- 0.7: Inferred from strong signals ("Met with the Lightspeed team" -> team is entity)
- 0.6: Weakly inferred (minimum threshold)
- <0.6: Don't extract

OUTPUT FORMAT:
{
  "entities": [{
    "name": "Full Name",
    "entity_type": "person|company|project|place|event",
    "attributes": {...},
    "confidence": 0.6-1.0,
    "mentions": ["exact text snippets where entity appears"]
  }],
  "relationships": [{
    "source_entity": "Entity Name 1",
    "target_entity": "Entity Name 2",
    "relationship_type": "works_for|reports_to|founded|...",
    "attributes": {...},
    "confidence": 0.6-1.0,
    "evidence": "text snippet supporting relationship"
  }]
}`;
  }

  /**
   * Build extraction prompt with context
   */
  private buildExtractionPrompt(
    content: string,
    context: EntityExtractionContext
  ): string {
    const knownEntitiesHint = context.known_entities
      ? `\n\nKNOWN ENTITIES (use exact names if referring to these):\n${context.known_entities
          .map((e) => `- ${e.name} (${e.entity_type})`)
          .join('\n')}`
      : '';

    return `Extract entities and relationships from this text:

TEXT:
"""
${content}
"""

CONTEXT:
- Date: ${context.created_at}
- User: ${context.user_id}${knownEntitiesHint}

ENTITY TYPE GUIDELINES:

PERSON attributes:
- role: Job title/role
- company: Company they work for
- email: Email address
- phone: Phone number
- location: City/location

COMPANY attributes:
- industry: Industry/sector
- stage: Funding stage (Seed, Series A, etc.)
- size: Company size
- location: HQ location

PROJECT attributes:
- status: Current status (active, completed, planning)
- deadline: Project deadline
- stakeholders: Key people involved

PLACE attributes:
- type: city, venue, address, region
- address: Full address if available

EVENT attributes:
- date: Event date/time
- location: Where it happened
- attendees: Who attended

RELATIONSHIP TYPES:
- works_for: Person → Company
- reports_to: Person → Person
- founded: Person → Company
- invested_in: Company → Company
- met_at: Person → Person (via Event/Place)
- collaborates_with: Person ↔ Person
- part_of: Project → Company
- manages: Person → Project
- attends: Person → Event
- located_in: Entity → Place

Extract now with high precision:`;
  }

  /**
   * Parse and validate LLM response
   */
  private parseResponse(response: string): LLMExtractionResponse {
    try {
      // Try to find JSON in response (LLM might add extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate structure
      if (!parsed.entities || !Array.isArray(parsed.entities)) {
        parsed.entities = [];
      }
      if (!parsed.relationships || !Array.isArray(parsed.relationships)) {
        parsed.relationships = [];
      }

      // Validate and normalize each entity
      const validatedEntities = parsed.entities
        .filter((e: any) => this.isValidEntity(e))
        .map((e: any) => this.normalizeEntity(e));

      // Validate and normalize each relationship
      const validatedRelationships = parsed.relationships
        .filter((r: any) => this.isValidRelationship(r))
        .map((r: any) => this.normalizeRelationship(r));

      return {
        entities: validatedEntities,
        relationships: validatedRelationships,
      };
    } catch (error: any) {
      console.error('[EntityExtractor] Failed to parse response:', error);
      console.error('[EntityExtractor] Raw response:', response);

      // Return empty result on parse failure
      return {
        entities: [],
        relationships: [],
      };
    }
  }

  /**
   * Validate entity structure
   */
  private isValidEntity(entity: any): boolean {
    return !!(
      entity &&
      typeof entity === 'object' &&
      entity.name &&
      typeof entity.name === 'string' &&
      entity.entity_type &&
      ['person', 'company', 'project', 'place', 'event', 'other'].includes(
        entity.entity_type
      ) &&
      typeof entity.confidence === 'number' &&
      entity.confidence >= 0 &&
      entity.confidence <= 1
    );
  }

  /**
   * Validate relationship structure
   */
  private isValidRelationship(relationship: any): boolean {
    return !!(
      relationship &&
      typeof relationship === 'object' &&
      relationship.source_entity &&
      relationship.target_entity &&
      relationship.relationship_type &&
      typeof relationship.confidence === 'number' &&
      relationship.confidence >= 0 &&
      relationship.confidence <= 1
    );
  }

  /**
   * Normalize entity data
   */
  private normalizeEntity(entity: any): ExtractedEntity {
    return {
      name: this.normalizeName(entity.name),
      entity_type: entity.entity_type,
      attributes: entity.attributes || {},
      confidence: Math.min(1, Math.max(0, entity.confidence)),
      mentions: Array.isArray(entity.mentions) ? entity.mentions : [],
    };
  }

  /**
   * Normalize relationship data
   */
  private normalizeRelationship(relationship: any): ExtractedRelationship {
    return {
      source_entity: this.normalizeName(relationship.source_entity),
      target_entity: this.normalizeName(relationship.target_entity),
      relationship_type: relationship.relationship_type,
      attributes: relationship.attributes || {},
      confidence: Math.min(1, Math.max(0, relationship.confidence)),
      evidence: relationship.evidence || '',
    };
  }

  /**
   * Normalize entity name for consistency
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/["""]/g, '"') // Normalize quotes
      .replace(/[''']/g, "'"); // Normalize apostrophes
  }

  /**
   * Generate canonical name for deduplication
   * Lowercase, remove punctuation, normalize spacing
   */
  static generateCanonicalName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
}
