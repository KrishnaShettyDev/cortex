/**
 * Contradiction Detection Module
 *
 * Detects when new information contradicts existing memories.
 * Examples:
 * - "Meeting is March 15" vs "Meeting moved to March 20"
 * - "John works at Acme" vs "John switched to XYZ Corp"
 */

import { generateEmbedding } from '../vectorize';

export interface Contradiction {
  existingMemoryId: string;
  existingContent: string;
  conflictType: 'date_mismatch' | 'fact_conflict' | 'status_change' | 'quantity_mismatch';
  confidence: number;
  description: string;
}

export interface ContradictionCheckResult {
  hasContradiction: boolean;
  contradictions: Contradiction[];
  suggestedAction: 'ask_user' | 'update_memory' | 'create_both' | 'none';
}

/**
 * Check if new content contradicts existing memories
 */
export async function detectContradictions(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  newContent: string,
  ai: any
): Promise<ContradictionCheckResult> {
  try {
    // Step 1: Generate embedding for new content
    const embedding = await generateEmbedding(newContent, ai);

    // Step 2: Find similar existing memories
    const similar = await vectorize.query(embedding, {
      topK: 5,
      filter: { user_id: userId },
      returnMetadata: 'all',
    });

    if (!similar.matches || similar.matches.length === 0) {
      return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
    }

    // Step 3: Filter to only reasonably similar memories (score > 0.7)
    const relevantMemories = similar.matches
      .filter(m => m.score && m.score > 0.7)
      .slice(0, 3);

    if (relevantMemories.length === 0) {
      return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
    }

    // Step 4: Use AI to check for contradictions
    const memoryContents = relevantMemories.map((m, i) =>
      `${i + 1}. [ID: ${m.id}] ${(m.metadata as any)?.content || 'Unknown'}`
    ).join('\n');

    const prompt = `You are a fact-checker. Compare the NEW statement with EXISTING memories and identify any contradictions.

NEW STATEMENT: "${newContent}"

EXISTING MEMORIES:
${memoryContents}

Look for these types of contradictions:
1. date_mismatch: Conflicting dates/times (e.g., "March 15" vs "March 20")
2. fact_conflict: Contradicting facts (e.g., "works at Acme" vs "works at XYZ")
3. status_change: Changed status that may need confirmation (e.g., "meeting scheduled" vs "meeting cancelled")
4. quantity_mismatch: Different numbers (e.g., "$100" vs "$150")

Respond ONLY with valid JSON in this format:
{
  "hasContradiction": boolean,
  "contradictions": [
    {
      "memoryIndex": 1,
      "conflictType": "date_mismatch",
      "confidence": 0.9,
      "description": "Brief explanation"
    }
  ]
}

If NO contradictions exist, return: {"hasContradiction": false, "contradictions": []}`;

    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
    });

    // Parse AI response
    const responseText = response.response || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.hasContradiction || !parsed.contradictions?.length) {
      return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
    }

    // Map AI response to our format
    const contradictions: Contradiction[] = parsed.contradictions.map((c: any) => {
      const memoryMatch = relevantMemories[c.memoryIndex - 1];
      return {
        existingMemoryId: memoryMatch?.id || 'unknown',
        existingContent: (memoryMatch?.metadata as any)?.content || 'Unknown',
        conflictType: c.conflictType as Contradiction['conflictType'],
        confidence: c.confidence || 0.7,
        description: c.description || 'Potential contradiction detected',
      };
    }).filter((c: Contradiction) => c.existingMemoryId !== 'unknown');

    if (contradictions.length === 0) {
      return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
    }

    // Determine suggested action based on contradiction types and confidence
    const highConfidenceConflicts = contradictions.filter(c => c.confidence > 0.8);
    let suggestedAction: ContradictionCheckResult['suggestedAction'] = 'ask_user';

    if (highConfidenceConflicts.length === 0) {
      suggestedAction = 'create_both'; // Low confidence, just save both
    } else if (contradictions.some(c => c.conflictType === 'status_change')) {
      suggestedAction = 'update_memory'; // Status changes are usually intentional updates
    }

    return {
      hasContradiction: true,
      contradictions,
      suggestedAction,
    };
  } catch (error) {
    console.error('[ContradictionDetector] Error:', error);
    return { hasContradiction: false, contradictions: [], suggestedAction: 'none' };
  }
}

/**
 * Record a detected contradiction for user resolution
 */
export async function recordContradiction(
  db: D1Database,
  userId: string,
  newMemoryId: string,
  contradiction: Contradiction
): Promise<void> {
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO memory_contradictions (
      id, user_id, new_memory_id, existing_memory_id,
      conflict_type, confidence, description, resolved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    id,
    userId,
    newMemoryId,
    contradiction.existingMemoryId,
    contradiction.conflictType,
    contradiction.confidence,
    contradiction.description,
    new Date().toISOString()
  ).run();
}

/**
 * Get unresolved contradictions for a user
 */
export async function getUnresolvedContradictions(
  db: D1Database,
  userId: string,
  limit: number = 5
): Promise<Array<{
  id: string;
  newContent: string;
  existingContent: string;
  conflictType: string;
  confidence: number;
  description: string;
  createdAt: string;
}>> {
  const results = await db.prepare(`
    SELECT
      mc.id,
      mc.conflict_type,
      mc.confidence,
      mc.description,
      mc.created_at,
      m1.content as new_content,
      m2.content as existing_content
    FROM memory_contradictions mc
    JOIN memories m1 ON mc.new_memory_id = m1.id
    JOIN memories m2 ON mc.existing_memory_id = m2.id
    WHERE mc.user_id = ? AND mc.resolved = 0
    ORDER BY mc.created_at DESC
    LIMIT ?
  `).bind(userId, limit).all<{
    id: string;
    conflict_type: string;
    confidence: number;
    description: string;
    created_at: string;
    new_content: string;
    existing_content: string;
  }>();

  return (results.results || []).map(r => ({
    id: r.id,
    newContent: r.new_content,
    existingContent: r.existing_content,
    conflictType: r.conflict_type,
    confidence: r.confidence,
    description: r.description,
    createdAt: r.created_at,
  }));
}

/**
 * Resolve a contradiction (keep new, keep existing, or keep both)
 */
export async function resolveContradiction(
  db: D1Database,
  userId: string,
  contradictionId: string,
  resolution: 'keep_new' | 'keep_existing' | 'keep_both'
): Promise<void> {
  // Get the contradiction
  const contradiction = await db.prepare(`
    SELECT new_memory_id, existing_memory_id FROM memory_contradictions
    WHERE id = ? AND user_id = ?
  `).bind(contradictionId, userId).first<{
    new_memory_id: string;
    existing_memory_id: string;
  }>();

  if (!contradiction) {
    throw new Error('Contradiction not found');
  }

  // Apply resolution
  if (resolution === 'keep_new') {
    // Mark existing as forgotten
    await db.prepare(`
      UPDATE memories SET is_forgotten = 1, updated_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), contradiction.existing_memory_id).run();
  } else if (resolution === 'keep_existing') {
    // Mark new as forgotten
    await db.prepare(`
      UPDATE memories SET is_forgotten = 1, updated_at = ? WHERE id = ?
    `).bind(new Date().toISOString(), contradiction.new_memory_id).run();
  }
  // 'keep_both' doesn't modify memories

  // Mark contradiction as resolved
  await db.prepare(`
    UPDATE memory_contradictions SET resolved = 1, resolution = ?, resolved_at = ?
    WHERE id = ?
  `).bind(resolution, new Date().toISOString(), contradictionId).run();
}

/**
 * Format contradiction for chat context
 */
export function formatContradictionForChat(contradiction: {
  newContent: string;
  existingContent: string;
  conflictType: string;
  description: string;
}): string {
  return `⚠️ I noticed something: You previously said "${contradiction.existingContent}" but now you're saying "${contradiction.newContent}". ${contradiction.description} Which is correct so I can update my memory?`;
}
