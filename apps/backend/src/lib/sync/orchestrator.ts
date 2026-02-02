/**
 * Sync Orchestrator
 *
 * Coordinates all sync operations:
 * - Manages sync connections and their state
 * - Schedules and runs syncs (manual + scheduled)
 * - Handles sync logging and error recovery
 * - Calculates next sync times based on frequency
 */

import { nanoid } from 'nanoid';
import type { Bindings } from '../../types';
import { syncGmail, type GmailSyncResult } from './gmail';
import { syncCalendar, type CalendarSyncResult } from './calendar';

export type SyncProvider = 'gmail' | 'google_calendar';
export type SyncFrequency = 'realtime' | 'hourly' | 'daily' | 'manual';
export type SyncType = 'full' | 'delta' | 'manual' | 'scheduled';
export type SyncStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncConnection {
  id: string;
  user_id: string;
  container_tag: string;
  provider: SyncProvider;
  composio_account_id: string;
  is_active: boolean;
  sync_enabled: boolean;
  sync_frequency: SyncFrequency;
  last_sync_at?: string;
  next_sync_at?: string;
  sync_cursor?: string; // historyId for Gmail, syncToken for Calendar
  sync_stats?: {
    items_synced: number;
    errors: number;
    last_duration_ms: number;
    last_error?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  connection_id: string;
  sync_type: SyncType;
  status: SyncStatus;
  items_processed: number;
  memories_created: number;
  profiles_discovered: number;
  errors?: string[];
  error_count: number;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  cursor_before?: string;
  cursor_after?: string;
  trigger_source: 'scheduled' | 'manual' | 'webhook' | 'initial';
}

export interface SyncOrchestratorOptions {
  connectionId: string;
  triggerSource: 'scheduled' | 'manual' | 'webhook' | 'initial';
  forceFull?: boolean; // Force full sync even if cursor exists
}

export class SyncOrchestrator {
  private db: D1Database;
  private env: Bindings;

  constructor(env: Bindings) {
    this.db = env.DB;
    this.env = env;
  }

  /**
   * Run sync for a specific connection
   */
  async runSync(options: SyncOrchestratorOptions): Promise<SyncLog> {
    const startTime = Date.now();
    const { connectionId, triggerSource, forceFull } = options;

    console.log(`[SyncOrchestrator] Starting sync for connection ${connectionId}`);

    // Get connection details
    const connection = await this.getSyncConnection(connectionId);
    if (!connection) {
      throw new Error(`Sync connection ${connectionId} not found`);
    }

    if (!connection.is_active) {
      throw new Error(`Sync connection ${connectionId} is not active`);
    }

    // Create sync log
    const logId = nanoid();
    const syncType: SyncType = triggerSource === 'manual' ? 'manual' :
                                 triggerSource === 'scheduled' ? 'scheduled' :
                                 (connection.sync_cursor && !forceFull) ? 'delta' : 'full';

    await this.createSyncLog({
      id: logId,
      connection_id: connectionId,
      sync_type: syncType,
      status: 'running',
      items_processed: 0,
      memories_created: 0,
      profiles_discovered: 0,
      error_count: 0,
      started_at: new Date().toISOString(),
      cursor_before: connection.sync_cursor,
      trigger_source: triggerSource,
    });

    try {
      // Run appropriate sync based on provider
      let result: GmailSyncResult | CalendarSyncResult;

      if (connection.provider === 'gmail') {
        result = await syncGmail(this.env, {
          userId: connection.user_id,
          connectedAccountId: connection.composio_account_id,
          containerTag: connection.container_tag,
          syncType: forceFull ? 'full' : (connection.sync_cursor ? 'delta' : 'full'),
          historyId: forceFull ? undefined : connection.sync_cursor,
          maxEmails: 100,
        });
      } else if (connection.provider === 'google_calendar') {
        result = await syncCalendar(this.env, {
          userId: connection.user_id,
          connectedAccountId: connection.composio_account_id,
          containerTag: connection.container_tag,
          syncType: forceFull ? 'full' : (connection.sync_cursor ? 'delta' : 'full'),
          syncToken: forceFull ? undefined : connection.sync_cursor,
          maxEvents: 250,
        });
      } else {
        throw new Error(`Unsupported provider: ${connection.provider}`);
      }

      const durationMs = Date.now() - startTime;

      // Update sync log
      await this.updateSyncLog(logId, {
        status: result.success ? 'completed' : 'failed',
        items_processed: result.emailsProcessed || result.eventsProcessed,
        memories_created: result.memoriesCreated,
        profiles_discovered: result.profilesDiscovered || 0,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : undefined,
        error_count: result.errors.length,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        cursor_after: result.nextHistoryId || result.nextSyncToken,
      });

      // Update connection
      const nextSyncAt = this.calculateNextSync(connection.sync_frequency);
      await this.updateSyncConnection(connectionId, {
        last_sync_at: new Date().toISOString(),
        next_sync_at: nextSyncAt,
        sync_cursor: result.nextHistoryId || result.nextSyncToken,
        sync_stats: {
          items_synced: result.emailsProcessed || result.eventsProcessed,
          errors: result.errors.length,
          last_duration_ms: durationMs,
          last_error: result.errors.length > 0 ? result.errors[0] : undefined,
        },
      });

      console.log(
        `[SyncOrchestrator] Sync completed for ${connection.provider}: ` +
        `${result.emailsProcessed || result.eventsProcessed} items → ${result.memoriesCreated} memories (${durationMs}ms)`
      );

      return await this.getSyncLog(logId);
    } catch (error: any) {
      console.error(`[SyncOrchestrator] Sync failed:`, error);

      // Mark sync log as failed
      await this.updateSyncLog(logId, {
        status: 'failed',
        errors: JSON.stringify([error.message]),
        error_count: 1,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      // Update connection
      await this.updateSyncConnection(connectionId, {
        sync_stats: {
          items_synced: 0,
          errors: 1,
          last_duration_ms: Date.now() - startTime,
          last_error: error.message,
        },
      });

      throw error;
    }
  }

  /**
   * Run all scheduled syncs that are due
   */
  async runScheduledSyncs(): Promise<{ synced: number; failed: number; skipped: number }> {
    const now = new Date().toISOString();

    console.log(`[SyncOrchestrator] Running scheduled syncs at ${now}`);

    // Get all connections due for sync
    const connections = await this.db.prepare(`
      SELECT id, user_id, provider
      FROM sync_connections
      WHERE is_active = 1
        AND sync_enabled = 1
        AND next_sync_at IS NOT NULL
        AND next_sync_at <= ?
      ORDER BY next_sync_at ASC
      LIMIT 50
    `).bind(now).all();

    const results = {
      synced: 0,
      failed: 0,
      skipped: 0,
    };

    console.log(`[SyncOrchestrator] Found ${connections.results?.length || 0} connections due for sync`);

    for (const conn of (connections.results || []) as any[]) {
      try {
        await this.runSync({
          connectionId: conn.id,
          triggerSource: 'scheduled',
        });
        results.synced++;
      } catch (error: any) {
        console.error(`[SyncOrchestrator] Failed to sync connection ${conn.id}:`, error);
        results.failed++;
      }
    }

    console.log(
      `[SyncOrchestrator] Scheduled syncs complete: ${results.synced} synced, ${results.failed} failed`
    );

    return results;
  }

  /**
   * Calculate next sync time based on frequency
   */
  private calculateNextSync(frequency: SyncFrequency): string | null {
    const now = new Date();

    switch (frequency) {
      case 'realtime':
        // Realtime = every 5 minutes (polling)
        return new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      case 'manual':
        // Manual syncs don't schedule next sync
        return null;
      default:
        return null;
    }
  }

  /**
   * Get sync connection by ID
   */
  async getSyncConnection(connectionId: string): Promise<SyncConnection | null> {
    const result = await this.db.prepare(`
      SELECT * FROM sync_connections WHERE id = ?
    `).bind(connectionId).first();

    if (!result) return null;

    return {
      ...result,
      is_active: result.is_active === 1,
      sync_enabled: result.sync_enabled === 1,
      sync_stats: result.sync_stats ? JSON.parse(result.sync_stats as string) : undefined,
    } as SyncConnection;
  }

  /**
   * Create sync connection
   */
  async createSyncConnection(params: {
    userId: string;
    containerTag: string;
    provider: SyncProvider;
    composioAccountId: string;
    syncFrequency?: SyncFrequency;
  }): Promise<SyncConnection> {
    const id = nanoid();
    const now = new Date().toISOString();
    const syncFrequency = params.syncFrequency || 'hourly';
    const nextSyncAt = this.calculateNextSync(syncFrequency);

    await this.db.prepare(`
      INSERT INTO sync_connections (
        id, user_id, container_tag, provider, composio_account_id,
        is_active, sync_enabled, sync_frequency, next_sync_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
    `).bind(
      id,
      params.userId,
      params.containerTag,
      params.provider,
      params.composioAccountId,
      syncFrequency,
      nextSyncAt,
      now,
      now
    ).run();

    return (await this.getSyncConnection(id))!;
  }

  /**
   * Update sync connection
   */
  async updateSyncConnection(
    connectionId: string,
    updates: {
      last_sync_at?: string;
      next_sync_at?: string | null;
      sync_cursor?: string;
      sync_stats?: any;
      is_active?: boolean;
      sync_enabled?: boolean;
      sync_frequency?: SyncFrequency;
    }
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.last_sync_at !== undefined) {
      sets.push('last_sync_at = ?');
      params.push(updates.last_sync_at);
    }
    if (updates.next_sync_at !== undefined) {
      sets.push('next_sync_at = ?');
      params.push(updates.next_sync_at);
    }
    if (updates.sync_cursor !== undefined) {
      sets.push('sync_cursor = ?');
      params.push(updates.sync_cursor);
    }
    if (updates.sync_stats !== undefined) {
      sets.push('sync_stats = ?');
      params.push(JSON.stringify(updates.sync_stats));
    }
    if (updates.is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }
    if (updates.sync_enabled !== undefined) {
      sets.push('sync_enabled = ?');
      params.push(updates.sync_enabled ? 1 : 0);
    }
    if (updates.sync_frequency !== undefined) {
      sets.push('sync_frequency = ?');
      params.push(updates.sync_frequency);
    }

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());

    params.push(connectionId);

    await this.db.prepare(`
      UPDATE sync_connections
      SET ${sets.join(', ')}
      WHERE id = ?
    `).bind(...params).run();
  }

  /**
   * Create sync log
   */
  async createSyncLog(log: Omit<SyncLog, 'completed_at' | 'duration_ms' | 'cursor_after'>): Promise<void> {
    await this.db.prepare(`
      INSERT INTO sync_logs (
        id, connection_id, sync_type, status, items_processed, memories_created,
        profiles_discovered, errors, error_count, started_at, cursor_before, trigger_source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      log.id,
      log.connection_id,
      log.sync_type,
      log.status,
      log.items_processed,
      log.memories_created,
      log.profiles_discovered,
      log.errors ? JSON.stringify(log.errors) : null,
      log.error_count,
      log.started_at,
      log.cursor_before || null,
      log.trigger_source
    ).run();
  }

  /**
   * Update sync log
   */
  async updateSyncLog(
    logId: string,
    updates: Partial<Pick<SyncLog, 'status' | 'items_processed' | 'memories_created' | 'profiles_discovered' | 'errors' | 'error_count' | 'completed_at' | 'duration_ms' | 'cursor_after'>>
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.items_processed !== undefined) {
      sets.push('items_processed = ?');
      params.push(updates.items_processed);
    }
    if (updates.memories_created !== undefined) {
      sets.push('memories_created = ?');
      params.push(updates.memories_created);
    }
    if (updates.profiles_discovered !== undefined) {
      sets.push('profiles_discovered = ?');
      params.push(updates.profiles_discovered);
    }
    if (updates.errors) {
      sets.push('errors = ?');
      params.push(updates.errors);
    }
    if (updates.error_count !== undefined) {
      sets.push('error_count = ?');
      params.push(updates.error_count);
    }
    if (updates.completed_at) {
      sets.push('completed_at = ?');
      params.push(updates.completed_at);
    }
    if (updates.duration_ms !== undefined) {
      sets.push('duration_ms = ?');
      params.push(updates.duration_ms);
    }
    if (updates.cursor_after !== undefined) {
      sets.push('cursor_after = ?');
      params.push(updates.cursor_after);
    }

    params.push(logId);

    await this.db.prepare(`
      UPDATE sync_logs
      SET ${sets.join(', ')}
      WHERE id = ?
    `).bind(...params).run();
  }

  /**
   * Get sync log by ID
   */
  async getSyncLog(logId: string): Promise<SyncLog> {
    const result = await this.db.prepare(`
      SELECT * FROM sync_logs WHERE id = ?
    `).bind(logId).first();

    if (!result) {
      throw new Error(`Sync log ${logId} not found`);
    }

    return {
      ...result,
      errors: result.errors ? JSON.parse(result.errors as string) : undefined,
    } as SyncLog;
  }

  /**
   * Get sync logs for connection
   */
  async getSyncLogs(connectionId: string, limit: number = 20): Promise<SyncLog[]> {
    const results = await this.db.prepare(`
      SELECT * FROM sync_logs
      WHERE connection_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).bind(connectionId, limit).all();

    return (results.results || []).map((row: any) => ({
      ...row,
      errors: row.errors ? JSON.parse(row.errors) : undefined,
    })) as SyncLog[];
  }

  /**
   * Get all sync connections for user
   */
  async getUserSyncConnections(userId: string, containerTag: string = 'default'): Promise<SyncConnection[]> {
    const results = await this.db.prepare(`
      SELECT * FROM sync_connections
      WHERE user_id = ? AND container_tag = ?
      ORDER BY created_at DESC
    `).bind(userId, containerTag).all();

    return (results.results || []).map((row: any) => ({
      ...row,
      is_active: row.is_active === 1,
      sync_enabled: row.sync_enabled === 1,
      sync_stats: row.sync_stats ? JSON.parse(row.sync_stats) : undefined,
    })) as SyncConnection[];
  }
}

/**
 * Helper: Get or create sync connection for provider
 */
export async function getOrCreateSyncConnection(
  env: Bindings,
  userId: string,
  provider: SyncProvider,
  composioAccountId: string,
  containerTag: string = 'default'
): Promise<SyncConnection> {
  const orchestrator = new SyncOrchestrator(env);

  // Check if connection exists
  const existing = await env.DB.prepare(`
    SELECT id FROM sync_connections
    WHERE user_id = ? AND provider = ? AND container_tag = ?
  `).bind(userId, provider, containerTag).first();

  if (existing) {
    return (await orchestrator.getSyncConnection(existing.id as string))!;
  }

  // Create new connection
  return await orchestrator.createSyncConnection({
    userId,
    containerTag,
    provider,
    composioAccountId,
    syncFrequency: 'hourly',
  });
}
