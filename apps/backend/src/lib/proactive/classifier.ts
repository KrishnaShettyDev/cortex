/**
 * Intelligent Event Classification Engine
 *
 * Multi-tier classification system:
 * 1. Fast-path regex rules (instant, no API calls)
 * 2. VIP sender boost/block
 * 3. Classification cache (1h TTL)
 * 4. LLM fallback for ambiguous cases (gpt-4o-mini)
 *
 * Security: No PII stored in cache, only content hashes
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';

// =============================================================================
// TYPES
// =============================================================================

export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface ClassificationResult {
  urgency: UrgencyLevel;
  category: string;
  actionRequired: boolean;
  confidence: number;
  reasoning?: string;
  source: 'fast_path' | 'cache' | 'llm' | 'vip_boost';
}

export interface ClassificationInput {
  title?: string;
  body?: string;
  sender?: string;
  source: string; // email, calendar, slack, etc.
  eventType?: string;
}

// =============================================================================
// FAST-PATH PATTERNS (No LLM needed - instant classification)
// =============================================================================

interface FastPathRule {
  pattern: RegExp;
  fields: ('title' | 'body' | 'sender')[];
  urgency: UrgencyLevel;
  category: string;
  actionRequired: boolean;
}

const FAST_PATH_CRITICAL: FastPathRule[] = [
  // OTPs and verification codes
  { pattern: /\b\d{4,8}\b.*(?:code|otp|verification|verify)/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },
  { pattern: /(?:code|otp|verification|verify).*\b\d{4,8}\b/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },
  { pattern: /one[- ]?time[- ]?password/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },
  { pattern: /2fa|two[- ]?factor/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },
  { pattern: /login code|sign[- ]?in code/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },
  { pattern: /security code|verification token/i, fields: ['title', 'body'], urgency: 'critical', category: 'otp', actionRequired: true },

  // Security alerts
  { pattern: /security alert|suspicious (?:activity|login|sign[- ]?in)/i, fields: ['title'], urgency: 'critical', category: 'security', actionRequired: true },
  { pattern: /unauthorized (?:access|login)/i, fields: ['title', 'body'], urgency: 'critical', category: 'security', actionRequired: true },
  { pattern: /account (?:compromised|locked|suspended)/i, fields: ['title'], urgency: 'critical', category: 'security', actionRequired: true },
];

const FAST_PATH_HIGH: FastPathRule[] = [
  // Password and account
  { pattern: /password reset/i, fields: ['title', 'body'], urgency: 'high', category: 'security', actionRequired: true },
  { pattern: /reset your password/i, fields: ['title', 'body'], urgency: 'high', category: 'security', actionRequired: true },

  // Urgency indicators
  { pattern: /\burgent\b/i, fields: ['title'], urgency: 'high', category: 'urgent', actionRequired: true },
  { pattern: /\basap\b/i, fields: ['title'], urgency: 'high', category: 'urgent', actionRequired: true },
  { pattern: /action required/i, fields: ['title'], urgency: 'high', category: 'urgent', actionRequired: true },
  { pattern: /immediate (?:action|attention)/i, fields: ['title'], urgency: 'high', category: 'urgent', actionRequired: true },
  { pattern: /deadline (?:today|tomorrow)/i, fields: ['title', 'body'], urgency: 'high', category: 'deadline', actionRequired: true },

  // Payment and financial
  { pattern: /payment (?:due|failed|declined|overdue)/i, fields: ['title', 'body'], urgency: 'high', category: 'payment', actionRequired: true },
  { pattern: /invoice (?:due|overdue)/i, fields: ['title', 'body'], urgency: 'high', category: 'payment', actionRequired: true },
  { pattern: /card (?:declined|expired)/i, fields: ['title', 'body'], urgency: 'high', category: 'payment', actionRequired: true },

  // Calendar - meetings starting soon
  { pattern: /starting (?:in|soon)/i, fields: ['title'], urgency: 'high', category: 'calendar', actionRequired: false },
  { pattern: /meeting in \d+ min/i, fields: ['title', 'body'], urgency: 'high', category: 'calendar', actionRequired: false },

  // Direct communication
  { pattern: /^DM:/i, fields: ['title'], urgency: 'high', category: 'direct_message', actionRequired: false },
  { pattern: /mentioned you/i, fields: ['title', 'body'], urgency: 'high', category: 'mention', actionRequired: false },
  { pattern: /commented on/i, fields: ['title'], urgency: 'high', category: 'comment', actionRequired: false },
];

const FAST_PATH_LOW: FastPathRule[] = [
  // Marketing
  { pattern: /newsletter/i, fields: ['title', 'body'], urgency: 'low', category: 'marketing', actionRequired: false },
  { pattern: /unsubscribe/i, fields: ['body'], urgency: 'low', category: 'marketing', actionRequired: false },
  { pattern: /\d+% off/i, fields: ['title', 'body'], urgency: 'low', category: 'marketing', actionRequired: false },
  { pattern: /special offer|limited time/i, fields: ['title'], urgency: 'low', category: 'marketing', actionRequired: false },
  { pattern: /sale ends|flash sale/i, fields: ['title'], urgency: 'low', category: 'marketing', actionRequired: false },

  // Automated/noreply
  { pattern: /noreply@|no-reply@|donotreply@/i, fields: ['sender'], urgency: 'low', category: 'automated', actionRequired: false },
  { pattern: /automated message/i, fields: ['body'], urgency: 'low', category: 'automated', actionRequired: false },

  // Social
  { pattern: /weekly digest|daily summary/i, fields: ['title'], urgency: 'low', category: 'digest', actionRequired: false },
  { pattern: /new follower|started following/i, fields: ['title'], urgency: 'low', category: 'social', actionRequired: false },
];

// =============================================================================
// CORE CLASSIFICATION FUNCTIONS
// =============================================================================

/**
 * Main classification entry point
 * Uses multi-tier approach: fast-path → cache → VIP → LLM
 */
export async function classifyEvent(
  db: D1Database,
  openaiKey: string,
  userId: string,
  input: ClassificationInput
): Promise<ClassificationResult> {
  const content = normalizeContent(input);

  // 1. Fast-path rules (instant, no DB/API calls)
  const fastResult = fastPathClassify(input);
  if (fastResult && fastResult.confidence >= 0.95) {
    return fastResult;
  }

  // 2. Check cache (avoid repeated LLM calls)
  const contentHash = await hashContent(content);
  const cached = await getCachedClassification(db, contentHash);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  // 3. VIP sender check (boost or block)
  const senderEmail = extractEmail(input.sender);
  if (senderEmail) {
    const vipStatus = await checkVipStatus(db, userId, senderEmail);
    if (vipStatus === 'blocked') {
      return {
        urgency: 'low',
        category: 'blocked',
        actionRequired: false,
        confidence: 1.0,
        source: 'vip_boost',
      };
    }
    if (vipStatus === 'vip' && fastResult) {
      // Boost VIP senders to at least high
      return {
        ...fastResult,
        urgency: boostUrgency(fastResult.urgency),
        source: 'vip_boost',
      };
    }
  }

  // 4. If fast-path gave medium confidence, use that
  if (fastResult && fastResult.confidence >= 0.7) {
    await cacheClassification(db, contentHash, fastResult);
    return fastResult;
  }

  // 5. LLM classification for ambiguous cases
  const llmResult = await llmClassify(openaiKey, input);
  await cacheClassification(db, contentHash, llmResult);

  return llmResult;
}

/**
 * Fast-path classification using regex rules
 * Returns null if no confident match
 */
function fastPathClassify(input: ClassificationInput): ClassificationResult | null {
  const fields = {
    title: input.title || '',
    body: input.body || '',
    sender: input.sender || '',
  };

  // Check critical first (highest priority)
  for (const rule of FAST_PATH_CRITICAL) {
    for (const field of rule.fields) {
      if (rule.pattern.test(fields[field])) {
        return {
          urgency: rule.urgency,
          category: rule.category,
          actionRequired: rule.actionRequired,
          confidence: 0.98,
          source: 'fast_path',
        };
      }
    }
  }

  // Check high priority
  for (const rule of FAST_PATH_HIGH) {
    for (const field of rule.fields) {
      if (rule.pattern.test(fields[field])) {
        return {
          urgency: rule.urgency,
          category: rule.category,
          actionRequired: rule.actionRequired,
          confidence: 0.95,
          source: 'fast_path',
        };
      }
    }
  }

  // Check low priority
  for (const rule of FAST_PATH_LOW) {
    for (const field of rule.fields) {
      if (rule.pattern.test(fields[field])) {
        return {
          urgency: rule.urgency,
          category: rule.category,
          actionRequired: rule.actionRequired,
          confidence: 0.95,
          source: 'fast_path',
        };
      }
    }
  }

  // Default to medium with low confidence (triggers LLM)
  return {
    urgency: 'medium',
    category: 'unknown',
    actionRequired: false,
    confidence: 0.5,
    source: 'fast_path',
  };
}

/**
 * LLM-based classification for ambiguous content
 * Uses gpt-4o-mini for cost efficiency
 */
async function llmClassify(
  openaiKey: string,
  input: ClassificationInput
): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(input);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, // Low temp for consistent classification
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      console.error('[Classifier] OpenAI API error:', response.status);
      return defaultClassification();
    }

    const data = await response.json() as any;
    const result = JSON.parse(data.choices[0].message.content);

    return {
      urgency: validateUrgency(result.urgency),
      category: result.category || 'unknown',
      actionRequired: Boolean(result.actionRequired),
      confidence: Math.min(1, Math.max(0, result.confidence || 0.8)),
      reasoning: result.reasoning,
      source: 'llm',
    };
  } catch (error) {
    console.error('[Classifier] LLM classification failed:', error);
    return defaultClassification();
  }
}

function buildClassificationPrompt(input: ClassificationInput): string {
  return `Classify this ${input.source} notification for urgency and action requirement.

Title: ${input.title || 'N/A'}
Sender: ${input.sender || 'N/A'}
Content: ${(input.body || '').slice(0, 500)}

Respond in JSON:
{
  "urgency": "critical|high|medium|low",
  "category": "otp|security|calendar|social|work|marketing|transactional|other",
  "actionRequired": true|false,
  "confidence": 0.0-1.0,
  "reasoning": "brief 10-word max explanation"
}

Classification rules:
- critical: OTPs, 2FA codes, security alerts (must act within minutes)
- high: Payment issues, deadline reminders, direct requests, meeting starting
- medium: Normal emails from known contacts, calendar updates, comments
- low: Marketing, newsletters, automated notifications, social updates`;
}

// =============================================================================
// CACHE FUNCTIONS
// =============================================================================

async function getCachedClassification(
  db: D1Database,
  contentHash: string
): Promise<ClassificationResult | null> {
  try {
    const cached = await db.prepare(`
      SELECT urgency, category, action_required, confidence, llm_reasoning
      FROM classification_cache
      WHERE content_hash = ? AND expires_at > datetime('now')
    `).bind(contentHash).first<{
      urgency: string;
      category: string;
      action_required: number;
      confidence: number;
      llm_reasoning: string;
    }>();

    if (cached) {
      return {
        urgency: cached.urgency as UrgencyLevel,
        category: cached.category,
        actionRequired: Boolean(cached.action_required),
        confidence: cached.confidence,
        reasoning: cached.llm_reasoning,
        source: 'cache',
      };
    }
  } catch (error) {
    console.error('[Classifier] Cache read error:', error);
  }
  return null;
}

async function cacheClassification(
  db: D1Database,
  contentHash: string,
  result: ClassificationResult
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour TTL

    await db.prepare(`
      INSERT INTO classification_cache (id, content_hash, urgency, category, action_required, confidence, llm_reasoning, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(content_hash) DO UPDATE SET
        urgency = excluded.urgency,
        category = excluded.category,
        action_required = excluded.action_required,
        confidence = excluded.confidence,
        llm_reasoning = excluded.llm_reasoning,
        expires_at = excluded.expires_at
    `).bind(
      nanoid(),
      contentHash,
      result.urgency,
      result.category,
      result.actionRequired ? 1 : 0,
      result.confidence,
      result.reasoning || null,
      expiresAt
    ).run();
  } catch (error) {
    console.error('[Classifier] Cache write error:', error);
  }
}

// =============================================================================
// VIP FUNCTIONS
// =============================================================================

async function checkVipStatus(
  db: D1Database,
  userId: string,
  email: string
): Promise<'vip' | 'blocked' | null> {
  try {
    const vip = await db.prepare(`
      SELECT type FROM proactive_vip WHERE user_id = ? AND email = ?
    `).bind(userId, email.toLowerCase()).first<{ type: string }>();

    if (vip?.type === 'vip') return 'vip';
    if (vip?.type === 'blocked') return 'blocked';
  } catch (error) {
    console.error('[Classifier] VIP check error:', error);
  }
  return null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function normalizeContent(input: ClassificationInput): string {
  // Create normalized string for hashing (lowercase, trimmed)
  return `${input.source}|${(input.title || '').toLowerCase().trim()}|${(input.body || '').toLowerCase().trim().slice(0, 200)}`;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractEmail(sender?: string): string | null {
  if (!sender) return null;

  // Extract email from "Name <email@example.com>" format
  const match = sender.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();

  // Check if it's already an email
  if (sender.includes('@')) return sender.toLowerCase();

  return null;
}

function boostUrgency(urgency: UrgencyLevel): UrgencyLevel {
  switch (urgency) {
    case 'low': return 'medium';
    case 'medium': return 'high';
    case 'high': return 'high'; // Already high
    case 'critical': return 'critical'; // Already critical
  }
}

function validateUrgency(urgency: string): UrgencyLevel {
  if (['critical', 'high', 'medium', 'low'].includes(urgency)) {
    return urgency as UrgencyLevel;
  }
  return 'medium';
}

function defaultClassification(): ClassificationResult {
  return {
    urgency: 'medium',
    category: 'unknown',
    actionRequired: false,
    confidence: 0.5,
    source: 'fast_path',
  };
}

// =============================================================================
// CLEANUP (run via cron)
// =============================================================================

export async function cleanupClassificationCache(db: D1Database): Promise<number> {
  try {
    const result = await db.prepare(`
      DELETE FROM classification_cache WHERE expires_at < datetime('now')
    `).run();
    return result.meta?.changes || 0;
  } catch (error) {
    console.error('[Classifier] Cache cleanup error:', error);
    return 0;
  }
}
