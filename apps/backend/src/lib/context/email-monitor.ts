/**
 * Email Monitoring System
 *
 * Monitors incoming emails and sends proactive notifications for important ones.
 * Classifies emails by importance and detects actionable items (flights, bills, invites).
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../../types';

export interface EmailEvent {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  body?: string;
  receivedAt: string;
  labels: string[];
}

export type EmailImportance = 'urgent' | 'important' | 'normal' | 'low' | 'ignore';

export interface EmailClassification {
  importance: EmailImportance;
  reason: string;
  actionType?: 'flight' | 'bill' | 'meeting_invite' | 'deadline' | 'delivery' | null;
}

/**
 * Handle a new email event (called from webhook or polling)
 */
export async function handleNewEmail(
  env: Bindings,
  userId: string,
  email: EmailEvent
): Promise<void> {
  console.log(`[EmailMonitor] Processing email: ${email.subject}`);

  // 1. Classify email importance
  const classification = await classifyEmailImportance(env.DB, userId, email);

  if (classification.importance === 'ignore') {
    console.log(`[EmailMonitor] Ignoring email: ${email.subject}`);
    return;
  }

  // 2. Create memory from email if important enough
  if (classification.importance !== 'low') {
    await createEmailMemory(env.DB, userId, email, classification);
  }

  // 3. Send push notification if urgent or important
  if (classification.importance === 'urgent' || classification.importance === 'important') {
    await sendEmailNotification(env, userId, email, classification);
  }

  // 4. Handle actionable emails
  if (classification.actionType) {
    await handleActionableEmail(env, userId, email, classification);
  }
}

/**
 * Classify email importance using rules and context
 */
export async function classifyEmailImportance(
  db: D1Database,
  userId: string,
  email: EmailEvent
): Promise<EmailClassification> {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  const snippet = (email.snippet || '').toLowerCase();
  const combined = `${subject} ${snippet}`;

  // ============ IGNORE RULES ============
  // Spam/Promotions
  if (email.labels.some(l => ['SPAM', 'PROMOTIONS', 'CATEGORY_PROMOTIONS'].includes(l))) {
    return { importance: 'ignore', reason: 'Promotional/Spam' };
  }

  // Unsubscribe/Marketing patterns
  const ignorePatterns = [
    /unsubscribe/i,
    /marketing.*email/i,
    /newsletter/i,
    /weekly.*digest/i,
    /daily.*digest/i,
    /no-?reply@/i,
    /notifications?@.*\.com$/i,
  ];
  if (ignorePatterns.some(p => p.test(from) || p.test(subject))) {
    return { importance: 'low', reason: 'Automated/Newsletter' };
  }

  // ============ URGENT RULES ============
  const urgentPatterns = [
    { pattern: /urgent|asap|immediately|emergency/i, reason: 'Urgent keywords' },
    { pattern: /flight.*(cancel|delay|change|reschedul)/i, reason: 'Flight issue' },
    { pattern: /payment.*fail|transaction.*fail|card.*decline/i, reason: 'Payment issue' },
    { pattern: /account.*(suspend|locked|compromised|security)/i, reason: 'Account security' },
    { pattern: /interview.*(confirm|tomorrow|today)/i, reason: 'Interview' },
    { pattern: /offer.*letter|job.*offer/i, reason: 'Job offer' },
    { pattern: /deadline.*today|due.*today|expires.*today/i, reason: 'Today deadline' },
  ];

  for (const { pattern, reason } of urgentPatterns) {
    if (pattern.test(combined)) {
      return { importance: 'urgent', reason };
    }
  }

  // ============ IMPORTANT: FROM KNOWN CONTACTS ============
  const importantContacts = await getImportantContacts(db, userId);
  const senderMatch = importantContacts.find(c =>
    from.includes(c.email.toLowerCase()) ||
    from.includes(c.name.toLowerCase())
  );

  if (senderMatch) {
    return {
      importance: 'important',
      reason: `From ${senderMatch.name}${senderMatch.relationship ? ` (${senderMatch.relationship})` : ''}`,
    };
  }

  // ============ IMPORTANT: ACTIONABLE EMAILS ============
  // Flight confirmation
  if (/flight.*confirm|booking.*confirm|itinerary|e-?ticket/i.test(combined)) {
    return { importance: 'important', reason: 'Flight/Travel confirmation', actionType: 'flight' };
  }

  // Meeting invite
  if (/meeting.*invite|calendar.*invite|you.*(invited|scheduled)/i.test(combined)) {
    return { importance: 'important', reason: 'Meeting invitation', actionType: 'meeting_invite' };
  }

  // Bill/Invoice
  if (/invoice|bill|payment.*due|pay.*by|amount.*due/i.test(combined)) {
    return { importance: 'important', reason: 'Bill/Invoice', actionType: 'bill' };
  }

  // Delivery
  if (/package.*deliver|order.*shipped|tracking.*number|out.*for.*delivery/i.test(combined)) {
    return { importance: 'normal', reason: 'Delivery notification', actionType: 'delivery' };
  }

  // ============ IMPORTANT: MENTIONS USER'S PROJECTS ============
  const userProjects = await getUserProjects(db, userId);
  const projectMatch = userProjects.find(p =>
    combined.includes(p.toLowerCase())
  );

  if (projectMatch) {
    return { importance: 'important', reason: `Mentions project: ${projectMatch}` };
  }

  // ============ NORMAL ============
  // Direct email (not CC'd)
  const userEmail = await getUserEmail(db, userId);
  if (userEmail && email.to.some(t => t.toLowerCase().includes(userEmail))) {
    return { importance: 'normal', reason: 'Direct email' };
  }

  // ============ LOW ============
  return { importance: 'low', reason: 'General email' };
}

/**
 * Get important contacts for a user
 */
async function getImportantContacts(
  db: D1Database,
  userId: string
): Promise<Array<{ name: string; email: string; relationship?: string }>> {
  const contacts = await db.prepare(`
    SELECT
      name,
      json_extract(metadata, '$.email') as email,
      json_extract(metadata, '$.relationship') as relationship
    FROM entities
    WHERE user_id = ?
    AND type = 'person'
    AND json_extract(metadata, '$.email') IS NOT NULL
    ORDER BY mention_count DESC
    LIMIT 50
  `).bind(userId).all();

  return (contacts.results as any[])
    .filter(c => c.email)
    .map(c => ({
      name: c.name,
      email: c.email,
      relationship: c.relationship,
    }));
}

/**
 * Get user's active projects
 */
async function getUserProjects(db: D1Database, userId: string): Promise<string[]> {
  const projects = await db.prepare(`
    SELECT name FROM entities
    WHERE user_id = ?
    AND type IN ('project', 'work', 'company')
    AND updated_at > datetime('now', '-30 days')
    ORDER BY mention_count DESC
    LIMIT 10
  `).bind(userId).all();

  return (projects.results as any[]).map(p => p.name);
}

/**
 * Get user's email
 */
async function getUserEmail(db: D1Database, userId: string): Promise<string> {
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  return user?.email?.toLowerCase() || '';
}

/**
 * Create a memory from an important email
 */
async function createEmailMemory(
  db: D1Database,
  userId: string,
  email: EmailEvent,
  classification: EmailClassification
): Promise<void> {
  const senderName = extractSenderName(email.from);
  const content = `Email from ${senderName}: "${email.subject}" - ${email.snippet.slice(0, 200)}`;

  await db.prepare(`
    INSERT INTO memories (id, user_id, content, source, importance, metadata, created_at)
    VALUES (?, ?, ?, 'email', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    content,
    classification.importance === 'urgent' ? 10 : classification.importance === 'important' ? 7 : 5,
    JSON.stringify({
      emailId: email.id,
      threadId: email.threadId,
      from: email.from,
      subject: email.subject,
      classification: classification.reason,
    })
  ).run();
}

/**
 * Send push notification for important email
 */
async function sendEmailNotification(
  env: Bindings,
  userId: string,
  email: EmailEvent,
  classification: EmailClassification
): Promise<void> {
  const pushToken = await env.DB.prepare(`
    SELECT push_token FROM notification_preferences WHERE user_id = ?
  `).bind(userId).first<{ push_token: string }>();

  if (!pushToken?.push_token) return;

  const senderName = extractSenderName(email.from);
  const emoji = classification.importance === 'urgent' ? '' : '';

  const title = `${emoji} ${senderName}`;
  const body = email.subject.slice(0, 100);

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken.push_token,
        title,
        body,
        data: {
          type: 'email_alert',
          emailId: email.id,
          threadId: email.threadId,
          importance: classification.importance,
        },
        sound: classification.importance === 'urgent' ? 'default' : undefined,
        categoryId: 'EMAIL',
      }),
    });
  } catch (error) {
    console.error('[EmailMonitor] Push notification failed:', error);
  }

  // Also create proactive message for in-app
  await env.DB.prepare(`
    INSERT INTO proactive_messages (id, user_id, message_type, content, metadata, created_at)
    VALUES (?, ?, 'email_alert', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    `**${senderName}** - ${email.subject}\n\n${email.snippet.slice(0, 150)}...`,
    JSON.stringify({
      emailId: email.id,
      threadId: email.threadId,
      from: email.from,
      importance: classification.importance,
      reason: classification.reason,
    })
  ).run();
}

/**
 * Handle actionable emails (flights, bills, invites)
 */
async function handleActionableEmail(
  env: Bindings,
  userId: string,
  email: EmailEvent,
  classification: EmailClassification
): Promise<void> {
  switch (classification.actionType) {
    case 'flight':
      await handleFlightEmail(env, userId, email);
      break;
    case 'bill':
      await handleBillEmail(env, userId, email);
      break;
    case 'meeting_invite':
      // Meeting invites are auto-handled by calendar sync
      break;
    case 'delivery':
      await handleDeliveryEmail(env, userId, email);
      break;
  }
}

/**
 * Handle flight confirmation email
 */
async function handleFlightEmail(
  env: Bindings,
  userId: string,
  email: EmailEvent
): Promise<void> {
  // Extract flight details (simplified - in production use LLM)
  const flightInfo = extractFlightInfo(email.subject + ' ' + email.snippet);

  if (!flightInfo) return;

  // Create a commitment for check-in reminder
  const checkInTime = new Date(flightInfo.departureTime);
  checkInTime.setHours(checkInTime.getHours() - 24);

  await env.DB.prepare(`
    INSERT INTO commitments (id, user_id, content, due_date, due_time, source, metadata, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'email', ?, 'active', datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    `Check in for flight to ${flightInfo.destination}`,
    checkInTime.toISOString().split('T')[0],
    checkInTime.toTimeString().slice(0, 5),
    JSON.stringify({
      emailId: email.id,
      airline: flightInfo.airline,
      flightNumber: flightInfo.flightNumber,
      destination: flightInfo.destination,
    })
  ).run();

  console.log(`[EmailMonitor] Created check-in reminder for flight to ${flightInfo.destination}`);
}

/**
 * Handle bill/invoice email
 */
async function handleBillEmail(
  env: Bindings,
  userId: string,
  email: EmailEvent
): Promise<void> {
  // Extract due date if present
  const dueDateMatch = email.snippet.match(/due\s*(by|on|date)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2},?\s*\d{4})/i);

  let dueDate: string | null = null;
  if (dueDateMatch) {
    try {
      const parsed = new Date(dueDateMatch[2]);
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed.toISOString().split('T')[0];
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Create commitment for bill payment
  await env.DB.prepare(`
    INSERT INTO commitments (id, user_id, content, due_date, source, metadata, status, created_at)
    VALUES (?, ?, ?, ?, 'email', ?, 'active', datetime('now'))
  `).bind(
    crypto.randomUUID(),
    userId,
    `Pay: ${email.subject.slice(0, 50)}`,
    dueDate,
    JSON.stringify({ emailId: email.id, from: email.from })
  ).run();

  console.log(`[EmailMonitor] Created bill reminder: ${email.subject}`);
}

/**
 * Handle delivery notification email
 */
async function handleDeliveryEmail(
  env: Bindings,
  userId: string,
  email: EmailEvent
): Promise<void> {
  // Just create a memory - no commitment needed
  console.log(`[EmailMonitor] Noted delivery: ${email.subject}`);
}

/**
 * Extract sender name from email address
 */
function extractSenderName(from: string): string {
  // "John Doe <john@example.com>" → "John Doe"
  const match = from.match(/^([^<]+)</);
  if (match) return match[1].trim();

  // "john@example.com" → "John"
  const emailMatch = from.match(/^([^@]+)@/);
  if (emailMatch) {
    const name = emailMatch[1].replace(/[._]/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  return from.slice(0, 20);
}

/**
 * Extract flight info from text (simplified)
 */
function extractFlightInfo(text: string): {
  airline: string;
  flightNumber: string;
  destination: string;
  departureTime: string;
} | null {
  // Very simplified extraction - in production use LLM
  const airlines = ['IndiGo', 'Air India', 'SpiceJet', 'Vistara', 'GoAir', 'AirAsia'];
  const airline = airlines.find(a => text.toLowerCase().includes(a.toLowerCase())) || 'Unknown';

  const flightMatch = text.match(/\b([A-Z]{2}\d{3,4}|[A-Z]{3}\d{3,4})\b/);
  const flightNumber = flightMatch?.[1] || 'Unknown';

  // Try to find destination city
  const cities = ['Delhi', 'Mumbai', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Goa'];
  const destination = cities.find(c => text.includes(c)) || 'Destination';

  // Try to find date
  const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  const departureTime = dateMatch
    ? new Date(dateMatch[1]).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Default to 7 days from now

  return { airline, flightNumber, destination, departureTime };
}

/**
 * Poll for new emails (alternative to webhooks)
 * Called periodically to check for new emails
 */
export async function pollNewEmails(env: Bindings, userId: string): Promise<number> {
  // Get user's Google connection
  const integration = await env.DB.prepare(`
    SELECT access_token FROM integrations
    WHERE user_id = ? AND provider = 'googlesuper' AND connected = 1
  `).bind(userId).first<{ access_token: string }>();

  if (!integration?.access_token) return 0;

  // Get last processed email timestamp
  const lastProcessed = await env.DB.prepare(`
    SELECT MAX(json_extract(metadata, '$.receivedAt')) as last_time
    FROM memories
    WHERE user_id = ? AND source = 'email'
  `).bind(userId).first<{ last_time: string }>();

  const since = lastProcessed?.last_time
    ? new Date(lastProcessed.last_time)
    : new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

  try {
    // Fetch recent emails from Composio
    const response = await fetch(
      'https://backend.composio.dev/api/v2/actions/GMAIL_FETCH_EMAILS/execute',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.COMPOSIO_API_KEY,
        },
        body: JSON.stringify({
          connectedAccountId: integration.access_token,
          input: {
            query: `after:${Math.floor(since.getTime() / 1000)}`,
            max_results: 20,
          },
        }),
      }
    );

    if (!response.ok) return 0;

    const result = await response.json() as any;
    const emails = result.data?.emails || result.emails || [];

    let processed = 0;

    for (const email of emails) {
      const emailEvent: EmailEvent = {
        id: email.id,
        threadId: email.threadId || email.thread_id,
        from: email.from || email.sender,
        to: email.to ? (Array.isArray(email.to) ? email.to : [email.to]) : [],
        subject: email.subject || '(no subject)',
        snippet: email.snippet || email.bodyPreview || '',
        body: email.body,
        receivedAt: email.date || email.receivedDateTime || new Date().toISOString(),
        labels: email.labelIds || email.labels || [],
      };

      await handleNewEmail(env, userId, emailEvent);
      processed++;
    }

    return processed;
  } catch (error) {
    console.error('[EmailMonitor] Poll failed:', error);
    return 0;
  }
}
