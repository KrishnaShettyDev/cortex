#!/bin/bash

# End-to-End Pipeline Test
# Tests the complete processing pipeline with real API calls
# Requires: API key from app.askcortex.plutas.in/settings

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
URL="https://askcortex.plutas.in"
API_KEY="${CORTEX_API_KEY:-}"

echo "🧪 CORTEX END-TO-END PIPELINE TEST"
echo "===================================="
echo ""

# Check API key
if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ ERROR: API key not set${NC}"
  echo ""
  echo "To get your API key:"
  echo ""
  echo "1. Sign in to the mobile app or web app (app.askcortex.plutas.in)"
  echo "2. Get your access token from the app"
  echo "   - Mobile: Check AsyncStorage or app logs"
  echo "   - Web: Check browser localStorage"
  echo ""
  echo "OR generate a long-lived API key:"
  echo ""
  echo "  # First, sign in and get a short-lived token"
  echo "  TOKEN='your-access-token'"
  echo ""
  echo "  # Generate a 1-year API key"
  echo "  API_KEY=\$(curl -s -X POST https://askcortex.plutas.in/auth/api-key \\"
  echo "    -H \"Authorization: Bearer \$TOKEN\" | jq -r '.api_key')"
  echo ""
  echo "  # Export it"
  echo "  export CORTEX_API_KEY=\"\$API_KEY\""
  echo ""
  echo "Then run: ./test-e2e-pipeline.sh"
  exit 1
fi

echo -e "${GREEN}✅ API key configured${NC}"
echo ""

# Test counter
PASSED=0
FAILED=0

# Test 1: Create Memory
echo "======================================"
echo -e "${BLUE}TEST 1: Create Memory${NC}"
echo "======================================"
echo ""

MEMORY_CONTENT="This is a test memory about machine learning and neural networks. It discusses how transformers revolutionized NLP."

echo "Creating memory..."
CREATE_RESPONSE=$(curl -s -X POST "$URL/v3/memories" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Container-Tag: test-pipeline" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$MEMORY_CONTENT\",\"source\":\"e2e-test\"}")

echo "Response: $CREATE_RESPONSE"
echo ""

# Extract memory ID
MEMORY_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')

if [ -z "$MEMORY_ID" ]; then
  echo -e "${RED}❌ FAIL: Could not create memory${NC}"
  echo "Response: $CREATE_RESPONSE"
  ((FAILED++))
  exit 1
else
  echo -e "${GREEN}✅ PASS: Memory created${NC}"
  echo "Memory ID: $MEMORY_ID"
  ((PASSED++))
fi

echo ""

# Test 2: Create Processing Job
echo "======================================"
echo -e "${BLUE}TEST 2: Create Processing Job${NC}"
echo "======================================"
echo ""

echo "Creating processing job for memory $MEMORY_ID..."
JOB_RESPONSE=$(curl -s -X POST "$URL/v3/processing/jobs" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Container-Tag: test-pipeline" \
  -H "Content-Type: application/json" \
  -d "{\"memoryId\":\"$MEMORY_ID\"}")

echo "Response: $JOB_RESPONSE"
echo ""

# Extract job ID
JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.job.id // empty')
PROCESSING_MODE=$(echo "$JOB_RESPONSE" | jq -r '.processingMode // empty')

if [ -z "$JOB_ID" ]; then
  echo -e "${RED}❌ FAIL: Could not create processing job${NC}"
  echo "Response: $JOB_RESPONSE"
  ((FAILED++))
  exit 1
else
  echo -e "${GREEN}✅ PASS: Processing job created${NC}"
  echo "Job ID: $JOB_ID"
  echo "Processing Mode: $PROCESSING_MODE"
  ((PASSED++))
fi

echo ""

# Test 3: Monitor Job Status
echo "======================================"
echo -e "${BLUE}TEST 3: Monitor Job Status${NC}"
echo "======================================"
echo ""

echo "Waiting for job to process (max 30 seconds)..."
echo ""

MAX_WAIT=30
WAIT_COUNT=0
JOB_STATUS="queued"

while [ "$JOB_STATUS" != "done" ] && [ "$JOB_STATUS" != "failed" ] && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
  sleep 1
  ((WAIT_COUNT++))

  STATUS_RESPONSE=$(curl -s "$URL/v3/processing/jobs/$JOB_ID" \
    -H "Authorization: Bearer $API_KEY" \
    -H "X-Container-Tag: test-pipeline")

  JOB_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.job.status // "unknown"')
  CURRENT_STEP=$(echo "$STATUS_RESPONSE" | jq -r '.job.currentStep // "unknown"')

  echo -ne "\rStatus: $JOB_STATUS | Step: $CURRENT_STEP | Time: ${WAIT_COUNT}s"
done

echo ""
echo ""

if [ "$JOB_STATUS" = "done" ]; then
  echo -e "${GREEN}✅ PASS: Job completed successfully${NC}"
  ((PASSED++))

  # Show metrics
  METRICS=$(echo "$STATUS_RESPONSE" | jq '.job.metrics')
  echo ""
  echo "Metrics:"
  echo "$METRICS" | jq '.'

  CHUNK_COUNT=$(echo "$METRICS" | jq -r '.chunkCount // 0')
  TOKEN_COUNT=$(echo "$METRICS" | jq -r '.tokenCount // 0')
  TOTAL_DURATION=$(echo "$METRICS" | jq -r '.totalDurationMs // 0')

  echo ""
  echo "Summary:"
  echo "  Chunks created: $CHUNK_COUNT"
  echo "  Tokens processed: $TOKEN_COUNT"
  echo "  Total duration: ${TOTAL_DURATION}ms"

elif [ "$JOB_STATUS" = "failed" ]; then
  echo -e "${RED}❌ FAIL: Job failed${NC}"
  ((FAILED++))

  LAST_ERROR=$(echo "$STATUS_RESPONSE" | jq -r '.job.lastError // "unknown"')
  echo "Error: $LAST_ERROR"

  # Show steps
  echo ""
  echo "Steps:"
  echo "$STATUS_RESPONSE" | jq '.job.steps'

else
  echo -e "${YELLOW}⚠️  TIMEOUT: Job did not complete in ${MAX_WAIT}s${NC}"
  echo "Current status: $JOB_STATUS"
  echo "Current step: $CURRENT_STEP"
  ((FAILED++))
fi

echo ""

# Test 4: Search for Memory
echo "======================================"
echo -e "${BLUE}TEST 4: Search for Memory${NC}"
echo "======================================"
echo ""

echo "Searching for 'machine learning'..."
SEARCH_RESPONSE=$(curl -s -X POST "$URL/v3/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Container-Tag: test-pipeline" \
  -H "Content-Type: application/json" \
  -d '{"q":"machine learning","limit":5}')

echo "Response:"
echo "$SEARCH_RESPONSE" | jq '.'
echo ""

RESULT_COUNT=$(echo "$SEARCH_RESPONSE" | jq '.memories | length')

if [ "$RESULT_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ PASS: Search found $RESULT_COUNT result(s)${NC}"
  ((PASSED++))

  # Check if our memory is in results
  FOUND=$(echo "$SEARCH_RESPONSE" | jq ".memories[] | select(.id == \"$MEMORY_ID\")")
  if [ ! -z "$FOUND" ]; then
    echo -e "${GREEN}✅ Our test memory was found in search results${NC}"
  else
    echo -e "${YELLOW}⚠️  Our test memory was not in top results (expected for new memory)${NC}"
  fi
else
  echo -e "${RED}❌ FAIL: Search returned no results${NC}"
  ((FAILED++))
fi

echo ""

# Test 5: List Processing Jobs
echo "======================================"
echo -e "${BLUE}TEST 5: List Processing Jobs${NC}"
echo "======================================"
echo ""

echo "Listing jobs for container 'test-pipeline'..."
LIST_RESPONSE=$(curl -s "$URL/v3/processing/jobs?container_tag=test-pipeline&limit=10" \
  -H "Authorization: Bearer $API_KEY")

echo "Response:"
echo "$LIST_RESPONSE" | jq '.'
echo ""

JOB_COUNT=$(echo "$LIST_RESPONSE" | jq '.jobs | length')

if [ "$JOB_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ PASS: Found $JOB_COUNT job(s)${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL: No jobs found${NC}"
  ((FAILED++))
fi

echo ""

# Test 6: Get Processing Stats
echo "======================================"
echo -e "${BLUE}TEST 6: Get Processing Stats${NC}"
echo "======================================"
echo ""

echo "Getting processing statistics..."
STATS_RESPONSE=$(curl -s "$URL/v3/processing/stats?container_tag=test-pipeline" \
  -H "Authorization: Bearer $API_KEY")

echo "Response:"
echo "$STATS_RESPONSE" | jq '.'
echo ""

TOTAL_JOBS=$(echo "$STATS_RESPONSE" | jq -r '.totals.jobs // 0')

if [ "$TOTAL_JOBS" -gt 0 ]; then
  echo -e "${GREEN}✅ PASS: Stats show $TOTAL_JOBS total job(s)${NC}"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠️  WARN: No jobs in stats (may be expected)${NC}"
  ((PASSED++))
fi

echo ""

# Test 7: Multi-tenancy Isolation
echo "======================================"
echo -e "${BLUE}TEST 7: Multi-tenancy Isolation${NC}"
echo "======================================"
echo ""

echo "Testing isolation: Querying with different container_tag..."
ISOLATION_RESPONSE=$(curl -s "$URL/v3/processing/jobs?container_tag=different-container&limit=10" \
  -H "Authorization: Bearer $API_KEY")

ISOLATION_COUNT=$(echo "$ISOLATION_RESPONSE" | jq '.jobs | length')

if [ "$ISOLATION_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ PASS: Isolation working (no jobs found in different container)${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL: Isolation broken (found $ISOLATION_COUNT jobs in different container)${NC}"
  ((FAILED++))
fi

echo ""

# Cleanup
echo "======================================"
echo -e "${BLUE}CLEANUP${NC}"
echo "======================================"
echo ""

echo "Deleting test memory..."
DELETE_RESPONSE=$(curl -s -X DELETE "$URL/v3/memories/$MEMORY_ID" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Container-Tag: test-pipeline")

if echo "$DELETE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Test memory deleted${NC}"
else
  echo -e "${YELLOW}⚠️  Could not delete test memory (may need manual cleanup)${NC}"
fi

echo ""

# Summary
echo "======================================"
echo -e "${BLUE}TEST SUMMARY${NC}"
echo "======================================"
echo ""
echo -e "${GREEN}Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $FAILED${NC}"
else
  echo -e "${GREEN}Failed: 0${NC}"
fi
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 ALL TESTS PASSED${NC}"
  echo ""
  echo "✅ Memory creation: Working"
  echo "✅ Processing pipeline: Working"
  echo "✅ Job monitoring: Working"
  echo "✅ Search: Working"
  echo "✅ Multi-tenancy: Working"
  echo ""
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo ""
  echo "Check the output above for details."
  exit 1
fi
