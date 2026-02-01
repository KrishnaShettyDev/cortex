#!/bin/bash

# Test Cortex Caching Layer
# This script tests embedding cache, profile cache, and search cache

API_URL="https://askcortex.plutas.in"
TOKEN=""  # Will get from auth

echo "=== Cortex Cache Test Suite ==="
echo ""

# Step 1: Authenticate
echo "1. Authenticating..."
# Note: You'll need to provide a valid test user token
# For now, using placeholder
read -p "Enter your JWT token: " TOKEN

if [ -z "$TOKEN" ]; then
    echo "Error: Token required"
    exit 1
fi

echo "Token set"
echo ""

# Step 2: Add a test memory (should generate embedding)
echo "2. Adding test memory (first time - cache miss)..."
MEMORY_ID=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "I prefer TypeScript over Python for backend development",
    "source": "test",
    "containerTag": "test"
  }' | jq -r '.id')

echo "Memory ID: $MEMORY_ID"
echo "Waiting 5 seconds for processing..."
sleep 5
echo ""

# Step 3: Search for the memory (first time - cache miss)
echo "3. Running search (first time - cache miss)..."
echo "Request sent at: $(date '+%H:%M:%S.%3N')"
RESPONSE1=$(curl -s -X POST "$API_URL/v3/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "programming language preferences",
    "containerTag": "test",
    "searchMode": "hybrid",
    "includeProfile": true,
    "limit": 5
  }')

TIMING1=$(echo $RESPONSE1 | jq -r '.timing')
echo "Response received at: $(date '+%H:%M:%S.%3N')"
echo "Timing: ${TIMING1}ms (should be slow - cache miss)"
echo ""

# Step 4: Search again (should be cached)
echo "4. Running same search again (should be cached)..."
echo "Request sent at: $(date '+%H:%M:%S.%3N')"
RESPONSE2=$(curl -s -X POST "$API_URL/v3/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "programming language preferences",
    "containerTag": "test",
    "searchMode": "hybrid",
    "includeProfile": true,
    "limit": 5
  }')

TIMING2=$(echo $RESPONSE2 | jq -r '.timing')
echo "Response received at: $(date '+%H:%M:%S.%3N')"
echo "Timing: ${TIMING2}ms (should be fast - cache hit)"
echo ""

# Step 5: Get profile (should be cached)
echo "5. Getting profile (should be cached)..."
echo "Request sent at: $(date '+%H:%M:%S.%3N')"
PROFILE=$(curl -s -X GET "$API_URL/v3/profile?containerTag=test" \
  -H "Authorization: Bearer $TOKEN")
echo "Response received at: $(date '+%H:%M:%S.%3N')"
echo "Profile: $PROFILE"
echo ""

# Step 6: Add another memory (should invalidate profile cache)
echo "6. Adding another memory (should invalidate profile cache)..."
MEMORY_ID2=$(curl -s -X POST "$API_URL/v3/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "I am currently working on a memory layer project",
    "source": "test",
    "containerTag": "test"
  }' | jq -r '.id')

echo "Memory ID: $MEMORY_ID2"
echo "Waiting 5 seconds for processing..."
sleep 5
echo ""

# Step 7: Get profile again (should be cache miss after invalidation)
echo "7. Getting profile again (should be fresh after invalidation)..."
PROFILE2=$(curl -s -X GET "$API_URL/v3/profile?containerTag=test" \
  -H "Authorization: Bearer $TOKEN")
echo "Profile (updated): $PROFILE2"
echo ""

# Summary
echo "=== Test Summary ==="
echo "First search timing: ${TIMING1}ms (cache miss)"
echo "Second search timing: ${TIMING2}ms (cache hit)"

if [ "$TIMING2" -lt "$TIMING1" ]; then
    echo "✅ Cache is working! Second request was faster."
else
    echo "⚠️  Cache might not be working. Second request was not faster."
fi

echo ""
echo "Check logs for cache hit/miss messages:"
echo "- [Cache] Embedding cache hit/miss"
echo "- [Cache] Profile cache hit/miss"
echo "- [Cache] Search results cache hit/miss"
echo ""
echo "View logs with: npx wrangler tail"
