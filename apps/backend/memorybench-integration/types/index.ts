/**
 * Type definitions for MemoryBench integration
 *
 * These types mirror the memorybench framework types to ensure compatibility.
 */

// ============================================================================
// Unified Session Types
// ============================================================================

export interface UnifiedSession {
  sessionId: string;
  messages: UnifiedMessage[];
  metadata?: Record<string, unknown>;
}

export interface UnifiedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  speaker?: string;
}

export interface UnifiedQuestion {
  questionId: string;
  question: string;
  questionType: string;
  groundTruth: string;
  haystackSessionIds: string[];
  metadata?: Record<string, unknown>;
}

export interface QuestionTypeInfo {
  id: string;
  alias: string;
  description: string;
}

export type QuestionTypeRegistry = Record<string, QuestionTypeInfo>;

// ============================================================================
// Provider Interface
// ============================================================================

export interface Provider {
  name: string;
  prompts?: ProviderPrompts;
  concurrency?: ConcurrencyConfig;

  initialize(config: ProviderConfig): Promise<void>;
  ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult>;
  awaitIndexing(
    result: IngestResult,
    containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void>;
  search(query: string, options: SearchOptions): Promise<unknown[]>;
  clear(containerTag: string): Promise<void>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  [key: string]: any; // Allow custom fields
}

export interface IngestOptions {
  containerTag: string;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  documentIds: string[];
  taskIds?: string[];
}

export interface IndexingProgress {
  completedIds: string[];
  failedIds: string[];
  total: number;
}

export type IndexingProgressCallback = (progress: IndexingProgress) => void;

export interface SearchOptions {
  containerTag: string;
  limit?: number;
  threshold?: number;
}

export interface ConcurrencyConfig {
  default?: number;
  ingest?: number;
  awaitIndexing?: number;
}

// ============================================================================
// Provider Prompts (Optional Customization)
// ============================================================================

export interface ProviderPrompts {
  answerPrompt?: string | AnswerPromptFunction;
  judgePrompts?: Record<string, string | JudgePromptFunction>;
}

export type AnswerPromptFunction = (searchResults: unknown[], question: string) => string;
export type JudgePromptFunction = (
  question: string,
  groundTruth: string,
  answer: string
) => string;

// ============================================================================
// Benchmark Types
// ============================================================================

export interface BenchmarkConfig {
  name: string;
  dataPath: string;
  description: string;
}

export interface BenchmarkResult {
  provider: string;
  benchmark: string;
  accuracy: number;
  averageLatency: number;
  searchQuality: number;
  completedQuestions: number;
  totalQuestions: number;
  timestamp: string;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface CheckpointState {
  phase: 'ingest' | 'index' | 'search' | 'answer' | 'evaluate' | 'report';
  completed: boolean;
  data?: any;
  timestamp: string;
}

export interface RunCheckpoint {
  runId: string;
  provider: string;
  benchmark: string;
  phases: Record<string, CheckpointState>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Judge Types
// ============================================================================

export interface JudgeConfig {
  name: string;
  model: string;
  apiKey: string;
}

export interface JudgeResult {
  questionId: string;
  score: number; // 0-1
  reasoning: string;
  matched: boolean;
}
