/**
 * Hybrid Ranking Library - Supermemory++ Phase 2
 *
 * Multi-signal ranking that combines:
 * - Vector similarity (semantic)
 * - BM25 keyword matching
 * - Temporal relevance
 * - Profile boosting
 * - Pinning/priority
 *
 * Returns explainable scores with contribution breakdown.
 */

export interface SearchCandidate {
  memoryId: string;
  content: string;
  vectorScore: number;      // 0-1 normalized similarity
  keywordScore?: number;    // 0-1 normalized BM25
  eventDates?: string[];    // ISO dates from memory_events
  createdAt: string;
  layer: string;
  importance?: number;
  pinned?: boolean;
  metadata?: Record<string, any>;
}

export interface ProfileFact {
  key: string;
  value: any;
  confidence: number;
  category: string;
}

export interface RankedResult {
  memoryId: string;
  content: string;
  score: number;
  contributions: {
    vector: number;
    keyword: number;
    temporal: number;
    profile: number;
    importance: number;
    pin: number;
  };
  eventDates: string[];
  layer: string;
  metadata?: Record<string, any>;
}

export interface RankingConfig {
  // Weight coefficients (should sum to ~1.0)
  vectorWeight: number;
  keywordWeight: number;
  temporalWeight: number;
  profileWeight: number;
  importanceWeight: number;

  // Pin boost (additive)
  pinBoost: number;

  // Temporal decay
  recencyLambda: number;  // exp(-lambda * age_days)

  // Score thresholds
  minScore: number;
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  vectorWeight: 0.45,
  keywordWeight: 0.20,
  temporalWeight: 0.15,
  profileWeight: 0.10,
  importanceWeight: 0.10,
  pinBoost: 0.15,
  recencyLambda: 0.01, // ~70 day half-life
  minScore: 0.1,
};

/**
 * Normalize a value to 0-1 range
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Normalize scores across a candidate set using softmax-style scaling
 */
function normalizeScores(candidates: SearchCandidate[], field: 'vectorScore' | 'keywordScore'): Map<string, number> {
  const scores = candidates.map(c => c[field] || 0);
  const max = Math.max(...scores);
  const min = Math.min(...scores);

  const normalized = new Map<string, number>();
  for (const c of candidates) {
    normalized.set(c.memoryId, normalize(c[field] || 0, min, max));
  }
  return normalized;
}

/**
 * Compute temporal relevance score
 *
 * Two modes:
 * 1. If query has time range: boost memories with events in that range
 * 2. Otherwise: recency decay based on created_at
 */
export function computeTemporalScore(
  candidate: SearchCandidate,
  queryTimeRange?: { start?: string; end?: string },
  config: RankingConfig = DEFAULT_RANKING_CONFIG
): number {
  // Mode 1: Time range query
  if (queryTimeRange && (queryTimeRange.start || queryTimeRange.end)) {
    const eventDates = candidate.eventDates || [];
    if (eventDates.length === 0) return 0.3; // No temporal data, neutral score

    const start = queryTimeRange.start ? new Date(queryTimeRange.start) : new Date('1970-01-01');
    const end = queryTimeRange.end ? new Date(queryTimeRange.end) : new Date('2100-01-01');

    // Check if any event date falls within range
    const inRange = eventDates.some(dateStr => {
      const date = new Date(dateStr);
      return date >= start && date <= end;
    });

    return inRange ? 1.0 : 0.1;
  }

  // Mode 2: Recency decay
  const createdAt = new Date(candidate.createdAt);
  const now = new Date();
  const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay: score = exp(-lambda * age)
  return Math.exp(-config.recencyLambda * ageDays);
}

/**
 * Compute profile boost based on matching facts
 */
export function computeProfileBoost(
  candidate: SearchCandidate,
  profiles: ProfileFact[]
): number {
  if (!profiles || profiles.length === 0) return 0;

  let boost = 0;
  const metadata = candidate.metadata || {};
  const content = candidate.content.toLowerCase();

  for (const fact of profiles) {
    // Match preference facts against content/metadata
    if (fact.category === 'preference') {
      const valueStr = typeof fact.value === 'string' ? fact.value.toLowerCase() : JSON.stringify(fact.value).toLowerCase();

      // Check if content mentions the preference
      if (content.includes(valueStr)) {
        boost += 0.2 * fact.confidence;
      }

      // Check metadata tags
      if (metadata.tags && Array.isArray(metadata.tags)) {
        for (const tag of metadata.tags) {
          if (tag.toLowerCase().includes(valueStr) || valueStr.includes(tag.toLowerCase())) {
            boost += 0.3 * fact.confidence;
          }
        }
      }
    }

    // Match expertise/interest areas
    if (fact.category === 'context' && fact.key === 'expertise_areas') {
      const areas = Array.isArray(fact.value) ? fact.value : [fact.value];
      for (const area of areas) {
        if (content.includes(area.toLowerCase())) {
          boost += 0.15 * fact.confidence;
        }
      }
    }
  }

  // Cap boost at 1.0
  return Math.min(1.0, boost);
}

/**
 * Main ranking function - combines all signals
 */
export function rankCandidates(
  candidates: SearchCandidate[],
  options: {
    profiles?: ProfileFact[];
    timeRange?: { start?: string; end?: string };
    config?: RankingConfig;
    topK?: number;
  } = {}
): RankedResult[] {
  const config = options.config || DEFAULT_RANKING_CONFIG;
  const profiles = options.profiles || [];
  const topK = options.topK || 10;

  if (candidates.length === 0) return [];

  // Normalize vector and keyword scores across candidate set
  const normalizedVec = normalizeScores(candidates, 'vectorScore');
  const normalizedKw = normalizeScores(candidates, 'keywordScore');

  // Score each candidate
  const scored: RankedResult[] = candidates.map(candidate => {
    const vec = normalizedVec.get(candidate.memoryId) || 0;
    const kw = normalizedKw.get(candidate.memoryId) || 0;
    const temporal = computeTemporalScore(candidate, options.timeRange, config);
    const profile = computeProfileBoost(candidate, profiles);
    const importance = candidate.importance || 0.5;
    const pin = candidate.pinned ? config.pinBoost : 0;

    // Weighted combination
    const score =
      config.vectorWeight * vec +
      config.keywordWeight * kw +
      config.temporalWeight * temporal +
      config.profileWeight * profile +
      config.importanceWeight * importance +
      pin;

    return {
      memoryId: candidate.memoryId,
      content: candidate.content,
      score,
      contributions: {
        vector: vec * config.vectorWeight,
        keyword: kw * config.keywordWeight,
        temporal: temporal * config.temporalWeight,
        profile: profile * config.profileWeight,
        importance: importance * config.importanceWeight,
        pin,
      },
      eventDates: candidate.eventDates || [],
      layer: candidate.layer,
      metadata: candidate.metadata,
    };
  });

  // Sort by score descending and filter by minimum
  return scored
    .filter(r => r.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Merge candidates from vector and keyword search
 * Deduplicates by memoryId and combines scores
 */
export function mergeCandidates(
  vectorResults: SearchCandidate[],
  keywordResults: SearchCandidate[]
): SearchCandidate[] {
  const merged = new Map<string, SearchCandidate>();

  // Add vector results
  for (const r of vectorResults) {
    merged.set(r.memoryId, { ...r });
  }

  // Merge keyword results
  for (const r of keywordResults) {
    const existing = merged.get(r.memoryId);
    if (existing) {
      // Combine scores
      existing.keywordScore = r.keywordScore;
    } else {
      merged.set(r.memoryId, { ...r, vectorScore: 0 });
    }
  }

  return Array.from(merged.values());
}

/**
 * Simple BM25-style keyword scoring
 * For production, use a proper full-text search engine
 */
export function computeBM25Score(
  query: string,
  content: string,
  avgDocLength: number = 500,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const docTerms = content.toLowerCase().split(/\s+/);
  const docLength = docTerms.length;

  if (queryTerms.length === 0) return 0;

  let score = 0;
  const termFreq = new Map<string, number>();

  // Count term frequencies in document
  for (const term of docTerms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  }

  // Score each query term
  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf === 0) continue;

    // Simplified BM25 (without IDF since we don't have corpus stats)
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
    score += numerator / denominator;
  }

  // Normalize by query length
  return score / queryTerms.length;
}
