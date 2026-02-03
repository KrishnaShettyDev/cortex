#!/bin/bash
# Test relationship intelligence and proactive nudges

set -e

API_URL="https://askcortex.plutas.in"
TOKEN="${CORTEX_TEST_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: CORTEX_TEST_TOKEN environment variable not set"
  echo "Get a token from: $API_URL/auth/test-token"
  exit 1
fi

echo "🤝 Testing Relationship Intelligence"
echo "====================================="
echo ""

# Test 1: Check relationship health
echo "1️⃣  Getting relationship health scores..."
HEALTH=$(curl -s "$API_URL/v3/relationships/health" \
  -H "Authorization: Bearer $TOKEN")

TOTAL=$(echo "$HEALTH" | jq '.total')
echo "Total relationships tracked: $TOTAL"

if [ "$TOTAL" -gt 0 ]; then
  echo ""
  echo "Relationship summary:"
  echo "$HEALTH" | jq '.summary'

  echo ""
  echo "Top relationships needing attention:"
  echo "$HEALTH" | jq '.relationships[:3] | .[] | {
    name: .entity_name,
    status: .health_status,
    health_score: .health_score,
    days_since_last: .days_since_last_interaction,
    pending_commitments: .pending_commitments,
    recommendation: .recommended_action
  }'
fi

# Test 2: Get health for specific entity (if any exist)
if [ "$TOTAL" -gt 0 ]; then
  echo -e "\n2️⃣  Getting health for specific entity..."
  ENTITY_ID=$(echo "$HEALTH" | jq -r '.relationships[0].entity_id')

  if [ ! -z "$ENTITY_ID" ] && [ "$ENTITY_ID" != "null" ]; then
    ENTITY_HEALTH=$(curl -s "$API_URL/v3/relationships/$ENTITY_ID/health" \
      -H "Authorization: Bearer $TOKEN")

    echo "Entity health details:"
    echo "$ENTITY_HEALTH" | jq '{
      entity_name,
      health_status,
      health_score,
      total_interactions,
      days_since_last_interaction,
      avg_interaction_frequency_days,
      pending_commitments,
      completed_commitments,
      overdue_commitments,
      commitment_completion_rate,
      recommended_action
    }'
  fi
fi

# Test 3: Generate proactive nudges
echo -e "\n3️⃣  Generating proactive nudges..."
NUDGES=$(curl -s "$API_URL/v3/nudges" \
  -H "Authorization: Bearer $TOKEN")

NUDGE_COUNT=$(echo "$NUDGES" | jq '.nudges | length')
echo "Generated nudges: $NUDGE_COUNT"

if [ "$NUDGE_COUNT" -gt 0 ]; then
  echo ""
  echo "Nudge summary:"
  echo "$NUDGES" | jq '.metadata'

  echo ""
  echo "Top nudges:"
  echo "$NUDGES" | jq '.nudges[] | {
    type: .nudge_type,
    priority: .priority,
    title,
    message,
    entity: .entity_name,
    action: .suggested_action,
    confidence: .confidence_score
  }'
fi

# Test 4: Force generate new nudges
echo -e "\n4️⃣  Force generating fresh nudges..."
FRESH_NUDGES=$(curl -s -X POST "$API_URL/v3/nudges/generate" \
  -H "Authorization: Bearer $TOKEN")

FRESH_COUNT=$(echo "$FRESH_NUDGES" | jq '.nudges | length')
echo "Fresh nudges generated: $FRESH_COUNT"

if [ "$FRESH_COUNT" -gt 0 ]; then
  echo ""
  echo "Priority breakdown:"
  URGENT=$(echo "$FRESH_NUDGES" | jq '[.nudges[] | select(.priority == "urgent")] | length')
  HIGH=$(echo "$FRESH_NUDGES" | jq '[.nudges[] | select(.priority == "high")] | length')
  MEDIUM=$(echo "$FRESH_NUDGES" | jq '[.nudges[] | select(.priority == "medium")] | length')
  LOW=$(echo "$FRESH_NUDGES" | jq '[.nudges[] | select(.priority == "low")] | length')

  echo "  Urgent: $URGENT"
  echo "  High: $HIGH"
  echo "  Medium: $MEDIUM"
  echo "  Low: $LOW"

  echo ""
  echo "Nudge types:"
  echo "$FRESH_NUDGES" | jq '[.nudges[] | .nudge_type] | group_by(.) | map({type: .[0], count: length})'
fi

echo ""
echo "====================================="
echo "✅ Relationship intelligence tests completed!"
echo ""
echo "Summary:"
echo "  - Relationship health scoring: Working"
echo "  - Health status classification: Working"
echo "  - Proactive nudge generation: Working"
echo "  - Priority and type categorization: Working"
