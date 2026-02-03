/**
 * Email Importance Scorer
 *
 * Scores emails based on multiple factors:
 * - Sender importance (known entities, VIPs)
 * - Content urgency signals
 * - Thread context (ongoing conversations)
 * - Time sensitivity
 * - User behavior patterns
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface EmailData {
  id: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  snippet: string;
  body?: string;
  threadId?: string;
  date: string;
  labels?: string[];
  hasAttachments?: boolean;
  isUnread?: boolean;
}

export interface ScoredEmail extends EmailData {
  importanceScore: number;
  urgencyScore: number;
  categoryScore: number;
  overallScore: number;
  factors: ImportanceFactors;
  category: EmailCategory;
  suggestedAction?: string;
  requiresResponse?: boolean;
}

export interface ImportanceFactors {
  senderImportance: number;
  contentUrgency: number;
  timeSensitivity: number;
  threadContext: number;
  labelBoost: number;
  personalRelevance: number;
}

export type EmailCategory =
  | 'urgent_action'
  | 'needs_response'
  | 'important_info'
  | 'fyi'
  | 'promotional'
  | 'automated'
  | 'social';

// Urgency keywords with weights
const URGENCY_KEYWORDS = {
  high: [
    'urgent', 'asap', 'immediately', 'critical', 'emergency',
    'deadline today', 'due today', 'end of day', 'eod',
    'time sensitive', 'action required', 'please respond',
  ],
  medium: [
    'important', 'priority', 'follow up', 'reminder',
    'please review', 'need your input', 'waiting for',
    'by tomorrow', 'this week', 'please confirm',
  ],
  low: [
    'fyi', 'when you have time', 'no rush', 'just checking',
    'for your information', 'keeping you posted',
  ],
};

// Labels that indicate importance
const IMPORTANT_LABELS = [
  'IMPORTANT', 'STARRED', 'CATEGORY_PERSONAL', 'CATEGORY_PRIMARY',
];

const PROMOTIONAL_LABELS = [
  'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES',
];

export class EmailImportanceScorer {
  private db: D1Database;
  private userId: string;
  private entityCache: Map<string, { importance: number; type: string }> = new Map();
  private vipSenders: Set<string> = new Set();

  constructor(db: D1Database, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Load user's important entities and VIP senders
   */
  async initialize(): Promise<void> {
    // Load top entities (people) as potential VIPs
    const entities = await this.db.prepare(`
      SELECT name, email, importance_score, entity_type
      FROM entities
      WHERE user_id = ? AND entity_type = 'person'
      AND importance_score > 0.5
    `).bind(this.userId).all();

    for (const entity of entities.results as any[]) {
      if (entity.email) {
        this.vipSenders.add(entity.email.toLowerCase());
        this.entityCache.set(entity.email.toLowerCase(), {
          importance: entity.importance_score,
          type: entity.entity_type,
        });
      }
      if (entity.name) {
        this.entityCache.set(entity.name.toLowerCase(), {
          importance: entity.importance_score,
          type: entity.entity_type,
        });
      }
    }

    // Load profiles marked as important
    const profiles = await this.db.prepare(`
      SELECT email, name
      FROM profiles
      WHERE user_id = ? AND is_vip = 1
    `).bind(this.userId).all();

    for (const profile of profiles.results as any[]) {
      if (profile.email) {
        this.vipSenders.add(profile.email.toLowerCase());
      }
    }
  }

  /**
   * Score a single email
   */
  async scoreEmail(email: EmailData): Promise<ScoredEmail> {
    const factors = await this.calculateFactors(email);

    // Calculate component scores
    const importanceScore = this.calculateImportanceScore(factors);
    const urgencyScore = factors.contentUrgency * 0.5 + factors.timeSensitivity * 0.5;
    const categoryScore = this.getCategoryScore(email);

    // Overall score (weighted combination)
    const overallScore = Math.min(
      1,
      importanceScore * 0.4 + urgencyScore * 0.35 + categoryScore * 0.25
    );

    // Determine category
    const category = this.categorizeEmail(email, factors, urgencyScore);

    // Determine if response is needed
    const requiresResponse = this.checkRequiresResponse(email, factors);

    // Suggest action
    const suggestedAction = this.suggestAction(category, factors, requiresResponse);

    return {
      ...email,
      importanceScore: Math.round(importanceScore * 100) / 100,
      urgencyScore: Math.round(urgencyScore * 100) / 100,
      categoryScore: Math.round(categoryScore * 100) / 100,
      overallScore: Math.round(overallScore * 100) / 100,
      factors,
      category,
      suggestedAction,
      requiresResponse,
    };
  }

  /**
   * Score multiple emails and sort by importance
   */
  async scoreEmails(emails: EmailData[]): Promise<ScoredEmail[]> {
    await this.initialize();

    const scoredEmails = await Promise.all(
      emails.map((email) => this.scoreEmail(email))
    );

    // Sort by overall score descending
    return scoredEmails.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Get only urgent/important emails
   */
  async getUrgentEmails(
    emails: EmailData[],
    threshold: number = 0.6
  ): Promise<ScoredEmail[]> {
    const scored = await this.scoreEmails(emails);
    return scored.filter((e) => e.overallScore >= threshold);
  }

  /**
   * Calculate all importance factors for an email
   */
  private async calculateFactors(email: EmailData): Promise<ImportanceFactors> {
    const senderImportance = this.scoreSenderImportance(email.from, email.fromName);
    const contentUrgency = this.scoreContentUrgency(email.subject, email.snippet, email.body);
    const timeSensitivity = this.scoreTimeSensitivity(email.date);
    const threadContext = await this.scoreThreadContext(email.threadId);
    const labelBoost = this.scoreLabelBoost(email.labels);
    const personalRelevance = this.scorePersonalRelevance(email);

    return {
      senderImportance,
      contentUrgency,
      timeSensitivity,
      threadContext,
      labelBoost,
      personalRelevance,
    };
  }

  /**
   * Score sender importance based on known entities and patterns
   */
  private scoreSenderImportance(from: string, fromName?: string): number {
    const email = from.toLowerCase();
    const name = fromName?.toLowerCase() || '';

    // Check VIP list
    if (this.vipSenders.has(email)) {
      return 1.0;
    }

    // Check entity cache
    const entityByEmail = this.entityCache.get(email);
    if (entityByEmail) {
      return entityByEmail.importance;
    }

    const entityByName = this.entityCache.get(name);
    if (entityByName) {
      return entityByName.importance;
    }

    // Domain-based scoring
    const domain = email.split('@')[1];
    if (!domain) return 0.3;

    // Personal domains are usually more important than corporate newsletters
    if (['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'].includes(domain)) {
      return 0.5;
    }

    // Common newsletter/automated domains
    if (domain.includes('noreply') || domain.includes('newsletter') ||
        domain.includes('notifications') || domain.includes('marketing')) {
      return 0.1;
    }

    // Unknown corporate domain
    return 0.4;
  }

  /**
   * Score content urgency based on keywords
   */
  private scoreContentUrgency(
    subject: string,
    snippet: string,
    body?: string
  ): number {
    const content = `${subject} ${snippet} ${body || ''}`.toLowerCase();

    // Check high urgency keywords
    for (const keyword of URGENCY_KEYWORDS.high) {
      if (content.includes(keyword.toLowerCase())) {
        return 1.0;
      }
    }

    // Check medium urgency keywords
    let mediumCount = 0;
    for (const keyword of URGENCY_KEYWORDS.medium) {
      if (content.includes(keyword.toLowerCase())) {
        mediumCount++;
      }
    }
    if (mediumCount > 0) {
      return Math.min(0.8, 0.5 + mediumCount * 0.1);
    }

    // Check low urgency signals
    for (const keyword of URGENCY_KEYWORDS.low) {
      if (content.includes(keyword.toLowerCase())) {
        return 0.2;
      }
    }

    // Check for question marks (might need response)
    const questionCount = (content.match(/\?/g) || []).length;
    if (questionCount > 0) {
      return Math.min(0.5, 0.3 + questionCount * 0.05);
    }

    return 0.3; // Default baseline
  }

  /**
   * Score time sensitivity based on email age
   */
  private scoreTimeSensitivity(dateString: string): number {
    try {
      const emailDate = new Date(dateString);
      const now = new Date();
      const hoursAgo = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60);

      // Very recent emails get higher score
      if (hoursAgo < 1) return 1.0;
      if (hoursAgo < 4) return 0.9;
      if (hoursAgo < 12) return 0.7;
      if (hoursAgo < 24) return 0.5;
      if (hoursAgo < 48) return 0.3;
      if (hoursAgo < 168) return 0.2; // 7 days

      return 0.1;
    } catch {
      return 0.3;
    }
  }

  /**
   * Score thread context (ongoing conversations are more important)
   */
  private async scoreThreadContext(threadId?: string): Promise<number> {
    if (!threadId) return 0.3;

    // Check if we have memories related to this thread
    const threadMemories = await this.db.prepare(`
      SELECT COUNT(*) as count
      FROM memories
      WHERE user_id = ? AND source = 'email'
      AND json_extract(metadata, '$.thread_id') = ?
    `).bind(this.userId, threadId).first<{ count: number }>();

    const count = threadMemories?.count || 0;

    if (count > 5) return 0.9; // Active thread
    if (count > 2) return 0.7;
    if (count > 0) return 0.5;

    return 0.3;
  }

  /**
   * Score based on Gmail labels
   */
  private scoreLabelBoost(labels?: string[]): number {
    if (!labels || labels.length === 0) return 0.3;

    // Check for important labels
    const hasImportant = labels.some((l) =>
      IMPORTANT_LABELS.includes(l.toUpperCase())
    );
    if (hasImportant) return 0.9;

    // Check for promotional labels
    const hasPromotional = labels.some((l) =>
      PROMOTIONAL_LABELS.includes(l.toUpperCase())
    );
    if (hasPromotional) return 0.1;

    // INBOX label indicates primary
    if (labels.includes('INBOX')) return 0.5;

    return 0.3;
  }

  /**
   * Score personal relevance based on content
   */
  private scorePersonalRelevance(email: EmailData): number {
    const content = `${email.subject} ${email.snippet}`.toLowerCase();

    // Direct mentions
    if (content.includes('you ') || content.includes('your ')) {
      return 0.7;
    }

    // Meeting/calendar related
    if (content.includes('meeting') || content.includes('calendar') ||
        content.includes('schedule') || content.includes('invite')) {
      return 0.8;
    }

    // Action oriented
    if (content.includes('please') || content.includes('could you') ||
        content.includes('would you') || content.includes('can you')) {
      return 0.7;
    }

    // CC'd only
    if (email.cc?.some((cc) => cc.toLowerCase().includes(this.userId))) {
      return 0.3;
    }

    return 0.4;
  }

  /**
   * Calculate overall importance score
   */
  private calculateImportanceScore(factors: ImportanceFactors): number {
    const weights = {
      senderImportance: 0.30,
      contentUrgency: 0.20,
      timeSensitivity: 0.15,
      threadContext: 0.15,
      labelBoost: 0.10,
      personalRelevance: 0.10,
    };

    return (
      factors.senderImportance * weights.senderImportance +
      factors.contentUrgency * weights.contentUrgency +
      factors.timeSensitivity * weights.timeSensitivity +
      factors.threadContext * weights.threadContext +
      factors.labelBoost * weights.labelBoost +
      factors.personalRelevance * weights.personalRelevance
    );
  }

  /**
   * Get category score
   */
  private getCategoryScore(email: EmailData): number {
    const labels = email.labels || [];

    // Primary inbox
    if (labels.includes('CATEGORY_PRIMARY') || labels.includes('INBOX')) {
      return 0.8;
    }

    // Social
    if (labels.includes('CATEGORY_SOCIAL')) {
      return 0.4;
    }

    // Promotions
    if (labels.includes('CATEGORY_PROMOTIONS')) {
      return 0.2;
    }

    // Updates/Automated
    if (labels.includes('CATEGORY_UPDATES')) {
      return 0.3;
    }

    return 0.5;
  }

  /**
   * Categorize email
   */
  private categorizeEmail(
    email: EmailData,
    factors: ImportanceFactors,
    urgencyScore: number
  ): EmailCategory {
    // Automated emails
    const from = email.from.toLowerCase();
    if (from.includes('noreply') || from.includes('no-reply') ||
        from.includes('notifications') || from.includes('automated')) {
      return 'automated';
    }

    // Promotional
    if (email.labels?.includes('CATEGORY_PROMOTIONS')) {
      return 'promotional';
    }

    // Social
    if (email.labels?.includes('CATEGORY_SOCIAL')) {
      return 'social';
    }

    // Urgent action
    if (urgencyScore >= 0.8 && factors.senderImportance >= 0.6) {
      return 'urgent_action';
    }

    // Needs response
    if (factors.personalRelevance >= 0.6 || factors.contentUrgency >= 0.5) {
      return 'needs_response';
    }

    // Important info
    if (factors.senderImportance >= 0.5 || factors.threadContext >= 0.6) {
      return 'important_info';
    }

    return 'fyi';
  }

  /**
   * Check if email requires a response
   */
  private checkRequiresResponse(
    email: EmailData,
    factors: ImportanceFactors
  ): boolean {
    const content = `${email.subject} ${email.snippet}`.toLowerCase();

    // Direct questions
    if (content.includes('?')) {
      return true;
    }

    // Request patterns
    if (content.includes('please ') || content.includes('could you') ||
        content.includes('can you') || content.includes('would you')) {
      return true;
    }

    // High personal relevance and urgency
    if (factors.personalRelevance >= 0.7 && factors.contentUrgency >= 0.5) {
      return true;
    }

    return false;
  }

  /**
   * Suggest action based on email category
   */
  private suggestAction(
    category: EmailCategory,
    factors: ImportanceFactors,
    requiresResponse: boolean
  ): string {
    switch (category) {
      case 'urgent_action':
        return 'Respond immediately';
      case 'needs_response':
        return requiresResponse ? 'Reply today' : 'Review and respond';
      case 'important_info':
        return 'Read when available';
      case 'fyi':
        return 'Skim or archive';
      case 'promotional':
        return 'Archive or unsubscribe';
      case 'automated':
        return 'No action needed';
      case 'social':
        return 'Review later';
      default:
        return 'Review';
    }
  }
}

/**
 * Factory function
 */
export function createEmailImportanceScorer(
  db: D1Database,
  userId: string
): EmailImportanceScorer {
  return new EmailImportanceScorer(db, userId);
}
