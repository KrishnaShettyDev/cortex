/**
 * Search Module - Supermemory++ Phase 2
 */

export {
  hybridSearch,
  timelineSearch,
  type SearchQuery,
  type SearchResponse,
  type EnrichedResult,
  type RelationshipLink,
} from './hybrid-search';

export {
  rankCandidates,
  mergeCandidates,
  computeBM25Score,
  computeTemporalScore,
  computeProfileBoost,
  DEFAULT_RANKING_CONFIG,
  type SearchCandidate,
  type ProfileFact,
  type RankedResult,
  type RankingConfig,
} from './ranking';

// Zero-hallucination grounding (Phase 3)
export {
  gateRetrieval,
  callGroundedLLM,
  buildGroundedPrompt,
  parseGroundedResponse,
  GATING_CONFIG,
  GROUNDED_SYSTEM_INSTRUCTION,
  type EvidenceStatus,
  type EvidenceSnippet,
  type GatedSearchResult,
  type MissingSignal,
  type SuggestedAction,
} from './grounded-response';
