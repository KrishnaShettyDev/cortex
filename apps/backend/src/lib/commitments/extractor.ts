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
} from './types';
import { CommitmentExtractionError } from './types';

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

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content:
              'You are a commitment extraction system. Extract promises, deadlines, and follow-ups from text. Return valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
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
   */
  private buildExtractionPrompt(
    content: string,
    referenceDate: Date
  ): string {
    const refDateStr = referenceDate.toISOString().split('T')[0];

    return `Extract commitments from this text. Reference date: ${refDateStr}

TEXT: "${content}"

COMMITMENT TYPES:
1. PROMISE - "I will...", "I'll...", "I promise to..."
2. DEADLINE - "Need to X by Y", "Due on...", "Must complete..."
3. FOLLOW_UP - "Remind me to...", "Check back on...", "Follow up with..."
4. MEETING - "Meeting with...", "Call scheduled...", "Sync with..."
5. DELIVERABLE - "Deliver X by Y", "Ship by...", "Complete X"

PRIORITY LEVELS:
- critical: ASAP, urgent, critical, emergency
- high: important, soon, priority
- medium: default
- low: when you can, eventually

EXTRACT:
- description: What needs to be done
- type: One of the types above
- to_entity: Person/company the commitment is to (if mentioned)
- due_date: When it's due (ISO format YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
- priority: critical/high/medium/low
- confidence: 0-1 (how confident you are this is a real commitment)

Return ONLY valid JSON array:
[
  {
    "description": "Send quarterly report",
    "type": "promise",
    "to_entity": "Sarah",
    "due_date": "2026-02-05",
    "priority": "high",
    "confidence": 0.9
  }
]

If no commitments found, return: []`;
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
   * Create reminder for commitment
   */
  private async createReminder(commitment: Commitment): Promise<void> {
    if (!commitment.due_date) return;

    const dueDate = new Date(commitment.due_date);
    const now = new Date();

    // Calculate reminder date (1 day before due date)
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() - 1);

    // Only create reminder if it's in the future
    if (reminderDate < now) {
      return;
    }

    const id = nanoid();
    await this.db
      .prepare(
        `INSERT INTO commitment_reminders (
          id, commitment_id, user_id, reminder_type,
          scheduled_for, sent_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        commitment.id,
        commitment.user_id,
        'due_soon',
        reminderDate.toISOString(),
        null,
        'pending',
        new Date().toISOString()
      )
      .run();
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
 * Helper function to extract and save commitments
 */
export async function extractAndSaveCommitments(
  db: D1Database,
  ai: any,
  userId: string,
  memoryId: string,
  content: string
): Promise<CommitmentExtractionResult> {
  const extractor = new CommitmentExtractor(db, ai);

  // Extract commitments
  const result = await extractor.extractCommitments(content);

  // Save high-confidence commitments
  const highConfidence = result.commitments.filter((c) => c.confidence >= 0.6);

  if (highConfidence.length > 0) {
    await extractor.saveCommitments(userId, memoryId, highConfidence);
  }

  return result;
}
