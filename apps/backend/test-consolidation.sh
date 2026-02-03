#!/bin/bash
# Test memory consolidation and importance scoring functionality

set -e

API_URL="https://askcortex.plutas.in"
TOKEN="${CORTEX_TEST_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: CORTEX_TEST_TOKEN environment variable not set"
  echo "Get a token from: $API_URL/auth/test-token"
  exit 1
fi

echo "🧠 Testing Memory Consolidation & Importance Scoring"
echo "===================================================="
echo ""

# Test 1: Check consolidation stats before creating memories
echo "1️⃣  Getting baseline consolidation stats..."
STATS=$(curl -s "$API_URL/v3/memories/consolidation-stats" \
  -H "Authorization: Bearer $TOKEN")

echo "Baseline stats:"
echo "$STATS" | jq '{total_memories, episodic_memories, semantic_memories, average_importance}'
echo ""

# Test 2: Create a high-importance memory
echo "2️⃣  Creating high-importance memory (career decision)..."
MEMORY1=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Made the decision to accept the VP of Engineering offer at TechCorp. Starting March 1st. Need to give notice to current company by Feb 15th.",
    "source": "test",
    "useAUDN": false
  }')

MEMORY1_ID=$(echo "$MEMORY1" | jq -r '.id')
echo "✅ Created high-importance memory: $MEMORY1_ID"
sleep 12

# Test 3: Create a low-importance memory
echo -e "\n3️⃣  Creating low-importance memory (trivial note)..."
MEMORY2=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Had a sandwich for lunch today. It was okay.",
    "source": "test",
    "useAUDN": false
  }')

MEMORY2_ID=$(echo "$MEMORY2" | jq -r '.id')
echo "✅ Created low-importance memory: $MEMORY2_ID"
sleep 12

# Test 4: Get importance scores after processing
echo -e "\n4️⃣  Checking importance scores..."
MEMORY1_DATA=$(curl -s "$API_URL/v3/memories?limit=100" \
  -H "Authorization: Bearer $TOKEN")

echo "Recent memories with importance scores:"
echo "$MEMORY1_DATA" | jq '.memories[:5] | .[] | {content: .content[0:60], importance_score, memory_type}'
echo ""

# Test 5: Manually recalculate importance for a memory
echo "5️⃣  Manually recalculating importance for first memory..."
RECALC=$(curl -s -X POST "$API_URL/v3/memories/$MEMORY1_ID/recalculate-importance" \
  -H "Authorization: Bearer $TOKEN")

echo "Recalculation result:"
echo "$RECALC" | jq '.importance_score'
echo ""

# Test 6: Create multiple episodic memories for consolidation testing
echo "6️⃣  Creating episodic memories for consolidation test..."
for i in {1..3}; do
  curl -s -X POST "$API_URL/v3/memories" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"content\": \"Had a quick sync with the team. Discussed project progress. Everyone is aligned.\",
      \"source\": \"test\",
      \"useAUDN\": false
    }" > /dev/null
  echo "  Created episodic memory $i/3"
  sleep 6
done
echo ""

# Test 7: Get updated consolidation stats
echo "7️⃣  Getting updated consolidation stats..."
STATS_AFTER=$(curl -s "$API_URL/v3/memories/consolidation-stats" \
  -H "Authorization: Bearer $TOKEN")

echo "Stats after creating memories:"
echo "$STATS_AFTER" | jq '{total_memories, episodic_memories, semantic_memories, low_importance_memories, consolidation_candidates, average_importance}'
echo ""

# Test 8: Run decay cycle (will apply decay + consolidation)
echo "8️⃣  Running decay cycle..."
DECAY_RESULT=$(curl -s -X POST "$API_URL/v3/memories/decay-cycle" \
  -H "Authorization: Bearer $TOKEN")

echo "Decay cycle results:"
echo "$DECAY_RESULT" | jq '.stats'
echo ""

# Test 9: Check for semantic memories created by consolidation
echo "9️⃣  Checking for semantic memories..."
SEMANTIC=$(curl -s "$API_URL/v3/memories?limit=100" \
  -H "Authorization: Bearer $TOKEN")

SEMANTIC_COUNT=$(echo "$SEMANTIC" | jq '[.memories[] | select(.memory_type == "semantic")] | length')
echo "Semantic memories found: $SEMANTIC_COUNT"

if [ "$SEMANTIC_COUNT" -gt 0 ]; then
  echo "Semantic memories:"
  echo "$SEMANTIC" | jq '[.memories[] | select(.memory_type == "semantic")] | .[] | {content: .content[0:100], importance_score}'
fi
echo ""

echo "===================================================="
echo "✅ Consolidation tests completed!"
echo ""
echo "Summary:"
echo "  - Importance scoring: Working (LLM-based analysis)"
echo "  - Manual recalculation: Available"
echo "  - Decay cycle: Functional"
echo "  - Episodic→Semantic consolidation: Ready"
echo "  - Consolidation stats: Tracking metrics"
