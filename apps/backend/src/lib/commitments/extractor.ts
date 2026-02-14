/**
 * Commitment Extractor
 *
 * Uses LLM to detect promises, deadlines, and follow-ups from memory content.
 * Extracts:
 * - Promises ("I will send the report")
 * - Deadlines ("Need to submit by Friday")
 * - Follow-ups ("Remind me to check in with Sarah")
 * - Meetings ("Meeting with the team tomorrow")
 * - Deliverables ("Finish the presentation by Monday")
 */

import { nanoid } from 'nanoid';
import type {
  Commitment,
  ExtractedCommitment,
  CommitmentExtractionResult,
  CommitmentType,
  CommitmentPriority,
  CommitmentExtractionMetadata,
} from './types';
import { CommitmentExtractionError } from './types';
import { scheduleJob } from '../jobs';

export class CommitmentExtractor {
  private db: D1Database;
  private ai: any;

  constructor(db: D1Database, ai: any) {
    this.db = db;
    this.ai = ai;
  }

  /**
   * Extract commitments from memory content
   */
  async extractCommitments(
    content: string,
    referenceDate: Date = new Date()
  ): Promise<CommitmentExtractionResult> {
    const startTime = Date.now();

    try {
      // Use LLM to detect commitments
      const prompt = this.buildExtractionPrompt(content, referenceDate);

      // OPTIMIZED: Reduced max_tokens from 500 to 300, simplified system prompt
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'Extract commitments as JSON array. Return [] if none.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      });

      const commitments = this.parseResponse(response.response, referenceDate);

      return {
        commitments,
        extraction_metadata: {
          total_extracted: commitments.length,
          high_confidence_count: commitments.filter((c) => c.confidence >= 0.7)
            .length,
          processing_time_ms: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      console.error('[CommitmentExtractor] Extraction failed:', error);
      throw new CommitmentExtractionError(
        `Commitment extraction failed: ${error.message}`,
        true
      );
    }
  }

  /**
   * Build extraction prompt for LLM
   * OPTIMIZED: Reduced from ~300 tokens to ~100 tokens
   */
  private buildExtractionPrompt(
    content: string,
    referenceDate: Date
  ): string {
    const refDateStr = referenceDate.toISOString().split('T')[0];

    return `Extract commitments from: "${content}"
Today: ${refDateStr}

Return JSON array: [{"description": "...", "type": "promise|deadline|follow_up|meeting|deliverable", "to_entity": "person/company or null", "due_date": "YYYY-MM-DD or null", "priority": "critical|high|medium|low", "confidence": 0.0-1.0}]
Return [] if none.`;
  }

  /**
   * Parse LLM response
   */
  private parseResponse(
    response: string,
    referenceDate: Date
  ): ExtractedCommitment[] {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn(
          '[CommitmentExtractor] No JSON found in response:',
          response
        );
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((item: any) => {
          // Validate and normalize
          if (!item.description || !item.type) {
            return null;
          }

          return {
            commitment_type: this.normalizeType(item.type),
            description: item.description.trim(),
            to_entity_name: item.to_entity || null,
            due_date: item.due_date || null,
            priority: this.normalizePriority(item.priority),
            context: null,
            confidence: Math.min(1, Math.max(0, item.confidence || 0.5)),
          };
        })
        .filter((c): c is ExtractedCommitment => c !== null);
    } catch (error) {
      console.error(
        '[CommitmentExtractor] Failed to parse response:',
        error,
        response
      );
      return [];
    }
  }

  /**
   * Normalize commitment type
   */
  private normalizeType(type: string): CommitmentType {
    const normalized = type.toLowerCase().trim();
    if (normalized.includes('promise')) return 'promise';
    if (normalized.includes('deadline')) return 'deadline';
    if (normalized.includes('follow')) return 'follow_up';
    if (normalized.includes('meeting')) return 'meeting';
    if (normalized.includes('deliver')) return 'deliverable';
    return 'promise'; // Default
  }

  /**
   * Normalize priority
   */
  private normalizePriority(priority: string | undefined): CommitmentPriority {
    if (!priority) return 'medium';
    const normalized = priority.toLowerCase().trim();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'high') return 'high';
    if (normalized === 'low') return 'low';
    return 'medium';
  }

  /**
   * Save commitments to database
   */
  async saveCommitments(
    userId: string,
    memoryId: string,
    commitments: ExtractedCommitment[]
  ): Promise<Commitment[]> {
    const saved: Commitment[] = [];

    for (const extracted of commitments) {
      try {
        // Find or create entity for "to" person
        let toEntityId: string | null = null;
        if (extracted.to_entity_name) {
          toEntityId = await this.findOrCreateEntity(
            userId,
            extracted.to_entity_name
          );
        }

        // Create commitment
        const commitment = await this.createCommitment(
          userId,
          memoryId,
          extracted,
          toEntityId
        );

        saved.push(commitment);

        // Create reminder if due date exists
        if (commitment.due_date && commitment.status === 'pending') {
          await this.createReminder(commitment);
        }
      } catch (error) {
        console.error(
          `[CommitmentExtractor] Failed to save commitment:`,
          error,
          extracted
        );
      }
    }

    return saved;
  }

  /**
   * Create commitment in database
   */
  private async createCommitment(
    userId: string,
    memoryId: string,
    extracted: ExtractedCommitment,
    toEntityId: string | null
  ): Promise<Commitment> {
    const id = nanoid();
    const now = new Date().toISOString();

    const commitment: Commitment = {
      id,
      user_id: userId,
      memory_id: memoryId,
      commitment_type: extracted.commitment_type,
      description: extracted.description,
      to_entity_id: toEntityId,
      to_entity_name: extracted.to_entity_name,
      from_entity_id: null,
      due_date: extracted.due_date,
      reminder_date: null,
      status: 'pending',
      priority: extracted.priority,
      context: extracted.context,
      tags: null,
      completed_at: null,
      completion_note: null,
      extraction_confidence: extracted.confidence,
      created_at: now,
      updated_at: now,
    };

    await this.db
      .prepare(
        `INSERT INTO commitments (
          id, user_id, memory_id, commitment_type, description,
          to_entity_id, to_entity_name, from_entity_id,
          due_date, reminder_date, status, priority,
          context, tags, completed_at, completion_note,
          extraction_confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId,
        memoryId,
        commitment.commitment_type,
        commitment.description,
        toEntityId,
        commitment.to_entity_name,
        null,
        commitment.due_date,
        null,
        commitment.status,
        commitment.priority,
        null,
        null,
        null,
        null,
        commitment.extraction_confidence,
        now,
        now
      )
      .run();

    return commitment;
  }

  /**
   * Create reminder for commitment using the job scheduler
   */
  private async createReminder(commitment: Commitment): Promise<void> {
    if (!commitment.due_date) return;

    const dueDate = new Date(commitment.due_date);
    const now = new Date();

    // Only create reminder if due date is in the future
    if (dueDate < now) {
      return;
    }

    // Schedule reminder job at due time
    await scheduleJob(this.db, {
      userId: commitment.user_id,
      type: 'commitment_reminder',
      scheduledFor: dueDate,
      payload: {
        commitmentId: commitment.id,
        title: commitment.description,
        description: commitment.context || undefined,
        dueAt: Math.floor(dueDate.getTime() / 1000),
      },
    });

    // Also schedule an early reminder 1 day before if there's enough time
    const earlyReminderDate = new Date(dueDate);
    earlyReminderDate.setDate(earlyReminderDate.getDate() - 1);

    if (earlyReminderDate > now) {
      await scheduleJob(this.db, {
        userId: commitment.user_id,
        type: 'commitment_reminder',
        scheduledFor: earlyReminderDate,
        payload: {
          commitmentId: commitment.id,
          title: `Due tomorrow: ${commitment.description}`,
          description: commitment.context || undefined,
          dueAt: Math.floor(dueDate.getTime() / 1000),
        },
      });
    }
  }

  /**
   * Find or create entity for person/company
   */
  private async findOrCreateEntity(
    userId: string,
    entityName: string
  ): Promise<string> {
    // Try to find existing entity
    const existing = await this.db
      .prepare(
        'SELECT id FROM entities WHERE user_id = ? AND name = ? LIMIT 1'
      )
      .bind(userId, entityName)
      .first<{ id: string }>();

    if (existing) {
      return existing.id;
    }

    // Create new entity
    const id = nanoid();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO entities (
          id, user_id, container_tag, name, entity_type,
          description, importance_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, 'default', entityName, 'person', null, 0.5, now, now)
      .run();

    return id;
  }
}

/**
 * Commitment signal keywords for pre-filtering
 * If none of these are present, skip LLM extraction entirely
 */
const COMMITMENT_SIGNALS = [
  // Action verbs
  'will', "i'll", 'promise', 'commit', 'agree', 'plan to', 'going to', 'gonna',
  // Deadlines
  'deadline', 'due', 'by', 'until', 'before', 'no later than',
  // Time references
  'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'next week', 'this week', 'end of', 'by end', 'eod', 'eow', 'eom',
  // Actions
  'send', 'deliver', 'submit', 'finish', 'complete', 'call', 'email', 'meet',
  'follow up', 'followup', 'follow-up', 'check in', 'remind', 'schedule',
  // Urgency
  'asap', 'urgent', 'priority', 'important', 'critical', 'must', 'need to', 'have to',
];

/**
 * Quick check if content likely contains commitments
 * Returns true if LLM extraction should be performed
 */
function hasCommitmentSignals(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return COMMITMENT_SIGNALS.some(signal => lowerContent.includes(signal));
}

/**
 * Helper function to extract and save commitments
 * Now with pre-filtering to skip LLM for non-commitment content
 */
export async function extractAndSaveCommitments(
  db: D1Database,
  ai: any,
  userId: string,
  memoryId: string,
  content: string
): Promise<CommitmentExtractionResult> {
  const startTime = Date.now();

  // PRE-FILTER: Skip LLM if no commitment signals detected
  if (!hasCommitmentSignals(content)) {
    console.log('[CommitmentExtractor] No commitment signals detected, skipping LLM');
    return {
      commitments: [],
      saved: [],
      extraction_metadata: {
        total_extracted: 0,
        high_confidence_count: 0,
        processing_time_ms: Date.now() - startTime,
        skipped_reason: 'no_signals',
      },
    };
  }

  const extractor = new CommitmentExtractor(db, ai);

  // Extract commitments via LLM
  const result = await extractor.extractCommitments(content);

  // Save high-confidence commitments
  const highConfidence = result.commitments.filter((c) => c.confidence >= 0.6);
  let saved: Commitment[] = [];

  if (highConfidence.length > 0) {
    saved = await extractor.saveCommitments(userId, memoryId, highConfidence);
  }

  return {
    ...result,
    saved,
  };
}
