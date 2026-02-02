/**
 * Semantic Fact Extraction
 *
 * Extracts meaningful patterns, preferences, and knowledge from memory clusters
 * using LLM-powered analysis. Creates semantic (timeless) memories from
 * episodic (time-bound) memories.
 */

import { nanoid } from 'nanoid';
import type { MemoryCluster } from './clustering';

export type FactType = 'pattern' | 'preference' | 'relationship' | 'knowledge' | 'skill';

export interface SemanticFact {
  id: string;
  content: string; // 2-3 sentence summary
  fact_type: FactType;
  confidence: number; // 0-1
  supporting_memory_ids: string[];
  entities_mentioned: string[];
  importance_estimate: number; // 0-1
  created_at: string;
}

export interface ExtractionContext {
  ai: any;
  db: D1Database;
  userId: string;
  containerTag: string;
}

export class SemanticFactExtractor {
  constructor(private context: ExtractionContext) {}

  /**
   * Extract semantic facts from a memory cluster
   * Quality checks:
   * - Must reference 3+ memories
   * - Confidence >= 0.7
   * - Not redundant with existing semantic memories
   */
  async extractFacts(cluster: MemoryCluster): Promise<SemanticFact[]> {
    if (cluster.memories.length < 3) {
      console.log(`[SemanticExtractor] Cluster too small (${cluster.memories.length} memories), skipping`);
      return [];
    }

    console.log(`[SemanticExtractor] Extracting facts from cluster of ${cluster.memories.length} memories`);

    try {
      // Call LLM to extract semantic facts
      const rawFacts = await this.llmExtractFacts(cluster);

      // Filter and validate facts
      const validFacts = rawFacts.filter(fact => this.validateFact(fact, cluster));

      console.log(`[SemanticExtractor] Extracted ${validFacts.length} valid facts from ${rawFacts.length} candidates`);

      // Check for redundancy against existing semantic memories
      const nonRedundantFacts = await this.filterRedundantFacts(validFacts);

      console.log(`[SemanticExtractor] ${nonRedundantFacts.length} facts are non-redundant`);

      return nonRedundantFacts;
    } catch (error) {
      console.error(`[SemanticExtractor] Extraction failed:`, error);
      return [];
    }
  }

  /**
   * Call LLM to extract semantic facts from cluster
   */
  private async llmExtractFacts(cluster: MemoryCluster): Promise<SemanticFact[]> {
    // Prepare context
    const memoryContexts = cluster.memories.map((m, i) =>
      `${i + 1}. [${m.event_date || m.created_at}] ${m.content}`
    ).join('\n\n');

    const entityContext = cluster.dominant_entities
      ? `\nKey entities: ${cluster.dominant_entities.join(', ')}`
      : '';

    const timeContext = cluster.time_span
      ? `\nTime period: ${new Date(cluster.time_span.start).toLocaleDateString()} to ${new Date(cluster.time_span.end).toLocaleDateString()}`
      : '';

    const prompt = `You are analyzing a cluster of related memories to extract lasting semantic facts worth preserving.

${memoryContexts}${entityContext}${timeContext}

Extract semantic facts that capture:
1. **Patterns of behavior** - recurring actions or habits (e.g., "User frequently meets Sarah for coffee on Thursdays")
2. **Preferences** - likes, dislikes, priorities (e.g., "User prefers morning meetings and dislikes back-to-back calls")
3. **Relationships** - how people interact and relate (e.g., "User works closely with design team on product features")
4. **Knowledge** - facts learned or remembered (e.g., "User is learning Spanish through Duolingo")
5. **Skills** - capabilities or expertise (e.g., "User has experience with React and TypeScript")

Guidelines:
- Extract only facts that are supported by multiple memories (3+ sources)
- Write in third person ("User does X")
- Each fact should be 2-3 sentences max
- Focus on information that remains relevant over time
- Ignore one-off events unless they reveal a pattern
- Include confidence score (0-1) based on evidence strength
- List memory IDs that support each fact

Return a JSON array of facts:
[
  {
    "content": "User frequently attends machine learning conferences and is interested in transformer architectures. They have presented at NeurIPS and follow research from OpenAI and Anthropic.",
    "fact_type": "pattern",
    "confidence": 0.9,
    "supporting_memory_ids": ["mem_123", "mem_456", "mem_789"],
    "entities": ["NeurIPS", "OpenAI", "Anthropic"],
    "importance": 0.8
  }
]

Return ONLY the JSON array, no other text.`;

    // Call LLM
    const response = await this.context.ai.run('@cf/meta/llama-3.1-8b-instruct', {
      prompt,
      max_tokens: 2000,
      temperature: 0.1, // Low temperature for consistency
    });

    // Parse response
    let responseText = response.response || '';

    // Extract JSON array if wrapped in markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/```\s*([\s\S]*?)\s*```/) ||
                      responseText.match(/(\[[\s\S]*\])/);

    if (jsonMatch) {
      responseText = jsonMatch[1];
    }

    let parsedFacts: any[];
    try {
      parsedFacts = JSON.parse(responseText);
    } catch (error) {
      console.error('[SemanticExtractor] Failed to parse LLM response:', responseText);
      return [];
    }

    // Transform to SemanticFact objects
    return parsedFacts.map(fact => ({
      id: nanoid(),
      content: fact.content,
      fact_type: this.normalizeFactType(fact.fact_type),
      confidence: Math.min(1.0, Math.max(0.0, fact.confidence || 0.7)),
      supporting_memory_ids: fact.supporting_memory_ids || [],
      entities_mentioned: fact.entities || [],
      importance_estimate: Math.min(1.0, Math.max(0.0, fact.importance || 0.5)),
      created_at: new Date().toISOString(),
    }));
  }

  /**
   * Normalize fact type to one of the allowed values
   */
  private normalizeFactType(type: string): FactType {
    const normalized = type.toLowerCase();
    const validTypes: FactType[] = ['pattern', 'preference', 'relationship', 'knowledge', 'skill'];

    for (const validType of validTypes) {
      if (normalized.includes(validType)) {
        return validType;
      }
    }

    // Default to 'pattern'
    return 'pattern';
  }

  /**
   * Validate a fact meets quality criteria
   */
  private validateFact(fact: SemanticFact, cluster: MemoryCluster): boolean {
    // Must have content
    if (!fact.content || fact.content.trim().length < 20) {
      return false;
    }

    // Must reference 3+ memories
    if (fact.supporting_memory_ids.length < 3) {
      return false;
    }

    // All supporting memories must exist in cluster
    const clusterMemoryIds = new Set(cluster.memories.map(m => m.id));
    const validSupporting = fact.supporting_memory_ids.filter(id => clusterMemoryIds.has(id));
    if (validSupporting.length < 3) {
      return false;
    }

    // Confidence must be >= 0.7
    if (fact.confidence < 0.7) {
      return false;
    }

    return true;
  }

  /**
   * Filter out facts that are redundant with existing semantic memories
   * Uses vector similarity to detect duplicates
   */
  private async filterRedundantFacts(facts: SemanticFact[]): Promise<SemanticFact[]> {
    const nonRedundant: SemanticFact[] = [];

    for (const fact of facts) {
      const isRedundant = await this.isRedundantWithExisting(fact);
      if (!isRedundant) {
        nonRedundant.push(fact);
      } else {
        console.log(`[SemanticExtractor] Fact is redundant, skipping: "${fact.content.substring(0, 50)}..."`);
      }
    }

    return nonRedundant;
  }

  /**
   * Check if fact is similar to existing semantic memories
   */
  private async isRedundantWithExisting(fact: SemanticFact): Promise<boolean> {
    try {
      // Query existing semantic memories
      const result = await this.context.db.prepare(`
        SELECT id, content
        FROM memories
        WHERE user_id = ?
          AND container_tag = ?
          AND memory_type = 'semantic'
          AND is_forgotten = 0
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(this.context.userId, this.context.containerTag).all();

      if (result.results.length === 0) {
        return false; // No existing semantic memories
      }

      // Simple text similarity check (can be enhanced with vector search)
      const factWords = new Set(this.tokenize(fact.content));

      for (const row of result.results as any[]) {
        const existingWords = new Set(this.tokenize(row.content));
        const overlap = this.jaccardSimilarity(factWords, existingWords);

        // If >80% word overlap, consider redundant
        if (overlap > 0.8) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.warn('[SemanticExtractor] Redundancy check failed:', error);
      return false; // On error, allow the fact
    }
  }

  /**
   * Simple tokenization for similarity check
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3); // Filter short words
  }

  /**
   * Jaccard similarity between two sets
   */
  private jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Batch extract facts from multiple clusters
   */
  async extractFromClusters(clusters: MemoryCluster[]): Promise<SemanticFact[]> {
    const allFacts: SemanticFact[] = [];

    for (const cluster of clusters) {
      const facts = await this.extractFacts(cluster);
      allFacts.push(...facts);
    }

    return allFacts;
  }
}

/**
 * Estimate importance of a semantic fact
 * Based on:
 * - Number of supporting memories
 * - Recency of supporting memories
 * - Entities mentioned (important entities boost score)
 * - Fact type (some types are more important)
 */
export function estimateFactImportance(
  fact: SemanticFact,
  cluster: MemoryCluster
): number {
  let score = 0.5; // Base score

  // Factor 1: Support strength (more supporting memories = higher importance)
  const supportRatio = fact.supporting_memory_ids.length / cluster.memories.length;
  score += supportRatio * 0.2;

  // Factor 2: Recency (newer patterns are more relevant)
  const avgAge = cluster.memories.reduce((sum, m) => {
    const age = Date.now() - new Date(m.created_at).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    return sum + days;
  }, 0) / cluster.memories.length;

  const recencyScore = Math.max(0, 1.0 - avgAge / 90); // Decay over 90 days
  score += recencyScore * 0.2;

  // Factor 3: Entity importance
  if (fact.entities_mentioned.length > 0) {
    score += 0.1; // Boost for entity-rich facts
  }

  // Factor 4: Fact type importance
  const typeWeights: Record<FactType, number> = {
    preference: 0.15,   // User preferences are highly important
    relationship: 0.15, // Relationships are critical
    pattern: 0.1,       // Behavioral patterns are valuable
    knowledge: 0.1,     // Learned knowledge matters
    skill: 0.1,         // Skills are relevant
  };
  score += typeWeights[fact.fact_type] || 0;

  // Factor 5: Confidence
  score += fact.confidence * 0.1;

  // Normalize to 0-1
  return Math.min(1.0, Math.max(0.0, score));
}
