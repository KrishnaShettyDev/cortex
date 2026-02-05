/**
 * Document Processing Pipeline - Orchestrator
 *
 * Production-grade pipeline with:
 * - Full status tracking
 * - Per-step timing
 * - Error handling with retry
 * - Metrics collection
 * - Observable at every step
 *
 * Pipeline: queued → extracting → chunking → embedding → indexing → done
 */

import { nanoid } from 'nanoid';
import type {
  ProcessingJob,
  ProcessingContext,
  ProcessingStatus,
  ProcessingStep,
  ProcessingError,
} from './types';

export class ProcessingPipeline {
  private ctx: ProcessingContext;

  constructor(ctx: ProcessingContext) {
    this.ctx = ctx;
  }

  /**
   * Execute the full processing pipeline
   */
  async execute(): Promise<ProcessingJob> {
    console.log(`[Pipeline] ========== EXECUTE START ==========`);
    console.log(`[Pipeline] Context:`, {
      hasJob: !!this.ctx?.job,
      hasEnv: !!this.ctx?.env,
      hasDB: !!this.ctx?.env?.DB,
      hasAI: !!this.ctx?.env?.AI,
      hasVectorize: !!this.ctx?.env?.VECTORIZE,
    });

    const { job, env } = this.ctx;

    console.log(`[Pipeline] Starting processing for memory ${job.memoryId}`);
    console.log(`[Pipeline] User: ${job.userId}, Container: ${job.containerTag}`);
    console.log(`[Pipeline] Job ID: ${job.id}, Status: ${job.status}, Step: ${job.currentStep}`);

    try {
      // Check if memory already has embedding (created via API)
      const memory = await this.getMemory();
      const hasEmbedding = await this.checkMemoryHasEmbedding(memory.id);

      if (!hasEmbedding) {
        // Document processing path: extract → chunk → embed → index
        // Step 1: Extract content
        await this.runStep('extracting', async () => {
          const extractor = await this.getExtractor();
          this.ctx.extractorResult = await extractor.extract(this.ctx);
        });

        // Step 2: Chunk content
        await this.runStep('chunking', async () => {
          const chunker = await this.getChunker();
          this.ctx.chunkerResult = await chunker.chunk(this.ctx);
        });

        // Step 3: Generate embeddings
        await this.runStep('embedding', async () => {
          const embedder = await this.getEmbedder();
          this.ctx.embeddingResult = await embedder.embed(this.ctx);
        });

        // Step 4: Index in vector DB
        await this.runStep('indexing', async () => {
          const indexer = await this.getIndexer();
          this.ctx.indexingResult = await indexer.index(this.ctx);
        });
      } else {
        console.log(`[Pipeline] Skipping document processing steps (memory already has embedding)`);
      }

      // Step 5: Extract temporal information
      await this.runStep('temporal_extraction', async () => {
        await this.runTemporalExtraction();
      });

      // Step 5.5: Check for temporal conflicts (AUDN-style)
      // This detects if the new memory contradicts or updates existing memories
      try {
        await this.runTemporalConflictResolution();
      } catch (error) {
        // Non-blocking - conflict resolution failure shouldn't stop pipeline
        console.warn(`[Pipeline] Temporal conflict resolution failed (non-critical):`, error);
      }

      // Step 6: Extract entities and relationships
      await this.runStep('entity_extraction', async () => {
        await this.runEntityExtraction();
      });

      // Step 7: Calculate importance score
      await this.runStep('importance_scoring', async () => {
        await this.runImportanceScoring();
      });

      // Step 8: Extract commitments
      await this.runStep('commitment_extraction', async () => {
        await this.runCommitmentExtraction();
      });

      // DELETED: Step 9 (learning extraction) - cognitive layer purged for Supermemory++

      // Mark as done
      await this.markDone();

      console.log(`[Pipeline] ✓ Completed in ${job.metrics.totalDurationMs}ms`);

      // Print detailed stage breakdown for performance monitoring
      console.log(`[Pipeline] Stage Breakdown:`);
      console.log(`  extracting:        ${(job.metrics.extractionDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  chunking:          ${(job.metrics.chunkingDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  embedding:         ${(job.metrics.embeddingDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  indexing:          ${(job.metrics.indexingDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  temporal:          ${(job.metrics.temporalExtractionDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  entity_extraction: ${(job.metrics.entityExtractionDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  importance:        ${(job.metrics.importanceScoringDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  commitment:        ${(job.metrics.commitmentExtractionDurationMs || 0).toString().padStart(6)}ms`);
      console.log(`  TOTAL:             ${job.metrics.totalDurationMs.toString().padStart(6)}ms`);

      console.log(`[Pipeline] Extraction Results:`);
      console.log(`  entities:     ${job.metrics.entitiesExtracted || 0}`);
      console.log(`  relationships: ${job.metrics.relationshipsExtracted || 0}`);
      console.log(`  commitments:  ${job.metrics.commitmentsExtracted || 0}`);
      console.log(`  importance:   ${(job.metrics.importanceScore || 0).toFixed(3)}`);

      console.log(`[Pipeline] ========== EXECUTE COMPLETE ==========`);
      return job;
    } catch (error: any) {
      console.error(`[Pipeline] ========== EXECUTE FAILED ==========`);
      console.error(`[Pipeline] Error type:`, error.constructor.name);
      console.error(`[Pipeline] Error message:`, error.message);
      console.error(`[Pipeline] Error stack:`, error.stack?.substring(0, 500));

      await this.handleError(error);
      throw error;
    }
  }

  /**
   * Run a processing step with timing and error handling
   */
  private async runStep(
    step: ProcessingStatus,
    fn: () => Promise<void>
  ): Promise<void> {
    const { job } = this.ctx;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    console.log(`[Pipeline] → ${step}`);

    // Update job status
    job.currentStep = step;
    job.status = step;

    const stepRecord: ProcessingStep = {
      step,
      startedAt,
    };

    job.steps.push(stepRecord);

    try {
      // Execute step
      await fn();

      // Record completion
      const durationMs = Date.now() - startTime;
      stepRecord.completedAt = new Date().toISOString();
      stepRecord.durationMs = durationMs;

      // Update metrics
      switch (step) {
        case 'extracting':
          job.metrics.extractionDurationMs = durationMs;
          break;
        case 'chunking':
          job.metrics.chunkingDurationMs = durationMs;
          break;
        case 'embedding':
          job.metrics.embeddingDurationMs = durationMs;
          break;
        case 'indexing':
          job.metrics.indexingDurationMs = durationMs;
          break;
        case 'temporal_extraction':
          job.metrics.temporalExtractionDurationMs = durationMs;
          break;
        case 'entity_extraction':
          job.metrics.entityExtractionDurationMs = durationMs;
          if (this.ctx.entityResult) {
            job.metrics.entitiesExtracted = this.ctx.entityResult.totalEntities;
            job.metrics.relationshipsExtracted = this.ctx.entityResult.totalRelationships;
          }
          break;
        case 'importance_scoring':
          job.metrics.importanceScoringDurationMs = durationMs;
          if (this.ctx.importanceResult) {
            job.metrics.importanceScore = this.ctx.importanceResult.importanceScore;
          }
          break;
        case 'commitment_extraction':
          job.metrics.commitmentExtractionDurationMs = durationMs;
          if (this.ctx.commitmentResult) {
            job.metrics.commitmentsExtracted = this.ctx.commitmentResult.totalCommitments;
          }
          break;
        case 'learning_extraction':
          job.metrics.learningExtractionDurationMs = durationMs;
          if (this.ctx.learningResult) {
            job.metrics.learningsExtracted = this.ctx.learningResult.totalLearnings;
          }
          break;
      }

      job.updatedAt = new Date().toISOString();

      // Persist job state
      await this.saveJob();

      console.log(`[Pipeline] ✓ ${step} completed in ${durationMs}ms`);
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      stepRecord.completedAt = new Date().toISOString();
      stepRecord.durationMs = durationMs;
      stepRecord.error = error.message;

      console.error(`[Pipeline] ✗ ${step} failed after ${durationMs}ms:`, error.message);

      throw error;
    }
  }

  /**
   * Handle processing errors with retry logic
   */
  private async handleError(error: any): Promise<void> {
    const { job } = this.ctx;
    const processingError = error as ProcessingError;

    job.status = 'failed';
    job.lastError = error.message;
    job.updatedAt = new Date().toISOString();

    // Check if retryable
    if (processingError.retryable && job.retryCount < job.maxRetries) {
      job.retryCount++;
      console.log(`[Pipeline] Retry ${job.retryCount}/${job.maxRetries} scheduled`);

      // Schedule retry (if queue available)
      if (this.ctx.env.QUEUE) {
        await this.scheduleRetry();
      }
    } else {
      console.error(`[Pipeline] Processing failed permanently:`, error.message);
    }

    job.metrics.retryCount = job.retryCount;
    await this.saveJob();
  }

  /**
   * Mark job as successfully done
   */
  private async markDone(): Promise<void> {
    const { job } = this.ctx;

    job.status = 'done';
    job.currentStep = 'done';
    job.completedAt = new Date().toISOString();

    // Calculate total duration
    const createdTime = new Date(job.createdAt).getTime();
    const completedTime = new Date(job.completedAt).getTime();
    job.metrics.totalDurationMs = completedTime - createdTime;

    await this.saveJob();
  }

  /**
   * Save job state to database
   */
  private async saveJob(): Promise<void> {
    const { job, env } = this.ctx;

    await env.DB.prepare(
      `INSERT OR REPLACE INTO processing_jobs
       (id, memory_id, user_id, container_tag, status, current_step, steps, metrics, retry_count, max_retries, last_error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        job.id,
        job.memoryId,
        job.userId,
        job.containerTag,
        job.status,
        job.currentStep,
        JSON.stringify(job.steps),
        JSON.stringify(job.metrics),
        job.retryCount,
        job.maxRetries,
        job.lastError || null,
        job.createdAt,
        job.updatedAt,
        job.completedAt || null
      )
      .run();
  }

  /**
   * Schedule retry for failed job
   */
  private async scheduleRetry(): Promise<void> {
    const { job, env } = this.ctx;

    if (!env.QUEUE) {
      console.warn('[Pipeline] No queue available for retry');
      return;
    }

    const retryDelay = Math.min(1000 * Math.pow(2, job.retryCount), 60000); // Exponential backoff, max 1 min

    await env.QUEUE.send(
      {
        type: 'retry_processing',
        jobId: job.id,
        memoryId: job.memoryId,
        userId: job.userId,
        containerTag: job.containerTag,
        retryCount: job.retryCount + 1,
        timestamp: new Date().toISOString(),
      },
      { delaySeconds: Math.floor(retryDelay / 1000) }
    );

    console.log(`[Pipeline] Retry scheduled in ${retryDelay}ms`);
  }

  /**
   * Fetch memory from database (lazy load)
   */
  private async getMemory() {
    if (this.ctx.memory) return this.ctx.memory;

    const result = await this.ctx.env.DB.prepare(
      'SELECT * FROM memories WHERE id = ?'
    )
      .bind(this.ctx.job.memoryId)
      .first();

    if (!result) {
      throw new Error(`Memory ${this.ctx.job.memoryId} not found`);
    }

    this.ctx.memory = result;
    return result;
  }

  /**
   * Check if memory already has embedding in Vectorize
   */
  private async checkMemoryHasEmbedding(memoryId: string): Promise<boolean> {
    try {
      // Query Vectorize to see if this memory has a vector
      const results = await this.ctx.env.VECTORIZE.query(
        new Array(768).fill(0), // Dummy vector
        {
          filter: { memoryId },
          topK: 1,
          returnValues: false,
          returnMetadata: false,
        }
      );

      return results.matches.length > 0;
    } catch (error) {
      // If query fails, assume no embedding (will try to create)
      console.warn(`[Pipeline] Failed to check embedding existence:`, error);
      return false;
    }
  }

  /**
   * Step 5: Extract temporal information (event dates)
   * Supermemory++ Phase 2: Enhanced with multi-date extraction and memory_events storage
   */
  private async runTemporalExtraction() {
    const memory = await this.getMemory();
    const { extractTemporalData, saveMemoryEvents, updateMemoryTemporalFields } = await import('../temporal/extractor');

    try {
      // Use enhanced extractor (Supermemory++ Phase 2)
      const result = await extractTemporalData(memory.content, {
        documentDate: memory.document_date || memory.created_at,
        referenceDate: new Date(),
        useLLM: false, // Use heuristics first, can enable LLM for complex cases
        ai: this.ctx.env.AI,
      });

      // Store all extracted dates in memory_events
      if (result.dates.length > 0) {
        await saveMemoryEvents(this.ctx.env.DB, memory.id, result);
        console.log(`[Pipeline] Extracted ${result.dates.length} event dates`);
      }

      // Update memory temporal fields
      await updateMemoryTemporalFields(
        this.ctx.env.DB,
        memory.id,
        result.documentDate,
        result.hasTemporalContent
      );

      // Get primary event date (highest confidence)
      const primaryDate = result.dates[0];

      // Store result for pipeline context
      this.ctx.temporalResult = {
        eventDate: primaryDate?.date || null,
        confidence: primaryDate?.confidence || 0,
        validFrom: memory.valid_from || new Date().toISOString(),
        validTo: null,
        allDates: result.dates,
      };

      // Update memory with primary event date if confidence is high enough
      if (primaryDate && primaryDate.confidence >= 0.7) {
        await this.ctx.env.DB.prepare(
          'UPDATE memories SET event_date = ?, updated_at = ? WHERE id = ?'
        )
          .bind(primaryDate.date, new Date().toISOString(), memory.id)
          .run();

        console.log(`[Pipeline] Set event_date: ${primaryDate.date} (confidence: ${primaryDate.confidence})`);
      }
    } catch (error) {
      // Non-blocking - temporal extraction failure shouldn't stop pipeline
      console.warn(`[Pipeline] Temporal extraction failed (non-critical):`, error);
      this.ctx.temporalResult = {
        eventDate: null,
        confidence: 0,
        validFrom: memory.valid_from || new Date().toISOString(),
        validTo: null,
        allDates: [],
      };
    }
  }

  /**
   * Step 5.5: Temporal conflict resolution (AUDN-style)
   * Detects if new memory contradicts or updates existing memories
   */
  private async runTemporalConflictResolution() {
    const memory = await this.getMemory();
    const { resolveMemoryConflict } = await import('../temporal/conflict-resolver');

    // Vector search for similar memories (already done in AUDN at creation time)
    // But we do a second pass here to handle any temporal conflicts

    const similarMemories = await this.ctx.env.VECTORIZE.query(
      await this.getMemoryEmbedding(memory.id),
      {
        topK: 5,
        filter: { userId: memory.user_id },
        returnMetadata: true,
      }
    );

    if (similarMemories.matches.length === 0) {
      console.log(`[Pipeline] No similar memories found for conflict check`);
      return;
    }

    // Filter for high similarity (>0.85)
    const highSimilarity = similarMemories.matches.filter(m => m.score > 0.85);
    if (highSimilarity.length === 0) {
      return;
    }

    // Fetch full memory details
    const similarMemoryIds = highSimilarity.map(m => m.metadata.memoryId);
    const placeholders = similarMemoryIds.map(() => '?').join(',');

    const candidatesResult = await this.ctx.env.DB.prepare(`
      SELECT * FROM memories
      WHERE id IN (${placeholders})
        AND id != ?
        AND is_forgotten = 0
      ORDER BY created_at DESC
    `).bind(...similarMemoryIds, memory.id).all();

    if (candidatesResult.results.length === 0) {
      return;
    }

    // Resolve conflicts
    for (const candidate of candidatesResult.results as any[]) {
      const resolution = await resolveMemoryConflict(
        this.ctx.env.AI,
        this.ctx.env.DB,
        memory,
        candidate
      );

      console.log(`[Pipeline] Conflict resolution: ${resolution.action} (confidence: ${resolution.confidence})`);

      switch (resolution.action) {
        case 'SUPERSEDE':
          // New memory supersedes old one
          await this.ctx.env.DB.prepare(`
            UPDATE memories
            SET valid_to = ?, superseded_by = ?, updated_at = ?
            WHERE id = ?
          `).bind(
            resolution.valid_to || new Date().toISOString(),
            memory.id,
            new Date().toISOString(),
            candidate.id
          ).run();

          await this.ctx.env.DB.prepare(`
            UPDATE memories
            SET supersedes = ?, updated_at = ?
            WHERE id = ?
          `).bind(
            candidate.id,
            new Date().toISOString(),
            memory.id
          ).run();

          console.log(`[Pipeline] Superseded memory ${candidate.id} with ${memory.id}`);
          break;

        case 'NOOP':
          // Duplicate detected - this shouldn't happen as AUDN already handled it
          // but if it does, we can soft delete the new memory
          console.warn(`[Pipeline] Duplicate detected that AUDN missed: ${memory.id}`);
          break;

        default:
          // ADD or UPDATE - no action needed
          break;
      }
    }
  }

  /**
   * Get embedding for a memory (from Vectorize)
   */
  private async getMemoryEmbedding(memoryId: string): Promise<number[]> {
    const results = await this.ctx.env.VECTORIZE.query(
      new Array(768).fill(0), // Dummy query
      {
        filter: { memoryId },
        topK: 1,
        returnValues: true,
      }
    );

    if (results.matches.length > 0) {
      return results.matches[0].values;
    }

    // If no embedding found, return zero vector
    return new Array(768).fill(0);
  }

  /**
   * Step 6: Extract entities and relationships
   */
  private async runEntityExtraction() {
    const memory = await this.getMemory();
    const { job } = this.ctx;
    const { processMemoryEntities } = await import('../entities/processor');

    try {
      const result = await processMemoryEntities(
        { AI: this.ctx.env.AI, DB: this.ctx.env.DB },
        memory.id,
        job.userId,
        job.containerTag,
        memory.content,
        memory.created_at
      );

      this.ctx.entityResult = {
        entities: result.entities || [],
        relationships: result.relationships || [],
        totalEntities: result.entities?.length || 0,
        totalRelationships: result.relationships?.length || 0,
      };

      console.log(`[Pipeline] Extracted ${this.ctx.entityResult.totalEntities} entities, ${this.ctx.entityResult.totalRelationships} relationships`);
    } catch (error: any) {
      // Entity extraction failures are retriable
      const { EntityExtractionError } = await import('./types');
      throw new EntityExtractionError(`Entity extraction failed: ${error.message}`, true);
    }
  }

  /**
   * Step 7: Calculate importance score
   */
  private async runImportanceScoring() {
    const memory = await this.getMemory();
    const { job } = this.ctx;
    const { ImportanceScorer } = await import('../consolidation/importance-scorer');

    try {
      const scorer = new ImportanceScorer(this.ctx.env.DB, this.ctx.env.AI);
      const result = await scorer.scoreMemory(memory, {
        user_id: job.userId,
        current_date: new Date(),
        access_count: 0,
      });

      this.ctx.importanceResult = {
        importanceScore: result.score,
        factors: {
          content: result.factors.content,
          recency: result.factors.recency,
          access: result.factors.access,
          entities: result.factors.entities,
          commitments: result.factors.commitments,
        },
        timestamp: new Date().toISOString(),
      };

      // Update memory with importance score
      await this.ctx.env.DB.prepare(
        'UPDATE memories SET importance_score = ?, updated_at = ? WHERE id = ?'
      )
        .bind(result.score, new Date().toISOString(), memory.id)
        .run();

      console.log(`[Pipeline] Importance score: ${result.score.toFixed(3)}`);
    } catch (error) {
      // Importance scoring failures are retriable
      const { ImportanceScoringError } = await import('./types');
      throw new ImportanceScoringError(`Importance scoring failed: ${error.message}`, true);
    }
  }

  /**
   * Step 8: Extract commitments
   */
  private async runCommitmentExtraction() {
    const memory = await this.getMemory();
    const { job } = this.ctx;
    const { extractAndSaveCommitments } = await import('../commitments/extractor');

    try {
      const result = await extractAndSaveCommitments(
        this.ctx.env.DB,
        this.ctx.env.AI,
        job.userId,
        memory.id,
        memory.content
      );
      const commitments = result.saved || [];

      this.ctx.commitmentResult = {
        commitments: commitments.map(c => ({
          id: c.id,
          type: c.commitment_type,
          title: c.title,
          dueDate: c.due_date,
          confidence: c.confidence,
        })),
        totalCommitments: commitments.length,
      };

      console.log(`[Pipeline] Extracted ${commitments.length} commitments`);
    } catch (error) {
      // Non-blocking - commitment extraction failure shouldn't stop pipeline
      console.warn(`[Pipeline] Commitment extraction failed (non-critical):`, error);
      this.ctx.commitmentResult = {
        commitments: [],
        totalCommitments: 0,
      };
    }
  }

  // DELETED: runLearningExtraction() - cognitive layer purged for Supermemory++

  /**
   * Get appropriate extractor based on content type
   */
  private async getExtractor() {
    // Import extractors dynamically
    const { TextExtractor } = await import('./extractors/text');
    // Will add more: PDFExtractor, ImageExtractor, etc.

    // For now, use text extractor
    // TODO: Detect content type and use appropriate extractor
    return new TextExtractor();
  }

  /**
   * Get chunker
   */
  private async getChunker() {
    const { SmartChunker } = await import('./chunkers/smart');
    return new SmartChunker();
  }

  /**
   * Get embedder
   */
  private async getEmbedder() {
    const { CloudflareEmbedder } = await import('./embedders/cloudflare');
    return new CloudflareEmbedder();
  }

  /**
   * Get indexer
   */
  private async getIndexer() {
    const { VectorizeIndexer } = await import('./indexers/vectorize');
    return new VectorizeIndexer();
  }
}

/**
 * Create a processing job (without starting it)
 * Job will be picked up by queue consumer
 */
export async function createProcessingJob(
  env: ProcessingContext['env'],
  memoryId: string,
  userId: string,
  containerTag: string = 'default',
  maxRetries: number = 3
): Promise<ProcessingJob> {
  const job: ProcessingJob = {
    id: nanoid(),
    memoryId,
    userId,
    containerTag,
    status: 'queued',
    currentStep: 'queued',
    steps: [],
    metrics: {
      tokenCount: 0,
      wordCount: 0,
      chunkCount: 0,
      averageChunkSize: 0,
      totalDurationMs: 0,
      apiCallCount: 0,
      retryCount: 0,
    },
    retryCount: 0,
    maxRetries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    queuedAt: new Date().toISOString(),
  };

  // Save initial job state
  await env.DB.prepare(
    `INSERT INTO processing_jobs
     (id, memory_id, user_id, container_tag, status, current_step, steps, metrics, retry_count, max_retries, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      job.id,
      job.memoryId,
      job.userId,
      job.containerTag,
      job.status,
      job.currentStep,
      JSON.stringify(job.steps),
      JSON.stringify(job.metrics),
      job.retryCount,
      job.maxRetries,
      job.createdAt,
      job.updatedAt
    )
    .run();

  return job;
}

/**
 * Execute processing pipeline for a memory
 */
export async function processMemory(
  env: ProcessingContext['env'],
  memoryId: string,
  userId: string,
  containerTag: string = 'default'
): Promise<ProcessingJob> {
  // Create job
  const job = await createProcessingJob(env, memoryId, userId, containerTag);

  // Create context
  const ctx: ProcessingContext = {
    job,
    env,
  };

  // Run pipeline
  const pipeline = new ProcessingPipeline(ctx);
  return await pipeline.execute();
}

/**
 * Get processing job status
 */
export async function getProcessingStatus(
  env: ProcessingContext['env'],
  jobId: string
): Promise<ProcessingJob | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM processing_jobs WHERE id = ?'
  )
    .bind(jobId)
    .first<any>();

  if (!result) return null;

  // Map snake_case database columns to camelCase interface fields
  return {
    id: result.id,
    memoryId: result.memory_id,
    userId: result.user_id,
    containerTag: result.container_tag,
    status: result.status,
    currentStep: result.current_step,
    steps: JSON.parse(result.steps || '[]'),
    metrics: JSON.parse(result.metrics || '{}'),
    retryCount: result.retry_count || 0,
    maxRetries: result.max_retries || 3,
    lastError: result.last_error,
    createdAt: result.created_at,
    completedAt: result.completed_at,
  };
}
