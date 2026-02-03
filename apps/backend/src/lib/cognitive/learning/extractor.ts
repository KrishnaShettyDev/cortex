/**
 * Learning Extractor
 *
 * Uses LLM to extract patterns, preferences, and insights from memory content.
 * Extracts:
 * - Preferences ("I prefer morning meetings")
 * - Habits ("I always check email first thing")
 * - Relationships ("Sarah is my mentor")
 * - Work patterns ("I work best in the afternoon")
 * - Interests ("I'm passionate about climate tech")
 * - Values ("Family comes first")
 * - Goals ("I want to learn Rust this year")
 */

import type {
  Learning,
  ExtractedLearning,
  LearningExtractionResult,
  LearningExtractionContext,
  LearningExtractionMetadata,
  LearningConflict,
  LearningCategory,
} from '../types';
import { LearningExtractionError } from '../types';
import { LearningRepository } from './repository';

interface CloudflareAI {
  run(model: string, options: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_tokens?: number;
  }): Promise<{ response: string }>;
}

export class LearningExtractor {
  private db: D1Database;
  private ai: CloudflareAI;
  private repository: LearningRepository;

  constructor(db: D1Database, ai: CloudflareAI) {
    this.db = db;
    this.ai = ai;
    this.repository = new LearningRepository(db);
  }

  /**
   * Extract learnings from memory content
   */
  async extractLearnings(
    context: LearningExtractionContext
  ): Promise<LearningExtractionResult> {
    const startTime = Date.now();

    // Pre-filter: Skip very short content
    if (context.memory_content.length < 50) {
      return {
        learnings: [],
        extraction_metadata: {
          total_extracted: 0,
          high_confidence_count: 0,
          conflicts_detected: 0,
          processing_time_ms: Date.now() - startTime,
          skipped_reason: 'too_short',
        },
      };
    }

    // Pre-filter: Check for learning signals
    if (!this.hasLearnableContent(context.memory_content)) {
      return {
        learnings: [],
        extraction_metadata: {
          total_extracted: 0,
          high_confidence_count: 0,
          conflicts_detected: 0,
          processing_time_ms: Date.now() - startTime,
          skipped_reason: 'no_signals',
        },
      };
    }

    try {
      // Use LLM to extract learnings
      const prompt = this.buildExtractionPrompt(context.memory_content);

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You extract user insights from text. Return JSON array. Return [] if no clear insights.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      const learnings = this.parseResponse(response.response);

      return {
        learnings,
        extraction_metadata: {
          total_extracted: learnings.length,
          high_confidence_count: learnings.filter(l => l.confidence >= 0.7).length,
          conflicts_detected: 0,
          processing_time_ms: Date.now() - startTime,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[LearningExtractor] Extraction failed:', error);
      throw new LearningExtractionError(
        `Learning extraction failed: ${errorMessage}`,
        true
      );
    }
  }

  /**
   * Build extraction prompt for LLM
   */
  private buildExtractionPrompt(content: string): string {
    return `Extract insights about the user from this text: "${content}"

Categories: preference, habit, relationship, work_pattern, health, interest, routine, communication, decision_style, value, goal, skill, other

Return JSON array: [{"category": "...", "statement": "User...", "reasoning": "Because they said...", "confidence": 0.0-1.0, "excerpt": "relevant quote"}]

Rules:
- Statement must start with "User" (e.g., "User prefers...", "User values...")
- Only extract clear, actionable insights
- Confidence: 0.9 for explicit statements, 0.7 for strong implications, 0.5 for weak signals
- Return [] if no clear insights

Return JSON only.`;
  }

  /**
   * Parse LLM response
   */
  private parseResponse(response: string): ExtractedLearning[] {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('[LearningExtractor] No JSON found in response:', response);
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((item: Record<string, unknown>) => {
          // Validate required fields
          if (!item.category || !item.statement || !item.reasoning) {
            return null;
          }

          return {
            category: this.normalizeCategory(String(item.category)),
            statement: String(item.statement).trim(),
            reasoning: String(item.reasoning).trim(),
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
            excerpt: String(item.excerpt || '').trim(),
          };
        })
        .filter((l): l is ExtractedLearning => l !== null);
    } catch (error) {
      console.error('[LearningExtractor] Failed to parse response:', error, response);
      return [];
    }
  }

  /**
   * Normalize category to valid type
   */
  private normalizeCategory(category: string): LearningCategory {
    const normalized = category.toLowerCase().trim();

    const categoryMap: Record<string, LearningCategory> = {
      preference: 'preference',
      pref: 'preference',
      like: 'preference',
      dislike: 'preference',
      habit: 'habit',
      routine: 'routine',
      relationship: 'relationship',
      rel: 'relationship',
      social: 'relationship',
      work: 'work_pattern',
      work_pattern: 'work_pattern',
      professional: 'work_pattern',
      health: 'health',
      wellness: 'health',
      fitness: 'health',
      interest: 'interest',
      hobby: 'interest',
      passion: 'interest',
      communication: 'communication',
      comm: 'communication',
      decision: 'decision_style',
      decision_style: 'decision_style',
      value: 'value',
      belief: 'value',
      principle: 'value',
      goal: 'goal',
      aspiration: 'goal',
      objective: 'goal',
      skill: 'skill',
      ability: 'skill',
      expertise: 'skill',
    };

    return categoryMap[normalized] || 'other';
  }

  /**
   * Check if content likely contains learnable insights
   */
  private hasLearnableContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return LEARNING_SIGNALS.some(signal => lowerContent.includes(signal));
  }

  /**
   * Save extracted learnings to database with conflict detection
   */
  async saveLearnings(
    userId: string,
    containerTag: string,
    memoryId: string,
    learnings: ExtractedLearning[]
  ): Promise<{ saved: Learning[]; conflicts: LearningConflict[] }> {
    const saved: Learning[] = [];
    const conflicts: LearningConflict[] = [];

    for (const extracted of learnings) {
      try {
        // Check for similar existing learnings
        const similar = await this.repository.findSimilarLearnings(
          userId,
          extracted.category,
          extracted.statement,
          containerTag
        );

        if (similar.length > 0) {
          // Potential conflict - check if it's a reinforcement or contradiction
          const conflict = this.detectConflict(extracted, similar[0]);

          if (conflict) {
            if (conflict.conflict_type === 'contradiction') {
              // Log conflict for manual review
              conflicts.push(conflict);
              continue;
            } else if (conflict.resolution === 'merge') {
              // Reinforce existing learning
              const reinforced = await this.repository.reinforceLearning(
                similar[0].id,
                memoryId,
                extracted.excerpt,
                extracted.confidence
              );
              if (reinforced) {
                saved.push(reinforced);
              }
              continue;
            }
          }
        }

        // Create new learning
        const learning = await this.repository.createLearning(
          userId,
          containerTag,
          extracted,
          memoryId
        );
        saved.push(learning);
      } catch (error) {
        console.error('[LearningExtractor] Failed to save learning:', error, extracted);
      }
    }

    return { saved, conflicts };
  }

  /**
   * Detect conflict type between new and existing learning
   */
  private detectConflict(
    newLearning: ExtractedLearning,
    existing: Learning
  ): LearningConflict | null {
    // Simple heuristic: check for negation keywords
    const newLower = newLearning.statement.toLowerCase();
    const existingLower = existing.statement.toLowerCase();

    const negations = ['not', "don't", "doesn't", "won't", 'never', 'avoid', 'hate', 'dislike'];
    const newHasNegation = negations.some(n => newLower.includes(n));
    const existingHasNegation = negations.some(n => existingLower.includes(n));

    // If one has negation and other doesn't, potential contradiction
    if (newHasNegation !== existingHasNegation) {
      return {
        new_learning: newLearning,
        existing_learning: existing,
        conflict_type: 'contradiction',
        resolution: 'pending',
      };
    }

    // Same polarity - this is a refinement/reinforcement
    if (newLearning.confidence > existing.confidence + 0.2) {
      return {
        new_learning: newLearning,
        existing_learning: existing,
        conflict_type: 'refinement',
        resolution: 'replace',
      };
    }

    // Similar confidence - merge (reinforce)
    return {
      new_learning: newLearning,
      existing_learning: existing,
      conflict_type: 'refinement',
      resolution: 'merge',
    };
  }
}

/**
 * Learning signal keywords for pre-filtering
 */
const LEARNING_SIGNALS = [
  // Preferences
  'prefer', 'like', 'love', 'enjoy', 'favorite', 'favourite', 'hate', 'dislike', 'avoid',
  // Habits
  'always', 'usually', 'typically', 'often', 'never', 'tend to', 'habit',
  // Self-description
  "i'm", 'i am', "i've", 'i have', 'my', 'me',
  // Values
  'important', 'value', 'believe', 'priority', 'matter',
  // Goals
  'want to', 'plan to', 'goal', 'hope to', 'aspire', 'dream',
  // Work
  'work', 'job', 'career', 'project', 'team', 'colleague',
  // Relationships
  'friend', 'family', 'partner', 'wife', 'husband', 'kid', 'child', 'parent',
  // Health
  'exercise', 'diet', 'sleep', 'health', 'workout',
  // Skills
  'good at', 'skilled', 'expert', 'learning', 'studying',
];

/**
 * Helper function to extract and save learnings
 */
export async function extractAndSaveLearnings(
  db: D1Database,
  ai: CloudflareAI,
  userId: string,
  containerTag: string,
  memoryId: string,
  content: string
): Promise<LearningExtractionResult> {
  const startTime = Date.now();
  const extractor = new LearningExtractor(db, ai);

  // Extract learnings
  const context: LearningExtractionContext = {
    user_id: userId,
    container_tag: containerTag,
    memory_id: memoryId,
    memory_content: content,
    created_at: new Date().toISOString(),
  };

  const result = await extractor.extractLearnings(context);

  // Save high-confidence learnings
  const highConfidence = result.learnings.filter(l => l.confidence >= 0.6);
  let saved: Learning[] = [];
  let conflicts: LearningConflict[] = [];

  if (highConfidence.length > 0) {
    const saveResult = await extractor.saveLearnings(
      userId,
      containerTag,
      memoryId,
      highConfidence
    );
    saved = saveResult.saved;
    conflicts = saveResult.conflicts;
  }

  return {
    ...result,
    saved,
    conflicts,
    extraction_metadata: {
      ...result.extraction_metadata,
      conflicts_detected: conflicts.length,
      processing_time_ms: Date.now() - startTime,
    },
  };
}
