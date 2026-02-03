/**
 * Learning Backfill Job
 *
 * Extracts learnings from existing memories in batches.
 * Features:
 * - Batch processing (configurable batch size)
 * - Rate limiting (configurable delay between batches)
 * - Progress tracking (resumable)
 * - Pre-filtering (skips memories unlikely to contain learnings)
 */

import { extractAndSaveLearnings } from './extractor';
import type { Learning, LearningExtractionResult } from '../types';

interface BackfillConfig {
  batchSize: number;
  delayBetweenBatches: number; // ms
  maxMemories?: number; // Optional limit for testing
  startFromDate?: string; // Process memories after this date
  endAtDate?: string; // Process memories before this date
  userId?: string; // Optional filter by user
}

interface BackfillProgress {
  totalMemories: number;
  processedMemories: number;
  learningsExtracted: number;
  conflictsDetected: number;
  skippedMemories: number;
  failedMemories: number;
  lastProcessedId: string | null;
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'paused' | 'failed';
  currentBatch: number;
  totalBatches: number;
}

interface BackfillResult {
  progress: BackfillProgress;
  learnings: Learning[];
}

// Pre-filter signals - memories without these are unlikely to yield learnings
const LEARNING_SIGNALS = [
  'prefer', 'like', 'love', 'enjoy', 'favorite', 'hate', 'dislike', 'avoid',
  'always', 'usually', 'typically', 'often', 'never', 'tend to', 'habit',
  "i'm", 'i am', "i've", 'i have', 'my', 'me',
  'important', 'value', 'believe', 'priority', 'matter',
  'want to', 'plan to', 'goal', 'hope to', 'aspire', 'dream',
  'work', 'job', 'career', 'project', 'team', 'colleague',
  'friend', 'family', 'partner', 'wife', 'husband', 'kid', 'child', 'parent',
  'exercise', 'diet', 'sleep', 'health', 'workout',
  'good at', 'skilled', 'expert', 'learning', 'studying',
];

/**
 * Check if memory content is likely to contain learnings
 */
function hasLearnableContent(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return LEARNING_SIGNALS.some(signal => lowerContent.includes(signal));
}

/**
 * Get or create backfill progress record
 */
async function getOrCreateProgress(
  db: D1Database,
  backfillId: string
): Promise<BackfillProgress | null> {
  const result = await db
    .prepare('SELECT * FROM learning_backfill_progress WHERE id = ?')
    .bind(backfillId)
    .first<{
      id: string;
      total_memories: number;
      processed_memories: number;
      learnings_extracted: number;
      conflicts_detected: number;
      skipped_memories: number;
      failed_memories: number;
      last_processed_id: string | null;
      started_at: string;
      updated_at: string;
      status: string;
      current_batch: number;
      total_batches: number;
    }>();

  if (!result) return null;

  return {
    totalMemories: result.total_memories,
    processedMemories: result.processed_memories,
    learningsExtracted: result.learnings_extracted,
    conflictsDetected: result.conflicts_detected,
    skippedMemories: result.skipped_memories,
    failedMemories: result.failed_memories,
    lastProcessedId: result.last_processed_id,
    startedAt: result.started_at,
    updatedAt: result.updated_at,
    status: result.status as BackfillProgress['status'],
    currentBatch: result.current_batch,
    totalBatches: result.total_batches,
  };
}

/**
 * Save backfill progress
 */
async function saveProgress(
  db: D1Database,
  backfillId: string,
  progress: BackfillProgress
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO learning_backfill_progress (
        id, total_memories, processed_memories, learnings_extracted,
        conflicts_detected, skipped_memories, failed_memories,
        last_processed_id, started_at, updated_at, status,
        current_batch, total_batches
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      backfillId,
      progress.totalMemories,
      progress.processedMemories,
      progress.learningsExtracted,
      progress.conflictsDetected,
      progress.skippedMemories,
      progress.failedMemories,
      progress.lastProcessedId,
      progress.startedAt,
      progress.updatedAt,
      progress.status,
      progress.currentBatch,
      progress.totalBatches
    )
    .run();
}

/**
 * Run backfill job
 */
export async function runLearningBackfill(
  db: D1Database,
  ai: { run: (model: string, options: unknown) => Promise<{ response: string }> },
  config: BackfillConfig,
  backfillId: string = 'default'
): Promise<BackfillResult> {
  const now = new Date().toISOString();
  const allLearnings: Learning[] = [];

  // Get or create progress
  let progress = await getOrCreateProgress(db, backfillId);

  if (!progress) {
    // Count total memories to process
    let countQuery = 'SELECT COUNT(*) as count FROM memories WHERE is_forgotten = 0';
    const countParams: (string | number)[] = [];

    if (config.userId) {
      countQuery += ' AND user_id = ?';
      countParams.push(config.userId);
    }

    if (config.startFromDate) {
      countQuery += ' AND created_at >= ?';
      countParams.push(config.startFromDate);
    }

    if (config.endAtDate) {
      countQuery += ' AND created_at <= ?';
      countParams.push(config.endAtDate);
    }

    const countResult = await db
      .prepare(countQuery)
      .bind(...countParams)
      .first<{ count: number }>();

    const totalMemories = config.maxMemories
      ? Math.min(countResult?.count || 0, config.maxMemories)
      : countResult?.count || 0;

    progress = {
      totalMemories,
      processedMemories: 0,
      learningsExtracted: 0,
      conflictsDetected: 0,
      skippedMemories: 0,
      failedMemories: 0,
      lastProcessedId: null,
      startedAt: now,
      updatedAt: now,
      status: 'running',
      currentBatch: 0,
      totalBatches: Math.ceil(totalMemories / config.batchSize),
    };

    await saveProgress(db, backfillId, progress);
  }

  // Resume from last position if paused
  if (progress.status === 'paused') {
    progress.status = 'running';
    progress.updatedAt = now;
    await saveProgress(db, backfillId, progress);
  }

  console.log(`[Backfill] Starting backfill job ${backfillId}`);
  console.log(`[Backfill] Total memories: ${progress.totalMemories}`);
  console.log(`[Backfill] Batch size: ${config.batchSize}`);
  console.log(`[Backfill] Starting from: ${progress.lastProcessedId || 'beginning'}`);

  try {
    while (progress.processedMemories < progress.totalMemories && progress.status === 'running') {
      // Fetch batch of memories
      let query = `
        SELECT id, user_id, container_tag, content, created_at
        FROM memories
        WHERE is_forgotten = 0
      `;
      const params: (string | number)[] = [];

      if (progress.lastProcessedId) {
        query += ' AND id > ?';
        params.push(progress.lastProcessedId);
      }

      if (config.userId) {
        query += ' AND user_id = ?';
        params.push(config.userId);
      }

      if (config.startFromDate) {
        query += ' AND created_at >= ?';
        params.push(config.startFromDate);
      }

      if (config.endAtDate) {
        query += ' AND created_at <= ?';
        params.push(config.endAtDate);
      }

      query += ' ORDER BY id ASC LIMIT ?';
      params.push(config.batchSize);

      const batch = await db
        .prepare(query)
        .bind(...params)
        .all<{
          id: string;
          user_id: string;
          container_tag: string;
          content: string;
          created_at: string;
        }>();

      if (!batch.results || batch.results.length === 0) {
        break;
      }

      console.log(`[Backfill] Processing batch ${progress.currentBatch + 1}/${progress.totalBatches} (${batch.results.length} memories)`);

      // Process each memory in batch
      for (const memory of batch.results) {
        try {
          // Pre-filter: skip memories unlikely to contain learnings
          if (!hasLearnableContent(memory.content)) {
            progress.skippedMemories++;
            progress.processedMemories++;
            progress.lastProcessedId = memory.id;
            continue;
          }

          // Skip very short content
          if (memory.content.length < 50) {
            progress.skippedMemories++;
            progress.processedMemories++;
            progress.lastProcessedId = memory.id;
            continue;
          }

          // Extract learnings
          const result = await extractAndSaveLearnings(
            db,
            ai,
            memory.user_id,
            memory.container_tag || 'default',
            memory.id,
            memory.content
          );

          // Track results
          const savedLearnings = result.saved || [];
          progress.learningsExtracted += savedLearnings.length;
          progress.conflictsDetected += result.conflicts?.length || 0;
          allLearnings.push(...savedLearnings);

          progress.processedMemories++;
          progress.lastProcessedId = memory.id;
        } catch (error) {
          console.error(`[Backfill] Failed to process memory ${memory.id}:`, error);
          progress.failedMemories++;
          progress.processedMemories++;
          progress.lastProcessedId = memory.id;
        }
      }

      // Update progress
      progress.currentBatch++;
      progress.updatedAt = new Date().toISOString();
      await saveProgress(db, backfillId, progress);

      console.log(`[Backfill] Progress: ${progress.processedMemories}/${progress.totalMemories} (${progress.learningsExtracted} learnings, ${progress.skippedMemories} skipped)`);

      // Delay between batches to avoid rate limiting
      if (config.delayBetweenBatches > 0 && progress.processedMemories < progress.totalMemories) {
        await new Promise(resolve => setTimeout(resolve, config.delayBetweenBatches));
      }
    }

    // Mark as completed
    progress.status = 'completed';
    progress.updatedAt = new Date().toISOString();
    await saveProgress(db, backfillId, progress);

    console.log(`[Backfill] Completed!`);
    console.log(`[Backfill] Total processed: ${progress.processedMemories}`);
    console.log(`[Backfill] Learnings extracted: ${progress.learningsExtracted}`);
    console.log(`[Backfill] Conflicts detected: ${progress.conflictsDetected}`);
    console.log(`[Backfill] Skipped: ${progress.skippedMemories}`);
    console.log(`[Backfill] Failed: ${progress.failedMemories}`);

    return {
      progress,
      learnings: allLearnings,
    };
  } catch (error) {
    console.error(`[Backfill] Job failed:`, error);
    progress.status = 'failed';
    progress.updatedAt = new Date().toISOString();
    await saveProgress(db, backfillId, progress);

    return {
      progress,
      learnings: allLearnings,
    };
  }
}

/**
 * Pause a running backfill job
 */
export async function pauseBackfill(
  db: D1Database,
  backfillId: string = 'default'
): Promise<BackfillProgress | null> {
  const progress = await getOrCreateProgress(db, backfillId);
  if (!progress) return null;

  if (progress.status === 'running') {
    progress.status = 'paused';
    progress.updatedAt = new Date().toISOString();
    await saveProgress(db, backfillId, progress);
  }

  return progress;
}

/**
 * Get backfill progress
 */
export async function getBackfillProgress(
  db: D1Database,
  backfillId: string = 'default'
): Promise<BackfillProgress | null> {
  return getOrCreateProgress(db, backfillId);
}

/**
 * Reset backfill progress (start over)
 */
export async function resetBackfill(
  db: D1Database,
  backfillId: string = 'default'
): Promise<void> {
  await db
    .prepare('DELETE FROM learning_backfill_progress WHERE id = ?')
    .bind(backfillId)
    .run();
}
