/**
 * Temporal Extractor - Supermemory++ Phase 2
 *
 * Extracts event dates from text using:
 * 1. Regex patterns for explicit dates
 * 2. Relative date parsing (yesterday, next week, etc.)
 * 3. LLM fallback for ambiguous cases
 *
 * Returns grounded dates with confidence scores.
 */

import { nanoid } from 'nanoid';

export interface ExtractedDate {
  date: string;           // ISO 8601 format
  originalText: string;   // The matched text
  confidence: number;     // 0-1 confidence score
  type: 'explicit' | 'relative' | 'inferred';
  eventType?: string;     // meeting, deadline, etc.
}

export interface TemporalExtractionResult {
  dates: ExtractedDate[];
  documentDate: string;   // When this content was created
  hasTemporalContent: boolean;
}

// Common date patterns (US and ISO formats)
const DATE_PATTERNS = [
  // ISO format: 2025-01-15, 2025-01-15T10:30:00
  /\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)\b/gi,

  // US format: 01/15/2025, 1/15/25
  /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,

  // Written format: January 15, 2025 or Jan 15, 2025
  /\b((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})\b/gi,

  // Day Month Year: 15 January 2025
  /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?,?\s*\d{4})\b/gi,

  // Short format: Jan 15 or January 15 (current year implied)
  /\b((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
];

// Relative date patterns
const RELATIVE_PATTERNS: { pattern: RegExp; resolver: (ref: Date) => Date }[] = [
  {
    pattern: /\byesterday\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setDate(d.getDate() - 1);
      return d;
    },
  },
  {
    pattern: /\btoday\b/i,
    resolver: (ref) => new Date(ref),
  },
  {
    pattern: /\btomorrow\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    pattern: /\blast\s+week\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setDate(d.getDate() - 7);
      return d;
    },
  },
  {
    pattern: /\bnext\s+week\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setDate(d.getDate() + 7);
      return d;
    },
  },
  {
    pattern: /\blast\s+month\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setMonth(d.getMonth() - 1);
      return d;
    },
  },
  {
    pattern: /\bnext\s+month\b/i,
    resolver: (ref) => {
      const d = new Date(ref);
      d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
  {
    pattern: /\b(\d+)\s+days?\s+ago\b/i,
    resolver: (ref, match) => {
      const days = parseInt(match![1], 10);
      const d = new Date(ref);
      d.setDate(d.getDate() - days);
      return d;
    },
  },
  {
    pattern: /\bin\s+(\d+)\s+days?\b/i,
    resolver: (ref, match) => {
      const days = parseInt(match![1], 10);
      const d = new Date(ref);
      d.setDate(d.getDate() + days);
      return d;
    },
  },
  {
    pattern: /\b(\d+)\s+weeks?\s+ago\b/i,
    resolver: (ref, match) => {
      const weeks = parseInt(match![1], 10);
      const d = new Date(ref);
      d.setDate(d.getDate() - weeks * 7);
      return d;
    },
  },
  {
    pattern: /\blast\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
    resolver: (ref, match) => {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(match![1].toLowerCase());
      const d = new Date(ref);
      const currentDay = d.getDay();
      let diff = currentDay - targetDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() - diff);
      return d;
    },
  },
  {
    pattern: /\bnext\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
    resolver: (ref, match) => {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = dayNames.indexOf(match![1].toLowerCase());
      const d = new Date(ref);
      const currentDay = d.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return d;
    },
  },
];

// Event type keywords
const EVENT_TYPE_KEYWORDS: Record<string, string[]> = {
  meeting: ['meeting', 'call', 'sync', 'standup', 'interview', 'coffee', 'lunch', 'dinner'],
  deadline: ['deadline', 'due', 'submit', 'deliver', 'launch', 'release'],
  milestone: ['milestone', 'goal', 'target', 'complete', 'finish', 'achieve'],
  travel: ['flight', 'trip', 'travel', 'vacation', 'visit'],
  appointment: ['appointment', 'doctor', 'dentist', 'checkup'],
  event: ['conference', 'event', 'party', 'wedding', 'birthday', 'anniversary'],
};

/**
 * Parse a date string into ISO format
 */
function parseToISO(dateStr: string, referenceDate: Date): string | null {
  try {
    // Try native Date parsing first
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    // Handle US format MM/DD/YYYY
    const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (usMatch) {
      let year = parseInt(usMatch[3], 10);
      if (year < 100) year += 2000;
      const month = parseInt(usMatch[1], 10) - 1;
      const day = parseInt(usMatch[2], 10);
      const d = new Date(year, month, day);
      return d.toISOString().split('T')[0];
    }

    // Handle written months
    const monthNames: Record<string, number> = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sep: 8, sept: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11,
    };

    // "January 15, 2025" or "Jan 15 2025"
    const writtenMatch = dateStr.match(/(\w+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i);
    if (writtenMatch) {
      const monthName = writtenMatch[1].toLowerCase().replace('.', '');
      const month = monthNames[monthName];
      if (month !== undefined) {
        const day = parseInt(writtenMatch[2], 10);
        const year = writtenMatch[3] ? parseInt(writtenMatch[3], 10) : referenceDate.getFullYear();
        const d = new Date(year, month, day);
        return d.toISOString().split('T')[0];
      }
    }

    // "15 January 2025"
    const dayFirstMatch = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\.?,?\s*(\d{4})?/i);
    if (dayFirstMatch) {
      const day = parseInt(dayFirstMatch[1], 10);
      const monthName = dayFirstMatch[2].toLowerCase().replace('.', '');
      const month = monthNames[monthName];
      if (month !== undefined) {
        const year = dayFirstMatch[3] ? parseInt(dayFirstMatch[3], 10) : referenceDate.getFullYear();
        const d = new Date(year, month, day);
        return d.toISOString().split('T')[0];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect event type from surrounding context
 */
function detectEventType(text: string, matchedText: string): string | undefined {
  const lowerText = text.toLowerCase();
  const startIdx = lowerText.indexOf(matchedText.toLowerCase());
  const contextWindow = 50;
  const start = Math.max(0, startIdx - contextWindow);
  const end = Math.min(lowerText.length, startIdx + matchedText.length + contextWindow);
  const context = lowerText.slice(start, end);

  for (const [eventType, keywords] of Object.entries(EVENT_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (context.includes(keyword)) {
        return eventType;
      }
    }
  }

  return undefined;
}

/**
 * Extract dates from text using pattern matching
 */
export function extractExplicitDates(text: string, referenceDate: Date): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const seen = new Set<string>();

  // Extract explicit date patterns
  for (const pattern of DATE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[1] || match[0];
      const isoDate = parseToISO(matchedText, referenceDate);

      if (isoDate && !seen.has(isoDate)) {
        seen.add(isoDate);
        results.push({
          date: isoDate,
          originalText: matchedText,
          confidence: 0.95,
          type: 'explicit',
          eventType: detectEventType(text, matchedText),
        });
      }
    }
  }

  return results;
}

/**
 * Extract relative dates from text
 */
export function extractRelativeDates(text: string, referenceDate: Date): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const seen = new Set<string>();

  for (const { pattern, resolver } of RELATIVE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const resolvedDate = resolver(referenceDate, match);
      const isoDate = resolvedDate.toISOString().split('T')[0];

      if (!seen.has(isoDate)) {
        seen.add(isoDate);
        results.push({
          date: isoDate,
          originalText: match[0],
          confidence: 0.85, // Lower confidence for relative dates
          type: 'relative',
          eventType: detectEventType(text, match[0]),
        });
      }
    }
  }

  return results;
}

/**
 * LLM-based date extraction for complex cases
 */
export async function extractDatesWithLLM(
  ai: any,
  text: string,
  referenceDate: Date
): Promise<ExtractedDate[]> {
  const prompt = `Extract all dates and events mentioned in the following text. Return a JSON array of objects with: date (ISO format YYYY-MM-DD), originalText (the text mentioning the date), and eventType (meeting/deadline/milestone/travel/appointment/event or null).

Reference date for relative dates: ${referenceDate.toISOString().split('T')[0]}

Text: "${text}"

Return ONLY valid JSON array, no explanation. If no dates found, return [].`;

  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });

    const content = response.response || '';
    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((item: any) => ({
        date: item.date,
        originalText: item.originalText || '',
        confidence: 0.7, // Lower confidence for LLM extraction
        type: 'inferred' as const,
        eventType: item.eventType || undefined,
      }));
    }
  } catch (error) {
    console.warn('[Temporal] LLM extraction failed:', error);
  }

  return [];
}

/**
 * Main extraction function - combines all methods
 */
export async function extractTemporalData(
  text: string,
  options: {
    documentDate?: string;
    referenceDate?: Date;
    useLLM?: boolean;
    ai?: any;
  } = {}
): Promise<TemporalExtractionResult> {
  const referenceDate = options.referenceDate || new Date();
  const documentDate = options.documentDate || new Date().toISOString();

  // Stage 1: Extract explicit dates (high confidence)
  const explicitDates = extractExplicitDates(text, referenceDate);

  // Stage 2: Extract relative dates (medium confidence)
  const relativeDates = extractRelativeDates(text, referenceDate);

  // Combine and deduplicate
  const allDates = [...explicitDates, ...relativeDates];
  const seenDates = new Set(allDates.map(d => d.date));

  // Stage 3: LLM fallback for complex cases (if enabled and no dates found)
  if (options.useLLM && options.ai && allDates.length === 0) {
    const llmDates = await extractDatesWithLLM(options.ai, text, referenceDate);
    for (const date of llmDates) {
      if (!seenDates.has(date.date)) {
        allDates.push(date);
        seenDates.add(date.date);
      }
    }
  }

  // Sort by confidence (highest first)
  allDates.sort((a, b) => b.confidence - a.confidence);

  return {
    dates: allDates,
    documentDate,
    hasTemporalContent: allDates.length > 0,
  };
}

/**
 * Save extracted dates to database
 */
export async function saveMemoryEvents(
  db: D1Database,
  memoryId: string,
  extractionResult: TemporalExtractionResult
): Promise<void> {
  if (extractionResult.dates.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO memory_events (id, memory_id, event_date, event_type, extraction_method, confidence, source_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = extractionResult.dates.map(date =>
    stmt.bind(
      nanoid(),
      memoryId,
      date.date,
      date.eventType || null,
      date.type,
      date.confidence,
      date.originalText
    )
  );

  await db.batch(batch);
}

/**
 * Update memory's document_date and flag temporal content
 */
export async function updateMemoryTemporalFields(
  db: D1Database,
  memoryId: string,
  documentDate: string,
  hasTemporalContent: boolean
): Promise<void> {
  await db.prepare(`
    UPDATE memories
    SET document_date = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(documentDate, memoryId).run();

  // Update search metadata
  await db.prepare(`
    INSERT INTO memory_search_meta (memory_id, has_temporal, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(memory_id) DO UPDATE SET
      has_temporal = excluded.has_temporal,
      updated_at = datetime('now')
  `).bind(memoryId, hasTemporalContent ? 1 : 0).run();
}
