#!/bin/bash

# Quick cache test - requires manual token input

echo "🧪 Quick Cortex Cache Test"
echo ""
echo "You need a JWT token. Get it by:"
echo "1. Login via mobile app, OR"
echo "2. Use Google/Apple auth endpoint"
echo ""
read -p "Enter your JWT token: " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
    echo "❌ Token required"
    exit 1
fi

API="https://askcortex.plutas.in"
TAG="test_$(date +%s)"

echo "Using container tag: $TAG"
echo ""

# Test 1: Add memory
echo "📝 Adding test memory..."
MEM1=$(curl -s -X POST "$API/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"I prefer TypeScript for backend\",\"source\":\"test\",\"containerTag\":\"$TAG\"}")

MEM_ID=$(echo $MEM1 | jq -r '.id')
echo "Memory ID: $MEM_ID"
echo "Waiting 10s for processing..."
sleep 10
echo ""

# Test 2: Search (first time)
echo "🔍 Search #1 (cache miss expected)..."
START1=$(node -e "console.log(Date.now())")
SEARCH1=$(curl -s -X POST "$API/v3/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"q\":\"programming preferences\",\"containerTag\":\"$TAG\",\"searchMode\":\"hybrid\",\"includeProfile\":true}")
END1=$(node -e "console.log(Date.now())")
ELAPSED1=$((END1 - START1))
TIMING1=$(echo $SEARCH1 | jq -r '.timing')

echo "Total time: ${ELAPSED1}ms"
echo "Backend time: ${TIMING1}ms"
echo ""

# Test 3: Same search (should be cached)
echo "🔍 Search #2 (cache HIT expected)..."
START2=$(node -e "console.log(Date.now())")
SEARCH2=$(curl -s -X POST "$API/v3/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"q\":\"programming preferences\",\"containerTag\":\"$TAG\",\"searchMode\":\"hybrid\",\"includeProfile\":true}")
END2=$(node -e "console.log(Date.now())")
ELAPSED2=$((END2 - START2))
TIMING2=$(echo $SEARCH2 | jq -r '.timing')

echo "Total time: ${ELAPSED2}ms"
echo "Backend time: ${TIMING2}ms"
echo ""

# Summary
echo "📊 Results:"
echo "First search:  ${ELAPSED1}ms (miss)"
echo "Second search: ${ELAPSED2}ms (hit)"

if [ "$ELAPSED2" -lt "$ELAPSED1" ]; then
    SPEEDUP=$(echo "scale=1; (1 - $ELAPSED2/$ELAPSED1) * 100" | bc)
    echo "✅ CACHE WORKING! ${SPEEDUP}% faster"
else
    echo "⚠️  No speedup detected"
fi

echo ""
echo "View real-time logs with:"
echo "npx wrangler tail --format=pretty"
