/**
 * Cloudflare Queue Consumer Worker
 *
 * Dedicated worker for processing async jobs from the queue.
 * Runs independently from the main API worker.
 */

import { handleQueueBatch, type QueueEnv } from './lib/queue/consumer';
import type { QueueMessage } from './lib/queue/producer';

export default {
  /**
   * Queue handler - called by Cloudflare for each batch of messages
   */
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: QueueEnv
  ): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
