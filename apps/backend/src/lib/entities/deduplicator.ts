/**
 * Entity Deduplicator
 *
 * Multi-strategy deduplication for entity matching:
 * 1. Exact match on canonical name
 * 2. Fuzzy string matching (Levenshtein distance)
 * 3. Embedding similarity for semantic matching
 * 4. LLM verification for ambiguous cases
 */

import type {
  Entity,
  ExtractedEntity,
  DeduplicationResult,
} from './types';
import { EntityExtractionError } from './types';
import { EntityExtractor } from './extractor';
import { findEntitiesByCanonicalName, getEntitiesByUser } from '../db/entities';
import { generateEmbedding } from '../vectorize';

export class EntityDeduplicator {
  private db: D1Database;
  private ai: any;

  // Thresholds for matching
  private static readonly EXACT_MATCH_THRESHOLD = 1.0;
  private static readonly FUZZY_MATCH_THRESHOLD = 0.85; // 85% similarity
  private static readonly EMBEDDING_MATCH_THRESHOLD = 0.90; // 90% cosine similarity
  private static readonly LLM_CONFIDENCE_THRESHOLD = 0.8;

  constructor(db: D1Database, ai: any) {
    this.db = db;
    this.ai = ai;
  }

  /**
   * Find matching entity for deduplication
   */
  async findMatch(
    extracted: ExtractedEntity,
    userId: string,
    containerTag: string
  ): Promise<DeduplicationResult> {
    const canonicalName = EntityExtractor.generateCanonicalName(extracted.name);

    // Step 1: Exact match on canonical name
    const exactMatches = await findEntitiesByCanonicalName(
      this.db,
      userId,
      canonicalName,
      extracted.entity_type
    );

    if (exactMatches.length === 1) {
      return {
        matched_entity_id: exactMatches[0].id,
        match_type: 'exact',
        confidence: 1.0,
        should_merge: true,
      };
    }

    if (exactMatches.length > 1) {
      // Multiple exact matches - use LLM to pick best one
      return this.llmDisambiguate(extracted, exactMatches);
    }

    // Step 2: Fuzzy string matching
    const fuzzyMatch = await this.fuzzyMatch(
      extracted,
      userId,
      containerTag
    );
    if (fuzzyMatch && fuzzyMatch.confidence >= EntityDeduplicator.FUZZY_MATCH_THRESHOLD) {
      return fuzzyMatch;
    }

    // Step 3: Embedding similarity
    const embeddingMatch = await this.embeddingMatch(
      extracted,
      userId,
      containerTag
    );
    if (embeddingMatch && embeddingMatch.confidence >= EntityDeduplicator.EMBEDDING_MATCH_THRESHOLD) {
      // Verify with LLM for high-confidence decision
      if (embeddingMatch.matched_entity_id) {
        const entity = await this.getEntityById(embeddingMatch.matched_entity_id);
        if (entity) {
          return this.llmVerify(extracted, entity);
        }
      }
    }

    // No match found
    return {
      matched_entity_id: null,
      match_type: 'none',
      confidence: 0,
      should_merge: false,
    };
  }

  /**
   * Fuzzy string matching using Levenshtein distance
   */
  private async fuzzyMatch(
    extracted: ExtractedEntity,
    userId: string,
    containerTag: string
  ): Promise<DeduplicationResult | null> {
    // Get entities of same type
    const existingEntities = await getEntitiesByUser(this.db, userId, {
      entity_type: extracted.entity_type,
      container_tag: containerTag,
      limit: 50, // Check top 50 entities
    });

    let bestMatch: { entity: Entity; similarity: number } | null = null;

    for (const entity of existingEntities) {
      const similarity = this.calculateStringSimilarity(
        extracted.name,
        entity.name
      );

      if (
        similarity > EntityDeduplicator.FUZZY_MATCH_THRESHOLD &&
        (!bestMatch || similarity > bestMatch.similarity)
      ) {
        bestMatch = { entity, similarity };
      }
    }

    if (bestMatch) {
      return {
        matched_entity_id: bestMatch.entity.id,
        match_type: 'fuzzy',
        confidence: bestMatch.similarity,
        should_merge: true,
      };
    }

    return null;
  }

  /**
   * Embedding-based similarity matching
   */
  private async embeddingMatch(
    extracted: ExtractedEntity,
    userId: string,
    containerTag: string
  ): Promise<DeduplicationResult | null> {
    try {
      // Generate embedding for extracted entity
      const entityText = this.generateEntityText(extracted);
      const embedding = await generateEmbedding(
        { AI: this.ai },
        entityText
      );

      // Get existing entities of same type
      const existingEntities = await getEntitiesByUser(this.db, userId, {
        entity_type: extracted.entity_type,
        container_tag: containerTag,
        limit: 50,
      });

      let bestMatch: { entity: Entity; similarity: number } | null = null;

      for (const entity of existingEntities) {
        // Generate embedding for existing entity
        const existingText = this.generateEntityText({
          name: entity.name,
          entity_type: entity.entity_type,
          attributes: entity.attributes,
          confidence: 1,
          mentions: [],
        });
        const existingEmbedding = await generateEmbedding(
          { AI: this.ai },
          existingText
        );

        // Calculate cosine similarity
        const similarity = this.cosineSimilarity(embedding, existingEmbedding);

        if (
          similarity > EntityDeduplicator.EMBEDDING_MATCH_THRESHOLD &&
          (!bestMatch || similarity > bestMatch.similarity)
        ) {
          bestMatch = { entity, similarity };
        }
      }

      if (bestMatch) {
        return {
          matched_entity_id: bestMatch.entity.id,
          match_type: 'embedding',
          confidence: bestMatch.similarity,
          should_merge: bestMatch.similarity > 0.95, // High threshold for auto-merge
        };
      }

      return null;
    } catch (error) {
      console.error('[EntityDeduplicator] Embedding match failed:', error);
      return null;
    }
  }

  /**
   * LLM-based disambiguation for ambiguous cases
   */
  private async llmDisambiguate(
    extracted: ExtractedEntity,
    candidates: Entity[]
  ): Promise<DeduplicationResult> {
    try {
      const prompt = this.buildDisambiguationPrompt(extracted, candidates);

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: `You are an entity disambiguation expert. Your job is to determine which existing entity (if any) matches a newly extracted entity. Return ONLY valid JSON.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      });

      const result = JSON.parse(response.response);

      if (result.matched_entity_id && result.confidence >= EntityDeduplicator.LLM_CONFIDENCE_THRESHOLD) {
        return {
          matched_entity_id: result.matched_entity_id,
          match_type: 'llm',
          confidence: result.confidence,
          should_merge: true,
        };
      }

      return {
        matched_entity_id: null,
        match_type: 'none',
        confidence: 0,
        should_merge: false,
      };
    } catch (error) {
      console.error('[EntityDeduplicator] LLM disambiguation failed:', error);
      // Default to first candidate if LLM fails
      return {
        matched_entity_id: candidates[0].id,
        match_type: 'fuzzy',
        confidence: 0.7,
        should_merge: true,
      };
    }
  }

  /**
   * LLM verification for embedding matches
   */
  private async llmVerify(
    extracted: ExtractedEntity,
    existing: Entity
  ): Promise<DeduplicationResult> {
    try {
      const prompt = `Are these two entities the same?

EXTRACTED ENTITY:
- Name: ${extracted.name}
- Type: ${extracted.entity_type}
- Attributes: ${JSON.stringify(extracted.attributes)}

EXISTING ENTITY:
- Name: ${existing.name}
- Type: ${existing.entity_type}
- Attributes: ${JSON.stringify(existing.attributes)}

Respond with JSON:
{
  "is_match": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are an entity matching expert. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 150,
      });

      const result = JSON.parse(response.response);

      if (result.is_match && result.confidence >= EntityDeduplicator.LLM_CONFIDENCE_THRESHOLD) {
        return {
          matched_entity_id: existing.id,
          match_type: 'llm',
          confidence: result.confidence,
          should_merge: true,
        };
      }

      return {
        matched_entity_id: null,
        match_type: 'none',
        confidence: 0,
        should_merge: false,
      };
    } catch (error) {
      console.error('[EntityDeduplicator] LLM verification failed:', error);
      return {
        matched_entity_id: null,
        match_type: 'none',
        confidence: 0,
        should_merge: false,
      };
    }
  }

  /**
   * Build disambiguation prompt
   */
  private buildDisambiguationPrompt(
    extracted: ExtractedEntity,
    candidates: Entity[]
  ): string {
    return `Which of these existing entities (if any) matches the newly extracted entity?

EXTRACTED ENTITY:
- Name: ${extracted.name}
- Type: ${extracted.entity_type}
- Attributes: ${JSON.stringify(extracted.attributes)}
- Mentions: ${extracted.mentions.join(', ')}

EXISTING ENTITIES:
${candidates
  .map(
    (c, idx) => `
${idx + 1}. ID: ${c.id}
   Name: ${c.name}
   Type: ${c.entity_type}
   Attributes: ${JSON.stringify(c.attributes)}
   Mention Count: ${c.mention_count}
`
  )
  .join('\n')}

Respond with JSON:
{
  "matched_entity_id": "entity_id or null",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // Levenshtein distance matrix
    const matrix: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return 1 - distance / maxLength;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Generate text representation of entity for embedding
   */
  private generateEntityText(entity: ExtractedEntity): string {
    const parts = [entity.name, entity.entity_type];

    // Add key attributes
    if (entity.attributes.role) parts.push(entity.attributes.role);
    if (entity.attributes.company) parts.push(entity.attributes.company);
    if (entity.attributes.industry) parts.push(entity.attributes.industry);
    if (entity.attributes.location) parts.push(entity.attributes.location);

    return parts.join(' ');
  }

  /**
   * Get entity by ID (helper)
   */
  private async getEntityById(entityId: string): Promise<Entity | null> {
    const result = await this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .bind(entityId)
      .first<any>();

    if (!result) return null;

    return {
      ...result,
      attributes: JSON.parse(result.attributes || '{}'),
    };
  }
}

/**
 * Helper function to deduplicate and merge entity
 */
export async function deduplicateEntity(
  db: D1Database,
  ai: any,
  extracted: ExtractedEntity,
  userId: string,
  containerTag: string
): Promise<DeduplicationResult> {
  const deduplicator = new EntityDeduplicator(db, ai);
  return deduplicator.findMatch(extracted, userId, containerTag);
}
