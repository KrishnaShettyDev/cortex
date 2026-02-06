/**
 * Briefing API Handler
 *
 * Consolidated endpoint for mobile app home screen:
 * GET /v3/briefing - Returns everything needed for home in one call
 * GET /v3/briefing/structured - Returns AI-enhanced structured briefing
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { createBriefingIntelligence } from '../lib/briefing';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Build greeting based on time of day in user's timezone
 */
function buildGreeting(userName: string | null, timezone: string = 'UTC'): string {
  const name = userName || 'there';

  // Get current hour in user's timezone using Intl API
  let hour = 12; // Default to noon if timezone fails
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find(p => p.type === 'hour');
    hour = parseInt(hourPart?.value || '12', 10);
  } catch {
    // Invalid timezone, use UTC
    hour = new Date().getUTCHours();
  }

  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

/**
 * GET /v3/briefing
 * Consolidated briefing for mobile home screen
 */
app.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const now = new Date();
  const nowIso = now.toISOString();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Parallelize all queries using Promise.allSettled
    // Note: cognitive layer tables (learnings, beliefs, outcomes) were purged in Supermemory++ migration
    const [
      userResult,
      timezoneResult,
      upcomingResult,
      overdueResult,
      nudgesResult,
      recentMemoriesResult,
      upcomingEventsResult,
      memoriesCountResult,
      entitiesCountResult,
    ] = await Promise.allSettled([
      // User info for greeting
      c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>(),

      // User timezone from notification preferences
      c.env.DB.prepare('SELECT timezone FROM notification_preferences WHERE user_id = ?').bind(userId).first<{ timezone: string }>(),

      // Upcoming commitments (next 7 days)
      c.env.DB.prepare(
        `SELECT * FROM commitments
         WHERE user_id = ? AND status = 'pending'
         AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?
         ORDER BY due_date ASC LIMIT 5`
      ).bind(userId, nowIso, sevenDaysFromNow).all(),

      // Overdue commitments
      c.env.DB.prepare(
        `SELECT * FROM commitments
         WHERE user_id = ? AND (status = 'pending' OR status = 'overdue')
         AND due_date IS NOT NULL AND due_date < ?
         ORDER BY due_date ASC LIMIT 10`
      ).bind(userId, nowIso).all(),

      // Top nudges (safe - table exists)
      c.env.DB.prepare(
        `SELECT * FROM nudges
         WHERE user_id = ? AND status = 'pending'
         ORDER BY
           CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           created_at DESC
         LIMIT 3`
      ).bind(userId).all().catch(() => ({ results: [] })),

      // Recent memories (replacement for cognitive layer)
      c.env.DB.prepare(
        `SELECT id, content, source, importance_score, created_at
         FROM memories
         WHERE user_id = ? AND is_forgotten = 0
         ORDER BY created_at DESC LIMIT 5`
      ).bind(userId).all().catch(() => ({ results: [] })),

      // Upcoming calendar events from sync_items
      c.env.DB.prepare(
        `SELECT si.subject as title, si.event_date, m.content
         FROM sync_items si
         LEFT JOIN memories m ON si.memory_id = m.id
         WHERE si.item_type = 'calendar_event'
           AND m.user_id = ?
           AND si.event_date >= ?
           AND si.event_date <= ?
         ORDER BY si.event_date ASC
         LIMIT 5`
      ).bind(userId, nowIso, sevenDaysFromNow).all().catch(() => ({ results: [] })),

      // Stats: total memories
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND is_forgotten = 0'
      ).bind(userId).first<{ count: number }>(),

      // Stats: total entities
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM entities WHERE user_id = ?'
      ).bind(userId).first<{ count: number }>(),
    ]);

    // Extract values with fallbacks
    const userName = userResult.status === 'fulfilled' ? userResult.value?.name ?? null : null;
    const userTimezone = timezoneResult.status === 'fulfilled' ? timezoneResult.value?.timezone || 'UTC' : 'UTC';
    const upcoming = upcomingResult.status === 'fulfilled' ? upcomingResult.value?.results || [] : [];
    const overdue = overdueResult.status === 'fulfilled' ? overdueResult.value?.results || [] : [];
    const nudges = nudgesResult.status === 'fulfilled' ? nudgesResult.value?.results || [] : [];
    const recentMemories = recentMemoriesResult.status === 'fulfilled' ? recentMemoriesResult.value?.results || [] : [];
    const upcomingEvents = upcomingEventsResult.status === 'fulfilled' ? upcomingEventsResult.value?.results || [] : [];

    // Count today's commitments
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const todayCount = upcoming.filter((c: any) =>
      c.due_date && new Date(c.due_date) <= todayEnd
    ).length;

    // Build urgent items for frontend (combines overdue commitments, today's events, nudges)
    const urgentItems = [
      ...overdue.slice(0, 3).map((c: any) => ({
        type: 'commitment_overdue',
        title: c.title || c.content?.slice(0, 50),
        due_date: c.due_date,
        priority: 'high',
      })),
      ...upcomingEvents.filter((e: any) => {
        const eventDate = new Date(e.event_date);
        return eventDate >= now && eventDate <= todayEnd;
      }).slice(0, 3).map((e: any) => ({
        type: 'calendar_event',
        title: e.title,
        due_date: e.event_date,
        priority: 'medium',
      })),
      ...nudges.slice(0, 2).map((n: any) => ({
        type: 'nudge',
        title: n.content || n.title,
        priority: n.priority || 'medium',
      })),
    ];

    return c.json({
      greeting: buildGreeting(userName, userTimezone),
      timezone: userTimezone,

      // Urgent items for frontend display
      urgent_items: urgentItems,

      commitments: {
        upcoming,
        overdue,
        todayCount,
      },

      nudges,

      // Upcoming calendar events
      upcomingEvents: upcomingEvents.map((e: any) => ({
        title: e.title,
        event_date: e.event_date,
      })),

      // Recent activity (replacement for cognitive layer)
      recentActivity: recentMemories.map((m: any) => ({
        id: m.id,
        snippet: m.content?.slice(0, 100),
        source: m.source,
        created_at: m.created_at,
      })),

      stats: {
        totalMemories: memoriesCountResult.status === 'fulfilled' ? memoriesCountResult.value?.count || 0 : 0,
        totalEntities: entitiesCountResult.status === 'fulfilled' ? entitiesCountResult.value?.count || 0 : 0,
        todayCommitments: todayCount,
        overdueCount: overdue.length,
      },
    });
  } catch (error: any) {
    console.error('[Briefing] Failed:', error);
    return c.json(
      {
        error: 'Failed to get briefing',
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /v3/briefing/structured
 * Enhanced AI-powered structured briefing with world context
 */
app.get('/structured', async (c) => {
  const userId = c.get('jwtPayload').sub;

  try {
    // Get user location and timezone from request or preferences
    const latitude = c.req.query('latitude') ? parseFloat(c.req.query('latitude')!) : undefined;
    const longitude = c.req.query('longitude') ? parseFloat(c.req.query('longitude')!) : undefined;
    const city = c.req.query('city');

    // Get user timezone from notification preferences
    const timezoneResult = await c.env.DB.prepare(
      'SELECT timezone FROM notification_preferences WHERE user_id = ?'
    ).bind(userId).first() as { timezone: string } | null;

    const timezone = timezoneResult?.timezone || 'UTC';

    // Create briefing intelligence with world context APIs
    const briefingIntelligence = createBriefingIntelligence({
      openWeatherApiKey: c.env.OPENWEATHER_API_KEY,
      serperApiKey: c.env.SERPER_API_KEY,
      yelpApiKey: c.env.YELP_API_KEY,
    });

    // Generate structured briefing
    const briefing = await briefingIntelligence.generateBriefing({
      userId,
      db: c.env.DB,
      timezone,
      latitude,
      longitude,
      city,
    });

    return c.json(briefing);
  } catch (error: any) {
    console.error('[Briefing] Structured briefing failed:', error);
    return c.json(
      {
        error: 'Failed to generate structured briefing',
        message: error.message,
      },
      500
    );
  }
});

export default app;
