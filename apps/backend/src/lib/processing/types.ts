/**
 * Document Processing Pipeline - Types
 *
 * Production-grade processing with full observability.
 * Extended pipeline: queued → extracting → chunking → embedding → indexing
 *                   → temporal_extraction → entity_extraction
 *                   → importance_scoring → commitment_extraction → done
 */

export type ProcessingStatus =
  | 'queued'                // Job created, waiting to start
  | 'extracting'            // Extracting content from source
  | 'chunking'              // Breaking content into chunks
  | 'embedding'             // Generating vector embeddings
  | 'indexing'              // Storing in vector DB
  | 'temporal_extraction'   // Extracting event dates and temporal info
  | 'entity_extraction'     // Extracting entities and relationships
  | 'importance_scoring'    // Calculating memory importance
  | 'commitment_extraction' // Extracting commitments and promises
  | 'done'                  // Successfully completed
  | 'failed';               // Processing failed

export interface ProcessingStep {
  step: ProcessingStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ProcessingMetrics {
  // Content metrics
  tokenCount: number;
  wordCount: number;
  chunkCount: number;
  averageChunkSize: number;

  // Processing metrics
  totalDurationMs: number;
  extractionDurationMs?: number;
  chunkingDurationMs?: number;
  embeddingDurationMs?: number;
  indexingDurationMs?: number;
  temporalExtractionDurationMs?: number;
  entityExtractionDurationMs?: number;
  importanceScoringDurationMs?: number;
  commitmentExtractionDurationMs?: number;

  // Intelligence metrics
  entitiesExtracted?: number;
  relationshipsExtracted?: number;
  commitmentsExtracted?: number;
  importanceScore?: number;

  // Resource metrics
  embeddingTokensUsed?: number;
  apiCallCount: number;
  retryCount: number;
}

export interface ProcessingJob {
  id: string;
  memoryId: string;
  userId: string;
  containerTag: string;

  // Status tracking
  status: ProcessingStatus;
  currentStep: ProcessingStatus;
  steps: ProcessingStep[];

  // Metrics
  metrics: ProcessingMetrics;

  // Retry logic
  retryCount: number;
  maxRetries: number;
  lastError?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ExtractorResult {
  content: string;
  contentType: 'text' | 'html' | 'markdown';
  metadata: {
    title?: string;
    author?: string;
    sourceUrl?: string;
    wordCount: number;
    tokenCount: number;
  };
}

export interface ChunkerResult {
  chunks: Array<{
    id: string;
    content: string;
    position: number;
    tokenCount: number;
    metadata?: Record<string, any>;
  }>;
  totalChunks: number;
  averageChunkSize: number;
}

export interface EmbeddingResult {
  chunks: Array<{
    id: string;
    embedding: number[];
    model: string;
    tokenCount: number;
  }>;
  totalTokensUsed: number;
  model: string;
}

export interface IndexingResult {
  vectorIds: string[];
  indexedCount: number;
  timestamp: string;
}

export interface TemporalExtractionResult {
  eventDate: string | null;
  confidence: number;
  validFrom: string;
  validTo: string | null;
}

export interface EntityExtractionResult {
  entities: Array<{
    id: string;
    name: string;
    type: string;
    confidence: number;
  }>;
  relationships: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    type: string;
    confidence: number;
  }>;
  totalEntities: number;
  totalRelationships: number;
}

export interface ImportanceScoringResult {
  importanceScore: number;
  factors: {
    content: number;
    recency: number;
    access: number;
    entities: number;
    commitments: number;
  };
  timestamp: string;
}

export interface CommitmentExtractionResult {
  commitments: Array<{
    id: string;
    type: string;
    title: string;
    dueDate: string | null;
    confidence: number;
  }>;
  totalCommitments: number;
}

/**
 * Processing context passed through pipeline
 */
export interface ProcessingContext {
  job: ProcessingJob;
  env: {
    DB: D1Database;
    VECTORIZE: Vectorize;
    AI: any;
    QUEUE?: any; // Cloudflare Queue
  };

  // Document processing results
  extractorResult?: ExtractorResult;
  chunkerResult?: ChunkerResult;
  embeddingResult?: EmbeddingResult;
  indexingResult?: IndexingResult;

  // Intelligence layer results
  temporalResult?: TemporalExtractionResult;
  entityResult?: EntityExtractionResult;
  importanceResult?: ImportanceScoringResult;
  commitmentResult?: CommitmentExtractionResult;

  // Memory record (fetched during processing)
  memory?: any;
}

/**
 * Error types for better error handling
 */
export class ProcessingError extends Error {
  constructor(
    public step: ProcessingStatus,
    message: string,
    public retryable: boolean = true,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export class ExtractorError extends ProcessingError {
  constructor(message: string, retryable = false, metadata?: Record<string, any>) {
    super('extracting', message, retryable, metadata);
    this.name = 'ExtractorError';
  }
}

export class ChunkerError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('chunking', message, retryable, metadata);
    this.name = 'ChunkerError';
  }
}

export class EmbeddingError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('embedding', message, retryable, metadata);
    this.name = 'EmbeddingError';
  }
}

export class IndexingError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('indexing', message, retryable, metadata);
    this.name = 'IndexingError';
  }
}

export class TemporalExtractionError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('temporal_extraction', message, retryable, metadata);
    this.name = 'TemporalExtractionError';
  }
}

export class EntityExtractionError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('entity_extraction', message, retryable, metadata);
    this.name = 'EntityExtractionError';
  }
}

export class ImportanceScoringError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('importance_scoring', message, retryable, metadata);
    this.name = 'ImportanceScoringError';
  }
}

export class CommitmentExtractionError extends ProcessingError {
  constructor(message: string, retryable = true, metadata?: Record<string, any>) {
    super('commitment_extraction', message, retryable, metadata);
    this.name = 'CommitmentExtractionError';
  }
}
