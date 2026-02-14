/**
 * AI Notification Generator
 *
 * Uses LLM to generate intelligent, contextual notifications.
 * Replaces templated notifications with personalized, context-aware messages.
 *
 * Cost control:
 * - Uses Cloudflare AI (Llama 3.1) for low-cost inference
 * - Rate limited to 10 AI notifications per user per day
 * - Falls back to templates if AI fails or rate limited
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  buildNotificationContext,
  buildCommitmentContext,
  buildNudgeContext,
  type NotificationContext,
} from './context-builder';

const AI_NOTIFICATIONS_PER_DAY = 10;

export interface GeneratedNotification {
  title: string;
  body: string;
  usedAI: boolean;
}

/**
 * Check if user has remaining AI notification budget for today
 */
async function checkAIBudget(db: D1Database, userId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];

  const result = await db.prepare(`
    SELECT COUNT(*) as count FROM notification_log
    WHERE user_id = ?
    AND created_at >= ?
    AND JSON_EXTRACT(data, '$.usedAI') = 1
  `).bind(userId, today + 'T00:00:00Z').first<{ count: number }>();

  return (result?.count || 0) < AI_NOTIFICATIONS_PER_DAY;
}

/**
 * Generate morning briefing notification using AI
 */
export async function generateMorningBriefing(
  db: D1Database,
  ai: any,
  userId: string,
  userName: string,
  timezone: string
): Promise<GeneratedNotification> {
  // Check AI budget
  const hasAIBudget = await checkAIBudget(db, userId);

  if (!hasAIBudget) {
    // Fall back to template
    return generateTemplateMorningBriefing(db, userId, userName);
  }

  try {
    // Build full context
    const context = await buildNotificationContext(db, userId);

    // If no data, use simple greeting
    if (
      context.stats.totalCommitments === 0 &&
      context.stats.totalEventsToday === 0 &&
      context.stats.totalNudges === 0
    ) {
      return {
        title: `Good morning, ${context.user.firstName}`,
        body: 'Your day looks clear. What would you like to focus on?',
        usedAI: false,
      };
    }

    // Build AI prompt
    const prompt = buildMorningBriefingPrompt(context);

    // Call AI
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
    });

    const responseText = (response.response || '').trim();

    // Parse response (expected format: TITLE: ... BODY: ...)
    const parsed = parseNotificationResponse(responseText, context.user.firstName);

    return {
      title: parsed.title || `Good morning, ${context.user.firstName}`,
      body: parsed.body || buildTemplateBriefingBody(context),
      usedAI: true,
    };
  } catch (error) {
    console.error('[AIGenerator] Morning briefing generation failed:', error);
    return generateTemplateMorningBriefing(db, userId, userName);
  }
}

/**
 * Generate evening briefing notification using AI
 */
export async function generateEveningBriefing(
  db: D1Database,
  ai: any,
  userId: string,
  userName: string
): Promise<GeneratedNotification> {
  const hasAIBudget = await checkAIBudget(db, userId);

  if (!hasAIBudget) {
    return generateTemplateEveningBriefing(db, userId, userName);
  }

  try {
    const context = await buildNotificationContext(db, userId);

    const prompt = buildEveningBriefingPrompt(context);

    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
    });

    const responseText = (response.response || '').trim();
    const parsed = parseNotificationResponse(responseText, context.user.firstName);

    return {
      title: parsed.title || `Good evening, ${context.user.firstName}`,
      body: parsed.body || 'How did your day go? Tap to reflect.',
      usedAI: true,
    };
  } catch (error) {
    console.error('[AIGenerator] Evening briefing generation failed:', error);
    return generateTemplateEveningBriefing(db, userId, userName);
  }
}

/**
 * Generate commitment reminder using AI
 */
export async function generateCommitmentReminder(
  db: D1Database,
  ai: any,
  userId: string,
  commitmentId: string
): Promise<GeneratedNotification> {
  const hasAIBudget = await checkAIBudget(db, userId);

  if (!hasAIBudget) {
    return generateTemplateCommitmentReminder(db, userId, commitmentId);
  }

  try {
    const context = await buildCommitmentContext(db, userId, commitmentId);

    if (!context.commitment) {
      return {
        title: 'Reminder',
        body: 'You have a commitment coming up.',
        usedAI: false,
      };
    }

    const prompt = buildCommitmentReminderPrompt(context);

    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });

    const responseText = (response.response || '').trim();
    const parsed = parseNotificationResponse(responseText, context.user.firstName);

    const entityPart = context.commitment.entityName
      ? ` with ${context.commitment.entityName}`
      : '';

    return {
      title: parsed.title || `${context.user.firstName}, reminder`,
      body: parsed.body || `${context.commitment.description}${entityPart} - due ${context.commitment.dueIn}`,
      usedAI: true,
    };
  } catch (error) {
    console.error('[AIGenerator] Commitment reminder generation failed:', error);
    return generateTemplateCommitmentReminder(db, userId, commitmentId);
  }
}

/**
 * Generate relationship nudge notification using AI
 */
export async function generateNudgeNotification(
  db: D1Database,
  ai: any,
  userId: string,
  nudgeId: string
): Promise<GeneratedNotification> {
  const hasAIBudget = await checkAIBudget(db, userId);

  if (!hasAIBudget) {
    return generateTemplateNudgeNotification(db, userId, nudgeId);
  }

  try {
    const context = await buildNudgeContext(db, userId, nudgeId);

    if (!context.nudge) {
      return {
        title: 'Stay connected',
        body: 'Someone might appreciate hearing from you.',
        usedAI: false,
      };
    }

    const prompt = buildNudgePrompt(context);

    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });

    const responseText = (response.response || '').trim();
    const parsed = parseNotificationResponse(responseText, context.user.firstName);

    return {
      title: parsed.title || `Reach out to ${context.nudge.entityName}`,
      body: parsed.body || context.nudge.message,
      usedAI: true,
    };
  } catch (error) {
    console.error('[AIGenerator] Nudge notification generation failed:', error);
    return generateTemplateNudgeNotification(db, userId, nudgeId);
  }
}

// ============================================================================
// Prompt Builders
// ============================================================================

function buildMorningBriefingPrompt(context: NotificationContext): string {
  const { user, commitments, calendar, nudges, beliefs } = context;

  let dataSection = '';

  // Add calendar events
  if (calendar.todayEvents.length > 0) {
    const events = calendar.todayEvents.slice(0, 3).map(e => {
      const time = new Date(e.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const attendees = e.attendees.length > 0 ? ` with ${e.attendees.join(', ')}` : '';
      return `- ${time}: ${e.title}${attendees}`;
    }).join('\n');
    dataSection += `Today's meetings:\n${events}\n\n`;
  }

  // Add commitments
  if (commitments.dueToday.length > 0 || commitments.overdue.length > 0) {
    const items: string[] = [];
    commitments.overdue.forEach(c => items.push(`- OVERDUE: ${c.description}`));
    commitments.dueToday.forEach(c => items.push(`- Due today: ${c.description}`));
    dataSection += `Tasks:\n${items.slice(0, 4).join('\n')}\n\n`;
  }

  // Add nudges
  if (nudges.length > 0) {
    const people = nudges.slice(0, 2).map(n => {
      const days = n.daysSinceContact ? ` (${n.daysSinceContact} days)` : '';
      return `- ${n.entityName}${days}`;
    }).join('\n');
    dataSection += `People to reach out to:\n${people}\n\n`;
  }

  // Add relevant beliefs for personalization
  const relevantBeliefs = beliefs.filter(b =>
    ['preference', 'value', 'habit'].includes(b.category)
  ).slice(0, 2);

  if (relevantBeliefs.length > 0) {
    const beliefText = relevantBeliefs.map(b => `- ${b.statement}`).join('\n');
    dataSection += `User preferences:\n${beliefText}\n\n`;
  }

  return `You are Cortex, a personal AI assistant. Generate a morning briefing notification.

User: ${user.firstName}
${dataSection}
Rules:
1. Be warm but concise (max 100 chars for body)
2. Highlight the most important thing first
3. If there are overdue items, mention them urgently
4. Use the user's name naturally
5. Don't use emojis

Output format (exactly):
TITLE: [short greeting with name]
BODY: [concise summary of day]

Example:
TITLE: Good morning, Sarah
BODY: You have a meeting with the board at 10am. 2 tasks due today, 1 overdue.`;
}

function buildEveningBriefingPrompt(context: NotificationContext): string {
  const { user, commitments, stats, calendar } = context;

  let dataSection = '';

  if (stats.completedToday > 0) {
    dataSection += `Completed today: ${stats.completedToday} tasks\n`;
  }

  if (commitments.overdue.length > 0) {
    dataSection += `Overdue: ${commitments.overdue.length} items\n`;
  }

  if (calendar.tomorrowEvents.length > 0) {
    dataSection += `Tomorrow: ${calendar.tomorrowEvents.length} meetings\n`;
    const firstMeeting = calendar.tomorrowEvents[0];
    const time = new Date(firstMeeting.startTime).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    dataSection += `First meeting: ${time} - ${firstMeeting.title}\n`;
  }

  return `You are Cortex, a personal AI assistant. Generate an evening briefing notification.

User: ${user.firstName}
${dataSection}
Rules:
1. Be reflective and encouraging
2. Acknowledge accomplishments if any
3. Gently mention overdue items if any
4. Preview tomorrow's first event if relevant
5. Max 100 chars for body
6. Don't use emojis

Output format (exactly):
TITLE: [evening greeting with name]
BODY: [brief reflection and preview]`;
}

function buildCommitmentReminderPrompt(context: {
  user: { firstName: string };
  commitment: { description: string; dueIn: string; entityName?: string; isOverdue: boolean } | null;
  relatedMemories: { content: string }[];
}): string {
  const { user, commitment, relatedMemories } = context;

  if (!commitment) {
    return 'Generate a generic reminder notification.';
  }

  let memoryContext = '';
  if (relatedMemories.length > 0) {
    memoryContext = `\nContext from past interactions:\n${relatedMemories.slice(0, 2).map(m => `- ${m.content}`).join('\n')}`;
  }

  const entityPart = commitment.entityName ? ` with ${commitment.entityName}` : '';

  return `You are Cortex, a personal AI assistant. Generate a commitment reminder notification.

User: ${user.firstName}
Commitment: ${commitment.description}${entityPart}
Due: ${commitment.dueIn}
${commitment.isOverdue ? 'STATUS: OVERDUE - be urgent!' : ''}
${memoryContext}

Rules:
1. Be helpful and motivating
2. If overdue, create urgency without being annoying
3. Reference context if it adds value
4. Max 80 chars for body
5. Don't use emojis

Output format (exactly):
TITLE: [reminder with name]
BODY: [what to do and when]`;
}

function buildNudgePrompt(context: {
  user: { firstName: string };
  nudge: { entityName: string; nudgeType: string; daysSinceContact?: number; message: string } | null;
  sharedHistory: string[];
}): string {
  const { user, nudge, sharedHistory } = context;

  if (!nudge) {
    return 'Generate a generic relationship nudge notification.';
  }

  let historyContext = '';
  if (sharedHistory.length > 0) {
    historyContext = `\nShared history:\n${sharedHistory.slice(0, 2).map(h => `- ${h}`).join('\n')}`;
  }

  const daysPart = nudge.daysSinceContact
    ? `\nLast contact: ${nudge.daysSinceContact} days ago`
    : '';

  return `You are Cortex, a personal AI assistant. Generate a relationship nudge notification.

User: ${user.firstName}
Person: ${nudge.entityName}
Reason: ${nudge.nudgeType}${daysPart}
${historyContext}

Rules:
1. Make it feel natural, not robotic
2. Reference shared history if relevant
3. Suggest a specific action if possible
4. Max 80 chars for body
5. Don't use emojis

Output format (exactly):
TITLE: [about the person]
BODY: [why reach out and how]`;
}

// ============================================================================
// Response Parser
// ============================================================================

function parseNotificationResponse(
  response: string,
  fallbackName: string
): { title: string; body: string } {
  // Try to parse TITLE: and BODY: format
  const titleMatch = response.match(/TITLE:\s*(.+?)(?:\n|BODY:|$)/i);
  const bodyMatch = response.match(/BODY:\s*(.+?)$/is);

  const title = titleMatch?.[1]?.trim() || '';
  let body = bodyMatch?.[1]?.trim() || '';

  // Clean up body (remove quotes, extra spaces)
  body = body.replace(/^["']|["']$/g, '').trim();

  // If parsing failed, use the whole response as body
  if (!title && !body && response.length > 0) {
    return {
      title: `Hey ${fallbackName}`,
      body: response.slice(0, 100),
    };
  }

  return { title, body };
}

// ============================================================================
// Template Fallbacks
// ============================================================================

async function generateTemplateMorningBriefing(
  db: D1Database,
  userId: string,
  userName: string
): Promise<GeneratedNotification> {
  const context = await buildNotificationContext(db, userId);
  const firstName = userName?.split(' ')[0] || 'there';

  return {
    title: `Good morning, ${firstName}`,
    body: buildTemplateBriefingBody(context),
    usedAI: false,
  };
}

async function generateTemplateEveningBriefing(
  db: D1Database,
  userId: string,
  userName: string
): Promise<GeneratedNotification> {
  const context = await buildNotificationContext(db, userId);
  const firstName = userName?.split(' ')[0] || 'there';

  let body = '';
  if (context.stats.completedToday > 0) {
    body = `You completed ${context.stats.completedToday} thing${context.stats.completedToday > 1 ? 's' : ''} today.`;
  }
  if (context.calendar.tomorrowEvents.length > 0) {
    body += body ? ' ' : '';
    body += `${context.calendar.tomorrowEvents.length} coming up tomorrow.`;
  }
  if (!body) {
    body = 'How did your day go? Tap to reflect.';
  }

  return {
    title: `Good evening, ${firstName}`,
    body,
    usedAI: false,
  };
}

async function generateTemplateCommitmentReminder(
  db: D1Database,
  userId: string,
  commitmentId: string
): Promise<GeneratedNotification> {
  const context = await buildCommitmentContext(db, userId, commitmentId);
  const firstName = context.user.firstName || 'there';

  if (!context.commitment) {
    return {
      title: 'Reminder',
      body: 'You have a commitment coming up.',
      usedAI: false,
    };
  }

  const entityPart = context.commitment.entityName
    ? ` with ${context.commitment.entityName}`
    : '';

  return {
    title: `${firstName}, reminder`,
    body: `${context.commitment.description}${entityPart} - due ${context.commitment.dueIn}`,
    usedAI: false,
  };
}

async function generateTemplateNudgeNotification(
  db: D1Database,
  userId: string,
  nudgeId: string
): Promise<GeneratedNotification> {
  const context = await buildNudgeContext(db, userId, nudgeId);

  if (!context.nudge) {
    return {
      title: 'Stay connected',
      body: 'Someone might appreciate hearing from you.',
      usedAI: false,
    };
  }

  const daysPart = context.nudge.daysSinceContact
    ? ` (${context.nudge.daysSinceContact} days)`
    : '';

  return {
    title: `Reach out to ${context.nudge.entityName}`,
    body: context.nudge.message || `It's been a while${daysPart}. Send a quick message?`,
    usedAI: false,
  };
}

function buildTemplateBriefingBody(context: NotificationContext): string {
  const { stats, commitments, calendar, nudges } = context;

  if (stats.totalCommitments === 0 && stats.totalEventsToday === 0 && stats.totalNudges === 0) {
    return 'Your day looks clear.';
  }

  const parts: string[] = [];

  if (calendar.todayEvents.length > 0) {
    parts.push(`${calendar.todayEvents.length} meeting${calendar.todayEvents.length > 1 ? 's' : ''}`);
  }

  if (commitments.dueToday.length > 0) {
    parts.push(`${commitments.dueToday.length} commitment${commitments.dueToday.length > 1 ? 's' : ''}`);
  }

  if (commitments.overdue.length > 0) {
    parts.push(`${commitments.overdue.length} overdue`);
  }

  if (nudges.length > 0) {
    parts.push(`${nudges.length} person${nudges.length > 1 ? 's' : ''} to reach out to`);
  }

  return parts.join(' · ') + ' today';
}
