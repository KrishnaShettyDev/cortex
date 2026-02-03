/**
 * Sleep-Time Compute Engine
 *
 * Orchestrates background cognitive processing.
 * Runs tasks within a time budget and tracks results.
 */

import type { D1Database, Ai } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';

import { LearningRepository } from '../learning/repository';
import { LearningExtractor } from '../learning/extractor';
import { BeliefRepository } from '../belief/repository';
import { BeliefFormationEngine } from '../belief/formation';
import { OutcomeRepository } from '../outcome/repository';
import { FeedbackPropagator } from '../outcome/propagator';
import type {
  SleepComputeConfig,
  SleepComputeResult,
  TaskResult,
  SleepTaskType,
  TriggerType,
  JobStatus,
  SessionContext,
  LearningExtractionDetails,
  BeliefFormationDetails,
  FeedbackPropagationDetails,
  ConfidenceDecayDetails,
  ConflictResolutionDetails,
  ArchivalDetails,
  SessionPrepDetails,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================
// ENGINE CLASS
// ============================================

export class SleepComputeEngine {
  private readonly config: SleepComputeConfig;
  private readonly learningRepository: LearningRepository;
  private readonly beliefRepository: BeliefRepository;
  private readonly outcomeRepository: OutcomeRepository;
  private readonly learningExtractor: LearningExtractor;
  private readonly beliefFormation: BeliefFormationEngine;
  private readonly feedbackPropagator: FeedbackPropagator;

  constructor(
    private readonly db: D1Database,
    private readonly ai: Ai,
    config: Partial<SleepComputeConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.learningRepository = new LearningRepository(db);
    this.beliefRepository = new BeliefRepository(db);
    this.outcomeRepository = new OutcomeRepository(db);
    this.learningExtractor = new LearningExtractor(db, ai as any);
    this.beliefFormation = new BeliefFormationEngine(db, ai);
    this.feedbackPropagator = new FeedbackPropagator(
      db,
      this.outcomeRepository,
      this.learningRepository,
      this.beliefRepository
    );
  }

  /**
   * Run the full sleep compute cycle for a user
   */
  async run(userId: string, triggerType: TriggerType = 'scheduled'): Promise<SleepComputeResult> {
    const jobId = nanoid();
    const startTime = Date.now();
    const tasks: TaskResult[] = [];

    console.log('[SleepCompute] Starting', { jobId, userId, triggerType });

    // Record job start
    await this.recordJobStart(jobId, userId, triggerType);

    // Define task order (priority order)
    const taskOrder: SleepTaskType[] = [
      'feedback_propagation', // First: propagate pending feedback
      'learning_extraction', // Second: extract new learnings
      'belief_formation', // Third: form beliefs from learnings
      'confidence_decay', // Fourth: decay stale items
      'conflict_resolution', // Fifth: resolve conflicts
      'archival', // Sixth: archive old items
      'session_prep', // Last: prepare session context
    ];

    // Execute tasks within time budget
    for (const taskType of taskOrder) {
      // Check time budget
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.config.timeBudgetMs) {
        console.warn('[SleepCompute] Time budget exceeded', {
          jobId,
          elapsed,
          budget: this.config.timeBudgetMs,
          remainingTasks: taskOrder.slice(taskOrder.indexOf(taskType)),
        });
        break;
      }

      const taskResult = await this.executeTask(userId, taskType, jobId);
      tasks.push(taskResult);
    }

    // Calculate totals
    const totalDurationMs = Date.now() - startTime;
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const failedTasks = tasks.filter((t) => t.status === 'failed').length;

    // Determine overall status
    let status: JobStatus = 'completed';
    if (failedTasks === tasks.length) {
      status = 'failed';
    }

    // Record job completion
    await this.recordJobComplete(jobId, status, tasks, totalDurationMs);

    // Build summary
    const summary = this.buildSummary(tasks, totalDurationMs);

    console.log('[SleepCompute] Complete', {
      jobId,
      userId,
      status,
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      durationMs: totalDurationMs,
    });

    return {
      jobId,
      userId,
      status,
      tasks,
      totalDurationMs,
      summary,
    };
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    userId: string,
    taskType: SleepTaskType,
    jobId: string
  ): Promise<TaskResult> {
    const taskStart = Date.now();

    try {
      let details: TaskResult['details'];

      switch (taskType) {
        case 'learning_extraction':
          details = await this.runLearningExtraction(userId);
          break;
        case 'belief_formation':
          details = await this.runBeliefFormation(userId);
          break;
        case 'feedback_propagation':
          details = await this.runFeedbackPropagation();
          break;
        case 'confidence_decay':
          details = await this.runConfidenceDecay(userId);
          break;
        case 'conflict_resolution':
          details = await this.runConflictResolution(userId);
          break;
        case 'archival':
          details = await this.runArchival(userId);
          break;
        case 'session_prep':
          details = await this.runSessionPrep(userId, jobId);
          break;
        default:
          return {
            taskType,
            status: 'skipped',
            durationMs: 0,
            details: {
              type: 'session_prep',
              topBeliefs: 0,
              topLearnings: 0,
              recentOutcomes: 0,
              contextGenerated: false,
            },
            error: `Unknown task type: ${taskType}`,
          };
      }

      return {
        taskType,
        status: 'completed',
        durationMs: Date.now() - taskStart,
        details,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SleepCompute] Task failed: ${taskType}`, error);

      return {
        taskType,
        status: 'failed',
        durationMs: Date.now() - taskStart,
        details: { type: taskType } as TaskResult['details'],
        error: errorMessage,
      };
    }
  }

  // ------------------------------------------
  // TASK IMPLEMENTATIONS
  // ------------------------------------------

  /**
   * Task 1: Extract learnings from unprocessed memories
   */
  private async runLearningExtraction(userId: string): Promise<LearningExtractionDetails> {
    // Get memories not yet processed for learnings
    const memoriesResult = await this.db
      .prepare(
        `
        SELECT m.id, m.user_id, m.content, m.created_at
        FROM memories m
        WHERE m.user_id = ?
          AND m.processing_status = 'done'
          AND NOT EXISTS (
            SELECT 1 FROM learning_evidence le WHERE le.memory_id = m.id
          )
        ORDER BY m.created_at DESC
        LIMIT ?
      `
      )
      .bind(userId, this.config.maxMemoriesPerRun)
      .all<{ id: string; user_id: string; content: string; created_at: string }>();

    const memories = memoriesResult.results ?? [];

    if (memories.length < 3) {
      return {
        type: 'learning_extraction',
        memoriesProcessed: 0,
        memoriesSkipped: memories.length,
        learningsExtracted: 0,
        learningsReinforced: 0,
        learningsContradicted: 0,
      };
    }

    let totalExtracted = 0;
    let totalReinforced = 0;
    let totalContradicted = 0;
    let totalProcessed = 0;
    let totalSkipped = 0;

    // Process memories individually
    for (const memory of memories) {
      try {
        const result = await this.learningExtractor.extractLearnings({
          user_id: userId,
          container_tag: 'default',
          memory_id: memory.id,
          memory_content: memory.content,
          created_at: memory.created_at,
        });

        if (result.extraction_metadata.skipped_reason) {
          totalSkipped++;
        } else {
          totalProcessed++;
          totalExtracted += result.extraction_metadata.total_extracted;
        }
      } catch (error) {
        console.error(`[SleepCompute] Learning extraction failed for memory ${memory.id}:`, error);
        totalSkipped++;
      }
    }

    return {
      type: 'learning_extraction',
      memoriesProcessed: totalProcessed,
      memoriesSkipped: totalSkipped,
      learningsExtracted: totalExtracted,
      learningsReinforced: totalReinforced,
      learningsContradicted: totalContradicted,
    };
  }

  /**
   * Task 2: Form beliefs from high-confidence learnings
   */
  private async runBeliefFormation(userId: string): Promise<BeliefFormationDetails> {
    const result = await this.beliefFormation.formBeliefsFromLearnings(userId, {
      minConfidence: 0.7,
      maxLearnings: this.config.maxLearningsForBeliefs,
    });

    return {
      type: 'belief_formation',
      learningsEvaluated: result.formed.length + result.skipped.length,
      beliefsFormed: result.formed.length,
      beliefsSkipped: result.skipped.length,
      conflictsDetected: result.conflicts.length,
    };
  }

  /**
   * Task 3: Propagate pending feedback
   */
  private async runFeedbackPropagation(): Promise<FeedbackPropagationDetails> {
    const result = await this.feedbackPropagator.processPendingPropagations(
      this.config.maxOutcomesToPropagate
    );

    let totalLearnings = 0;
    let totalBeliefs = 0;
    let totalChanges = 0;

    for (const propagation of result.results) {
      totalLearnings += propagation.learningsUpdated.length;
      totalBeliefs += propagation.beliefsUpdated.length;
      totalChanges += propagation.totalSourcesUpdated;
    }

    return {
      type: 'feedback_propagation',
      outcomesPropagated: result.processed,
      learningsUpdated: totalLearnings,
      beliefsUpdated: totalBeliefs,
      totalConfidenceChanges: totalChanges,
    };
  }

  /**
   * Task 4: Decay stale confidence scores
   */
  private async runConfidenceDecay(userId: string): Promise<ConfidenceDecayDetails> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.decayStartDays);
    const cutoffISO = cutoffDate.toISOString();

    // Decay stale learnings
    const staleLearnings = await this.db
      .prepare(
        `
        SELECT id, confidence
        FROM learnings
        WHERE user_id = ? AND status = 'active' AND updated_at < ?
        LIMIT 200
      `
      )
      .bind(userId, cutoffISO)
      .all<{ id: string; confidence: number }>();

    let learningsDecayed = 0;
    let learningsWeakened = 0;

    for (const learning of staleLearnings.results ?? []) {
      const newConfidence = learning.confidence * (1 - this.config.decayRate);

      if (newConfidence < this.config.archivalThreshold) {
        // Mark as weakened
        await this.db
          .prepare(
            `UPDATE learnings SET status = 'weakened', confidence = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(newConfidence, learning.id)
          .run();
        learningsWeakened++;
      } else {
        await this.db
          .prepare(`UPDATE learnings SET confidence = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(newConfidence, learning.id)
          .run();
      }
      learningsDecayed++;
    }

    // Decay stale beliefs
    const staleBeliefs = await this.db
      .prepare(
        `
        SELECT id, current_confidence
        FROM beliefs
        WHERE user_id = ? AND status = 'active' AND updated_at < ?
        LIMIT 200
      `
      )
      .bind(userId, cutoffISO)
      .all<{ id: string; current_confidence: number }>();

    let beliefsDecayed = 0;
    let beliefsWeakened = 0;

    for (const belief of staleBeliefs.results ?? []) {
      const newConfidence = belief.current_confidence * (1 - this.config.decayRate);

      await this.beliefRepository.applyBayesianUpdate({
        beliefId: belief.id,
        userId,
        evidenceStrength: this.config.decayRate,
        supports: false,
        reason: 'Confidence decay (no recent evidence)',
      });

      beliefsDecayed++;
      if (newConfidence < 0.3) {
        beliefsWeakened++;
      }
    }

    return {
      type: 'confidence_decay',
      learningsDecayed,
      beliefsDecayed,
      learningsWeakened,
      beliefsWeakened,
    };
  }

  /**
   * Task 5: Auto-resolve clear-cut conflicts
   */
  private async runConflictResolution(userId: string): Promise<ConflictResolutionDetails> {
    const conflicts = await this.beliefRepository.getUnresolvedConflicts(userId);

    let autoResolved = 0;
    let escalated = 0;

    for (const conflict of conflicts) {
      const beliefA = await this.beliefRepository.getBelief(conflict.beliefAId);
      const beliefB = await this.beliefRepository.getBelief(conflict.beliefBId);

      if (!beliefA || !beliefB) {
        // One belief was deleted, auto-resolve
        await this.beliefRepository.resolveConflict(conflict.id, 'One belief no longer exists');
        autoResolved++;
        continue;
      }

      // Auto-resolve if confidence gap is large enough
      const confidenceGap = Math.abs(beliefA.currentConfidence - beliefB.currentConfidence);

      if (confidenceGap >= 0.3) {
        // Clear winner - resolve in favor of higher confidence
        const winner =
          beliefA.currentConfidence >= beliefB.currentConfidence ? beliefA : beliefB;
        const loser = winner.id === beliefA.id ? beliefB : beliefA;

        await this.beliefRepository.resolveConflict(
          conflict.id,
          `Auto-resolved: "${winner.proposition}" (${(winner.currentConfidence * 100).toFixed(0)}%) vs "${loser.proposition}" (${(loser.currentConfidence * 100).toFixed(0)}%)`,
          winner.id
        );

        // Weaken the loser
        await this.beliefRepository.updateBeliefStatus(loser.id, userId, 'uncertain');

        autoResolved++;
      } else {
        // Too close to call - leave for user
        escalated++;
      }
    }

    return {
      type: 'conflict_resolution',
      conflictsEvaluated: conflicts.length,
      conflictsAutoResolved: autoResolved,
      conflictsEscalated: escalated,
    };
  }

  /**
   * Task 6: Archive old/low-confidence items
   */
  private async runArchival(userId: string): Promise<ArchivalDetails> {
    const archivalDate = new Date();
    archivalDate.setDate(archivalDate.getDate() - this.config.archivalDays);
    const archivalISO = archivalDate.toISOString();

    // Archive low-confidence learnings
    const learningResult = await this.db
      .prepare(
        `
        UPDATE learnings
        SET status = 'archived', updated_at = datetime('now')
        WHERE user_id = ?
          AND status IN ('active', 'weakened')
          AND confidence < ?
          AND updated_at < ?
      `
      )
      .bind(userId, this.config.archivalThreshold, archivalISO)
      .run();

    // Archive low-confidence beliefs
    const beliefResult = await this.db
      .prepare(
        `
        UPDATE beliefs
        SET status = 'archived', updated_at = datetime('now')
        WHERE user_id = ?
          AND status IN ('active', 'uncertain')
          AND current_confidence < ?
          AND updated_at < ?
      `
      )
      .bind(userId, this.config.archivalThreshold, archivalISO)
      .run();

    // Archive old outcomes (older than 180 days)
    const outcomeArchivalDate = new Date();
    outcomeArchivalDate.setDate(outcomeArchivalDate.getDate() - 180);

    const outcomeResult = await this.db
      .prepare(
        `
        DELETE FROM outcomes
        WHERE user_id = ?
          AND action_at < ?
          AND feedback_propagated = 1
      `
      )
      .bind(userId, outcomeArchivalDate.toISOString())
      .run();

    return {
      type: 'archival',
      learningsArchived: learningResult.meta?.changes ?? 0,
      beliefsArchived: beliefResult.meta?.changes ?? 0,
      outcomesArchived: outcomeResult.meta?.changes ?? 0,
    };
  }

  /**
   * Task 7: Pre-compute session context
   */
  private async runSessionPrep(userId: string, jobId: string): Promise<SessionPrepDetails> {
    const limit = this.config.sessionPrepLimit;

    // Get top beliefs
    const beliefsResult = await this.beliefRepository.queryBeliefs({
      userId,
      status: ['active'],
      limit,
      orderBy: 'confidence',
      orderDirection: 'desc',
    });
    const beliefs = beliefsResult.beliefs;

    // Get top learnings
    const learningsResult = await this.learningRepository.listLearnings(userId, {
      status: 'active',
      limit,
      sortBy: 'confidence',
      sortOrder: 'desc',
    });
    const learnings = learningsResult.learnings;

    // Get outcome stats
    const outcomeStats = await this.outcomeRepository.getStats(userId);

    // Get pending items
    const conflicts = await this.beliefRepository.getUnresolvedConflicts(userId);

    const weakenedBeliefs = await this.db
      .prepare(`SELECT COUNT(*) as count FROM beliefs WHERE user_id = ? AND status = 'uncertain'`)
      .bind(userId)
      .first<{ count: number }>();

    const uncertainLearnings = await this.db
      .prepare(`SELECT COUNT(*) as count FROM learnings WHERE user_id = ? AND status = 'weakened'`)
      .bind(userId)
      .first<{ count: number }>();

    // Build session context
    const context: SessionContext = {
      userId,
      generatedAt: new Date().toISOString(),
      topBeliefs: beliefs.slice(0, 10).map((b) => ({
        id: b.id,
        proposition: b.proposition,
        confidence: b.currentConfidence,
        domain: b.domain,
      })),
      topLearnings: learnings.slice(0, 10).map((l) => ({
        id: l.id,
        statement: l.statement,
        confidence: l.confidence,
        category: l.category,
      })),
      recentOutcomes: {
        total: outcomeStats.total,
        positiveRate: outcomeStats.positiveRate,
        topEffectiveSources: [],
      },
      pendingItems: {
        unresolvedConflicts: conflicts.length,
        weakenedBeliefs: weakenedBeliefs?.count ?? 0,
        uncertainLearnings: uncertainLearnings?.count ?? 0,
      },
    };

    // Save session context
    await this.db
      .prepare(
        `
        INSERT INTO session_contexts (id, user_id, context_data, generated_at, generated_by_job, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .bind(
        nanoid(),
        userId,
        JSON.stringify(context),
        context.generatedAt,
        jobId,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h expiry
      )
      .run();

    return {
      type: 'session_prep',
      topBeliefs: beliefs.length,
      topLearnings: learnings.length,
      recentOutcomes: outcomeStats.total,
      contextGenerated: true,
    };
  }

  // ------------------------------------------
  // JOB TRACKING
  // ------------------------------------------

  private async recordJobStart(
    jobId: string,
    userId: string,
    triggerType: TriggerType
  ): Promise<void> {
    await this.db
      .prepare(
        `
        INSERT INTO sleep_jobs (id, user_id, trigger_type, status, started_at, created_at)
        VALUES (?, ?, ?, 'running', ?, datetime('now'))
      `
      )
      .bind(jobId, userId, triggerType, new Date().toISOString())
      .run();
  }

  private async recordJobComplete(
    jobId: string,
    status: JobStatus,
    tasks: TaskResult[],
    durationMs: number
  ): Promise<void> {
    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');

    await this.db
      .prepare(
        `
        UPDATE sleep_jobs
        SET
          status = ?,
          tasks_completed = ?,
          tasks_failed = ?,
          total_tasks = ?,
          completed_tasks = ?,
          failed_tasks = ?,
          completed_at = ?,
          duration_ms = ?
        WHERE id = ?
      `
      )
      .bind(
        status,
        JSON.stringify(completed),
        JSON.stringify(failed),
        tasks.length,
        completed.length,
        failed.length,
        new Date().toISOString(),
        durationMs,
        jobId
      )
      .run();
  }

  /**
   * Build human-readable summary
   */
  private buildSummary(tasks: TaskResult[], durationMs: number): string {
    const parts: string[] = [`Sleep compute completed in ${durationMs}ms.`];

    for (const task of tasks) {
      if (task.status === 'failed') {
        parts.push(`[FAIL] ${task.taskType}: ${task.error}`);
        continue;
      }

      if (task.status === 'skipped') {
        continue;
      }

      const d = task.details;
      switch (d.type) {
        case 'learning_extraction':
          if (d.learningsExtracted > 0) {
            parts.push(
              `Extracted ${d.learningsExtracted} learnings from ${d.memoriesProcessed} memories`
            );
          }
          break;
        case 'belief_formation':
          if (d.beliefsFormed > 0) {
            parts.push(`Formed ${d.beliefsFormed} new beliefs`);
          }
          break;
        case 'feedback_propagation':
          if (d.outcomesPropagated > 0) {
            parts.push(`Propagated ${d.outcomesPropagated} feedback items`);
          }
          break;
        case 'confidence_decay':
          if (d.learningsDecayed > 0 || d.beliefsDecayed > 0) {
            parts.push(`Decayed ${d.learningsDecayed} learnings, ${d.beliefsDecayed} beliefs`);
          }
          break;
        case 'conflict_resolution':
          if (d.conflictsAutoResolved > 0) {
            parts.push(`Auto-resolved ${d.conflictsAutoResolved} conflicts`);
          }
          break;
        case 'archival':
          if (d.learningsArchived > 0 || d.beliefsArchived > 0) {
            parts.push(`Archived ${d.learningsArchived} learnings, ${d.beliefsArchived} beliefs`);
          }
          break;
        case 'session_prep':
          if (d.contextGenerated) {
            parts.push(`Session context prepared (${d.topBeliefs} beliefs, ${d.topLearnings} learnings)`);
          }
          break;
      }
    }

    return parts.join(' ');
  }
}
