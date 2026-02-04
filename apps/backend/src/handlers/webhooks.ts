/**
 * Webhooks Handler
 *
 * Handles incoming webhooks from Composio triggers:
 * - GMAIL_NEW_GMAIL_MESSAGE: New email received
 * - GOOGLECALENDAR_EVENT_CREATED: Calendar event created
 * - GOOGLECALENDAR_EVENT_UPDATED: Calendar event updated
 *
 * SECURITY: All webhooks verify HMAC-SHA256 signatures before processing
 * Uses Composio's actual webhook format: v1,<base64_signature>
 */

import { Hono, Context } from 'hono';
import type { Bindings } from '../types';
import { createEmailImportanceScorer } from '../lib/email';
import { sendPushNotification } from '../lib/notifications/push-service';
import { verifyComposioWebhookAsync } from '../lib/webhook-signature';
import { createLogger } from '../lib/logger';
import { badRequest, unauthorized, internalError } from '../utils/errors';

const logger = createLogger('webhooks');
const app = new Hono<{ Bindings: Bindings }>();

// =============================================================================
// Composio Trigger Event Types
// =============================================================================

type ComposioTriggerType =
  | 'GMAIL_NEW_GMAIL_MESSAGE'
  | 'GOOGLECALENDAR_EVENT_CREATED'
  | 'GOOGLECALENDAR_EVENT_UPDATED'
  | 'GOOGLECALENDAR_EVENT_DELETED';

interface ComposioWebhookPayload {
  /** Trigger type (e.g., GMAIL_NEW_GMAIL_MESSAGE) */
  trigger_name: ComposioTriggerType;
  /** Trigger instance ID */
  trigger_id: string;
  /** Connected account ID */
  connection_id: string;
  /** Our user ID (entity_id in Composio) */
  client_id: string;
  /** Trigger-specific payload data */
  payload: Record<string, any>;
}

interface GmailMessagePayload {
  messageId: string;
  threadId: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
  hasAttachments: boolean;
}

interface CalendarEventPayload {
  eventId: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  organizer?: { email: string; displayName?: string };
  htmlLink?: string;
  hangoutLink?: string;
  status: string;
  updated: string;
}

// =============================================================================
// Main Composio Webhook Endpoint
// =============================================================================

/**
 * POST /webhooks/composio
 * Main Composio webhook endpoint for trigger events
 *
 * Headers required:
 * - webhook-signature: v1,<base64_signature>
 * - webhook-id: unique message ID
 * - webhook-timestamp: Unix timestamp
 */
app.post('/composio', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = logger.child({ requestId });

  try {
    // Get raw body for signature verification
    const rawBody = await c.req.text();

    // Extract Composio webhook headers
    const signature = c.req.header('webhook-signature');
    const msgId = c.req.header('webhook-id');
    const timestamp = c.req.header('webhook-timestamp');

    log.debug('Webhook received', {
      hasSignature: !!signature,
      hasMsgId: !!msgId,
      hasTimestamp: !!timestamp,
    });

    // Verify webhook signature
    const isValid = await verifyComposioWebhookAsync(
      rawBody,
      signature,
      msgId,
      timestamp,
      c.env.COMPOSIO_WEBHOOK_SECRET
    );

    if (!isValid) {
      log.warn('Webhook signature verification failed');
      return unauthorized(c, 'Invalid webhook signature');
    }

    // Parse the verified payload
    const webhook: ComposioWebhookPayload = JSON.parse(rawBody);
    const userId = webhook.client_id;

    log.info('Processing webhook', {
      triggerType: webhook.trigger_name,
      userId,
      triggerId: webhook.trigger_id,
    });

    // Route to appropriate handler and process in background
    switch (webhook.trigger_name) {
      case 'GMAIL_NEW_GMAIL_MESSAGE':
        c.executionCtx.waitUntil(
          handleGmailMessage(c, webhook, userId, log)
        );
        break;

      case 'GOOGLECALENDAR_EVENT_CREATED':
      case 'GOOGLECALENDAR_EVENT_UPDATED':
        c.executionCtx.waitUntil(
          handleCalendarEvent(c, webhook, userId, 'upsert', log)
        );
        break;

      case 'GOOGLECALENDAR_EVENT_DELETED':
        c.executionCtx.waitUntil(
          handleCalendarEvent(c, webhook, userId, 'delete', log)
        );
        break;

      default:
        log.warn('Unhandled trigger type', { triggerName: webhook.trigger_name });
    }

    // Return immediately - processing continues in background
    return c.json({ received: true, requestId });
  } catch (error) {
    log.error('Webhook processing error', error as Error);
    return internalError(c, 'Failed to process webhook');
  }
});

// =============================================================================
// Gmail Message Handler
// =============================================================================

async function handleGmailMessage(
  c: Context<{ Bindings: Bindings }>,
  webhook: ComposioWebhookPayload,
  userId: string,
  log: ReturnType<typeof logger.child>
): Promise<void> {
  try {
    const payload = webhook.payload as GmailMessagePayload;

    log.debug('Processing Gmail message', {
      messageId: payload.messageId,
      from: payload.from,
      subject: payload.subject?.slice(0, 50),
    });

    // Score the email for importance
    const scorer = createEmailImportanceScorer(c.env.DB, userId);
    await scorer.initialize();

    const scored = await scorer.scoreEmail({
      id: payload.messageId,
      from: payload.from,
      fromName: payload.fromName,
      to: payload.to,
      subject: payload.subject,
      snippet: payload.snippet,
      threadId: payload.threadId,
      date: payload.date,
      labels: payload.labelIds || [],
      hasAttachments: payload.hasAttachments,
      isUnread: true,
    });

    log.info('Email scored', {
      messageId: payload.messageId,
      score: scored.overallScore,
      category: scored.category,
    });

    // Only notify for important/urgent emails (score >= 0.6 or urgent category)
    if (scored.overallScore >= 0.6 || scored.category === 'urgent_action') {
      await sendEmailNotification(c, userId, payload, scored, log);
    }

    // Store email as memory for context
    await storeEmailAsMemory(c, userId, payload, scored, log);

    log.info('Gmail message processed', { messageId: payload.messageId });
  } catch (error) {
    log.error('Gmail message handler failed', error as Error, {
      triggerId: webhook.trigger_id,
    });
  }
}

async function sendEmailNotification(
  c: Context<{ Bindings: Bindings }>,
  userId: string,
  message: GmailMessagePayload,
  scored: { overallScore: number; category: string; urgencyScore: number },
  log: ReturnType<typeof logger.child>
): Promise<void> {
  // Get user's push token
  const tokenResult = await c.env.DB.prepare(
    'SELECT push_token FROM push_tokens WHERE user_id = ? AND is_active = 1 LIMIT 1'
  ).bind(userId).first<{ push_token: string }>();

  if (!tokenResult?.push_token) {
    log.debug('No push token for user', { userId });
    return;
  }

  const title = scored.category === 'urgent_action' ? 'Urgent Email' : 'Important Email';
  const body = `From ${message.fromName || message.from}: ${message.subject}`;

  const result = await sendPushNotification(
    tokenResult.push_token,
    title,
    body,
    {
      type: 'urgent_email',
      thread_id: message.threadId,
      message_id: message.messageId,
      subject: message.subject,
      from: message.from,
      urgency_score: scored.urgencyScore,
    },
    {
      channelId: 'urgent_email',
      priority: 'high',
    }
  );

  if (result.success) {
    // Log notification sent
    await c.env.DB.prepare(`
      INSERT INTO notification_log (id, user_id, notification_type, title, body, data, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      userId,
      'urgent_email',
      title,
      body,
      JSON.stringify({ messageId: message.messageId, score: scored.overallScore }),
      new Date().toISOString()
    ).run();

    log.info('Push notification sent', { messageId: message.messageId, ticketId: result.ticketId });
  } else {
    log.warn('Push notification failed', { error: result.error });
  }
}

async function storeEmailAsMemory(
  c: Context<{ Bindings: Bindings }>,
  userId: string,
  message: GmailMessagePayload,
  scored: { overallScore: number; category: string },
  log: ReturnType<typeof logger.child>
): Promise<void> {
  const content = `Email from ${message.fromName || message.from}: "${message.subject}"\n\n${message.snippet}`;

  await c.env.DB.prepare(`
    INSERT INTO memories (id, user_id, container_tag, content, source, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).bind(
    `email-${message.messageId}`,
    userId,
    'default',
    content,
    'email',
    JSON.stringify({
      email_id: message.messageId,
      thread_id: message.threadId,
      from: message.from,
      from_name: message.fromName,
      subject: message.subject,
      date: message.date,
      labels: message.labelIds,
      importance_score: scored.overallScore,
      category: scored.category,
    }),
    new Date().toISOString(),
    new Date().toISOString()
  ).run();

  log.debug('Email stored as memory', { memoryId: `email-${message.messageId}` });
}

// =============================================================================
// Calendar Event Handler
// =============================================================================

async function handleCalendarEvent(
  c: Context<{ Bindings: Bindings }>,
  webhook: ComposioWebhookPayload,
  userId: string,
  action: 'upsert' | 'delete',
  log: ReturnType<typeof logger.child>
): Promise<void> {
  try {
    const event = webhook.payload as CalendarEventPayload;

    log.debug('Processing calendar event', {
      eventId: event.eventId,
      action,
      summary: event.summary?.slice(0, 50),
    });

    if (action === 'delete') {
      await c.env.DB.prepare(
        'DELETE FROM memories WHERE id = ? AND user_id = ?'
      ).bind(`calendar-${event.eventId}`, userId).run();

      log.info('Calendar event deleted', { eventId: event.eventId });
      return;
    }

    // Store/update event as memory
    const startTime = event.start?.dateTime || event.start?.date || '';
    const endTime = event.end?.dateTime || event.end?.date || '';
    const attendeeNames = event.attendees?.map(a => a.displayName || a.email).join(', ') || '';

    let content = `Calendar Event: "${event.summary}" on ${new Date(startTime).toLocaleString()}`;
    if (attendeeNames) content += ` with ${attendeeNames}`;
    if (event.location) content += ` at ${event.location}`;

    await c.env.DB.prepare(`
      INSERT INTO memories (id, user_id, container_tag, content, source, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `).bind(
      `calendar-${event.eventId}`,
      userId,
      'default',
      content,
      'calendar',
      JSON.stringify({
        event_id: event.eventId,
        title: event.summary,
        description: event.description,
        start_time: startTime,
        end_time: endTime,
        location: event.location,
        attendees: event.attendees,
        organizer: event.organizer,
        meeting_url: event.hangoutLink || event.htmlLink,
        status: event.status,
      }),
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    log.info('Calendar event processed', { eventId: event.eventId, action });
  } catch (error) {
    log.error('Calendar event handler failed', error as Error, {
      triggerId: webhook.trigger_id,
    });
  }
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * GET /webhooks/health
 * Health check for webhook endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supportedTriggers: [
      'GMAIL_NEW_GMAIL_MESSAGE',
      'GOOGLECALENDAR_EVENT_CREATED',
      'GOOGLECALENDAR_EVENT_UPDATED',
      'GOOGLECALENDAR_EVENT_DELETED',
    ],
  });
});

export default app;
