/**
 * Briefing API Handler
 *
 * Consolidated endpoint for mobile app home screen:
 * GET /v3/briefing - Returns everything needed for home in one call
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';

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
    const [
      userResult,
      timezoneResult,
      upcomingResult,
      overdueResult,
      nudgesResult,
      learningsResult,
      beliefsResult,
      outcomeStatsResult,
      sleepContextResult,
      memoriesCountResult,
      entitiesCountResult,
      learningsCountResult,
      beliefsCountResult,
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

      // Top nudges
      c.env.DB.prepare(
        `SELECT * FROM nudges
         WHERE user_id = ? AND status = 'pending'
         ORDER BY
           CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           created_at DESC
         LIMIT 3`
      ).bind(userId).all().catch(() => ({ results: [] })),

      // Recent learnings
      c.env.DB.prepare(
        `SELECT id, insight, category, confidence, status, created_at
         FROM learnings
         WHERE user_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 5`
      ).bind(userId).all(),

      // Top beliefs by confidence
      c.env.DB.prepare(
        `SELECT id, proposition, belief_type, current_confidence, domain, status
         FROM beliefs
         WHERE user_id = ? AND status = 'active'
         ORDER BY current_confidence DESC LIMIT 5`
      ).bind(userId).all(),

      // Outcome stats
      c.env.DB.prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN feedback_signal = 'positive' THEN 1 ELSE 0 END) as positive,
           SUM(CASE WHEN feedback_signal IS NOT NULL THEN 1 ELSE 0 END) as with_feedback
         FROM outcomes
         WHERE user_id = ?`
      ).bind(userId).first<{ total: number; positive: number; with_feedback: number }>(),

      // Sleep context
      c.env.DB.prepare(
        `SELECT context_data, generated_at
         FROM session_contexts
         WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY generated_at DESC LIMIT 1`
      ).bind(userId).first<{ context_data: string; generated_at: string }>(),

      // Stats: total memories
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND is_forgotten = 0'
      ).bind(userId).first<{ count: number }>(),

      // Stats: total entities
      c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM entities WHERE user_id = ?'
      ).bind(userId).first<{ count: number }>(),

      // Stats: total learnings
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM learnings WHERE user_id = ? AND status = 'active'"
      ).bind(userId).first<{ count: number }>(),

      // Stats: total beliefs
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM beliefs WHERE user_id = ? AND status = 'active'"
      ).bind(userId).first<{ count: number }>(),
    ]);

    // Extract values with fallbacks
    const userName = userResult.status === 'fulfilled' ? userResult.value?.name : null;
    const userTimezone = timezoneResult.status === 'fulfilled' ? timezoneResult.value?.timezone || 'UTC' : 'UTC';
    const upcoming = upcomingResult.status === 'fulfilled' ? upcomingResult.value?.results || [] : [];
    const overdue = overdueResult.status === 'fulfilled' ? overdueResult.value?.results || [] : [];
    const nudges = nudgesResult.status === 'fulfilled' ? nudgesResult.value?.results || [] : [];
    const learnings = learningsResult.status === 'fulfilled' ? learningsResult.value?.results || [] : [];
    const beliefs = beliefsResult.status === 'fulfilled' ? beliefsResult.value?.results || [] : [];
    const outcomeStats = outcomeStatsResult.status === 'fulfilled' ? outcomeStatsResult.value : null;
    const sleepContext = sleepContextResult.status === 'fulfilled' ? sleepContextResult.value : null;

    // Parse sleep context
    let parsedSleepContext = null;
    let sleepGeneratedAt = null;
    if (sleepContext?.context_data) {
      try {
        parsedSleepContext = JSON.parse(sleepContext.context_data);
        sleepGeneratedAt = sleepContext.generated_at;
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Calculate positive rate
    const total = outcomeStats?.total || 0;
    const positive = outcomeStats?.positive || 0;
    const positiveRate = total > 0 ? positive / total : 0;

    // Count today's commitments
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const todayCount = upcoming.filter((c: any) =>
      c.due_date && new Date(c.due_date) <= todayEnd
    ).length;

    return c.json({
      greeting: buildGreeting(userName, userTimezone),
      timezone: userTimezone,

      commitments: {
        upcoming,
        overdue,
        todayCount,
      },

      nudges,

      cognitive: {
        recentLearnings: learnings,
        topBeliefs: beliefs,
        outcomeStats: {
          total,
          positiveRate: Math.round(positiveRate * 100) / 100,
        },
      },

      sleepCompute: {
        lastRun: sleepGeneratedAt,
        context: parsedSleepContext,
      },

      stats: {
        totalMemories: memoriesCountResult.status === 'fulfilled' ? memoriesCountResult.value?.count || 0 : 0,
        totalEntities: entitiesCountResult.status === 'fulfilled' ? entitiesCountResult.value?.count || 0 : 0,
        totalLearnings: learningsCountResult.status === 'fulfilled' ? learningsCountResult.value?.count || 0 : 0,
        totalBeliefs: beliefsCountResult.status === 'fulfilled' ? beliefsCountResult.value?.count || 0 : 0,
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

export default app;
