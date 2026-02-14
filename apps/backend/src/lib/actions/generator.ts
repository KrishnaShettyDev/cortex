/**
 * Action Generator
 *
 * Proactively generates action suggestions based on user activity.
 * Runs on scheduled cron jobs (4x daily) to populate pending_actions
 * for the Poke/Iris frontend to display.
 *
 * Action types:
 * - follow_up_email: Emails that haven't been replied to
 * - commitment_reminder: Commitments approaching due date
 * - relationship_nudge: At-risk relationships needing attention
 * - calendar_prep: Upcoming meetings needing prep
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Ai } from '@cloudflare/workers-types';

export interface GeneratedAction {
  id: string;
  userId: string;
  action: string;
  parameters: Record<string, any>;
  confirmationMessage: string;
  expiresAt: string;
  priority: 'high' | 'medium' | 'low';
  category: 'email' | 'calendar' | 'relationship' | 'commitment';
}

export interface ActionGeneratorResult {
  userId: string;
  generated: number;
  skipped: number;
  errors: string[];
}

/**
 * Generate action suggestions for a single user
 */
export async function generateActionsForUser(
  db: D1Database,
  userId: string,
  options: {
    maxActions?: number;
    expiryHours?: number;
  } = {}
): Promise<ActionGeneratorResult> {
  const { maxActions = 5, expiryHours = 24 } = options;
  const result: ActionGeneratorResult = {
    userId,
    generated: 0,
    skipped: 0,
    errors: [],
  };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000).toISOString();

  try {
    // Get existing pending actions to avoid duplicates
    const existingActions = await db.prepare(`
      SELECT action, parameters FROM pending_actions
      WHERE user_id = ? AND expires_at > ?
    `).bind(userId, now.toISOString()).all();

    const existingKeys = new Set(
      (existingActions.results as any[]).map(a => `${a.action}:${a.parameters}`)
    );

    const actions: GeneratedAction[] = [];

    // 1. Check for emails needing follow-up
    const emailActions = await generateEmailFollowUpActions(db, userId, existingKeys);
    actions.push(...emailActions);

    // 2. Check for commitments approaching due date
    const commitmentActions = await generateCommitmentReminderActions(db, userId, existingKeys);
    actions.push(...commitmentActions);

    // 3. Check for relationship nudges
    const relationshipActions = await generateRelationshipActions(db, userId, existingKeys);
    actions.push(...relationshipActions);

    // 4. Check for upcoming calendar events needing prep
    const calendarActions = await generateCalendarPrepActions(db, userId, existingKeys);
    actions.push(...calendarActions);

    // Sort by priority and limit
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortedActions = actions
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
      .slice(0, maxActions);

    // Insert actions into pending_actions table
    for (const action of sortedActions) {
      try {
        await db.prepare(`
          INSERT INTO pending_actions (id, user_id, action, parameters, confirmation_message, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          action.id,
          userId,
          action.action,
          JSON.stringify(action.parameters),
          action.confirmationMessage,
          expiresAt,
          now.toISOString()
        ).run();
        result.generated++;
      } catch (error: any) {
        result.errors.push(`Failed to insert action ${action.action}: ${error.message}`);
      }
    }

    result.skipped = actions.length - sortedActions.length;
  } catch (error: any) {
    result.errors.push(`Failed to generate actions: ${error.message}`);
  }

  return result;
}

/**
 * Generate follow-up email actions
 * Looks for recent emails that seem to need a reply
 */
async function generateEmailFollowUpActions(
  db: D1Database,
  userId: string,
  existingKeys: Set<string>
): Promise<GeneratedAction[]> {
  const actions: GeneratedAction[] = [];

  try {
    // Get recent email memories that might need follow-up
    // Look for emails with questions or requests in the last 3 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const emails = await db.prepare(`
      SELECT m.id, m.content, m.metadata, m.created_at
      FROM memories m
      WHERE m.user_id = ? AND m.source IN ('gmail', 'email')
      AND m.created_at >= ?
      AND m.is_forgotten = 0
      AND (
        m.content LIKE '%?%'
        OR m.content LIKE '%please%'
        OR m.content LIKE '%could you%'
        OR m.content LIKE '%would you%'
        OR m.content LIKE '%let me know%'
        OR m.content LIKE '%waiting for%'
      )
      ORDER BY m.created_at DESC
      LIMIT 10
    `).bind(userId, threeDaysAgo).all();

    for (const email of (emails.results as any[]).slice(0, 3)) {
      let metadata: any = {};
      try {
        metadata = typeof email.metadata === 'string'
          ? JSON.parse(email.metadata)
          : email.metadata || {};
      } catch {
        metadata = {};
      }

      const sender = metadata.from || metadata.sender || 'someone';
      const subject = metadata.subject || extractSubject(email.content);
      const threadId = metadata.thread_id || email.id;

      const actionKey = `reply_to_email:${JSON.stringify({ thread_id: threadId })}`;
      if (existingKeys.has(actionKey)) continue;

      actions.push({
        id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        action: 'reply_to_email',
        parameters: {
          thread_id: threadId,
          suggested_response: `Following up on this thread about "${subject}"`,
        },
        confirmationMessage: `Reply to ${sender}'s email about "${subject}"?`,
        expiresAt: '',
        priority: 'medium',
        category: 'email',
      });
    }
  } catch (error) {
    console.warn('[ActionGenerator] Email follow-up generation failed:', error);
  }

  return actions;
}

/**
 * Generate commitment reminder actions
 * Looks for commitments due within the next 48 hours
 */
async function generateCommitmentReminderActions(
  db: D1Database,
  userId: string,
  existingKeys: Set<string>
): Promise<GeneratedAction[]> {
  const actions: GeneratedAction[] = [];

  try {
    const now = new Date().toISOString();
    const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const commitments = await db.prepare(`
      SELECT c.id, c.title, c.description, c.due_date, c.priority, e.name as entity_name
      FROM commitments c
      LEFT JOIN entities e ON c.related_entity_id = e.id
      WHERE c.user_id = ? AND c.status = 'pending'
      AND c.due_date >= ? AND c.due_date <= ?
      ORDER BY c.due_date ASC
      LIMIT 5
    `).bind(userId, now, twoDaysFromNow).all();

    for (const commitment of (commitments.results as any[])) {
      const dueDate = new Date(commitment.due_date);
      const hoursUntilDue = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60);

      // Determine priority based on time remaining
      let priority: 'high' | 'medium' | 'low' = 'medium';
      if (hoursUntilDue < 12) priority = 'high';
      else if (hoursUntilDue > 36) priority = 'low';

      const actionKey = `commitment_reminder:${JSON.stringify({ commitment_id: commitment.id })}`;
      if (existingKeys.has(actionKey)) continue;

      const withEntity = commitment.entity_name ? ` (with ${commitment.entity_name})` : '';

      actions.push({
        id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        action: 'commitment_reminder',
        parameters: {
          commitment_id: commitment.id,
          title: commitment.title,
          due_date: commitment.due_date,
        },
        confirmationMessage: `Complete "${commitment.title}"${withEntity} - due ${formatRelativeTime(dueDate)}?`,
        expiresAt: '',
        priority,
        category: 'commitment',
      });
    }
  } catch (error) {
    console.warn('[ActionGenerator] Commitment reminder generation failed:', error);
  }

  return actions;
}

/**
 * Generate relationship nudge actions
 * Converts pending nudges into actionable suggestions
 */
async function generateRelationshipActions(
  db: D1Database,
  userId: string,
  existingKeys: Set<string>
): Promise<GeneratedAction[]> {
  const actions: GeneratedAction[] = [];

  try {
    const nudges = await db.prepare(`
      SELECT n.id, n.entity_id, n.nudge_type, n.message as content, n.priority, e.name, e.entity_type
      FROM proactive_nudges n
      JOIN entities e ON n.entity_id = e.id
      WHERE n.user_id = ? AND n.dismissed = 0 AND n.acted = 0
      AND n.nudge_type IN ('at_risk', 'maintenance', 'follow_up')
      ORDER BY
        CASE n.priority WHEN 4 THEN 1 WHEN 3 THEN 2 ELSE 3 END,
        n.created_at DESC
      LIMIT 5
    `).bind(userId).all();

    for (const nudge of (nudges.results as any[])) {
      const actionKey = `reach_out:${JSON.stringify({ entity_id: nudge.entity_id })}`;
      if (existingKeys.has(actionKey)) continue;

      // Determine action based on entity type
      let actionType = 'send_message';
      let actionDescription = `Send a quick message to ${nudge.name}`;

      if (nudge.entity_type === 'person') {
        actionType = 'create_draft';
        actionDescription = `Draft an email to ${nudge.name}`;
      }

      actions.push({
        id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        action: actionType,
        parameters: {
          entity_id: nudge.entity_id,
          entity_name: nudge.name,
          nudge_id: nudge.id,
          context: nudge.content,
        },
        confirmationMessage: `${actionDescription}? ${nudge.content || ''}`.trim(),
        expiresAt: '',
        priority: nudge.priority || 'medium',
        category: 'relationship',
      });
    }
  } catch (error) {
    console.warn('[ActionGenerator] Relationship action generation failed:', error);
  }

  return actions;
}

/**
 * Generate calendar prep actions
 * Suggests preparation for upcoming important meetings
 */
async function generateCalendarPrepActions(
  db: D1Database,
  userId: string,
  existingKeys: Set<string>
): Promise<GeneratedAction[]> {
  const actions: GeneratedAction[] = [];

  try {
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Get upcoming calendar events from sync_items
    const events = await db.prepare(`
      SELECT si.provider_item_id as id, si.subject as title, si.event_date, m.content, m.metadata
      FROM sync_items si
      LEFT JOIN memories m ON si.memory_id = m.id
      WHERE si.item_type = 'calendar_event'
      AND m.user_id = ?
      AND si.event_date >= ?
      AND si.event_date <= ?
      ORDER BY si.event_date ASC
      LIMIT 5
    `).bind(userId, now, tomorrow).all();

    for (const event of (events.results as any[])) {
      let metadata: any = {};
      try {
        metadata = typeof event.metadata === 'string'
          ? JSON.parse(event.metadata)
          : event.metadata || {};
      } catch {
        metadata = {};
      }

      // Only suggest prep for meetings with attendees
      const attendees = metadata.attendees || [];
      if (attendees.length === 0) continue;

      const actionKey = `meeting_prep:${JSON.stringify({ event_id: event.id })}`;
      if (existingKeys.has(actionKey)) continue;

      const eventTime = new Date(event.event_date);

      actions.push({
        id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        action: 'meeting_prep',
        parameters: {
          event_id: event.id,
          event_title: event.title,
          event_time: event.event_date,
          attendees,
        },
        confirmationMessage: `Prepare for "${event.title}" at ${formatTime(eventTime)}?`,
        expiresAt: '',
        priority: 'medium',
        category: 'calendar',
      });
    }
  } catch (error) {
    console.warn('[ActionGenerator] Calendar prep generation failed:', error);
  }

  return actions;
}

/**
 * Run action generation for all active users
 * Called by the scheduled cron handler
 */
export async function runActionGeneration(
  db: D1Database,
  options: {
    maxUsersPerRun?: number;
    maxActionsPerUser?: number;
  } = {}
): Promise<{
  usersProcessed: number;
  totalGenerated: number;
  totalSkipped: number;
  errors: string[];
}> {
  const { maxUsersPerRun = 100, maxActionsPerUser = 5 } = options;
  const stats = {
    usersProcessed: 0,
    totalGenerated: 0,
    totalSkipped: 0,
    errors: [] as string[],
  };

  try {
    // Get active users (users with recent activity)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const usersResult = await db.prepare(`
      SELECT DISTINCT user_id FROM memories
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(sevenDaysAgo, maxUsersPerRun).all();

    for (const user of (usersResult.results as any[])) {
      try {
        const result = await generateActionsForUser(db, user.user_id, {
          maxActions: maxActionsPerUser,
        });

        stats.usersProcessed++;
        stats.totalGenerated += result.generated;
        stats.totalSkipped += result.skipped;
        stats.errors.push(...result.errors);
      } catch (error: any) {
        stats.errors.push(`User ${user.user_id}: ${error.message}`);
      }
    }

    // Cleanup expired actions
    await db.prepare(`
      DELETE FROM pending_actions
      WHERE expires_at < ?
    `).bind(new Date().toISOString()).run();

  } catch (error: any) {
    stats.errors.push(`Action generation failed: ${error.message}`);
  }

  return stats;
}

// Helper functions

function extractSubject(content: string): string {
  const lines = content.split('\n');
  const subjectLine = lines.find(l => l.toLowerCase().startsWith('subject:'));
  if (subjectLine) {
    return subjectLine.replace(/^subject:\s*/i, '').trim().slice(0, 50);
  }
  return content.slice(0, 30).trim() + '...';
}

function formatRelativeTime(date: Date): string {
  const hoursFromNow = (date.getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursFromNow < 1) return 'in less than an hour';
  if (hoursFromNow < 2) return 'in about an hour';
  if (hoursFromNow < 24) return `in ${Math.round(hoursFromNow)} hours`;
  if (hoursFromNow < 48) return 'tomorrow';
  return `in ${Math.round(hoursFromNow / 24)} days`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
