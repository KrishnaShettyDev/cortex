#!/bin/bash
# Test entity extraction functionality

set -e

API_URL="https://askcortex.plutas.in"
TOKEN="${CORTEX_TEST_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: CORTEX_TEST_TOKEN environment variable not set"
  echo "Get a token from: $API_URL/auth/test-token"
  exit 1
fi

echo "🧪 Testing Entity Extraction & Knowledge Graph"
echo "=============================================="
echo ""

# Test 1: Create a memory with entities
echo "1️⃣  Creating memory with entities..."
MEMORY_RESPONSE=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Had a great meeting with Sarah Chen, Partner at Lightspeed Venture Partners. She mentioned they recently invested in a new AI startup called Cortex. We discussed potential collaboration on their Series A round. Sarah introduced me to John Smith, who is the CEO of Cortex. The meeting was at Lightspeed office in Menlo Park.",
    "source": "manual",
    "useAUDN": false
  }')

MEMORY_ID=$(echo "$MEMORY_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$MEMORY_ID" ]; then
  echo "❌ Failed to create memory"
  echo "$MEMORY_RESPONSE"
  exit 1
fi

echo "✅ Memory created: $MEMORY_ID"
echo ""

# Wait for processing
echo "⏳ Waiting for entity extraction (15 seconds)..."
sleep 15
echo ""

# Test 2: Get graph stats
echo "2️⃣  Getting graph statistics..."
STATS=$(curl -s "$API_URL/v3/graph/stats" \
  -H "Authorization: Bearer $TOKEN")

echo "Graph Stats:"
echo "$STATS" | jq '.'
echo ""

# Test 3: List entities
echo "3️⃣  Listing entities..."
ENTITIES=$(curl -s "$API_URL/v3/entities?limit=10" \
  -H "Authorization: Bearer $TOKEN")

echo "Entities:"
echo "$ENTITIES" | jq '.entities[] | {name, entity_type, attributes}'
echo ""

# Test 4: Search for specific entity
echo "4️⃣  Searching for 'Sarah Chen'..."
SEARCH=$(curl -s "$API_URL/v3/graph/search?q=Sarah" \
  -H "Authorization: Bearer $TOKEN")

SARAH_ID=$(echo "$SEARCH" | jq -r '.entities[0].id // empty')

if [ -z "$SARAH_ID" ]; then
  echo "⚠️  Sarah Chen not found (entity extraction may still be processing)"
else
  echo "✅ Found Sarah Chen: $SARAH_ID"
  echo ""

  # Test 5: Get entity details
  echo "5️⃣  Getting Sarah Chen's entity details..."
  ENTITY_DETAILS=$(curl -s "$API_URL/v3/entities/$SARAH_ID" \
    -H "Authorization: Bearer $TOKEN")

  echo "Entity Details:"
  echo "$ENTITY_DETAILS" | jq '.entity | {name, entity_type, attributes, importance_score, mention_count}'
  echo ""

  # Test 6: Get relationships
  echo "6️⃣  Getting Sarah Chen's relationships..."
  RELATIONSHIPS=$(curl -s "$API_URL/v3/entities/$SARAH_ID/relationships" \
    -H "Authorization: Bearer $TOKEN")

  echo "Relationships:"
  echo "$RELATIONSHIPS" | jq '.relationships[] | {source_entity, target_entity, relationship_type}'
  echo ""
fi

# Test 7: List companies
echo "7️⃣  Listing companies..."
COMPANIES=$(curl -s "$API_URL/v3/entities?entity_type=company&limit=5" \
  -H "Authorization: Bearer $TOKEN")

echo "Companies:"
echo "$COMPANIES" | jq '.entities[] | {name, attributes}'
echo ""

# Test 8: List people
echo "8️⃣  Listing people..."
PEOPLE=$(curl -s "$API_URL/v3/entities?entity_type=person&limit=5" \
  -H "Authorization: Bearer $TOKEN")

echo "People:"
echo "$PEOPLE" | jq '.entities[] | {name, attributes}'
echo ""

echo "=============================================="
echo "✅ Entity extraction tests completed!"
echo ""
echo "Check the output above for:"
echo "  - Entities: Sarah Chen (person), Lightspeed Venture Partners (company), Cortex (company), John Smith (person)"
echo "  - Relationships: Sarah works_for Lightspeed, Lightspeed invested_in Cortex, John manages Cortex"
echo "  - Attributes: roles, companies, etc."
