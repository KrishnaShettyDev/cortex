/**
 * Pipeline Benchmark Script
 *
 * Measures processing time for each pipeline stage.
 * Run with: npx wrangler dev --test-scheduled
 *
 * BEFORE optimization (baseline):
 *   commitment:   6,429ms  (58%)
 *   entity:       2,957ms  (27%)
 *   indexing:       871ms  (8%)
 *   importance:     659ms  (6%)
 *   extracting:     182ms  (2%)
 *   embedding:       36ms  (<1%)
 *   TOTAL:       ~11,100ms
 *
 * AFTER optimization (target):
 *   commitment:     <500ms  (pre-filter + trimmed prompts)
 *   entity:         <800ms  (no embedding dedup + trimmed prompts)
 *   indexing:       <300ms  (batching)
 *   importance:      <50ms  (rule-based, no LLM)
 *   extracting:     <200ms  (unchanged)
 *   embedding:       <50ms  (with cache)
 *   TOTAL:        <2,000ms  (~80% improvement)
 */

export interface BenchmarkResult {
  testCase: string;
  stages: Record<string, number>;
  totalMs: number;
  preFilterSkipped: boolean;
}

export interface BenchmarkSummary {
  results: BenchmarkResult[];
  averages: Record<string, number>;
  totalAverage: number;
  improvements: Record<string, string>;
}

// Test cases with different characteristics
export const TEST_CASES = [
  {
    name: 'simple_thought',
    content: 'Random thought: the weather is nice today.',
    expectCommitmentSkip: true,
    expectEntitySkip: true,
  },
  {
    name: 'meeting_with_person',
    content: 'Had a call with Sarah Chen from Acme Corp about the Q2 deliverables. She mentioned they are expanding their engineering team.',
    expectCommitmentSkip: false,
    expectEntitySkip: false,
  },
  {
    name: 'commitment_heavy',
    content: "I will send the quarterly report to John by Friday. Need to follow up with the marketing team about the launch deadline. Meeting scheduled with investors on Monday at 2pm.",
    expectCommitmentSkip: false,
    expectEntitySkip: false,
  },
  {
    name: 'entity_heavy',
    content: 'Met with David Park, CEO of TechStart Inc at the SaaS Summit in San Francisco. He introduced me to Lisa Wong from Sequoia Capital who is interested in our Series B round.',
    expectCommitmentSkip: true,
    expectEntitySkip: false,
  },
  {
    name: 'short_note',
    content: 'Review slides',
    expectCommitmentSkip: false,
    expectEntitySkip: true, // Too short
  },
];

// Baseline times (from production logs)
export const BASELINE_TIMES = {
  extracting: 182,
  embedding: 36,
  indexing: 871,
  temporal_extraction: 100,
  entity_extraction: 2957,
  importance_scoring: 659,
  commitment_extraction: 6429,
};

// Target times after optimization
export const TARGET_TIMES = {
  extracting: 200,
  embedding: 50,
  indexing: 300,
  temporal_extraction: 100,
  entity_extraction: 800,
  importance_scoring: 50,
  commitment_extraction: 500,
};

/**
 * Format milliseconds as human-readable string
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Calculate improvement percentage
 */
export function calculateImprovement(before: number, after: number): string {
  if (before === 0) return 'N/A';
  const improvement = ((before - after) / before) * 100;
  if (improvement > 0) {
    return `↓${improvement.toFixed(0)}% faster`;
  } else if (improvement < 0) {
    return `↑${Math.abs(improvement).toFixed(0)}% slower`;
  }
  return 'No change';
}

/**
 * Print benchmark results as ASCII table
 */
export function printBenchmarkTable(summary: BenchmarkSummary): void {
  console.log('\n' + '='.repeat(80));
  console.log('PIPELINE BENCHMARK RESULTS');
  console.log('='.repeat(80));

  // Stage comparison table
  console.log('\nStage Performance:');
  console.log('-'.repeat(80));
  console.log(
    'Stage'.padEnd(25) +
    'Baseline'.padStart(12) +
    'Current'.padStart(12) +
    'Target'.padStart(12) +
    'Status'.padStart(15)
  );
  console.log('-'.repeat(80));

  const stages = Object.keys(BASELINE_TIMES) as Array<keyof typeof BASELINE_TIMES>;

  for (const stage of stages) {
    const baseline = BASELINE_TIMES[stage];
    const current = summary.averages[stage] || 0;
    const target = TARGET_TIMES[stage];

    const status = current <= target ? '✅ PASS' : '❌ FAIL';
    const improvement = calculateImprovement(baseline, current);

    console.log(
      stage.padEnd(25) +
      formatMs(baseline).padStart(12) +
      formatMs(Math.round(current)).padStart(12) +
      formatMs(target).padStart(12) +
      status.padStart(15)
    );
  }

  console.log('-'.repeat(80));
  console.log(
    'TOTAL'.padEnd(25) +
    formatMs(Object.values(BASELINE_TIMES).reduce((a, b) => a + b, 0)).padStart(12) +
    formatMs(Math.round(summary.totalAverage)).padStart(12) +
    formatMs(Object.values(TARGET_TIMES).reduce((a, b) => a + b, 0)).padStart(12)
  );
  console.log('='.repeat(80));

  // Individual test case results
  console.log('\nTest Case Results:');
  console.log('-'.repeat(80));

  for (const result of summary.results) {
    const skipped = result.preFilterSkipped ? ' (pre-filter skipped)' : '';
    console.log(`\n${result.testCase}${skipped}: ${formatMs(result.totalMs)}`);

    for (const [stage, time] of Object.entries(result.stages)) {
      const bar = '█'.repeat(Math.min(50, Math.ceil(time / 100)));
      console.log(`  ${stage.padEnd(22)} ${formatMs(time).padStart(8)} ${bar}`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Create mock environment for testing
 */
export function createMockEnv() {
  return {
    AI: {
      run: async (model: string, options: any) => {
        // Simulate LLM latency
        await new Promise(resolve => setTimeout(resolve, 50));

        // Return appropriate mock response based on model
        if (model.includes('bge-base')) {
          // Embedding model
          return { data: [new Array(768).fill(0.1)] };
        }

        // LLM model - return empty results
        return { response: '[]' };
      },
    },
    DB: {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ success: true }),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
      }),
    },
    VECTORIZE: {
      query: async () => ({ matches: [] }),
      insert: async () => ({ success: true }),
    },
    CACHE: {
      get: async () => null,
      put: async () => {},
    },
  };
}
