/**
 * Queue Consumer
 *
 * Processes async jobs from Cloudflare Queue.
 * Handles processing jobs and retries.
 */

import { ProcessingPipeline, getProcessingStatus } from '../processing/pipeline';
import type { QueueMessage } from './producer';
import type { Bindings } from '../../types';

export interface QueueEnv extends Bindings {
  PROCESSING_QUEUE: Queue<QueueMessage>;
}

/**
 * Queue consumer handler
 * Called by Cloudflare Workers for each batch of messages
 */
export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: QueueEnv
): Promise<void> {
  console.log(`[Queue Consumer] ========================================`);
  console.log(`[Queue Consumer] Processing batch of ${batch.messages.length} messages`);
  console.log(`[Queue Consumer] Queue name: ${batch.queue}`);

  // Validate env bindings
  console.log(`[Queue Consumer] Env bindings:`, {
    hasDB: !!env.DB,
    hasAI: !!env.AI,
    hasVectorize: !!env.VECTORIZE,
    hasQueue: !!env.PROCESSING_QUEUE,
  });

  // Process messages in parallel (with concurrency limit)
  const CONCURRENCY = 5;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < batch.messages.length; i += CONCURRENCY) {
    const chunk = batch.messages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((message) => processMessage(message, env))
    );

    // Track results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failCount++;
        console.error(`[Queue Consumer] Message failed:`, result.reason);
      }
    }
  }

  console.log(`[Queue Consumer] Batch complete: ${successCount} succeeded, ${failCount} failed`);
  console.log(`[Queue Consumer] ========================================`);
}

/**
 * Non-retryable error types
 */
const NON_RETRYABLE_ERRORS = [
  'Memory not found',
  'Job not found',
  'Invalid message type',
  'Memory already processed',
];

/**
 * Process single queue message
 */
async function processMessage(
  message: Message<QueueMessage>,
  env: QueueEnv
): Promise<void> {
  const { body, id } = message;

  try {
    console.log(`[Queue Consumer] Processing message ${id}: ${body.type}`);
    console.log(`[Queue Consumer] Message body:`, JSON.stringify(body));

    switch (body.type) {
      case 'process_memory':
        await processMemoryJob(body, env);
        break;

      case 'retry_processing':
        await retryProcessingJob(body, env);
        break;

      default:
        console.warn(`[Queue Consumer] Unknown message type:`, body);
        // Don't retry unknown message types - ack and discard
        message.ack();
        return;
    }

    // Acknowledge message (success)
    console.log(`[Queue Consumer] ✓ Message ${id} processed successfully`);
    message.ack();
  } catch (error: any) {
    console.error(`[Queue Consumer] Message ${id} processing failed:`);
    console.error(`[Queue Consumer] Error name: ${error.name}`);
    console.error(`[Queue Consumer] Error message: ${error.message}`);
    console.error(`[Queue Consumer] Error stack: ${error.stack?.substring(0, 300)}`);

    // Check if error is non-retryable
    const isNonRetryable = NON_RETRYABLE_ERRORS.some(msg =>
      error.message?.includes(msg)
    );

    if (isNonRetryable) {
      console.warn(`[Queue Consumer] Non-retryable error, acking message`);
      message.ack();
    } else {
      console.log(`[Queue Consumer] Retryable error, scheduling retry`);
      message.retry();
    }
  }
}

/**
 * Process memory job from queue
 */
async function processMemoryJob(
  message: { jobId: string; memoryId: string; userId: string; containerTag: string },
  env: QueueEnv
): Promise<void> {
  const { jobId, memoryId, userId, containerTag } = message;

  console.log(`[Queue Consumer] Processing job ${jobId} for memory ${memoryId}`);

  // Get job from database
  const job = await getProcessingStatus(env, jobId);
  if (!job) {
    console.error(`[Queue Consumer] Job ${jobId} not found in database`);
    return;
  }

  // Verify job is still pending (not already processed)
  if (job.status !== 'queued') {
    console.warn(`[Queue Consumer] Job ${jobId} already in status: ${job.status}`);
    return;
  }

  // Create processing context
  const ctx = {
    job,
    env: {
      DB: env.DB,
      VECTORIZE: env.VECTORIZE,
      AI: env.AI,
      QUEUE: env.PROCESSING_QUEUE,
    },
  };

  // Run pipeline
  const pipeline = new ProcessingPipeline(ctx);
  await pipeline.execute();

  console.log(`[Queue Consumer] ✓ Job ${jobId} completed successfully`);
}

/**
 * Retry failed processing job
 */
async function retryProcessingJob(
  message: {
    jobId: string;
    memoryId: string;
    userId: string;
    containerTag: string;
    retryCount: number;
  },
  env: QueueEnv
): Promise<void> {
  const { jobId, memoryId, retryCount } = message;

  console.log(`[Queue Consumer] Retrying job ${jobId} (attempt ${retryCount})`);

  // Get job from database
  const job = await getProcessingStatus(env, jobId);
  if (!job) {
    console.error(`[Queue Consumer] Retry job ${jobId} not found`);
    return;
  }

  // Verify job failed
  if (job.status !== 'failed') {
    console.warn(`[Queue Consumer] Job ${jobId} is not in failed status: ${job.status}`);
    return;
  }

  // Reset job to queued for retry
  await env.DB.prepare(
    `UPDATE processing_jobs
     SET status = 'queued',
         current_step = 'queued',
         updated_at = ?
     WHERE id = ?`
  )
    .bind(new Date().toISOString(), jobId)
    .run();

  // Process with updated job
  const updatedJob = await getProcessingStatus(env, jobId);
  if (!updatedJob) {
    console.error(`[Queue Consumer] Failed to get updated job ${jobId}`);
    return;
  }

  const ctx = {
    job: updatedJob,
    env: {
      DB: env.DB,
      VECTORIZE: env.VECTORIZE,
      AI: env.AI,
      QUEUE: env.PROCESSING_QUEUE,
    },
  };

  const pipeline = new ProcessingPipeline(ctx);
  await pipeline.execute();

  console.log(`[Queue Consumer] ✓ Retry ${retryCount} for job ${jobId} completed`);
}
