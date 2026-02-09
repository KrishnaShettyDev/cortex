/**
 * Grounded Response Module - Zero Hallucination Mode
 *
 * Enforces epistemic discipline:
 * - Gates LLM calls based on retrieval confidence
 * - Forces snippet-level citation
 * - Returns INSUFFICIENT_EVIDENCE when unsure
 */

import type { EnrichedResult } from './hybrid-search';

// Gating thresholds
export const GATING_CONFIG = {
  MIN_COMPOSITE_SCORE: 0.40,
  MIN_SUPPORT_COUNT: 2,
  MIN_SUPPORT_SCORE: 0.15,
  MAX_EVIDENCE_SNIPPETS: 5,
} as const;

export type EvidenceStatus =
  | 'GROUNDED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTING_EVIDENCE'
  | 'ACTIONABLE_UNCERTAINTY';

export interface EvidenceSnippet {
  id: string;
  memoryId: string;
  excerpt: string;
  eventDate?: string;
  score: number;
  contributions: {
    vector: number;
    keyword: number;
    temporal: number;
    profile: number;
    importance: number;
  };
}

export interface MissingSignal {
  signal: string;
  description: string;
  severity: 'critical' | 'moderate' | 'minor';
}

export interface SuggestedAction {
  action: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface GatedSearchResult {
  status: EvidenceStatus;
  reason?: 'NO_CANDIDATES' | 'LOW_CONFIDENCE' | 'SINGLE_SOURCE';
  compositeScore?: number;
  supportCount?: number;
  evidence: EvidenceSnippet[];
  answer?: string;
  citations?: string[];
  // Actionable uncertainty fields
  missingSignals?: MissingSignal[];
  suggestedActions?: SuggestedAction[];
  message?: string;
}

/**
 * Check if candidates have enough support for a grounded answer.
 */
function hasEnoughSupport(candidates: EnrichedResult[]): boolean {
  const supportingCandidates = candidates.filter(
    c => c.score >= GATING_CONFIG.MIN_SUPPORT_SCORE
  );
  return supportingCandidates.length >= GATING_CONFIG.MIN_SUPPORT_COUNT;
}

/**
 * Convert search results to evidence snippets.
 */
function toEvidenceSnippets(
  candidates: EnrichedResult[],
  limit: number = GATING_CONFIG.MAX_EVIDENCE_SNIPPETS
): EvidenceSnippet[] {
  return candidates.slice(0, limit).map((c, idx) => ({
    id: `[${idx + 1}]`,
    memoryId: c.memoryId,
    excerpt: c.snippet || '',
    eventDate: c.eventDates?.[0],
    score: Math.round(c.score * 1000) / 1000,
    contributions: {
      vector: Math.round(c.contributions.vector * 1000) / 1000,
      keyword: Math.round(c.contributions.keyword * 1000) / 1000,
      temporal: Math.round(c.contributions.temporal * 1000) / 1000,
      profile: Math.round(c.contributions.profile * 1000) / 1000,
      importance: Math.round(c.contributions.importance * 1000) / 1000,
    },
  }));
}

/**
 * Detect what's missing from the evidence and why confidence is low.
 */
function detectMissingSignals(
  candidates: EnrichedResult[],
  reason: 'NO_CANDIDATES' | 'LOW_CONFIDENCE' | 'SINGLE_SOURCE'
): MissingSignal[] {
  const signals: MissingSignal[] = [];

  if (reason === 'NO_CANDIDATES') {
    signals.push({
      signal: 'no_memories',
      description: 'No memories match this query',
      severity: 'critical',
    });
    return signals;
  }

  if (reason === 'SINGLE_SOURCE') {
    signals.push({
      signal: 'single_source',
      description: 'Only one memory mentions this topic',
      severity: 'critical',
    });
  }

  if (candidates.length > 0) {
    const top = candidates[0];

    // Check vector similarity
    if (top.contributions.vector < 0.3) {
      signals.push({
        signal: 'weak_semantic_match',
        description: 'No memories closely match the meaning of your query',
        severity: 'critical',
      });
    }

    // Check keyword match
    if (top.contributions.keyword < 0.1) {
      signals.push({
        signal: 'no_keyword_match',
        description: 'Key terms from your query not found in memories',
        severity: 'moderate',
      });
    }

    // Check temporal grounding
    const hasEventDates = candidates.some(c => c.eventDates && c.eventDates.length > 0);
    if (!hasEventDates) {
      signals.push({
        signal: 'no_temporal_grounding',
        description: 'No dated events found for this topic',
        severity: 'moderate',
      });
    }

    // Check importance
    if (top.contributions.importance < 0.05) {
      signals.push({
        signal: 'low_importance',
        description: 'Related memories have low importance scores',
        severity: 'minor',
      });
    }
  }

  return signals;
}

/**
 * Map missing signals to actionable suggestions.
 */
function generateSuggestedActions(
  signals: MissingSignal[],
  query: string
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const signalSet = new Set(signals.map(s => s.signal));

  if (signalSet.has('no_memories') || signalSet.has('weak_semantic_match')) {
    actions.push({
      action: 'add_memory',
      description: `Add a memory about "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`,
      priority: 'high',
    });
  }

  if (signalSet.has('single_source')) {
    actions.push({
      action: 'add_corroborating_memory',
      description: 'Add another memory to corroborate this information',
      priority: 'high',
    });
  }

  if (signalSet.has('no_temporal_grounding')) {
    actions.push({
      action: 'add_dates',
      description: 'Add memories with specific dates (e.g., "On January 15th...")',
      priority: 'medium',
    });
  }

  if (signalSet.has('no_keyword_match')) {
    actions.push({
      action: 'rephrase_query',
      description: 'Try rephrasing your question with different keywords',
      priority: 'medium',
    });
  }

  if (signalSet.has('low_importance')) {
    actions.push({
      action: 'pin_memory',
      description: 'Pin important memories to boost their relevance',
      priority: 'low',
    });
  }

  // Always suggest upload if critical signals present
  if (signals.some(s => s.severity === 'critical')) {
    actions.push({
      action: 'upload_document',
      description: 'Upload a document (email, note, file) related to this topic',
      priority: 'high',
    });
  }

  return actions;
}

/**
 * Generate a human-friendly message for actionable uncertainty.
 */
function generateUncertaintyMessage(signals: MissingSignal[]): string {
  const criticalCount = signals.filter(s => s.severity === 'critical').length;

  if (criticalCount === 0) {
    return "I found some related information, but I'm not confident enough to give a definitive answer.";
  }

  if (signals.some(s => s.signal === 'no_memories')) {
    return "I don't have any memories about this topic yet.";
  }

  if (signals.some(s => s.signal === 'single_source')) {
    return "I only found one memory about this. I need more sources to be confident.";
  }

  if (signals.some(s => s.signal === 'weak_semantic_match')) {
    return "I couldn't find memories that closely match what you're asking about.";
  }

  return "I don't have strong enough evidence to answer this confidently.";
}

/**
 * Gate retrieval results - determine if LLM call is safe.
 * Returns ACTIONABLE_UNCERTAINTY instead of bare INSUFFICIENT_EVIDENCE.
 */
export function gateRetrieval(candidates: EnrichedResult[], query: string = ''): {
  safe: boolean;
  result: GatedSearchResult;
} {
  // No candidates at all
  if (!candidates.length) {
    const reason = 'NO_CANDIDATES';
    const missingSignals = detectMissingSignals(candidates, reason);
    const suggestedActions = generateSuggestedActions(missingSignals, query);
    const message = generateUncertaintyMessage(missingSignals);

    return {
      safe: false,
      result: {
        status: 'ACTIONABLE_UNCERTAINTY',
        reason,
        evidence: [],
        missingSignals,
        suggestedActions,
        message,
      },
    };
  }

  const top = candidates[0];
  const evidence = toEvidenceSnippets(candidates);

  // Top score too low
  if (top.score < GATING_CONFIG.MIN_COMPOSITE_SCORE) {
    const reason = 'LOW_CONFIDENCE';
    const missingSignals = detectMissingSignals(candidates, reason);
    const suggestedActions = generateSuggestedActions(missingSignals, query);
    const message = generateUncertaintyMessage(missingSignals);

    return {
      safe: false,
      result: {
        status: 'ACTIONABLE_UNCERTAINTY',
        reason,
        compositeScore: Math.round(top.score * 1000) / 1000,
        supportCount: candidates.filter(c => c.score >= GATING_CONFIG.MIN_SUPPORT_SCORE).length,
        evidence,
        missingSignals,
        suggestedActions,
        message,
      },
    };
  }

  // Not enough supporting evidence
  if (!hasEnoughSupport(candidates)) {
    const reason = 'SINGLE_SOURCE';
    const missingSignals = detectMissingSignals(candidates, reason);
    const suggestedActions = generateSuggestedActions(missingSignals, query);
    const message = generateUncertaintyMessage(missingSignals);

    return {
      safe: false,
      result: {
        status: 'ACTIONABLE_UNCERTAINTY',
        reason,
        compositeScore: Math.round(top.score * 1000) / 1000,
        supportCount: 1,
        evidence,
        missingSignals,
        suggestedActions,
        message,
      },
    };
  }

  // Safe to proceed
  return {
    safe: true,
    result: {
      status: 'GROUNDED',
      compositeScore: Math.round(top.score * 1000) / 1000,
      supportCount: candidates.filter(c => c.score >= GATING_CONFIG.MIN_SUPPORT_SCORE).length,
      evidence,
    },
  };
}

/**
 * Build the zero-hallucination prompt for Claude.
 */
export function buildGroundedPrompt(
  query: string,
  evidence: EvidenceSnippet[]
): string {
  const snippetsText = evidence
    .map(e => `${e.id} [${e.eventDate || 'undated'}]: ${e.excerpt}`)
    .join('\n\n');

  return `You are operating in STRICT GROUNDED MODE.

You will be given numbered evidence snippets.
You MUST follow these rules:

1. You may ONLY use the provided snippets.
2. Every factual sentence MUST cite a snippet ID in square brackets.
3. You may NOT infer, assume, or use outside knowledge.
4. If a claim is not directly supported, respond EXACTLY with:
   "INSUFFICIENT_EVIDENCE"

You are NOT allowed to:
- Generalize beyond the text
- Merge snippets into new facts
- Guess missing details

If evidence conflicts, explicitly say:
"CONFLICTING_EVIDENCE" and list both snippet IDs.

----------------
EVIDENCE:
${snippetsText}
----------------

QUESTION:
${query}

Return:
- Either a grounded answer with citations
- OR exactly: INSUFFICIENT_EVIDENCE`;
}

/**
 * System instruction for additional safety.
 */
export const GROUNDED_SYSTEM_INSTRUCTION =
  'Failure to follow citation rules is considered an incorrect answer. ' +
  'You must cite evidence for every factual claim using [N] notation.';

/**
 * Parse LLM response for citations and detect special states.
 */
export function parseGroundedResponse(response: string): {
  status: EvidenceStatus;
  answer?: string;
  citations: string[];
} {
  const trimmed = response.trim();

  // Check for explicit insufficient evidence
  if (trimmed === 'INSUFFICIENT_EVIDENCE' || trimmed.startsWith('INSUFFICIENT_EVIDENCE')) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      citations: [],
    };
  }

  // Check for conflicting evidence
  if (trimmed.includes('CONFLICTING_EVIDENCE')) {
    const citationMatches = trimmed.match(/\[\d+\]/g) || [];
    return {
      status: 'CONFLICTING_EVIDENCE',
      answer: trimmed,
      citations: [...new Set(citationMatches)],
    };
  }

  // Extract citations from grounded answer
  const citationMatches = trimmed.match(/\[\d+\]/g) || [];
  const citations = [...new Set(citationMatches)];

  return {
    status: 'GROUNDED',
    answer: trimmed,
    citations,
  };
}

/**
 * Call LLM with grounded evidence.
 * Uses OpenAI API for reliable grounding, falls back to Llama.
 */
export async function callGroundedLLM(
  env: { AI: any; OPENAI_API_KEY?: string },
  query: string,
  evidence: EvidenceSnippet[]
): Promise<GatedSearchResult> {
  const prompt = buildGroundedPrompt(query, evidence);

  // Try OpenAI first for reliable grounded responses
  if (env.OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: GROUNDED_SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1024,
          temperature: 0.1,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const text = data.choices?.[0]?.message?.content || '';
        const parsed = parseGroundedResponse(text);

        return {
          status: parsed.status,
          evidence,
          answer: parsed.answer,
          citations: parsed.citations,
        };
      } else {
        console.error('[GroundedLLM] OpenAI API error:', await response.text());
      }
    } catch (error) {
      console.error('[GroundedLLM] OpenAI call failed, falling back to Llama:', error);
    }
  }

  // Fallback to Llama
  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: GROUNDED_SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0.1,
    });

    const text = response.response || '';
    const parsed = parseGroundedResponse(text);

    return {
      status: parsed.status,
      evidence,
      answer: parsed.answer,
      citations: parsed.citations,
    };
  } catch (error: any) {
    console.error('[GroundedLLM] Error:', error);
    // On LLM failure, return evidence without answer
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'LOW_CONFIDENCE',
      evidence,
    };
  }
}
