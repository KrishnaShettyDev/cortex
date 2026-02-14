/**
 * Sync API Handlers
 *
 * RESTful API for managing sync connections and operations:
 * - GET /v3/sync/connections - List sync connections
 * - POST /v3/sync/connections - Create sync connection
 * - PATCH /v3/sync/connections/:id - Update sync connection
 * - DELETE /v3/sync/connections/:id - Delete sync connection
 * - POST /v3/sync/connections/:id/sync - Trigger manual sync
 * - GET /v3/sync/connections/:id/logs - Get sync history
 * - GET /v3/sync/status - Get sync status overview
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import { handleError } from '../utils/errors';
import { SyncOrchestrator } from '../lib/sync/orchestrator';

/**
 * GET /v3/sync/connections
 * List all sync connections for user
 */
export async function listSyncConnectionsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('container_tag') || 'default';

    const orchestrator = new SyncOrchestrator(c.env);
    const connections = await orchestrator.getUserSyncConnections(userId, containerTag);

    return c.json({
      connections: connections.map(conn => ({
        id: conn.id,
        provider: conn.provider,
        is_active: conn.is_active,
        sync_enabled: conn.sync_enabled,
        sync_frequency: conn.sync_frequency,
        last_sync_at: conn.last_sync_at,
        next_sync_at: conn.next_sync_at,
        sync_stats: conn.sync_stats,
        created_at: conn.created_at,
      })),
      total: connections.length,
    });
  });
}

/**
 * POST /v3/sync/connections
 * Create a new sync connection
 */
export async function createSyncConnectionHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const body = await c.req.json<{
      provider: 'gmail' | 'google_calendar';
      composio_account_id: string;
      container_tag?: string;
      sync_frequency?: 'realtime' | 'hourly' | 'daily' | 'manual';
    }>();

    if (!body.provider || !body.composio_account_id) {
      return c.json({ error: 'provider and composio_account_id are required' }, 400);
    }

    const orchestrator = new SyncOrchestrator(c.env);
    const connection = await orchestrator.createSyncConnection({
      userId,
      containerTag: body.container_tag || 'default',
      provider: body.provider,
      composioAccountId: body.composio_account_id,
      syncFrequency: body.sync_frequency || 'hourly',
    });

    // Trigger initial sync
    c.executionCtx.waitUntil(
      orchestrator.runSync({
        connectionId: connection.id,
        triggerSource: 'initial',
      }).catch(err => {
        console.error('[Sync] Initial sync failed:', err);
      })
    );

    return c.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        sync_frequency: connection.sync_frequency,
        next_sync_at: connection.next_sync_at,
      },
      message: 'Sync connection created and initial sync started',
    }, 201);
  });
}

/**
 * PATCH /v3/sync/connections/:id
 * Update sync connection settings
 */
export async function updateSyncConnectionHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const connectionId = c.req.param('id');
    const body = await c.req.json<{
      sync_enabled?: boolean;
      sync_frequency?: 'realtime' | 'hourly' | 'daily' | 'manual';
    }>();

    const orchestrator = new SyncOrchestrator(c.env);

    // Verify ownership
    const connection = await orchestrator.getSyncConnection(connectionId);
    if (!connection || connection.user_id !== userId) {
      return c.json({ error: 'Sync connection not found' }, 404);
    }

    // Update connection
    const updates: any = {};
    if (body.sync_enabled !== undefined) {
      updates.sync_enabled = body.sync_enabled;
    }
    if (body.sync_frequency !== undefined) {
      updates.sync_frequency = body.sync_frequency;
      // Recalculate next sync time using the existing orchestrator
      updates.next_sync_at = (orchestrator as any).calculateNextSync(body.sync_frequency);
    }

    await orchestrator.updateSyncConnection(connectionId, updates);

    return c.json({
      success: true,
      message: 'Sync connection updated',
    });
  });
}

/**
 * DELETE /v3/sync/connections/:id
 * Delete/disconnect sync connection
 */
export async function deleteSyncConnectionHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const connectionId = c.req.param('id');

    const orchestrator = new SyncOrchestrator(c.env);

    // Verify ownership
    const connection = await orchestrator.getSyncConnection(connectionId);
    if (!connection || connection.user_id !== userId) {
      return c.json({ error: 'Sync connection not found' }, 404);
    }

    // Mark as inactive instead of deleting (preserve logs)
    await orchestrator.updateSyncConnection(connectionId, {
      is_active: false,
      sync_enabled: false,
    });

    return c.json({
      success: true,
      message: 'Sync connection disconnected',
    });
  });
}

/**
 * POST /v3/sync/connections/:id/sync
 * Trigger manual sync for connection
 */
export async function triggerManualSyncHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const connectionId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const forceFull = body.force_full === true;

    const orchestrator = new SyncOrchestrator(c.env);

    // Verify ownership
    const connection = await orchestrator.getSyncConnection(connectionId);
    if (!connection || connection.user_id !== userId) {
      return c.json({ error: 'Sync connection not found' }, 404);
    }

    // Run sync
    const log = await orchestrator.runSync({
      connectionId,
      triggerSource: 'manual',
      forceFull,
    });

    return c.json({
      log: {
        id: log.id,
        sync_type: log.sync_type,
        status: log.status,
        items_processed: log.items_processed,
        memories_created: log.memories_created,
        duration_ms: log.duration_ms,
        errors: log.errors,
        started_at: log.started_at,
        completed_at: log.completed_at,
      },
      message: 'Sync completed',
    });
  });
}

/**
 * GET /v3/sync/connections/:id/logs
 * Get sync history for connection
 */
export async function getSyncLogsHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const connectionId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '20');

    const orchestrator = new SyncOrchestrator(c.env);

    // Verify ownership
    const connection = await orchestrator.getSyncConnection(connectionId);
    if (!connection || connection.user_id !== userId) {
      return c.json({ error: 'Sync connection not found' }, 404);
    }

    // Get logs
    const logs = await orchestrator.getSyncLogs(connectionId, limit);

    return c.json({
      logs: logs.map(log => ({
        id: log.id,
        sync_type: log.sync_type,
        status: log.status,
        items_processed: log.items_processed,
        memories_created: log.memories_created,
        profiles_discovered: log.profiles_discovered,
        error_count: log.error_count,
        errors: log.errors,
        started_at: log.started_at,
        completed_at: log.completed_at,
        duration_ms: log.duration_ms,
        trigger_source: log.trigger_source,
      })),
      total: logs.length,
    });
  });
}

/**
 * GET /v3/sync/status
 * Get sync status overview for user
 */
export async function getSyncStatusHandler(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;
    const containerTag = c.req.query('container_tag') || 'default';

    const orchestrator = new SyncOrchestrator(c.env);
    const connections = await orchestrator.getUserSyncConnections(userId, containerTag);

    // Calculate stats
    const activeConnections = connections.filter(c => c.is_active);
    const enabledConnections = activeConnections.filter(c => c.sync_enabled);

    const byProvider: Record<string, any> = {};
    for (const conn of activeConnections) {
      byProvider[conn.provider] = {
        connected: true,
        sync_enabled: conn.sync_enabled,
        last_sync_at: conn.last_sync_at,
        next_sync_at: conn.next_sync_at,
        sync_frequency: conn.sync_frequency,
        sync_stats: conn.sync_stats,
      };
    }

    // Get total synced items
    const syncStatsResult = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_syncs,
        SUM(items_processed) as total_items,
        SUM(memories_created) as total_memories,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_syncs
      FROM sync_logs
      WHERE connection_id IN (
        SELECT id FROM sync_connections
        WHERE user_id = ? AND container_tag = ?
      )
    `).bind(userId, containerTag).first();

    return c.json({
      active_connections: activeConnections.length,
      enabled_connections: enabledConnections.length,
      providers: byProvider,
      overall_stats: {
        total_syncs: syncStatsResult?.total_syncs || 0,
        total_items_synced: syncStatsResult?.total_items || 0,
        total_memories_created: syncStatsResult?.total_memories || 0,
        failed_syncs: syncStatsResult?.failed_syncs || 0,
      },
    });
  });
}
