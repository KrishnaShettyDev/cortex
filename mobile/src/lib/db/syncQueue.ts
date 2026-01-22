import {
  getPendingMutations,
  updateMutationStatus,
  deleteMutation,
  markMemorySynced,
  deleteLocalMemory,
  getUnsyncedMemories,
  MutationQueueItem,
} from './database';
import { api } from '../../services/api';
import { addBreadcrumb, captureException } from '../sentry';
import { useAppStore } from '../../stores/appStore';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // Exponential backoff

interface SyncResult {
  success: number;
  failed: number;
  errors: string[];
}

// Process a single mutation
const processMutation = async (mutation: MutationQueueItem): Promise<boolean> => {
  try {
    await updateMutationStatus(mutation.id, 'processing');

    const payload = mutation.payload ? JSON.parse(mutation.payload) : undefined;
    const headers = mutation.headers ? JSON.parse(mutation.headers) : undefined;

    // Make the API request
    await api.request(mutation.endpoint, {
      method: mutation.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      body: payload,
      headers,
    });

    // Mark as completed and delete
    await deleteMutation(mutation.id);

    addBreadcrumb('sync', 'Mutation processed successfully', {
      type: mutation.type,
      endpoint: mutation.endpoint,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (mutation.retries >= MAX_RETRIES) {
      await updateMutationStatus(mutation.id, 'failed', errorMessage);
      addBreadcrumb('sync', 'Mutation failed permanently', {
        type: mutation.type,
        error: errorMessage,
      });
    } else {
      await updateMutationStatus(mutation.id, 'pending', errorMessage);
    }

    return false;
  }
};

// Process all pending mutations
export const processQueue = async (): Promise<SyncResult> => {
  const { isOnline, isApiHealthy } = useAppStore.getState();

  if (!isOnline || !isApiHealthy) {
    return { success: 0, failed: 0, errors: ['Offline or API unavailable'] };
  }

  const mutations = await getPendingMutations();
  const result: SyncResult = { success: 0, failed: 0, errors: [] };

  for (const mutation of mutations) {
    // Check if we should retry based on retries count and delay
    const delay = RETRY_DELAYS[Math.min(mutation.retries, RETRY_DELAYS.length - 1)];
    const timeSinceCreated = Date.now() - new Date(mutation.created_at).getTime();

    if (mutation.retries > 0 && timeSinceCreated < delay) {
      continue; // Skip this mutation, not ready for retry yet
    }

    const success = await processMutation(mutation);
    if (success) {
      result.success++;
    } else {
      result.failed++;
      if (mutation.last_error) {
        result.errors.push(mutation.last_error);
      }
    }

    // Small delay between mutations to avoid overwhelming the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return result;
};

// Sync locally cached memories with server
export const syncMemories = async (): Promise<SyncResult> => {
  const { isOnline, isApiHealthy } = useAppStore.getState();

  if (!isOnline || !isApiHealthy) {
    return { success: 0, failed: 0, errors: ['Offline or API unavailable'] };
  }

  const unsyncedMemories = await getUnsyncedMemories();
  const result: SyncResult = { success: 0, failed: 0, errors: [] };

  for (const memory of unsyncedMemories) {
    try {
      if (memory.pending_delete) {
        // Memory was marked for deletion
        await api.request(`/memories/${memory.id}`, { method: 'DELETE' });
        await deleteLocalMemory(memory.id);
      } else if (memory.id.startsWith('local-')) {
        // New memory created offline, sync to server
        const entities = memory.entities ? JSON.parse(memory.entities) : [];
        const response = await api.request<{ id: string }>('/memories', {
          method: 'POST',
          body: {
            content: memory.content,
            memory_type: memory.memory_type,
            source: memory.source,
            media_url: memory.media_url,
            entities,
          },
        });

        // Update local ID with server ID
        await deleteLocalMemory(memory.id);
        await import('./database').then(({ saveMemoryLocally }) =>
          saveMemoryLocally({
            ...memory,
            id: response.id,
            synced: 1,
          })
        );
      } else {
        // Existing memory, just mark as synced
        await markMemorySynced(memory.id);
      }

      result.success++;
    } catch (error) {
      result.failed++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Memory ${memory.id}: ${errorMessage}`);
      captureException(error as Error, {
        context: 'sync_memory',
        memoryId: memory.id,
      });
    }
  }

  return result;
};

// Full sync - process queue and sync memories
export const fullSync = async (): Promise<{
  queue: SyncResult;
  memories: SyncResult;
}> => {
  addBreadcrumb('sync', 'Starting full sync');

  const [queueResult, memoriesResult] = await Promise.all([
    processQueue(),
    syncMemories(),
  ]);

  addBreadcrumb('sync', 'Full sync completed', {
    queueSuccess: queueResult.success,
    queueFailed: queueResult.failed,
    memoriesSuccess: memoriesResult.success,
    memoriesFailed: memoriesResult.failed,
  });

  return {
    queue: queueResult,
    memories: memoriesResult,
  };
};

// Background sync interval
let syncInterval: NodeJS.Timeout | null = null;

export const startBackgroundSync = (intervalMs = 60000): void => {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    const { isOnline, isApiHealthy } = useAppStore.getState();
    if (isOnline && isApiHealthy) {
      await fullSync();
    }
  }, intervalMs);

  addBreadcrumb('sync', 'Background sync started', { intervalMs });
};

export const stopBackgroundSync = (): void => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    addBreadcrumb('sync', 'Background sync stopped');
  }
};
