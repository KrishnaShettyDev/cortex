/**
 * Temporal Resolver
 *
 * Resolves relative dates ("last Thursday", "next week") to absolute timestamps.
 * Extracts event dates from memory content with high accuracy.
 */

import type { EventDateExtraction } from './types';
import { TemporalError } from './types';

export class TemporalResolver {
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
  }

  /**
   * Extract event date from memory content
   */
  async resolveEventDate(
    content: string,
    referenceDate: Date = new Date()
  ): Promise<EventDateExtraction> {
    try {
      const prompt = this.buildResolutionPrompt(content, referenceDate);

      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a temporal reasoning expert. Extract event dates from text and resolve relative dates to absolute timestamps. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1, // Low temp for consistency
        max_tokens: 200,
      });

      const result = this.parseResponse(response.response);
      return result;
    } catch (error: any) {
      console.error('[TemporalResolver] Resolution failed:', error);
      return {
        event_date: null,
        confidence: 0,
        original_phrase: null,
        is_relative: false,
      };
    }
  }

  /**
   * Build prompt for event date extraction
   */
  private buildResolutionPrompt(content: string, referenceDate: Date): string {
    return `Extract the event date from this text.

TEXT:
"""
${content}
"""

REFERENCE DATE: ${referenceDate.toISOString()} (when this was said/written)
Today: ${referenceDate.toDateString()}

EXTRACTION RULES:

1. ABSOLUTE DATES:
   - "January 15, 2025" → "2025-01-15T00:00:00Z"
   - "Jan 15" → "2025-01-15T00:00:00Z" (assume current year if not specified)
   - "15th" → "2025-01-15T00:00:00Z" (assume current month/year)

2. RELATIVE DATES (resolve from reference date):
   - "yesterday" → reference_date - 1 day
   - "last Thursday" → most recent Thursday before reference date
   - "next week" → 7 days from reference date
   - "in 3 days" → reference_date + 3 days
   - "two weeks ago" → reference_date - 14 days

3. DAY NAMES:
   - "Monday" (no context) → next Monday from reference date
   - "last Monday" → most recent Monday before reference date
   - "this Monday" → Monday of current week

4. TIME OF DAY:
   - "this morning" → reference date at 09:00
   - "this afternoon" → reference date at 14:00
   - "tonight" → reference date at 20:00
   - "3pm" → reference date at 15:00

5. NO DATE MENTIONED:
   - If text doesn't mention a specific time/date, return null

RESPONSE FORMAT (JSON only, no explanation):
{
  "event_date": "2025-01-15T14:00:00Z" or null,
  "confidence": 0.9,
  "original_phrase": "last Thursday afternoon",
  "is_relative": true
}

Confidence levels:
- 1.0: Explicit absolute date
- 0.9: Clear relative date
- 0.7: Implied timing
- 0.5: Weak inference
- 0.0: No date found

Extract now:`;
  }

  /**
   * Parse LLM response
   */
  private parseResponse(response: string): EventDateExtraction {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getEmptyResult();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      if (!this.isValidExtraction(parsed)) {
        return this.getEmptyResult();
      }

      return {
        event_date: parsed.event_date,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
        original_phrase: parsed.original_phrase || null,
        is_relative: parsed.is_relative || false,
      };
    } catch (error) {
      console.error('[TemporalResolver] Failed to parse response:', error);
      return this.getEmptyResult();
    }
  }

  /**
   * Validate extraction result
   */
  private isValidExtraction(extraction: any): boolean {
    // If event_date is null, that's valid (no date found)
    if (extraction.event_date === null) {
      return true;
    }

    // If event_date is provided, validate it's a valid ISO timestamp
    if (typeof extraction.event_date === 'string') {
      try {
        const date = new Date(extraction.event_date);
        return !isNaN(date.getTime());
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Get empty result
   */
  private getEmptyResult(): EventDateExtraction {
    return {
      event_date: null,
      confidence: 0,
      original_phrase: null,
      is_relative: false,
    };
  }

  /**
   * Resolve relative date phrase to absolute timestamp
   * Utility function for manual date resolution
   */
  static resolveRelativeDate(
    phrase: string,
    referenceDate: Date = new Date()
  ): Date | null {
    const lowerPhrase = phrase.toLowerCase().trim();

    // Today/now
    if (lowerPhrase === 'today' || lowerPhrase === 'now') {
      return referenceDate;
    }

    // Yesterday
    if (lowerPhrase === 'yesterday') {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() - 1);
      return date;
    }

    // Tomorrow
    if (lowerPhrase === 'tomorrow') {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() + 1);
      return date;
    }

    // "X days ago"
    const daysAgoMatch = lowerPhrase.match(/(\d+)\s+days?\s+ago/);
    if (daysAgoMatch) {
      const days = parseInt(daysAgoMatch[1]);
      const date = new Date(referenceDate);
      date.setDate(date.getDate() - days);
      return date;
    }

    // "in X days"
    const inDaysMatch = lowerPhrase.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1]);
      const date = new Date(referenceDate);
      date.setDate(date.getDate() + days);
      return date;
    }

    // "last week"
    if (lowerPhrase.includes('last week')) {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() - 7);
      return date;
    }

    // "next week"
    if (lowerPhrase.includes('next week')) {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() + 7);
      return date;
    }

    // Default: null (couldn't parse)
    return null;
  }
}

/**
 * Helper function to extract event date from memory
 */
export async function extractEventDate(
  ai: any,
  content: string,
  referenceDate?: Date
): Promise<EventDateExtraction> {
  const resolver = new TemporalResolver(ai);
  return resolver.resolveEventDate(content, referenceDate);
}
