/**
 * Cortex Greet Generator
 * Generates savage, playful roast-style greetings based on user context
 */

import type { D1Database } from '@cloudflare/workers-types';
import OpenAI from 'openai';
import { SAVAGE_GREET_PROMPT, buildGreetPrompt } from './prompts';

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
  stats: {
    totalMemories: number;
    totalEntities: number;
  };
}

export interface GreetResult {
  message: string;
  greetType: 'roast' | 'nudge' | 'celebration' | 'curiosity';
  targetedItem?: string;
  severity: 'light' | 'medium' | 'savage';
  generatedAt: string;
}

export interface RoastTarget {
  type: 'overdue_commitment' | 'neglected_relationship' | 'busy_calendar' | 'empty_calendar' | 'pattern' | 'celebration';
  priority: number;
  data: any;
  description: string;
}

export class CortexGreetGenerator {
  private db: D1Database;
  private openai: OpenAI;

  constructor(db: D1Database, openaiApiKey: string) {
    this.db = db;
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  async generateGreeting(userId: string, userName: string): Promise<GreetResult> {
    // 1. Gather context
    const context = await this.gatherContext(userId, userName);

    // 2. Select best roast target
    const targets = this.identifyRoastTargets(context);
    const selectedTarget = this.selectBestTarget(targets);

    // 3. Generate greeting with LLM
    const greeting = await this.generateWithLLM(selectedTarget, context);

    return greeting;
  }

  private async gatherContext(userId: string, userName: string): Promise<GreetContext> {
    const [commitments, relationships, events, memories, stats] = await Promise.all([
      this.getOverdueCommitments(userId),
      this.getNeglectedRelationships(userId),
      this.getTodayEvents(userId),
      this.getRecentMemories(userId),
      this.getStats(userId),
    ]);

    return {
      userName,
      overdueCommitments: commitments,
      neglectedRelationships: relationships,
      todayEvents: events,
      recentMemories: memories,
      stats,
    };
  }

  private async getOverdueCommitments(userId: string) {
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
  }

  private async getNeglectedRelationships(userId: string) {
    const result = await this.db.prepare(`
      SELECT
        e.name,
        e.metadata,
        julianday('now') - julianday(e.last_seen_at) as days_since_contact
      FROM entities e
      WHERE e.user_id = ?
        AND e.entity_type = 'person'
        AND e.last_seen_at IS NOT NULL
        AND julianday('now') - julianday(e.last_seen_at) >= 14
      ORDER BY days_since_contact DESC
      LIMIT 5
    `).bind(userId).all();

    return (result.results as any[]).map(r => {
      let relationship = null;
      try {
        const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        relationship = metadata?.relationship || null;
      } catch {}
      return {
        name: r.name,
        daysSinceContact: Math.floor(r.days_since_contact || 0),
        relationship,
      };
    });
  }

  private async getTodayEvents(userId: string) {
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
  }

  private async getRecentMemories(userId: string) {
    const result = await this.db.prepare(`
      SELECT content, source, created_at
      FROM memories
      WHERE user_id = ?
        AND source != 'calendar'
        AND forgotten = 0
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(userId).all();

    return (result.results as any[]).map(r => ({
      content: r.content,
      source: r.source,
      createdAt: r.created_at,
    }));
  }

  private async getStats(userId: string) {
    const [memoriesResult, entitiesResult] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ? AND forgotten = 0').bind(userId).first(),
      this.db.prepare('SELECT COUNT(*) as count FROM entities WHERE user_id = ?').bind(userId).first(),
    ]);

    return {
      totalMemories: (memoriesResult as any)?.count || 0,
      totalEntities: (entitiesResult as any)?.count || 0,
    };
  }

  private identifyRoastTargets(context: GreetContext): RoastTarget[] {
    const targets: RoastTarget[] = [];

    // Overdue commitments (highest priority for roasting)
    for (const commitment of context.overdueCommitments) {
      targets.push({
        type: 'overdue_commitment',
        priority: 100 + commitment.daysOverdue * 10, // More overdue = higher priority
        data: commitment,
        description: `Overdue commitment: "${commitment.description}" - ${commitment.daysOverdue} days late${commitment.toEntityName ? ` (promised to ${commitment.toEntityName})` : ''}`,
      });
    }

    // Neglected relationships
    for (const relationship of context.neglectedRelationships) {
      targets.push({
        type: 'neglected_relationship',
        priority: 80 + Math.min(relationship.daysSinceContact, 60), // Cap at 60 days bonus
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

    // Empty calendar
    if (context.todayEvents.length === 0) {
      targets.push({
        type: 'empty_calendar',
        priority: 40,
        data: {},
        description: 'Empty calendar - nothing planned today',
      });
    }

    // If nothing to roast, celebrate!
    if (targets.length === 0 || (context.overdueCommitments.length === 0 && context.neglectedRelationships.length === 0)) {
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
    // Sort by priority and pick the highest
    targets.sort((a, b) => b.priority - a.priority);
    return targets[0];
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
        temperature: 0.9, // High creativity for varied roasts
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
      // Fallback to pre-written message
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
        return 'roast';
      case 'busy_calendar':
      case 'empty_calendar':
        return 'nudge';
      case 'celebration':
        return 'celebration';
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

      case 'busy_calendar':
        return `${target.data.eventCount} meetings today and you're on this app? The avoidance is strong. What are we actually dreading?`;

      case 'empty_calendar':
        return `Another day of absolutely nothing planned. Are we being spontaneous or just... not getting invited to things? What's the vibe today?`;

      case 'celebration':
        return `Wait... no overdue tasks? No ghosted friends? Who are you and what did you do with the real ${name}? Seriously though, what's the secret?`;

      default:
        return `Hey ${name}, what chaos are we getting into today? 👀`;
    }
  }
}
