/**
 * Location-Based Reminders API
 *
 * Client-first geofencing approach:
 * - Server stores reminder metadata (location, message, trigger conditions)
 * - Mobile app syncs reminders and registers geofences with OS
 * - OS handles all location monitoring (zero server load, battery efficient)
 * - Device notifies server when reminder is triggered
 *
 * Endpoints:
 * - GET /v3/location-reminders - List active reminders for sync
 * - POST /v3/location-reminders - Create a new location reminder
 * - PUT /v3/location-reminders/:id - Update a reminder
 * - DELETE /v3/location-reminders/:id - Delete a reminder
 * - POST /v3/location-reminders/:id/trigger - Mark reminder as triggered
 * - POST /v3/location-reminders/:id/snooze - Snooze a reminder
 *
 * - GET /v3/known-locations - List user's saved locations
 * - POST /v3/known-locations - Save a new location
 * - DELETE /v3/known-locations/:id - Delete a saved location
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

// ============================================================================
// Location Reminders
// ============================================================================

/**
 * GET /v3/location-reminders
 * List active location reminders for sync to device
 * Device uses this to register geofences with the OS
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    // Get all active reminders (not triggered one-time, not deleted)
    const result = await c.env.DB.prepare(`
      SELECT
        id,
        name,
        latitude,
        longitude,
        radius_meters,
        message,
        trigger_on,
        status,
        is_recurring,
        created_at,
        updated_at
      FROM location_reminders
      WHERE user_id = ?
        AND status = 'active'
        AND (snooze_until IS NULL OR snooze_until < datetime('now'))
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(userId).all();

    // iOS limit is 20 geofences, so we cap at 20
    const reminders = (result.results as any[]).map(r => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      radius: r.radius_meters,
      message: r.message,
      triggerOn: r.trigger_on,
      isRecurring: r.is_recurring === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return c.json({
      success: true,
      reminders,
      count: reminders.length,
      limit: 20, // iOS geofence limit
      note: reminders.length >= 20
        ? 'You have reached the maximum of 20 location reminders. Delete some to add more.'
        : undefined,
    });
  } catch (error: any) {
    console.error('[LocationReminders] List failed:', error);
    return c.json({ error: 'Failed to fetch reminders', message: error.message }, 500);
  }
});

/**
 * POST /v3/location-reminders
 * Create a new location-based reminder
 */
app.post('/', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();

    // Validate required fields
    if (!body.name || !body.latitude || !body.longitude || !body.message) {
      return c.json({
        error: 'Missing required fields',
        required: ['name', 'latitude', 'longitude', 'message'],
      }, 400);
    }

    // Check active reminder count (iOS limit is 20)
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM location_reminders
      WHERE user_id = ? AND status = 'active'
    `).bind(userId).first<{ count: number }>();

    if (countResult && countResult.count >= 20) {
      return c.json({
        error: 'Geofence limit reached',
        message: 'You can only have 20 active location reminders. Delete some to add more.',
        limit: 20,
        current: countResult.count,
      }, 400);
    }

    // Validate radius (minimum 100m for reliability)
    const radius = Math.max(body.radius || 100, 100);

    // Validate trigger type
    const triggerOn = ['enter', 'exit', 'both'].includes(body.trigger_on)
      ? body.trigger_on
      : 'enter';

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO location_reminders (
        id, user_id, name, latitude, longitude, radius_meters,
        message, trigger_on, is_recurring, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).bind(
      id,
      userId,
      body.name,
      body.latitude,
      body.longitude,
      radius,
      body.message,
      triggerOn,
      body.is_recurring ? 1 : 0,
      now,
      now
    ).run();

    // Also save to known_locations if it's a new place
    if (body.save_location !== false) {
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO known_locations (
          id, user_id, name, type, latitude, longitude, radius_meters,
          address, use_count, last_used_at, created_at, updated_at
        ) VALUES (
          COALESCE(
            (SELECT id FROM known_locations WHERE user_id = ? AND name = ?),
            ?
          ),
          ?, ?, ?, ?, ?, ?,
          ?,
          COALESCE((SELECT use_count FROM known_locations WHERE user_id = ? AND name = ?), 0) + 1,
          ?, ?, ?
        )
      `).bind(
        userId, body.name,
        crypto.randomUUID(),
        userId,
        body.name,
        body.location_type || 'other',
        body.latitude,
        body.longitude,
        radius,
        body.address || null,
        userId, body.name,
        now, now, now
      ).run();
    }

    return c.json({
      success: true,
      reminder: {
        id,
        name: body.name,
        latitude: body.latitude,
        longitude: body.longitude,
        radius,
        message: body.message,
        triggerOn,
        isRecurring: !!body.is_recurring,
      },
      message: `Location reminder created. You'll be reminded when you ${triggerOn === 'exit' ? 'leave' : 'arrive at'} ${body.name}.`,
    });
  } catch (error: any) {
    console.error('[LocationReminders] Create failed:', error);
    return c.json({ error: 'Failed to create reminder', message: error.message }, 500);
  }
});

/**
 * PUT /v3/location-reminders/:id
 * Update a location reminder
 */
app.put('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const reminderId = c.req.param('id');

  try {
    const body = await c.req.json();

    // Verify ownership
    const existing = await c.env.DB.prepare(`
      SELECT id FROM location_reminders WHERE id = ? AND user_id = ?
    `).bind(reminderId, userId).first();

    if (!existing) {
      return c.json({ error: 'Reminder not found' }, 404);
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.latitude !== undefined) {
      updates.push('latitude = ?');
      values.push(body.latitude);
    }
    if (body.longitude !== undefined) {
      updates.push('longitude = ?');
      values.push(body.longitude);
    }
    if (body.radius !== undefined) {
      updates.push('radius_meters = ?');
      values.push(Math.max(body.radius, 100));
    }
    if (body.message !== undefined) {
      updates.push('message = ?');
      values.push(body.message);
    }
    if (body.trigger_on !== undefined) {
      updates.push('trigger_on = ?');
      values.push(body.trigger_on);
    }
    if (body.is_recurring !== undefined) {
      updates.push('is_recurring = ?');
      values.push(body.is_recurring ? 1 : 0);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(reminderId);
    values.push(userId);

    await c.env.DB.prepare(`
      UPDATE location_reminders
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).bind(...values).run();

    return c.json({
      success: true,
      message: 'Reminder updated',
    });
  } catch (error: any) {
    console.error('[LocationReminders] Update failed:', error);
    return c.json({ error: 'Failed to update reminder', message: error.message }, 500);
  }
});

/**
 * DELETE /v3/location-reminders/:id
 * Delete a location reminder
 */
app.delete('/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const reminderId = c.req.param('id');

  try {
    const result = await c.env.DB.prepare(`
      DELETE FROM location_reminders WHERE id = ? AND user_id = ?
    `).bind(reminderId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Reminder not found' }, 404);
    }

    return c.json({
      success: true,
      message: 'Reminder deleted',
    });
  } catch (error: any) {
    console.error('[LocationReminders] Delete failed:', error);
    return c.json({ error: 'Failed to delete reminder', message: error.message }, 500);
  }
});

/**
 * POST /v3/location-reminders/:id/trigger
 * Called by mobile app when geofence is triggered
 * Marks reminder as triggered, handles one-time vs recurring
 */
app.post('/:id/trigger', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const reminderId = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const eventType = body.event_type || 'enter'; // 'enter' or 'exit'

    // Get reminder details
    const reminder = await c.env.DB.prepare(`
      SELECT id, name, message, is_recurring, trigger_count
      FROM location_reminders
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).bind(reminderId, userId).first<{
      id: string;
      name: string;
      message: string;
      is_recurring: number;
      trigger_count: number;
    }>();

    if (!reminder) {
      return c.json({ error: 'Reminder not found or already completed' }, 404);
    }

    const now = new Date().toISOString();

    if (reminder.is_recurring) {
      // Recurring: just update trigger count
      await c.env.DB.prepare(`
        UPDATE location_reminders
        SET triggered_at = ?, trigger_count = trigger_count + 1, updated_at = ?
        WHERE id = ?
      `).bind(now, now, reminderId).run();
    } else {
      // One-time: mark as completed
      await c.env.DB.prepare(`
        UPDATE location_reminders
        SET status = 'completed', triggered_at = ?, trigger_count = 1, updated_at = ?
        WHERE id = ?
      `).bind(now, now, reminderId).run();
    }

    return c.json({
      success: true,
      reminder: {
        id: reminder.id,
        name: reminder.name,
        message: reminder.message,
        completed: !reminder.is_recurring,
      },
      message: reminder.is_recurring
        ? 'Reminder triggered (will remind again next time)'
        : 'Reminder completed',
    });
  } catch (error: any) {
    console.error('[LocationReminders] Trigger failed:', error);
    return c.json({ error: 'Failed to trigger reminder', message: error.message }, 500);
  }
});

/**
 * POST /v3/location-reminders/:id/snooze
 * Snooze a reminder for a duration
 */
app.post('/:id/snooze', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const reminderId = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const hours = body.hours || 24; // Default: snooze for 24 hours

    const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const result = await c.env.DB.prepare(`
      UPDATE location_reminders
      SET status = 'snoozed', snooze_until = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(snoozeUntil, now, reminderId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Reminder not found' }, 404);
    }

    return c.json({
      success: true,
      message: `Reminder snoozed for ${hours} hour${hours > 1 ? 's' : ''}`,
      snoozeUntil,
    });
  } catch (error: any) {
    console.error('[LocationReminders] Snooze failed:', error);
    return c.json({ error: 'Failed to snooze reminder', message: error.message }, 500);
  }
});

// ============================================================================
// Known Locations
// ============================================================================

/**
 * GET /v3/known-locations
 * List user's saved locations (for quick selection when creating reminders)
 */
app.get('/locations', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const result = await c.env.DB.prepare(`
      SELECT
        id, name, type, latitude, longitude, radius_meters, address,
        use_count, last_used_at, created_at
      FROM known_locations
      WHERE user_id = ?
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT 50
    `).bind(userId).all();

    const locations = (result.results as any[]).map(loc => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.radius_meters,
      address: loc.address,
      useCount: loc.use_count,
      lastUsedAt: loc.last_used_at,
    }));

    return c.json({
      success: true,
      locations,
      count: locations.length,
    });
  } catch (error: any) {
    console.error('[KnownLocations] List failed:', error);
    return c.json({ error: 'Failed to fetch locations', message: error.message }, 500);
  }
});

/**
 * POST /v3/known-locations
 * Save a new known location
 */
app.post('/locations', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    const body = await c.req.json();

    if (!body.name || !body.latitude || !body.longitude) {
      return c.json({
        error: 'Missing required fields',
        required: ['name', 'latitude', 'longitude'],
      }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO known_locations (
        id, user_id, name, type, latitude, longitude, radius_meters,
        address, use_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      id,
      userId,
      body.name,
      body.type || 'other',
      body.latitude,
      body.longitude,
      body.radius || 100,
      body.address || null,
      now,
      now
    ).run();

    return c.json({
      success: true,
      location: {
        id,
        name: body.name,
        type: body.type || 'other',
        latitude: body.latitude,
        longitude: body.longitude,
        radius: body.radius || 100,
      },
      message: `Saved "${body.name}" to your locations`,
    });
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.message?.includes('UNIQUE constraint')) {
      return c.json({
        error: 'Location already exists',
        message: `You already have a location named "${(await c.req.json()).name}"`,
      }, 400);
    }
    console.error('[KnownLocations] Create failed:', error);
    return c.json({ error: 'Failed to save location', message: error.message }, 500);
  }
});

/**
 * DELETE /v3/known-locations/:id
 * Delete a saved location
 */
app.delete('/locations/:id', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const locationId = c.req.param('id');

  try {
    const result = await c.env.DB.prepare(`
      DELETE FROM known_locations WHERE id = ? AND user_id = ?
    `).bind(locationId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Location not found' }, 404);
    }

    return c.json({
      success: true,
      message: 'Location deleted',
    });
  } catch (error: any) {
    console.error('[KnownLocations] Delete failed:', error);
    return c.json({ error: 'Failed to delete location', message: error.message }, 500);
  }
});

export default app;
