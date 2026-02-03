# MemoryBench Integration - READY TO TEST

## Status: Integration Complete ✅

The Cortex memory infrastructure has been integrated with the official MemoryBench testing framework at:
- **Framework**: https://github.com/supermemoryai/memorybench
- **Local Path**: `/tmp/memorybench`

This replaces the estimated benchmark scores with **REAL industry-standard benchmarks**.

---

## What Was Completed

### 1. Cortex Provider Adapter
**File**: `/tmp/memorybench/src/providers/cortex/index.ts`

Implements the MemoryBench `Provider` interface:
- ✅ `initialize()` - API key setup
- ✅ `ingest()` - Batch upload sessions to `/v3/memories`
- ✅ `awaitIndexing()` - Polls `processing_status` until "done"
- ✅ `search()` - Hybrid search via `/v3/search`
- ⚠️ `clear()` - Not implemented (logged warning)

### 2. Framework Integration
- ✅ Added "cortex" to `ProviderName` type
- ✅ Registered in provider factory
- ✅ Added `CORTEX_API_KEY` to config system
- ✅ Installed all dependencies (`bun install`)

### 3. Configuration
**File**: `/tmp/memorybench/.env.local`

Requires:
- `CORTEX_API_KEY` - Production API key from https://askcortex.plutas.in
- Judge API key (at least one):
  - `OPENAI_API_KEY` (GPT-4o) - Recommended
  - `ANTHROPIC_API_KEY` (Claude Sonnet 4)
  - `GOOGLE_API_KEY` (Gemini 2.5 Flash)

---

## Running Real Benchmarks

### Quick Test (10 questions)
```bash
cd /tmp/memorybench
bun run src/index.ts run -p cortex -b locomo -l 10 -j gpt-4o
```

### Full Industry Benchmarks

**LoCoMo** (Long Context Memory):
```bash
bun run src/index.ts run -p cortex -b locomo -j gpt-4o
```
Tests: fact recall, temporal reasoning, multi-hop, inference, abstention

**LongMemEval** (Long-term Memory):
```bash
bun run src/index.ts run -p cortex -b longmemeval -j gpt-4o
```
Tests: single-session, multi-session, temporal reasoning, knowledge updates

**ConvoMem** (Conversational Memory):
```bash
bun run src/index.ts run -p convomem -j gpt-4o
```
Tests: user facts, preferences, implicit connections

### Compare with Competitors
```bash
bun run src/index.ts compare -p cortex,supermemory,mem0 -b locomo -s 10
```

---

## What Gets Measured

### Accuracy Metrics
- **Retrieval Accuracy** - % of correct memories retrieved
- **Answer Accuracy** - % of correct answers generated
- **Entity Recognition** - Extraction quality
- **Temporal Reasoning** - Date/time understanding
- **Multi-hop Reasoning** - Complex query handling

### Performance Metrics
- **Search Latency** - Time per query (target: <500ms)
- **Indexing Time** - Time to process memories
- **Throughput** - Queries per second

### Results Location
`/tmp/memorybench/data/runs/{runId}/`
- `checkpoint.json` - Run state
- `results/` - Per-question search results
- `report.json` - Final scores

---

## Expected vs Previous Estimates

### Previous Estimates (REJECTED by user):
- LongMemEval Score: 67.5/100 (estimated)
- Entity Extraction: 80% (manual test)
- Retrieval Latency: 600ms (single query)

### What Real Benchmarks Will Show:
- **Actual LongMemEval Score** - Industry standard metric
- **Actual Retrieval Accuracy** - Across diverse queries
- **Actual Latency Distribution** - p50, p95, p99
- **Actual Entity Performance** - On real conversational data

---

## Before Running

### 1. Get Cortex API Key
- Login to https://askcortex.plutas.in
- Navigate to user settings
- Generate new API key
- Copy the key

### 2. Configure Environment
Edit `/tmp/memorybench/.env.local`:
```bash
CORTEX_API_KEY=your_actual_key_here
OPENAI_API_KEY=sk-...  # For GPT-4o judge
```

### 3. Verify Backend is Running
```bash
curl https://askcortex.plutas.in/health
# Should return: {"status":"healthy"}
```

---

## Viewing Results

### CLI Commands
```bash
# Check progress
bun run src/index.ts status -r {runId}

# View failures
bun run src/index.ts show-failures -r {runId}

# List questions
bun run src/index.ts list-questions -b locomo
```

### Web UI
```bash
bun run src/index.ts serve
# Open http://localhost:3000
```

Real-time visualization of:
- Run progress
- Question-by-question results
- Failure analysis
- Latency graphs

---

## What This Proves

Running these benchmarks will provide **objective, industry-standard proof** that:

1. **Retrieval Quality** - How well Cortex finds relevant memories
2. **Temporal Intelligence** - Date/time reasoning capability
3. **Entity Extraction** - Knowledge graph quality
4. **Performance at Scale** - Latency under realistic load
5. **Competitive Position** - Direct comparison with Supermemory, Mem0, Zep

**No more estimates. Real data.**

---

## Next Steps

1. **Add API keys** to `/tmp/memorybench/.env.local`
2. **Run quick test**: `bun run src/index.ts run -p cortex -b locomo -l 10 -j gpt-4o`
3. **Review results** in `data/runs/{runId}/report.json`
4. **Run full benchmarks** for complete validation
5. **Update `BENCHMARK_RESULTS.md`** with REAL scores

---

## Documentation

- **Setup Guide**: `/tmp/memorybench/CORTEX_SETUP.md`
- **MemoryBench README**: `/tmp/memorybench/README.md`
- **Provider README**: `/tmp/memorybench/src/providers/README.md`

---

## Architecture Notes

### How Cortex Provider Works

**Ingestion Flow**:
```
MemoryBench Session → Format as JSON → POST /v3/memories → Get document ID
```

**Indexing Flow**:
```
Poll GET /v3/memories?limit=100 → Check processing_status → Wait for "done"
Exponential backoff: 2s → 2.4s → 2.88s → ... → max 10s
```

**Search Flow**:
```
Query → POST /v3/search (hybrid mode) → Return memories array
No reranking, no profile inclusion (for fair comparison)
```

### API Compatibility
All existing Cortex endpoints work unchanged. The MemoryBench integration:
- Uses standard `/v3/memories` and `/v3/search` endpoints
- Sets `source: "memorybench"` for tracking
- Disables AUDN (`useAUDN: false`) for fair benchmarking
- No special processing required

---

_Ready to get real proof of Cortex's memory capabilities._
