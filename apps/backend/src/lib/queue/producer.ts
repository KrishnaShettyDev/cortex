/**
 * Queue Producer
 *
 * Sends processing jobs to Cloudflare Queue for async execution.
 */

export interface ProcessingJobMessage {
  type: 'process_memory';
  jobId: string;
  memoryId: string;
  userId: string;
  containerTag: string;
  timestamp: string;
}

export interface RetryJobMessage {
  type: 'retry_processing';
  jobId: string;
  memoryId: string;
  userId: string;
  containerTag: string;
  retryCount: number;
  timestamp: string;
}

export type QueueMessage = ProcessingJobMessage | RetryJobMessage;

/**
 * Send processing job to queue
 */
export async function enqueueProcessingJob(
  queue: Queue<QueueMessage>,
  jobId: string,
  memoryId: string,
  userId: string,
  containerTag: string
): Promise<void> {
  const message: ProcessingJobMessage = {
    type: 'process_memory',
    jobId,
    memoryId,
    userId,
    containerTag,
    timestamp: new Date().toISOString(),
  };

  await queue.send(message);
  console.log(`[Queue] Enqueued job ${jobId} for memory ${memoryId}`);
}

/**
 * Send retry job to queue (with delay)
 */
export async function enqueueRetryJob(
  queue: Queue<QueueMessage>,
  jobId: string,
  memoryId: string,
  userId: string,
  containerTag: string,
  retryCount: number,
  delaySeconds: number
): Promise<void> {
  const message: RetryJobMessage = {
    type: 'retry_processing',
    jobId,
    memoryId,
    userId,
    containerTag,
    retryCount,
    timestamp: new Date().toISOString(),
  };

  await queue.send(message, { delaySeconds });
  console.log(
    `[Queue] Enqueued retry ${retryCount} for job ${jobId} (delay: ${delaySeconds}s)`
  );
}

/**
 * Send batch of jobs to queue
 */
export async function enqueueBatch(
  queue: Queue<QueueMessage>,
  messages: QueueMessage[]
): Promise<void> {
  if (messages.length === 0) return;

  await queue.sendBatch(messages.map((body) => ({ body })));
  console.log(`[Queue] Enqueued batch of ${messages.length} jobs`);
}
