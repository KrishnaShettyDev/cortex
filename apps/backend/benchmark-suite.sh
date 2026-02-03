#!/bin/bash
# LongMemEval Benchmark Suite
# Comprehensive testing of Cortex memory infrastructure

set -e

API_URL="https://askcortex.plutas.in"
TOKEN="${CORTEX_TEST_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: CORTEX_TEST_TOKEN environment variable not set"
  echo "Get a token from: $API_URL/auth/test-token"
  exit 1
fi

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 LongMemEval Benchmark Suite"
echo "==============================="
echo ""

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Helper function to run test
run_test() {
  local test_name=$1
  local test_command=$2
  local success_criteria=$3

  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  echo -n "Testing: $test_name... "

  if eval "$test_command" "$success_criteria"; then
    echo -e "${GREEN}✓ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Measure latency using curl's time_total
measure_latency() {
  local endpoint=$1
  local method=${2:-GET}

  if [ "$method" = "GET" ]; then
    local time_ms=$(curl -s -w "%{time_total}" -o /dev/null "$API_URL$endpoint" -H "Authorization: Bearer $TOKEN")
  else
    local time_ms=$(curl -s -w "%{time_total}" -o /dev/null -X POST "$API_URL$endpoint" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
  fi

  # Convert to milliseconds
  echo $(echo "$time_ms * 1000" | bc | cut -d'.' -f1)
}

echo "📊 BENCHMARK 1: Retrieval Latency"
echo "--------------------------------"

# Test memory retrieval
LATENCY=$(measure_latency "/v3/memories?limit=50")
echo "Memory list (50 items): ${LATENCY}ms"
if [ $LATENCY -lt 400 ]; then
  echo -e "${GREEN}✓ Under 400ms target${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠ Above 400ms target${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# Test search latency
LATENCY=$(measure_latency "/v3/search" "POST")
echo "Hybrid search: ${LATENCY}ms"
if [ $LATENCY -lt 500 ]; then
  echo -e "${GREEN}✓ Under 500ms target${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠ Above 500ms target${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# Test entity graph query
LATENCY=$(measure_latency "/v3/entities?limit=20")
echo "Entity list (20 items): ${LATENCY}ms"
if [ $LATENCY -lt 300 ]; then
  echo -e "${GREEN}✓ Under 300ms target${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠ Above 300ms target${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "🎯 BENCHMARK 2: Entity Extraction Accuracy"
echo "----------------------------------------"

# Create test memories with known entities
echo "Creating test memories..."

TEST_MEMORIES=(
  "Had lunch with Sarah Chen from Anthropic to discuss the new Claude model."
  "Meeting with John Smith at Google tomorrow about the partnership."
  "Called Microsoft support, spoke with Jane Wilson about licensing."
  "Dinner with Alex Johnson from OpenAI last Friday."
  "Emailed David Lee at Meta regarding the research collaboration."
)

CREATED_IDS=()
for memory in "${TEST_MEMORIES[@]}"; do
  RESULT=$(curl -s -X POST "$API_URL/v3/memories" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"$memory\", \"source\": \"benchmark\", \"useAUDN\": false}")

  ID=$(echo "$RESULT" | jq -r '.id')
  CREATED_IDS+=("$ID")
done

echo "Waiting 60 seconds for processing..."
sleep 60

# Check entity extraction
ENTITIES=$(curl -s "$API_URL/v3/entities?limit=100" \
  -H "Authorization: Bearer $TOKEN")

TOTAL_ENTITIES=$(echo "$ENTITIES" | jq '.total')
echo "Total entities extracted: $TOTAL_ENTITIES"

# Check for expected entities (people and companies)
EXPECTED_PEOPLE=("Sarah Chen" "John Smith" "Jane Wilson" "Alex Johnson" "David Lee")
EXPECTED_COMPANIES=("Anthropic" "Google" "Microsoft" "OpenAI" "Meta")

PEOPLE_FOUND=0
for person in "${EXPECTED_PEOPLE[@]}"; do
  if echo "$ENTITIES" | jq -e ".entities[] | select(.name == \"$person\")" > /dev/null 2>&1; then
    PEOPLE_FOUND=$((PEOPLE_FOUND + 1))
  fi
done

COMPANIES_FOUND=0
for company in "${EXPECTED_COMPANIES[@]}"; do
  if echo "$ENTITIES" | jq -e ".entities[] | select(.name == \"$company\")" > /dev/null 2>&1; then
    COMPANIES_FOUND=$((COMPANIES_FOUND + 1))
  fi
done

PEOPLE_ACCURACY=$((PEOPLE_FOUND * 100 / ${#EXPECTED_PEOPLE[@]}))
COMPANIES_ACCURACY=$((COMPANIES_FOUND * 100 / ${#EXPECTED_COMPANIES[@]}))

echo "People extracted: $PEOPLE_FOUND/${#EXPECTED_PEOPLE[@]} (${PEOPLE_ACCURACY}%)"
echo "Companies extracted: $COMPANIES_FOUND/${#EXPECTED_COMPANIES[@]} (${COMPANIES_ACCURACY}%)"

if [ $PEOPLE_ACCURACY -ge 60 ]; then
  echo -e "${GREEN}✓ People extraction acceptable${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗ People extraction below target${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "⏰ BENCHMARK 3: Temporal Reasoning"
echo "--------------------------------"

# Test event date extraction
TEMPORAL_TEST=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Meeting scheduled for next Monday at 3pm to review Q1 results.", "source": "benchmark", "useAUDN": false}')

TEMPORAL_ID=$(echo "$TEMPORAL_TEST" | jq -r '.id')
echo "Waiting for temporal processing..."
sleep 20

TEMPORAL_MEMORY=$(curl -s "$API_URL/v3/memories?limit=1" \
  -H "Authorization: Bearer $TOKEN")

EVENT_DATE=$(echo "$TEMPORAL_MEMORY" | jq -r '.memories[0].event_date')
echo "Event date extracted: $EVENT_DATE"

if [ "$EVENT_DATE" != "null" ] && [ ! -z "$EVENT_DATE" ]; then
  echo -e "${GREEN}✓ Event date extraction working${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗ Event date extraction failed${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "💯 BENCHMARK 4: Importance Scoring"
echo "--------------------------------"

# Check importance scores
MEMORIES=$(curl -s "$API_URL/v3/memories?limit=10" \
  -H "Authorization: Bearer $TOKEN")

SCORED_COUNT=$(echo "$MEMORIES" | jq '[.memories[] | select(.importance_score != null)] | length')
TOTAL_COUNT=$(echo "$MEMORIES" | jq '.memories | length')

echo "Memories with importance scores: $SCORED_COUNT/$TOTAL_COUNT"

if [ $SCORED_COUNT -gt 0 ]; then
  AVG_SCORE=$(echo "$MEMORIES" | jq '[.memories[] | select(.importance_score != null) | .importance_score] | add / length')
  echo "Average importance score: $AVG_SCORE"

  echo -e "${GREEN}✓ Importance scoring active${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗ No importance scores found${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "📝 BENCHMARK 5: Commitment Detection"
echo "----------------------------------"

# Create memory with clear commitment
COMMITMENT_TEST=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "I promised to deliver the final proposal to the client by February 15th 2026. This is a critical deadline.", "source": "benchmark", "useAUDN": false}')

COMMIT_ID=$(echo "$COMMITMENT_TEST" | jq -r '.id')
echo "Waiting for commitment extraction..."
sleep 20

COMMITMENTS=$(curl -s "$API_URL/v3/commitments?limit=20" \
  -H "Authorization: Bearer $TOKEN")

COMMIT_COUNT=$(echo "$COMMITMENTS" | jq '.total')
echo "Total commitments tracked: $COMMIT_COUNT"

if [ $COMMIT_COUNT -gt 0 ]; then
  echo "Recent commitments:"
  echo "$COMMITMENTS" | jq '.commitments[:3] | .[] | {type: .commitment_type, description: .description[0:60], confidence: .extraction_confidence}'

  echo -e "${GREEN}✓ Commitment tracking working${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠ No commitments detected (LLM may need tuning)${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "🤝 BENCHMARK 6: Relationship Intelligence"
echo "---------------------------------------"

HEALTH=$(curl -s "$API_URL/v3/relationships/health" \
  -H "Authorization: Bearer $TOKEN")

REL_COUNT=$(echo "$HEALTH" | jq '.total')
echo "Relationships tracked: $REL_COUNT"

if [ $REL_COUNT -gt 0 ]; then
  echo "Health summary:"
  echo "$HEALTH" | jq '.summary'

  echo -e "${GREEN}✓ Relationship scoring working${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠ No relationships tracked yet${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

echo ""
echo "==============================="
echo "📊 BENCHMARK RESULTS"
echo "==============================="
echo ""
echo "Total Tests: $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

PASS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))
echo ""
echo "Pass Rate: ${PASS_RATE}%"

if [ $PASS_RATE -ge 70 ]; then
  echo -e "${GREEN}✓ TARGET MET: >70% pass rate${NC}"
  exit 0
else
  echo -e "${RED}✗ BELOW TARGET: <70% pass rate${NC}"
  exit 1
fi
