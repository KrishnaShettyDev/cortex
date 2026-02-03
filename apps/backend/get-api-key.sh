#!/bin/bash

# Helper script to generate a long-lived API key for testing
# Usage: ./get-api-key.sh <your-current-access-token>

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}🔑 CORTEX API KEY GENERATOR${NC}"
echo "=============================="
echo ""

# Check if token is provided
if [ -z "$1" ]; then
  echo -e "${RED}❌ ERROR: No access token provided${NC}"
  echo ""
  echo "Usage:"
  echo "  ./get-api-key.sh <your-access-token>"
  echo ""
  echo "How to get your access token:"
  echo ""
  echo "1. Sign in to the mobile app or web app (app.askcortex.plutas.in)"
  echo "2. Get your access token:"
  echo ""
  echo "   Mobile App:"
  echo "   - Open the app and sign in"
  echo "   - Check your console/logs for the access_token"
  echo "   - Or inspect AsyncStorage"
  echo ""
  echo "   Web App:"
  echo "   - Open browser DevTools (F12)"
  echo "   - Go to Application > Local Storage"
  echo "   - Find the access_token key"
  echo ""
  echo "3. Then run:"
  echo "   ./get-api-key.sh <your-access-token>"
  echo ""
  exit 1
fi

TOKEN="$1"

echo -e "${YELLOW}⏳ Generating long-lived API key...${NC}"
echo ""

# Generate API key
RESPONSE=$(curl -s -X POST https://askcortex.plutas.in/auth/api-key \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# Check for errors
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR=$(echo "$RESPONSE" | jq -r '.error')
  echo -e "${RED}❌ ERROR: $ERROR${NC}"
  echo ""
  echo "Your access token may be expired or invalid."
  echo "Please sign in again and get a fresh token."
  exit 1
fi

# Extract API key
API_KEY=$(echo "$RESPONSE" | jq -r '.api_key // empty')

if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ Failed to generate API key${NC}"
  echo ""
  echo "Response:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✅ API key generated successfully!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your API Key (valid for 1 year):"
echo ""
echo -e "${GREEN}$API_KEY${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To use this API key:"
echo ""
echo "1. Export it:"
echo "   export CORTEX_API_KEY='$API_KEY'"
echo ""
echo "2. Run the E2E test:"
echo "   ./test-e2e-pipeline.sh"
echo ""
echo "3. Or use it in API calls:"
echo "   curl https://askcortex.plutas.in/v3/memories \\"
echo "     -H 'Authorization: Bearer $API_KEY'"
echo ""
echo -e "${YELLOW}⚠️  Keep this key secure! It has full access to your account.${NC}"
echo ""
