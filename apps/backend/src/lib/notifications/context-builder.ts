/**
 * Notification Context Builder
 *
 * Gathers all relevant context for AI-powered notification generation.
 * This includes user data, commitments, relationships, calendar, memories, and beliefs.
 *
 * Used by ai-generator.ts to create intelligent, contextual notifications.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface UserContext {
  id: string;
  name: string;
  firstName: string;
  timezone: string;
}

export interface CommitmentContext {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  dueIn: string;       // "in 2 hours", "tomorrow"
  priority: string;
  entityName?: string; // Person/company associated
  isOverdue: boolean;
}

export interface NudgeContext {
  id: string;
  entityName: string;
  entityType: string;
  nudgeType: string;
  message: string;
  priority: number;
  daysSinceContact?: number;
}

export interface CalendarEventContext {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  attendees: string[];
  location?: string;
  isAllDay: boolean;
}

export interface RecentMemory {
  id: string;
  content: string;
  type: string;
  source: string;
  importance: number;
  createdAt: string;
}

export interface Belief {
  statement: string;
  category: string;
  confidence: number;
}

export interface NotificationContext {
  user: UserContext;
  commitments: {
    dueToday: CommitmentContext[];
    overdue: CommitmentContext[];
    upcoming: CommitmentContext[];
  };
  nudges: NudgeContext[];
  calendar: {
    todayEvents: CalendarEventContext[];
    tomorrowEvents: CalendarEventContext[];
  };
  recentMemories: RecentMemory[];
  beliefs: Belief[];
  stats: {
    totalCommitments: number;
    totalNudges: number;
    totalEventsToday: number;
    completedToday: number;
  };
}

/**
 * Build complete notification context for a user
 */
export async function buildNotificationContext(
  db: D1Database,
  userId: string
): Promise<NotificationContext> {
  const now = new Date();
  const todayStart = now.toISOString().split('T')[0] + 'T00:00:00Z';
  const todayEnd = now.toISOString().split('T')[0] + 'T23:59:59Z';
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStart = tomorrow.toISOString().split('T')[0] + 'T00:00:00Z';
  const tomorrowEnd = tomorrow.toISOString().split('T')[0] + 'T23:59:59Z';

  // Fetch all data in parallel for performance
  const [
    userResult,
    dueTodayResult,
    overdueResult,
    upcomingResult,
    completedTodayResult,
    nudgesResult,
    todayEventsResult,
    tomorrowEventsResult,
    recentMemoriesResult,
    beliefsResult,
  ] = await Promise.all([
    // User info
    db.prepare(`
      SELECT id, name, email, timezone
      FROM users WHERE id = ?
    `).bind(userId).first<{ id: string; name: string; email: string; timezone: string }>(),

    // Commitments due today
    db.prepare(`
      SELECT c.id, c.title, c.description, c.due_date, c.priority, e.name as entity_name
      FROM commitments c
      LEFT JOIN entities e ON c.related_entity_id = e.id
      WHERE c.user_id = ? AND c.status = 'pending'
      AND c.due_date >= ? AND c.due_date <= ?
      ORDER BY c.due_date ASC
      LIMIT 10
    `).bind(userId, todayStart, todayEnd).all(),

    // Overdue commitments
    db.prepare(`
      SELECT c.id, c.title, c.description, c.due_date, c.priority, e.name as entity_name
      FROM commitments c
      LEFT JOIN entities e ON c.related_entity_id = e.id
      WHERE c.user_id = ? AND (c.status = 'pending' OR c.status = 'overdue')
      AND c.due_date < ?
      ORDER BY c.due_date DESC
      LIMIT 5
    `).bind(userId, todayStart).all(),

    // Upcoming commitments (next 3 days)
    db.prepare(`
      SELECT c.id, c.title, c.description, c.due_date, c.priority, e.name as entity_name
      FROM commitments c
      LEFT JOIN entities e ON c.related_entity_id = e.id
      WHERE c.user_id = ? AND c.status = 'pending'
      AND c.due_date > ? AND c.due_date <= datetime('now', '+3 days')
      ORDER BY c.due_date ASC
      LIMIT 5
    `).bind(userId, todayEnd).all(),

    // Completed today
    db.prepare(`
      SELECT COUNT(*) as count FROM commitments
      WHERE user_id = ? AND status = 'completed'
      AND updated_at >= ?
    `).bind(userId, todayStart).first<{ count: number }>(),

    // Nudges (relationships needing attention)
    db.prepare(`
      SELECT n.id, n.nudge_type, n.message, n.priority, e.name, e.entity_type,
             e.last_contact_date
      FROM proactive_nudges n
      JOIN entities e ON n.entity_id = e.id
      WHERE n.user_id = ? AND n.dismissed = 0 AND n.acted = 0
      ORDER BY n.priority DESC
      LIMIT 5
    `).bind(userId).all(),

    // Today's calendar events
    db.prepare(`
      SELECT si.provider_item_id as id, si.subject as title,
             si.event_date as start_time, si.event_end_date as end_time,
             m.metadata
      FROM sync_items si
      JOIN memories m ON si.memory_id = m.id
      WHERE m.user_id = ?
      AND si.item_type = 'calendar_event'
      AND si.event_date >= ? AND si.event_date <= ?
      ORDER BY si.event_date ASC
      LIMIT 10
    `).bind(userId, todayStart, todayEnd).all(),

    // Tomorrow's calendar events
    db.prepare(`
      SELECT si.provider_item_id as id, si.subject as title,
             si.event_date as start_time, si.event_end_date as end_time,
             m.metadata
      FROM sync_items si
      JOIN memories m ON si.memory_id = m.id
      WHERE m.user_id = ?
      AND si.item_type = 'calendar_event'
      AND si.event_date >= ? AND si.event_date <= ?
      ORDER BY si.event_date ASC
      LIMIT 5
    `).bind(userId, tomorrowStart, tomorrowEnd).all(),

    // Recent memories (last 3 days, high importance)
    db.prepare(`
      SELECT id, content, type, source, importance_score as importance, created_at
      FROM memories
      WHERE user_id = ? AND is_forgotten = 0
      AND created_at >= datetime('now', '-3 days')
      AND importance_score >= 0.5
      ORDER BY importance_score DESC, created_at DESC
      LIMIT 10
    `).bind(userId).all(),

    // User's beliefs
    db.prepare(`
      SELECT statement, category, confidence
      FROM beliefs
      WHERE user_id = ? AND is_active = 1
      ORDER BY confidence DESC
      LIMIT 10
    `).bind(userId).all().catch(() => ({ results: [] })),
  ]);

  // Parse user
  const user: UserContext = {
    id: userId,
    name: userResult?.name || 'there',
    firstName: (userResult?.name || '').split(' ')[0] || 'there',
    timezone: userResult?.timezone || 'UTC',
  };

  // Parse commitments
  const parseCommitment = (c: any, isOverdue = false): CommitmentContext => {
    const dueDate = new Date(c.due_date);
    const hoursUntil = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    let dueIn = '';
    if (hoursUntil < 0) {
      const hoursOverdue = Math.abs(hoursUntil);
      dueIn = hoursOverdue < 24
        ? `${Math.round(hoursOverdue)} hours overdue`
        : `${Math.round(hoursOverdue / 24)} days overdue`;
    } else if (hoursUntil < 1) {
      dueIn = 'in less than an hour';
    } else if (hoursUntil < 2) {
      dueIn = 'in about an hour';
    } else if (hoursUntil < 24) {
      dueIn = `in ${Math.round(hoursUntil)} hours`;
    } else {
      dueIn = `in ${Math.round(hoursUntil / 24)} days`;
    }

    return {
      id: c.id,
      title: c.title || c.description?.slice(0, 50) || 'Commitment',
      description: c.description || '',
      dueDate: c.due_date,
      dueIn,
      priority: c.priority || 'medium',
      entityName: c.entity_name,
      isOverdue,
    };
  };

  const commitments = {
    dueToday: ((dueTodayResult.results || []) as any[]).map(c => parseCommitment(c)),
    overdue: ((overdueResult.results || []) as any[]).map(c => parseCommitment(c, true)),
    upcoming: ((upcomingResult.results || []) as any[]).map(c => parseCommitment(c)),
  };

  // Parse nudges
  const nudges: NudgeContext[] = ((nudgesResult.results || []) as any[]).map(n => {
    let daysSinceContact: number | undefined;
    if (n.last_contact_date) {
      const lastContact = new Date(n.last_contact_date);
      daysSinceContact = Math.floor((now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      id: n.id,
      entityName: n.name,
      entityType: n.entity_type,
      nudgeType: n.nudge_type,
      message: n.message || '',
      priority: n.priority,
      daysSinceContact,
    };
  });

  // Parse calendar events
  const parseEvent = (e: any): CalendarEventContext => {
    let metadata: any = {};
    try {
      metadata = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata || {};
    } catch {
      metadata = {};
    }

    return {
      id: e.id,
      title: e.title || 'Event',
      startTime: e.start_time,
      endTime: e.end_time,
      attendees: metadata.attendees || [],
      location: metadata.location,
      isAllDay: metadata.isAllDay || false,
    };
  };

  const calendar = {
    todayEvents: ((todayEventsResult.results || []) as any[]).map(parseEvent),
    tomorrowEvents: ((tomorrowEventsResult.results || []) as any[]).map(parseEvent),
  };

  // Parse recent memories
  const recentMemories: RecentMemory[] = ((recentMemoriesResult.results || []) as any[]).map(m => ({
    id: m.id,
    content: m.content?.slice(0, 200) || '',
    type: m.type,
    source: m.source,
    importance: m.importance,
    createdAt: m.created_at,
  }));

  // Parse beliefs
  const beliefs: Belief[] = ((beliefsResult.results || []) as any[]).map(b => ({
    statement: b.statement,
    category: b.category,
    confidence: b.confidence,
  }));

  // Calculate stats
  const stats = {
    totalCommitments: commitments.dueToday.length + commitments.overdue.length,
    totalNudges: nudges.length,
    totalEventsToday: calendar.todayEvents.length,
    completedToday: completedTodayResult?.count || 0,
  };

  return {
    user,
    commitments,
    nudges,
    calendar,
    recentMemories,
    beliefs,
    stats,
  };
}

/**
 * Build minimal context for a specific commitment reminder
 */
export async function buildCommitmentContext(
  db: D1Database,
  userId: string,
  commitmentId: string
): Promise<{
  user: UserContext;
  commitment: CommitmentContext | null;
  relatedMemories: RecentMemory[];
}> {
  const now = new Date();

  const [userResult, commitmentResult, relatedMemoriesResult] = await Promise.all([
    db.prepare(`
      SELECT id, name, timezone FROM users WHERE id = ?
    `).bind(userId).first<{ id: string; name: string; timezone: string }>(),

    db.prepare(`
      SELECT c.id, c.title, c.description, c.due_date, c.priority, e.name as entity_name
      FROM commitments c
      LEFT JOIN entities e ON c.related_entity_id = e.id
      WHERE c.id = ? AND c.user_id = ?
    `).bind(commitmentId, userId).first(),

    // Get memories related to the commitment's entity
    db.prepare(`
      SELECT m.id, m.content, m.type, m.source, m.importance_score as importance, m.created_at
      FROM memories m
      JOIN commitments c ON c.related_entity_id = m.entity_id
      WHERE c.id = ? AND m.user_id = ?
      AND m.is_forgotten = 0
      ORDER BY m.importance_score DESC, m.created_at DESC
      LIMIT 5
    `).bind(commitmentId, userId).all(),
  ]);

  const user: UserContext = {
    id: userId,
    name: userResult?.name || 'there',
    firstName: (userResult?.name || '').split(' ')[0] || 'there',
    timezone: userResult?.timezone || 'UTC',
  };

  let commitment: CommitmentContext | null = null;
  if (commitmentResult) {
    const c = commitmentResult as any;
    const dueDate = new Date(c.due_date);
    const hoursUntil = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    let dueIn = '';
    if (hoursUntil < 0) {
      dueIn = 'overdue';
    } else if (hoursUntil < 1) {
      dueIn = 'in less than an hour';
    } else if (hoursUntil < 2) {
      dueIn = 'in about an hour';
    } else if (hoursUntil < 24) {
      dueIn = `in ${Math.round(hoursUntil)} hours`;
    } else {
      dueIn = `in ${Math.round(hoursUntil / 24)} days`;
    }

    commitment = {
      id: c.id,
      title: c.title || c.description?.slice(0, 50) || 'Commitment',
      description: c.description || '',
      dueDate: c.due_date,
      dueIn,
      priority: c.priority || 'medium',
      entityName: c.entity_name,
      isOverdue: hoursUntil < 0,
    };
  }

  const relatedMemories: RecentMemory[] = ((relatedMemoriesResult.results || []) as any[]).map(m => ({
    id: m.id,
    content: m.content?.slice(0, 200) || '',
    type: m.type,
    source: m.source,
    importance: m.importance,
    createdAt: m.created_at,
  }));

  return { user, commitment, relatedMemories };
}

/**
 * Build context for a relationship nudge notification
 */
export async function buildNudgeContext(
  db: D1Database,
  userId: string,
  nudgeId: string
): Promise<{
  user: UserContext;
  nudge: NudgeContext | null;
  entityMemories: RecentMemory[];
  sharedHistory: string[];
}> {
  const now = new Date();

  const [userResult, nudgeResult] = await Promise.all([
    db.prepare(`
      SELECT id, name, timezone FROM users WHERE id = ?
    `).bind(userId).first<{ id: string; name: string; timezone: string }>(),

    db.prepare(`
      SELECT n.id, n.nudge_type, n.message, n.priority, n.entity_id,
             e.name, e.entity_type, e.last_contact_date
      FROM proactive_nudges n
      JOIN entities e ON n.entity_id = e.id
      WHERE n.id = ? AND n.user_id = ?
    `).bind(nudgeId, userId).first(),
  ]);

  const user: UserContext = {
    id: userId,
    name: userResult?.name || 'there',
    firstName: (userResult?.name || '').split(' ')[0] || 'there',
    timezone: userResult?.timezone || 'UTC',
  };

  let nudge: NudgeContext | null = null;
  let entityMemories: RecentMemory[] = [];
  let sharedHistory: string[] = [];

  if (nudgeResult) {
    const n = nudgeResult as any;
    let daysSinceContact: number | undefined;
    if (n.last_contact_date) {
      const lastContact = new Date(n.last_contact_date);
      daysSinceContact = Math.floor((now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));
    }

    nudge = {
      id: n.id,
      entityName: n.name,
      entityType: n.entity_type,
      nudgeType: n.nudge_type,
      message: n.message || '',
      priority: n.priority,
      daysSinceContact,
    };

    // Get memories related to this entity
    const memoriesResult = await db.prepare(`
      SELECT id, content, type, source, importance_score as importance, created_at
      FROM memories
      WHERE user_id = ? AND entity_id = ? AND is_forgotten = 0
      ORDER BY importance_score DESC, created_at DESC
      LIMIT 10
    `).bind(userId, n.entity_id).all();

    entityMemories = ((memoriesResult.results || []) as any[]).map(m => ({
      id: m.id,
      content: m.content?.slice(0, 200) || '',
      type: m.type,
      source: m.source,
      importance: m.importance,
      createdAt: m.created_at,
    }));

    // Extract key shared history points from memories
    sharedHistory = entityMemories
      .filter(m => m.importance >= 0.6)
      .slice(0, 3)
      .map(m => m.content);
  }

  return { user, nudge, entityMemories, sharedHistory };
}
