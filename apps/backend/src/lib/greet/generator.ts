/**
 * Cortex Greet Generator
 * Generates savage, playful roast-style greetings based on user context
 *
 * Enhanced to pull REAL data from:
 * - Composio (Gmail, Calendar)
 * - User memories and chat history
 * - Commitments and relationships
 */

import type { D1Database } from '@cloudflare/workers-types';
import OpenAI from 'openai';
import { SAVAGE_GREET_PROMPT, buildGreetPrompt } from './prompts';
import { createComposioServices, executeComposioSafely } from '../composio';

export interface GreetContext {
  userName: string;
  overdueCommitments: Array<{
    description: string;
    dueDate: string | null;
    toEntityName: string | null;
    daysOverdue: number;
  }>;
  neglectedRelationships: Array<{
    name: string;
    daysSinceContact: number;
    relationship: string | null;
  }>;
  todayEvents: Array<{
    title: string;
    startTime: string;
    attendees?: string[];
  }>;
  recentMemories: Array<{
    content: string;
    source: string;
    createdAt: string;
  }>;
  // NEW: Real data from Composio
  unreadEmails: Array<{
    from: string;
    subject: string;
    snippet: string;
    date: string;
  }>;
  upcomingMeetings: Array<{
    title: string;
    startTime: string;
    endTime: string;
    attendees: string[];
  }>;
  stats: {
    totalMemories: number;
    totalEntities: number;
    unreadEmailCount: number;
    todayMeetingCount: number;
  };
  // Integration status
  hasGmailConnected: boolean;
  hasCalendarConnected: boolean;
}

export interface GreetResult {
  message: string;
  greetType: 'roast' | 'nudge' | 'celebration' | 'curiosity';
  targetedItem?: string;
  severity: 'light' | 'medium' | 'savage';
  generatedAt: string;
}

export interface RoastTarget {
  type: 'overdue_commitment' | 'neglected_relationship' | 'busy_calendar' | 'empty_calendar' | 'email_pile' | 'upcoming_meeting' | 'pattern' | 'celebration' | 'new_user';
  priority: number;
  data: any;
  description: string;
}

export class CortexGreetGenerator {
  private db: D1Database;
  private openai: OpenAI;
  private composioApiKey: string;

  constructor(db: D1Database, openaiApiKey: string, composioApiKey?: string) {
    this.db = db;
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.composioApiKey = composioApiKey || '';
  }

  async generateGreeting(userId: string, userName: string): Promise<GreetResult> {
    // 1. Gather context from all sources
    const context = await this.gatherContext(userId, userName);

    // 2. Select best roast target
    const targets = this.identifyRoastTargets(context);
    const selectedTarget = this.selectBestTarget(targets);

    // 3. Generate greeting with LLM
    const greeting = await this.generateWithLLM(selectedTarget, context);

    return greeting;
  }

  private async gatherContext(userId: string, userName: string): Promise<GreetContext> {
    // Parallel fetch from all sources
    const [
      commitments,
      relationships,
      dbEvents,
      memories,
      stats,
      composioData,
    ] = await Promise.all([
      this.getOverdueCommitments(userId),
      this.getNeglectedRelationships(userId),
      this.getTodayEventsFromDb(userId),
      this.getRecentMemories(userId),
      this.getStats(userId),
      this.getComposioData(userId),
    ]);

    // Merge calendar events from DB and Composio
    const todayEvents = composioData.calendarEvents.length > 0
      ? composioData.calendarEvents.map(e => ({
          title: e.title,
          startTime: e.startTime,
          attendees: e.attendees,
        }))
      : dbEvents;

    return {
      userName,
      overdueCommitments: commitments,
      neglectedRelationships: relationships,
      todayEvents,
      recentMemories: memories,
      unreadEmails: composioData.emails,
      upcomingMeetings: composioData.calendarEvents,
      stats: {
        ...stats,
        unreadEmailCount: composioData.emails.length,
        todayMeetingCount: composioData.calendarEvents.length,
      },
      hasGmailConnected: composioData.hasGmail,
      hasCalendarConnected: composioData.hasCalendar,
    };
  }

  /**
   * Fetch real data from Composio (Gmail + Calendar)
   */
  private async getComposioData(userId: string): Promise<{
    emails: Array<{ from: string; subject: string; snippet: string; date: string }>;
    calendarEvents: Array<{ title: string; startTime: string; endTime: string; attendees: string[] }>;
    hasGmail: boolean;
    hasCalendar: boolean;
  }> {
    const emptyResult = {
      emails: [],
      calendarEvents: [],
      hasGmail: false,
      hasCalendar: false,
    };

    if (!this.composioApiKey) {
      console.log('[GreetGenerator] No Composio API key, skipping integration data');
      return emptyResult;
    }

    try {
      // Get user's Composio connection from integrations table
      // The access_token field stores the Composio connected account ID
      const connection = await this.db.prepare(`
        SELECT access_token, connected
        FROM integrations
        WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
      `).bind(userId).first<{ access_token: string; connected: number }>();

      if (!connection?.access_token) {
        console.log('[GreetGenerator] User has no Composio connection');
        return emptyResult;
      }

      const services = createComposioServices(this.composioApiKey);
      const connectedAccountId = connection.access_token;

      // Fetch emails and calendar in parallel
      const [emailResult, calendarResult] = await Promise.all([
        executeComposioSafely(() =>
          services.gmail.fetchEmails({
            connectedAccountId,
            maxResults: 10,
            query: 'is:unread',
          })
        ),
        executeComposioSafely(() => {
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
          const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

          return services.calendar.listEvents({
            connectedAccountId,
            timeMin: todayStart,
            timeMax: todayEnd,
            maxResults: 20,
          });
        }),
      ]);

      // Parse email results
      const emails: Array<{ from: string; subject: string; snippet: string; date: string }> = [];
      if (emailResult.success && emailResult.data?.data?.emails) {
        for (const email of emailResult.data.data.emails.slice(0, 5)) {
          emails.push({
            from: email.from || email.sender || 'Unknown',
            subject: email.subject || '(no subject)',
            snippet: email.snippet || '',
            date: email.date || email.internalDate || '',
          });
        }
      }

      // Parse calendar results
      const calendarEvents: Array<{ title: string; startTime: string; endTime: string; attendees: string[] }> = [];
      if (calendarResult.success && calendarResult.data?.data?.events) {
        for (const event of calendarResult.data.data.events) {
          calendarEvents.push({
            title: event.summary || event.title || 'Untitled Event',
            startTime: event.start?.dateTime || event.start?.date || '',
            endTime: event.end?.dateTime || event.end?.date || '',
            attendees: (event.attendees || []).map((a: any) => a.email || a.displayName || ''),
          });
        }
      }

      console.log(`[GreetGenerator] Fetched ${emails.length} emails, ${calendarEvents.length} events for user ${userId}`);

      return {
        emails,
        calendarEvents,
        hasGmail: emailResult.success,
        hasCalendar: calendarResult.success,
      };
    } catch (error) {
      console.error('[GreetGenerator] Error fetching Composio data:', error);
      return emptyResult;
    }
  }

  private async getOverdueCommitments(userId: string) {
    try {
      const result = await this.db.prepare(`
        SELECT
          description,
          due_date,
          to_entity_name,
          julianday('now') - julianday(due_date) as days_overdue
        FROM commitments
        WHERE user_id = ?
          AND status IN ('pending', 'active')
          AND due_date < date('now')
        ORDER BY due_date ASC
        LIMIT 5
      `).bind(userId).all();

      return (result.results as any[]).map(r => ({
        description: r.description,
        dueDate: r.due_date,
        toEntityName: r.to_entity_name,
        daysOverdue: Math.floor(r.days_overdue || 0),
      }));
    } catch (error) {
      console.error('[GreetGenerator] Error fetching commitments:', error);
      return [];
    }
  }

  private async getNeglectedRelationships(userId: string) {
    try {
      const result = await this.db.prepare(`
        SELECT
          e.name,
          julianday('now') - julianday(e.last_mentioned) as days_since_contact
        FROM entities e
        WHERE e.user_id = ?
          AND e.entity_type = 'person'
          AND e.last_mentioned IS NOT NULL
          AND julianday('now') - julianday(e.last_mentioned) >= 14
        ORDER BY days_since_contact DESC
        LIMIT 5
      `).bind(userId).all();

      return (result.results as any[]).map(r => ({
        name: r.name,
        daysSinceContact: Math.floor(r.days_since_contact || 0),
        relationship: null,
      }));
    } catch (error) {
      console.error('[GreetGenerator] Error fetching relationships:', error);
      return [];
    }
  }

  private async getTodayEventsFromDb(userId: string) {
    try {
      const result = await this.db.prepare(`
        SELECT
          content,
          metadata
        FROM memories
        WHERE user_id = ?
          AND source = 'calendar'
          AND date(created_at) = date('now')
        ORDER BY created_at ASC
        LIMIT 10
      `).bind(userId).all();

      return (result.results as any[]).map(r => {
        let metadata: any = {};
        try {
          metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        } catch {}
        return {
          title: metadata.title || r.content?.substring(0, 50) || 'Event',
          startTime: metadata.start_time || metadata.startTime || '',
          attendees: metadata.attendees || [],
        };
      });
    } catch (error) {
      console.error('[GreetGenerator] Error fetching calendar from DB:', error);
      return [];
    }
  }

  private async getRecentMemories(userId: string) {
    try {
      const result = await this.db.prepare(`
        SELECT content, source, created_at
        FROM memories
        WHERE user_id = ?
          AND source NOT IN ('calendar', 'gmail')
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(userId).all();

      return (result.results as any[]).map(r => ({
        content: r.content,
        source: r.source,
        createdAt: r.created_at,
      }));
    } catch (error) {
      console.error('[GreetGenerator] Error fetching memories:', error);
      return [];
    }
  }

  private async getStats(userId: string) {
    try {
      const [memoriesResult, entitiesResult] = await Promise.all([
        this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ?').bind(userId).first(),
        this.db.prepare('SELECT COUNT(*) as count FROM entities WHERE user_id = ?').bind(userId).first(),
      ]);

      return {
        totalMemories: (memoriesResult as any)?.count || 0,
        totalEntities: (entitiesResult as any)?.count || 0,
      };
    } catch (error) {
      console.error('[GreetGenerator] Error fetching stats:', error);
      return { totalMemories: 0, totalEntities: 0 };
    }
  }

  private identifyRoastTargets(context: GreetContext): RoastTarget[] {
    const targets: RoastTarget[] = [];

    // NEW: Email pile roast (high priority if many unread)
    if (context.unreadEmails.length >= 5) {
      targets.push({
        type: 'email_pile',
        priority: 90 + context.unreadEmails.length * 2,
        data: {
          count: context.unreadEmails.length,
          emails: context.unreadEmails.slice(0, 3),
          topSender: context.unreadEmails[0]?.from,
        },
        description: `Email pile: ${context.unreadEmails.length} unread emails`,
      });
    }

    // NEW: Upcoming meeting roast
    if (context.upcomingMeetings.length > 0) {
      const nextMeeting = context.upcomingMeetings[0];
      const meetingTime = new Date(nextMeeting.startTime);
      const now = new Date();
      const minutesUntil = Math.floor((meetingTime.getTime() - now.getTime()) / 60000);

      if (minutesUntil > 0 && minutesUntil <= 60) {
        targets.push({
          type: 'upcoming_meeting',
          priority: 95, // High priority for imminent meetings
          data: {
            meeting: nextMeeting,
            minutesUntil,
            attendeeCount: nextMeeting.attendees.length,
          },
          description: `Meeting "${nextMeeting.title}" in ${minutesUntil} minutes`,
        });
      }
    }

    // Overdue commitments (highest priority for roasting)
    for (const commitment of context.overdueCommitments) {
      targets.push({
        type: 'overdue_commitment',
        priority: 100 + commitment.daysOverdue * 10,
        data: commitment,
        description: `Overdue commitment: "${commitment.description}" - ${commitment.daysOverdue} days late${commitment.toEntityName ? ` (promised to ${commitment.toEntityName})` : ''}`,
      });
    }

    // Neglected relationships
    for (const relationship of context.neglectedRelationships) {
      targets.push({
        type: 'neglected_relationship',
        priority: 80 + Math.min(relationship.daysSinceContact, 60),
        data: relationship,
        description: `Neglected relationship: ${relationship.name} - ${relationship.daysSinceContact} days of silence`,
      });
    }

    // Busy calendar (5+ events)
    if (context.todayEvents.length >= 5) {
      targets.push({
        type: 'busy_calendar',
        priority: 70,
        data: { eventCount: context.todayEvents.length, events: context.todayEvents },
        description: `Busy calendar: ${context.todayEvents.length} events today`,
      });
    }

    // Empty calendar (only if we have calendar connected)
    if (context.todayEvents.length === 0 && context.hasCalendarConnected) {
      targets.push({
        type: 'empty_calendar',
        priority: 40,
        data: {},
        description: 'Empty calendar - nothing planned today',
      });
    }

    // New user - no data yet
    if (context.stats.totalMemories < 5 && !context.hasGmailConnected && !context.hasCalendarConnected) {
      targets.push({
        type: 'new_user',
        priority: 50,
        data: { memoryCount: context.stats.totalMemories },
        description: 'New user - needs to connect integrations or add memories',
      });
    }

    // If nothing to roast, celebrate!
    if (targets.length === 0) {
      targets.push({
        type: 'celebration',
        priority: 30,
        data: { stats: context.stats },
        description: 'Nothing to roast - user is on top of things!',
      });
    }

    return targets;
  }

  private selectBestTarget(targets: RoastTarget[]): RoastTarget {
    // Sort by priority
    targets.sort((a, b) => b.priority - a.priority);

    // Add randomness: pick from top 3 targets randomly (if available)
    // This ensures variety in greetings while still prioritizing important targets
    const topTargets = targets.slice(0, Math.min(3, targets.length));
    const randomIndex = Math.floor(Math.random() * topTargets.length);
    return topTargets[randomIndex];
  }

  private async generateWithLLM(target: RoastTarget, context: GreetContext): Promise<GreetResult> {
    const userPrompt = buildGreetPrompt(target, context);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SAVAGE_GREET_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 200,
      });

      const message = response.choices[0]?.message?.content?.trim() || this.getFallbackMessage(target, context);

      return {
        message,
        greetType: this.mapTargetToGreetType(target.type),
        targetedItem: target.description,
        severity: this.calculateSeverity(target),
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[GreetGenerator] LLM error:', error);
      return {
        message: this.getFallbackMessage(target, context),
        greetType: this.mapTargetToGreetType(target.type),
        targetedItem: target.description,
        severity: 'medium',
        generatedAt: new Date().toISOString(),
      };
    }
  }

  private mapTargetToGreetType(targetType: RoastTarget['type']): GreetResult['greetType'] {
    switch (targetType) {
      case 'overdue_commitment':
      case 'neglected_relationship':
      case 'email_pile':
        return 'roast';
      case 'busy_calendar':
      case 'empty_calendar':
      case 'upcoming_meeting':
        return 'nudge';
      case 'celebration':
        return 'celebration';
      case 'new_user':
      default:
        return 'curiosity';
    }
  }

  private calculateSeverity(target: RoastTarget): GreetResult['severity'] {
    if (target.priority >= 100) return 'savage';
    if (target.priority >= 60) return 'medium';
    return 'light';
  }

  private getFallbackMessage(target: RoastTarget, context: GreetContext): string {
    const name = context.userName || 'bestie';

    switch (target.type) {
      case 'overdue_commitment':
        const commitment = target.data;
        return `${name}... that thing you said you'd do ${commitment.daysOverdue} days ago? Still waiting. What's the holdup? 💀`;

      case 'neglected_relationship':
        const person = target.data;
        return `So we're just... not talking to ${person.name} anymore? It's been ${person.daysSinceContact} days. Are we fighting or did you forget they exist?`;

      case 'email_pile':
        return `${target.data.count} unread emails and you're opening THIS app? The inbox isn't going to answer itself. What are we avoiding? 📧`;

      case 'upcoming_meeting':
        const meeting = target.data.meeting;
        return `"${meeting.title}" starts in ${target.data.minutesUntil} minutes. Are we prepared or are we winging it again? 🎭`;

      case 'busy_calendar':
        return `${target.data.eventCount} meetings today and you're on this app? The avoidance is strong. What are we actually dreading?`;

      case 'empty_calendar':
        return `Another day of absolutely nothing planned. Are we being spontaneous or just... not getting invited to things? What's the vibe today?`;

      case 'new_user':
        return `Oh, you're new here! Connect your Gmail or Calendar so I can properly judge your life choices. What's on your mind?`;

      case 'celebration':
        return `Wait... no overdue tasks? No ghosted friends? Who are you and what did you do with the real ${name}? Seriously though, what's the secret?`;

      default:
        return `Hey ${name}, what chaos are we getting into today? 👀`;
    }
  }
}
