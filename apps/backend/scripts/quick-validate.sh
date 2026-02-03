#!/bin/bash
# Cortex Quick Validation Script
# Run: ./scripts/quick-validate.sh

set -e

API_URL="${API_URL:-https://askcortex.plutas.in}"
TOKEN="${CORTEX_API_KEY:-}"

echo "=============================================="
echo "  CORTEX QUICK VALIDATION"
echo "=============================================="
echo "API: $API_URL"
echo "Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

PASSED=0
FAILED=0

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
fi

# Check for API key
if [ -z "$TOKEN" ]; then
    warn "CORTEX_API_KEY not set. Using unauthenticated requests."
    AUTH_HEADER=""
else
    AUTH_HEADER="-H \"Authorization: Bearer $TOKEN\""
fi

echo "----------------------------------------------"
echo "1. HEALTH CHECK"
echo "----------------------------------------------"

HEALTH_START=$(python3 -c 'import time; print(int(time.time() * 1000))')
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")
HEALTH_END=$(python3 -c 'import time; print(int(time.time() * 1000))')
HEALTH_TIME=$((HEALTH_END - HEALTH_START))

if [ "$HEALTH_RESPONSE" == "200" ]; then
    pass "API responding (${HEALTH_TIME}ms)"
    ((PASSED++))
else
    fail "API down (status: $HEALTH_RESPONSE)"
    ((FAILED++))
fi

echo ""
echo "----------------------------------------------"
echo "2. PIPELINE PERFORMANCE"
echo "----------------------------------------------"

# Create a test memory
TEST_CONTENT="Quick test with John from Acme Corp. Will send report by Friday. Meeting scheduled for tomorrow at 2pm."

PIPELINE_START=$(python3 -c 'import time; print(int(time.time() * 1000))')

if [ -n "$TOKEN" ]; then
    CREATE_RESPONSE=$(curl -s -X POST "$API_URL/v3/memories" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"$TEST_CONTENT\"}" 2>/dev/null)
else
    CREATE_RESPONSE=$(curl -s -X POST "$API_URL/v3/memories" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"$TEST_CONTENT\"}" 2>/dev/null)
fi

MEMORY_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // .memory.id // empty' 2>/dev/null)

if [ -n "$MEMORY_ID" ] && [ "$MEMORY_ID" != "null" ]; then
    pass "Memory created: $MEMORY_ID"
    ((PASSED++))

    echo "   Waiting for pipeline to complete..."

    # Poll for completion (max 30 seconds)
    MAX_ATTEMPTS=30
    ATTEMPT=0
    STATUS="pending"

    while [ $ATTEMPT -lt $MAX_ATTEMPTS ] && [ "$STATUS" != "done" ] && [ "$STATUS" != "failed" ]; do
        sleep 1
        ((ATTEMPT++))

        if [ -n "$TOKEN" ]; then
            STATUS_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID" \
                -H "Authorization: Bearer $TOKEN" 2>/dev/null)
        else
            STATUS_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID" 2>/dev/null)
        fi

        STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.processing_status // .status // "unknown"' 2>/dev/null)

        # Show progress
        printf "\r   Progress: %d/%d seconds (status: %s)    " $ATTEMPT $MAX_ATTEMPTS "$STATUS"
    done

    echo ""

    PIPELINE_END=$(python3 -c 'import time; print(int(time.time() * 1000))')
    PIPELINE_TIME=$((PIPELINE_END - PIPELINE_START))

    if [ "$STATUS" == "done" ]; then
        if [ $PIPELINE_TIME -lt 5000 ]; then
            pass "Pipeline complete: ${PIPELINE_TIME}ms (target: <5000ms)"
            ((PASSED++))
        else
            warn "Pipeline complete but slow: ${PIPELINE_TIME}ms (target: <5000ms)"
            ((PASSED++))
        fi
    else
        fail "Pipeline status: $STATUS (expected: done)"
        ((FAILED++))
    fi

    # Check for entities
    if [ -n "$TOKEN" ]; then
        ENTITIES_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID/entities" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    else
        ENTITIES_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID/entities" 2>/dev/null)
    fi

    ENTITY_COUNT=$(echo "$ENTITIES_RESPONSE" | jq -r '.entities | length // 0' 2>/dev/null)

    if [ "$ENTITY_COUNT" -gt 0 ] 2>/dev/null; then
        pass "Entities extracted: $ENTITY_COUNT"
        ((PASSED++))
    else
        warn "No entities extracted (may be expected for simple content)"
    fi

    # Check for commitments
    if [ -n "$TOKEN" ]; then
        COMMIT_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID/commitments" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    else
        COMMIT_RESPONSE=$(curl -s "$API_URL/v3/memories/$MEMORY_ID/commitments" 2>/dev/null)
    fi

    COMMIT_COUNT=$(echo "$COMMIT_RESPONSE" | jq -r '.commitments | length // 0' 2>/dev/null)

    if [ "$COMMIT_COUNT" -gt 0 ] 2>/dev/null; then
        pass "Commitments found: $COMMIT_COUNT"
        ((PASSED++))
    else
        warn "No commitments found (may need different test content)"
    fi

    # Cleanup
    if [ -n "$TOKEN" ]; then
        curl -s -X DELETE "$API_URL/v3/memories/$MEMORY_ID" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
    else
        curl -s -X DELETE "$API_URL/v3/memories/$MEMORY_ID" > /dev/null 2>&1
    fi
    pass "Cleanup complete"
    ((PASSED++))

else
    fail "Failed to create memory"
    ((FAILED++))
    echo "   Response: $CREATE_RESPONSE"
fi

echo ""
echo "----------------------------------------------"
echo "3. SEARCH PERFORMANCE"
echo "----------------------------------------------"

SEARCH_START=$(python3 -c 'import time; print(int(time.time() * 1000))')

if [ -n "$TOKEN" ]; then
    SEARCH_RESPONSE=$(curl -s -X POST "$API_URL/v3/search" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"query": "meeting project report"}' 2>/dev/null)
else
    SEARCH_RESPONSE=$(curl -s -X POST "$API_URL/v3/search" \
        -H "Content-Type: application/json" \
        -d '{"query": "meeting project report"}' 2>/dev/null)
fi

SEARCH_END=$(python3 -c 'import time; print(int(time.time() * 1000))')
SEARCH_TIME=$((SEARCH_END - SEARCH_START))

RESULT_COUNT=$(echo "$SEARCH_RESPONSE" | jq -r '.results | length // 0' 2>/dev/null)

if [ $SEARCH_TIME -lt 500 ]; then
    pass "Search: ${SEARCH_TIME}ms ($RESULT_COUNT results) - target: <500ms"
    ((PASSED++))
else
    warn "Search slow: ${SEARCH_TIME}ms ($RESULT_COUNT results) - target: <500ms"
    ((PASSED++))
fi

echo ""
echo "----------------------------------------------"
echo "4. SYSTEM STATS"
echo "----------------------------------------------"

if [ -n "$TOKEN" ]; then
    STATS_RESPONSE=$(curl -s "$API_URL/v3/stats" \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)
else
    STATS_RESPONSE=$(curl -s "$API_URL/v3/stats" 2>/dev/null)
fi

TOTAL_MEMORIES=$(echo "$STATS_RESPONSE" | jq -r '.total_memories // .memories // "?"' 2>/dev/null)
TOTAL_ENTITIES=$(echo "$STATS_RESPONSE" | jq -r '.total_entities // .entities // "?"' 2>/dev/null)

echo "   Total Memories: $TOTAL_MEMORIES"
echo "   Total Entities: $TOTAL_ENTITIES"

echo ""
echo "=============================================="
echo "  SUMMARY"
echo "=============================================="
TOTAL=$((PASSED + FAILED))
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Total:  $TOTAL"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}Some tests failed. Review output above.${NC}"
    exit 1
fi
