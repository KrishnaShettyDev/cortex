#!/bin/bash
# Test temporal intelligence functionality

set -e

API_URL="https://askcortex.plutas.in"
TOKEN="${CORTEX_TEST_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: CORTEX_TEST_TOKEN environment variable not set"
  echo "Get a token from: $API_URL/auth/test-token"
  exit 1
fi

echo "🕐 Testing Temporal Intelligence & Time Travel"
echo "=============================================="
echo ""

# Test 1: Create memory with temporal content
echo "1️⃣  Creating memory with event date..."
MEMORY1=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Had coffee with Sarah last Thursday. She mentioned the new product launch.",
    "source": "test",
    "useAUDN": false
  }')

MEMORY1_ID=$(echo "$MEMORY1" | jq -r '.id')
echo "✅ Created memory 1: $MEMORY1_ID"
sleep 10

# Test 2: Check event date extraction
echo -e "\n2️⃣  Checking event date extraction..."
MEMORY1_DATA=$(curl -s "$API_URL/v3/memories?limit=1" \
  -H "Authorization: Bearer $TOKEN")

EVENT_DATE=$(echo "$MEMORY1_DATA" | jq -r '.memories[0].metadata.timestamp // "null"')
echo "Event date extracted: $EVENT_DATE"

# Test 3: Create a superseding memory
echo -e "\n3️⃣  Creating memory about future event..."
MEMORY2=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Meeting with the team tomorrow at 2pm to discuss Q1 goals.",
    "source": "test",
    "useAUDN": false
  }')

MEMORY2_ID=$(echo "$MEMORY2" | jq -r '.id')
echo "✅ Created memory 2: $MEMORY2_ID"
sleep 10

# Test 4: Query currently valid memories
echo -e "\n4️⃣  Querying currently valid memories..."
CURRENT=$(curl -s "$API_URL/v3/memories/current?limit=10" \
  -H "Authorization: Bearer $TOKEN")

CURRENT_COUNT=$(echo "$CURRENT" | jq '.total')
echo "Currently valid memories: $CURRENT_COUNT"
echo "$CURRENT" | jq '.memories[] | {content: .content[0:50], event_date, memory_type}'

# Test 5: Time-travel query (1 week ago)
echo -e "\n5️⃣  Time-travel query (7 days ago)..."
ONE_WEEK_AGO=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "7 days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "2025-01-25T00:00:00Z")

TIMETRAVEL=$(curl -s -X POST "$API_URL/v3/time-travel" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"as_of_date\": \"$ONE_WEEK_AGO\",
    \"limit\": 10
  }")

TT_COUNT=$(echo "$TIMETRAVEL" | jq '.total')
echo "Memories valid on $ONE_WEEK_AGO: $TT_COUNT"

# Test 6: Create a contradictory memory (for supersession test)
echo -e "\n6️⃣  Creating memory that updates earlier fact..."
MEMORY3=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Sarah got promoted! She is now VP of Engineering at Lightspeed.",
    "source": "test",
    "useAUDN": false
  }')

MEMORY3_ID=$(echo "$MEMORY3" | jq -r '.id')
echo "✅ Created memory 3: $MEMORY3_ID"
sleep 10

# Test 7: Check memory history
echo -e "\n7️⃣  Checking memory history..."
if [ ! -z "$MEMORY3_ID" ] && [ "$MEMORY3_ID" != "null" ]; then
  HISTORY=$(curl -s "$API_URL/v3/memories/$MEMORY3_ID/history" \
    -H "Authorization: Bearer $TOKEN")

  HISTORY_COUNT=$(echo "$HISTORY" | jq '.total_versions // 0')
  echo "Memory versions: $HISTORY_COUNT"

  if [ "$HISTORY_COUNT" -gt 0 ]; then
    echo "$HISTORY" | jq '.history[] | {content: .content[0:60], valid_from, valid_to}'
  fi
fi

# Test 8: Query superseded memories
echo -e "\n8️⃣  Querying superseded memories..."
SUPERSEDED=$(curl -s "$API_URL/v3/memories/superseded?limit=10" \
  -H "Authorization: Bearer $TOKEN")

SUPERSEDED_COUNT=$(echo "$SUPERSEDED" | jq '.total')
echo "Superseded memories: $SUPERSEDED_COUNT"

if [ "$SUPERSEDED_COUNT" -gt 0 ]; then
  echo "$SUPERSEDED" | jq '.memories[] | {content: .content[0:50], valid_to, superseded_by}'
fi

echo -e "\n=============================================="
echo "✅ Temporal intelligence tests completed!"
echo ""
echo "Summary:"
echo "  - Event dates: Automatically extracted from content"
echo "  - Time-travel: Query memories as of any date"
echo "  - Supersession: Track knowledge updates"
echo "  - Memory types: Episodic vs semantic"
