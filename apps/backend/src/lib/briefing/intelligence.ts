/**
 * Briefing Intelligence Layer
 *
 * Generates structured, intelligent daily briefings by combining:
 * - User's calendar events
 * - Pending commitments
 * - Entity relationships and health
 * - World context (weather, news)
 * - Proactive insights and nudges
 */

import type { D1Database } from '@cloudflare/workers-types';
import { createWorldContext, type WorldContext } from '../world-context';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees?: string[];
  description?: string;
  meetingUrl?: string;
}

export interface Commitment {
  id: string;
  title: string;
  description?: string;
  dueDate: string;
  status: 'pending' | 'overdue' | 'completed';
  priority: 'high' | 'medium' | 'low';
  relatedEntityId?: string;
  relatedEntityName?: string;
}

export interface Insight {
  id: string;
  type: 'pattern' | 'warning' | 'opportunity' | 'reminder' | 'celebration';
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
  suggestedAction?: string;
  relatedEntityId?: string;
}

export interface MeetingPrep {
  eventId: string;
  eventTitle: string;
  attendees: string[];
  relevantContext: string[];
  pastInteractions: string[];
  suggestedTalkingPoints: string[];
  openCommitments: Commitment[];
}

export interface StructuredBriefing {
  greeting: string;
  date: string;
  timezone: string;

  // Today's schedule
  todayEvents: CalendarEvent[];
  nextMeeting?: CalendarEvent;
  meetingPreps: MeetingPrep[];

  // Commitments
  overdueCommitments: Commitment[];
  todayCommitments: Commitment[];
  upcomingCommitments: Commitment[];

  // Proactive insights
  insights: Insight[];

  // World context
  weather?: {
    summary: string;
    temperature: number;
    description: string;
    icon: string;
  };
  relevantNews?: {
    title: string;
    source: string;
    url: string;
  }[];

  // Stats
  stats: {
    totalMemories: number;
    totalEntities: number;
    healthyRelationships: number;
    atRiskRelationships: number;
  };

  // Summary (AI-generated)
  summary: string;

  generatedAt: string;
}

export interface BriefingGeneratorConfig {
  openWeatherApiKey?: string;
  serperApiKey?: string;
  yelpApiKey?: string;
}

export class BriefingIntelligence {
  private config: BriefingGeneratorConfig;

  constructor(config: BriefingGeneratorConfig) {
    this.config = config;
  }

  /**
   * Generate a structured daily briefing for a user
   */
  async generateBriefing(params: {
    userId: string;
    db: D1Database;
    timezone: string;
    latitude?: number;
    longitude?: number;
    city?: string;
  }): Promise<StructuredBriefing> {
    const { userId, db, timezone, latitude, longitude, city } = params;
    const now = new Date();
    const nowIso = now.toISOString();

    // Get date boundaries in user's timezone
    const { todayStart, todayEnd, tomorrowEnd, weekEnd } = this.getDateBoundaries(timezone);

    // Fetch all data in parallel
    const [
      userResult,
      todayEventsResult,
      overdueCommitmentsResult,
      todayCommitmentsResult,
      upcomingCommitmentsResult,
      entitiesResult,
      relationshipHealthResult,
      memoriesCountResult,
      recentLearningsResult,
      worldContext,
    ] = await Promise.all([
      // User info
      db.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>(),

      // Today's calendar events (from memories with source='calendar')
      db.prepare(`
        SELECT id, content, metadata, created_at
        FROM memories
        WHERE user_id = ? AND source = 'calendar'
        AND json_extract(metadata, '$.start_time') >= ?
        AND json_extract(metadata, '$.start_time') < ?
        ORDER BY json_extract(metadata, '$.start_time') ASC
      `).bind(userId, todayStart, todayEnd).all(),

      // Overdue commitments
      db.prepare(`
        SELECT c.*, e.name as entity_name
        FROM commitments c
        LEFT JOIN entities e ON c.related_entity_id = e.id
        WHERE c.user_id = ? AND (c.status = 'pending' OR c.status = 'overdue')
        AND c.due_date IS NOT NULL AND c.due_date < ?
        ORDER BY c.due_date ASC LIMIT 10
      `).bind(userId, nowIso).all(),

      // Today's commitments
      db.prepare(`
        SELECT c.*, e.name as entity_name
        FROM commitments c
        LEFT JOIN entities e ON c.related_entity_id = e.id
        WHERE c.user_id = ? AND c.status = 'pending'
        AND c.due_date >= ? AND c.due_date < ?
        ORDER BY c.due_date ASC
      `).bind(userId, todayStart, todayEnd).all(),

      // Upcoming commitments (next 7 days)
      db.prepare(`
        SELECT c.*, e.name as entity_name
        FROM commitments c
        LEFT JOIN entities e ON c.related_entity_id = e.id
        WHERE c.user_id = ? AND c.status = 'pending'
        AND c.due_date >= ? AND c.due_date <= ?
        ORDER BY c.due_date ASC LIMIT 10
      `).bind(userId, todayEnd, weekEnd).all(),

      // Top entities for context
      db.prepare(`
        SELECT id, name, entity_type, importance_score
        FROM entities
        WHERE user_id = ?
        ORDER BY importance_score DESC LIMIT 20
      `).bind(userId).all(),

      // Relationship health from nudges
      db.prepare(`
        SELECT entity_id, nudge_type, priority
        FROM nudges
        WHERE user_id = ? AND status = 'pending'
        AND (nudge_type = 'at_risk' OR nudge_type = 'maintenance')
      `).bind(userId).all(),

      // Memory count
      db.prepare(
        'SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND is_forgotten = 0'
      ).bind(userId).first<{ count: number }>(),

      // Recent learnings for insights
      db.prepare(`
        SELECT insight, category, confidence
        FROM learnings
        WHERE user_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 5
      `).bind(userId).all(),

      // World context (weather, news)
      this.fetchWorldContext({ latitude, longitude, city, timezone, db, userId }),
    ]);

    // Parse results
    const userName = userResult?.name || null;
    const todayEvents = this.parseCalendarEvents(todayEventsResult?.results || []);
    const overdueCommitments = this.parseCommitments(overdueCommitmentsResult?.results || [], 'overdue');
    const todayCommitments = this.parseCommitments(todayCommitmentsResult?.results || [], 'pending');
    const upcomingCommitments = this.parseCommitments(upcomingCommitmentsResult?.results || [], 'pending');
    const entities = entitiesResult?.results || [];
    const atRiskEntities = (relationshipHealthResult?.results || []).filter(
      (n: any) => n.nudge_type === 'at_risk'
    );

    // Generate meeting preps for next meeting
    const nextMeeting = todayEvents.find(e => new Date(e.startTime) > now);
    const meetingPreps = nextMeeting
      ? await this.generateMeetingPrep(db, userId, nextMeeting, entities)
      : [];

    // Generate insights
    const insights = this.generateInsights({
      overdueCommitments,
      todayCommitments,
      atRiskEntities,
      learnings: recentLearningsResult?.results || [],
      todayEvents,
    });

    // Generate summary
    const summary = this.generateSummary({
      userName,
      todayEvents,
      overdueCommitments,
      todayCommitments,
      insights,
      weather: worldContext?.weather,
    });

    return {
      greeting: this.buildGreeting(userName, timezone),
      date: this.formatDate(now, timezone),
      timezone,

      todayEvents,
      nextMeeting,
      meetingPreps,

      overdueCommitments,
      todayCommitments,
      upcomingCommitments,

      insights,

      weather: worldContext?.weather
        ? {
            summary: `${worldContext.weather.temperature}°, ${worldContext.weather.description}`,
            temperature: worldContext.weather.temperature,
            description: worldContext.weather.description,
            icon: worldContext.weather.icon,
          }
        : undefined,

      relevantNews: worldContext?.news?.slice(0, 3).map((n) => ({
        title: n.title,
        source: n.source,
        url: n.url,
      })),

      stats: {
        totalMemories: memoriesCountResult?.count || 0,
        totalEntities: entities.length,
        healthyRelationships: entities.length - atRiskEntities.length,
        atRiskRelationships: atRiskEntities.length,
      },

      summary,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Build greeting based on time of day
   */
  private buildGreeting(userName: string | null, timezone: string): string {
    const name = userName || 'there';
    let hour = 12;

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      const hourPart = parts.find((p) => p.type === 'hour');
      hour = parseInt(hourPart?.value || '12', 10);
    } catch {
      hour = new Date().getUTCHours();
    }

    if (hour < 12) return `Good morning, ${name}`;
    if (hour < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name}`;
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date, timezone: string): string {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
    } catch {
      return date.toDateString();
    }
  }

  /**
   * Get date boundaries in user's timezone
   */
  private getDateBoundaries(timezone: string): {
    todayStart: string;
    todayEnd: string;
    tomorrowEnd: string;
    weekEnd: string;
  } {
    const now = new Date();

    // Get today's date in user's timezone
    let todayDate: string;
    try {
      todayDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
      }).format(now);
    } catch {
      todayDate = now.toISOString().split('T')[0];
    }

    const todayStart = `${todayDate}T00:00:00Z`;
    const todayEnd = `${todayDate}T23:59:59Z`;

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];
    const tomorrowEnd = `${tomorrowDate}T23:59:59Z`;

    const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekDate = week.toISOString().split('T')[0];
    const weekEnd = `${weekDate}T23:59:59Z`;

    return { todayStart, todayEnd, tomorrowEnd, weekEnd };
  }

  /**
   * Parse calendar memories into events
   */
  private parseCalendarEvents(memories: any[]): CalendarEvent[] {
    return memories.map((m) => {
      let metadata: any = {};
      try {
        metadata = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata || {};
      } catch {
        metadata = {};
      }

      return {
        id: m.id,
        title: metadata.title || m.content?.split('\n')[0] || 'Event',
        startTime: metadata.start_time || m.created_at,
        endTime: metadata.end_time || m.created_at,
        location: metadata.location,
        attendees: metadata.attendees || [],
        description: metadata.description || m.content,
        meetingUrl: metadata.meeting_url || metadata.hangoutLink,
      };
    });
  }

  /**
   * Parse commitment records
   */
  private parseCommitments(
    records: any[],
    defaultStatus: 'pending' | 'overdue'
  ): Commitment[] {
    return records.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      dueDate: c.due_date,
      status: c.status || defaultStatus,
      priority: c.priority || 'medium',
      relatedEntityId: c.related_entity_id,
      relatedEntityName: c.entity_name,
    }));
  }

  /**
   * Generate meeting prep for next meeting
   */
  private async generateMeetingPrep(
    db: D1Database,
    userId: string,
    meeting: CalendarEvent,
    entities: any[]
  ): Promise<MeetingPrep[]> {
    if (!meeting.attendees?.length) {
      return [];
    }

    // Find entities matching attendees
    const attendeeNames = meeting.attendees.map((a) => a.toLowerCase());
    const matchedEntities = entities.filter((e) =>
      attendeeNames.some((name) => e.name?.toLowerCase().includes(name))
    );

    // Get relevant memories about attendees
    const relevantContext: string[] = [];
    const pastInteractions: string[] = [];
    const openCommitments: Commitment[] = [];

    for (const entity of matchedEntities.slice(0, 3)) {
      // Get recent memories mentioning entity
      const memories = await db.prepare(`
        SELECT content, created_at
        FROM memories
        WHERE user_id = ? AND content LIKE ?
        AND is_forgotten = 0
        ORDER BY created_at DESC LIMIT 3
      `).bind(userId, `%${entity.name}%`).all();

      if (memories.results) {
        for (const m of memories.results as any[]) {
          pastInteractions.push(`${entity.name}: ${m.content.substring(0, 100)}...`);
        }
      }

      // Get open commitments with entity
      const commitments = await db.prepare(`
        SELECT title, due_date, status
        FROM commitments
        WHERE user_id = ? AND related_entity_id = ?
        AND status = 'pending'
      `).bind(userId, entity.id).all();

      if (commitments.results) {
        for (const c of commitments.results as any[]) {
          openCommitments.push({
            id: c.id,
            title: c.title,
            dueDate: c.due_date,
            status: 'pending',
            priority: 'medium',
            relatedEntityId: entity.id,
            relatedEntityName: entity.name,
          });
        }
      }
    }

    // Generate suggested talking points
    const suggestedTalkingPoints: string[] = [];
    if (openCommitments.length > 0) {
      suggestedTalkingPoints.push(`Follow up on: ${openCommitments[0].title}`);
    }
    if (meeting.description) {
      suggestedTalkingPoints.push('Review meeting agenda');
    }

    return [
      {
        eventId: meeting.id,
        eventTitle: meeting.title,
        attendees: meeting.attendees,
        relevantContext,
        pastInteractions: pastInteractions.slice(0, 5),
        suggestedTalkingPoints,
        openCommitments,
      },
    ];
  }

  /**
   * Generate proactive insights
   */
  private generateInsights(params: {
    overdueCommitments: Commitment[];
    todayCommitments: Commitment[];
    atRiskEntities: any[];
    learnings: any[];
    todayEvents: CalendarEvent[];
  }): Insight[] {
    const { overdueCommitments, todayCommitments, atRiskEntities, learnings, todayEvents } = params;
    const insights: Insight[] = [];

    // Overdue commitment warnings
    if (overdueCommitments.length > 0) {
      insights.push({
        id: `insight-overdue-${Date.now()}`,
        type: 'warning',
        title: `${overdueCommitments.length} overdue commitment${overdueCommitments.length > 1 ? 's' : ''}`,
        message: `You have commitments past their due date: ${overdueCommitments.slice(0, 2).map((c) => c.title).join(', ')}`,
        priority: 'high',
        actionable: true,
        suggestedAction: 'Review and complete or reschedule',
      });
    }

    // Busy day warning
    if (todayEvents.length >= 5) {
      insights.push({
        id: `insight-busy-${Date.now()}`,
        type: 'warning',
        title: 'Busy day ahead',
        message: `You have ${todayEvents.length} events scheduled today. Consider time-blocking for focus work.`,
        priority: 'medium',
        actionable: false,
      });
    }

    // At-risk relationships
    if (atRiskEntities.length > 0) {
      insights.push({
        id: `insight-relationships-${Date.now()}`,
        type: 'opportunity',
        title: `${atRiskEntities.length} relationship${atRiskEntities.length > 1 ? 's' : ''} need${atRiskEntities.length > 1 ? '' : 's'} attention`,
        message: 'Some of your important relationships may be fading. Consider reaching out.',
        priority: 'medium',
        actionable: true,
        suggestedAction: 'Send a quick message to reconnect',
      });
    }

    // Learning highlights
    if (learnings.length > 0 && learnings[0].confidence > 0.8) {
      const learning = learnings[0] as any;
      insights.push({
        id: `insight-learning-${Date.now()}`,
        type: 'pattern',
        title: 'Pattern detected',
        message: learning.insight,
        priority: 'low',
        actionable: false,
      });
    }

    // No commitments celebration
    if (todayCommitments.length === 0 && overdueCommitments.length === 0) {
      insights.push({
        id: `insight-clear-${Date.now()}`,
        type: 'celebration',
        title: 'Clear slate!',
        message: 'No pending commitments for today. Great time to plan ahead or tackle something new.',
        priority: 'low',
        actionable: false,
      });
    }

    return insights.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Fetch world context
   */
  private async fetchWorldContext(params: {
    latitude?: number;
    longitude?: number;
    city?: string;
    timezone: string;
    db: D1Database;
    userId: string;
  }): Promise<WorldContext | null> {
    const { latitude, longitude, city } = params;

    if (!this.config.openWeatherApiKey && !this.config.serperApiKey) {
      return null;
    }

    try {
      const worldContext = createWorldContext({
        openWeatherApiKey: this.config.openWeatherApiKey,
        serperApiKey: this.config.serperApiKey,
        yelpApiKey: this.config.yelpApiKey,
      });

      // Get user's interests from top entities
      const entitiesResult = await params.db.prepare(`
        SELECT name FROM entities
        WHERE user_id = ? AND entity_type IN ('topic', 'organization', 'concept')
        ORDER BY importance_score DESC LIMIT 5
      `).bind(params.userId).all();

      const interests = (entitiesResult.results as any[])?.map((e) => e.name) || [];

      return await worldContext.getContext({
        latitude,
        longitude,
        city,
        timezone: params.timezone,
        interests,
        includeWeather: !!this.config.openWeatherApiKey,
        includeNews: !!this.config.serperApiKey && interests.length > 0,
        includePlaces: false,
      });
    } catch (error) {
      console.warn('[Briefing] World context fetch failed:', error);
      return null;
    }
  }

  /**
   * Generate natural language summary
   */
  private generateSummary(params: {
    userName: string | null;
    todayEvents: CalendarEvent[];
    overdueCommitments: Commitment[];
    todayCommitments: Commitment[];
    insights: Insight[];
    weather?: any;
  }): string {
    const { todayEvents, overdueCommitments, todayCommitments, weather } = params;
    const parts: string[] = [];

    // Events summary
    if (todayEvents.length > 0) {
      parts.push(
        `You have ${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''} today`
      );
      if (todayEvents[0]) {
        parts.push(`starting with "${todayEvents[0].title}"`);
      }
    } else {
      parts.push('Your calendar is clear today');
    }

    // Commitments summary
    if (overdueCommitments.length > 0) {
      parts.push(
        `${overdueCommitments.length} commitment${overdueCommitments.length > 1 ? 's are' : ' is'} overdue`
      );
    }
    if (todayCommitments.length > 0) {
      parts.push(
        `${todayCommitments.length} due today`
      );
    }

    // Weather
    if (weather) {
      parts.push(`${weather.temperature}° and ${weather.description} outside`);
    }

    return parts.join('. ') + '.';
  }
}

/**
 * Factory function
 */
export function createBriefingIntelligence(
  config: BriefingGeneratorConfig
): BriefingIntelligence {
  return new BriefingIntelligence(config);
}
