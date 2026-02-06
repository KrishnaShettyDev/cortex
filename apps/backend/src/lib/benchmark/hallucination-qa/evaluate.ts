/**
 * Hallucination QA Evaluation Suite
 *
 * Tests the guarded search endpoint for epistemic discipline.
 * Acceptance criteria: ≥95% grounded, ≤5% hallucination rate.
 *
 * Usage:
 *   npx ts-node evaluate.ts --base-url http://localhost:8787 --token <jwt>
 *   npx ts-node evaluate.ts --base-url https://askcortex.plutas.in --token <jwt>
 */

import * as fs from 'fs';
import * as path from 'path';

interface QuerySpec {
  id: string;
  category: string;
  query: string;
  expected: string;
  required_support: number;
  description: string;
}

interface EvaluationResult {
  id: string;
  query: string;
  expected: string;
  actual_status: string;
  actual_support: number;
  passed: boolean;
  hallucination: boolean;
  reason: string;
  latency_ms: number;
}

interface EvaluationSummary {
  total: number;
  passed: number;
  failed: number;
  hallucinations: number;
  grounded_rate: number;
  hallucination_rate: number;
  avg_latency_ms: number;
  by_category: Record<string, { total: number; passed: number; hallucinations: number }>;
}

async function fetchGuardedSearch(
  baseUrl: string,
  token: string,
  query: string
): Promise<{ status: string; supportCount: number; latency: number }> {
  const start = Date.now();

  const response = await fetch(`${baseUrl}/v3/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      k: 10,
      generateAnswer: true,
    }),
  });

  const latency = Date.now() - start;
  const data = await response.json() as any;

  return {
    status: data.status || 'UNKNOWN',
    supportCount: data.supportCount || 0,
    latency,
  };
}

function evaluateResult(spec: QuerySpec, result: { status: string; supportCount: number }): {
  passed: boolean;
  hallucination: boolean;
  reason: string;
} {
  // Case 1: Expected INSUFFICIENT_EVIDENCE
  if (spec.expected === 'INSUFFICIENT_EVIDENCE') {
    if (result.status === 'INSUFFICIENT_EVIDENCE') {
      return { passed: true, hallucination: false, reason: 'Correctly refused' };
    }
    // Hallucination: answered when should have refused
    return { passed: false, hallucination: true, reason: 'Hallucinated answer when evidence was expected to be insufficient' };
  }

  // Case 2: Expected a grounded answer
  if (result.status === 'INSUFFICIENT_EVIDENCE') {
    // Not a hallucination - system correctly refused
    return { passed: true, hallucination: false, reason: 'Correctly refused due to insufficient evidence' };
  }

  if (result.status === 'GROUNDED') {
    if (result.supportCount >= spec.required_support) {
      return { passed: true, hallucination: false, reason: 'Grounded with sufficient support' };
    }
    // Potential hallucination: grounded but with insufficient support
    return { passed: false, hallucination: true, reason: `Grounded but only ${result.supportCount} support (required ${spec.required_support})` };
  }

  if (result.status === 'CONFLICTING_EVIDENCE') {
    return { passed: true, hallucination: false, reason: 'Correctly identified conflicting evidence' };
  }

  // Unknown status
  return { passed: false, hallucination: true, reason: `Unknown status: ${result.status}` };
}

async function runEvaluation(baseUrl: string, token: string): Promise<void> {
  console.log('🔍 Hallucination QA Evaluation Suite');
  console.log('====================================\n');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Load queries
  const queriesPath = path.join(__dirname, 'qa_queries.json');
  const queries: QuerySpec[] = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'));

  console.log(`Loaded ${queries.length} test queries\n`);

  const results: EvaluationResult[] = [];
  const categoryStats: Record<string, { total: number; passed: number; hallucinations: number }> = {};

  // Run each query
  for (let i = 0; i < queries.length; i++) {
    const spec = queries[i];
    process.stdout.write(`[${i + 1}/${queries.length}] ${spec.id}: ${spec.query.slice(0, 40)}...`);

    try {
      const response = await fetchGuardedSearch(baseUrl, token, spec.query);
      const evaluation = evaluateResult(spec, response);

      const result: EvaluationResult = {
        id: spec.id,
        query: spec.query,
        expected: spec.expected,
        actual_status: response.status,
        actual_support: response.supportCount,
        passed: evaluation.passed,
        hallucination: evaluation.hallucination,
        reason: evaluation.reason,
        latency_ms: response.latency,
      };

      results.push(result);

      // Track by category
      if (!categoryStats[spec.category]) {
        categoryStats[spec.category] = { total: 0, passed: 0, hallucinations: 0 };
      }
      categoryStats[spec.category].total++;
      if (evaluation.passed) categoryStats[spec.category].passed++;
      if (evaluation.hallucination) categoryStats[spec.category].hallucinations++;

      // Print result
      const icon = evaluation.hallucination ? '❌' : evaluation.passed ? '✅' : '⚠️';
      console.log(` ${icon} ${response.latency}ms`);

    } catch (error: any) {
      console.log(` ❌ Error: ${error.message}`);
      results.push({
        id: spec.id,
        query: spec.query,
        expected: spec.expected,
        actual_status: 'ERROR',
        actual_support: 0,
        passed: false,
        hallucination: true,
        reason: `Request failed: ${error.message}`,
        latency_ms: 0,
      });
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Calculate summary
  const hallucinations = results.filter(r => r.hallucination).length;
  const passed = results.filter(r => r.passed).length;
  const totalLatency = results.reduce((sum, r) => sum + r.latency_ms, 0);

  const summary: EvaluationSummary = {
    total: results.length,
    passed,
    failed: results.length - passed,
    hallucinations,
    grounded_rate: (passed / results.length) * 100,
    hallucination_rate: (hallucinations / results.length) * 100,
    avg_latency_ms: totalLatency / results.length,
    by_category: categoryStats,
  };

  // Print summary
  console.log('\n====================================');
  console.log('📊 EVALUATION SUMMARY');
  console.log('====================================\n');

  console.log(`Total queries:      ${summary.total}`);
  console.log(`Passed:             ${summary.passed}`);
  console.log(`Failed:             ${summary.failed}`);
  console.log(`Hallucinations:     ${summary.hallucinations}`);
  console.log(`Grounded rate:      ${summary.grounded_rate.toFixed(1)}%`);
  console.log(`Hallucination rate: ${summary.hallucination_rate.toFixed(1)}%`);
  console.log(`Avg latency:        ${summary.avg_latency_ms.toFixed(0)}ms`);

  console.log('\n📁 Results by category:');
  for (const [category, stats] of Object.entries(categoryStats)) {
    const catHalRate = (stats.hallucinations / stats.total) * 100;
    console.log(`  ${category}: ${stats.passed}/${stats.total} passed, ${stats.hallucinations} hallucinations (${catHalRate.toFixed(1)}%)`);
  }

  // Acceptance criteria
  console.log('\n====================================');
  console.log('🎯 ACCEPTANCE CRITERIA');
  console.log('====================================\n');

  const passedAcceptance = summary.hallucination_rate <= 5;
  console.log(`Hallucination rate ≤5%: ${passedAcceptance ? '✅ PASS' : '❌ FAIL'} (${summary.hallucination_rate.toFixed(1)}%)`);
  console.log(`Grounded rate ≥95%:     ${summary.grounded_rate >= 95 ? '✅ PASS' : '❌ FAIL'} (${summary.grounded_rate.toFixed(1)}%)`);

  if (passedAcceptance) {
    console.log('\n🏆 EVALUATION PASSED - Enterprise-grade epistemic discipline achieved!');
  } else {
    console.log('\n🚨 EVALUATION FAILED - Review hallucination cases below:');
    const hallucinationCases = results.filter(r => r.hallucination);
    for (const c of hallucinationCases) {
      console.log(`\n  ${c.id}: ${c.query}`);
      console.log(`    Expected: ${c.expected}`);
      console.log(`    Actual:   ${c.actual_status} (support: ${c.actual_support})`);
      console.log(`    Reason:   ${c.reason}`);
    }
  }

  // Write detailed results to file
  const outputPath = path.join(__dirname, `evaluation_results_${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\n📝 Detailed results written to: ${outputPath}`);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:8787';
  let token = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      baseUrl = args[i + 1];
      i++;
    }
    if (args[i] === '--token' && args[i + 1]) {
      token = args[i + 1];
      i++;
    }
  }

  if (!token) {
    console.error('Usage: npx ts-node evaluate.ts --base-url <url> --token <jwt>');
    console.error('Token is required for authentication');
    process.exit(1);
  }

  await runEvaluation(baseUrl, token);
}

main().catch(console.error);
