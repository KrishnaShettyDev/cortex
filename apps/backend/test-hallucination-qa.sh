#!/bin/bash
#
# Hallucination QA Test Runner
# Tests the zero-hallucination grounding system
#
# Usage:
#   ./test-hallucination-qa.sh <jwt_token> [base_url]
#
# Examples:
#   ./test-hallucination-qa.sh "eyJ..." (uses localhost:8787)
#   ./test-hallucination-qa.sh "eyJ..." "https://askcortex.plutas.in"
#

set -e

TOKEN="$1"
BASE_URL="${2:-http://localhost:8787}"

if [ -z "$TOKEN" ]; then
  echo "❌ Error: JWT token required"
  echo ""
  echo "Usage: ./test-hallucination-qa.sh <jwt_token> [base_url]"
  echo ""
  echo "To get a token:"
  echo "  1. Login via /auth/apple or /auth/google"
  echo "  2. Or generate an API key via /auth/api-keys"
  exit 1
fi

echo "🔍 Hallucination QA Test Suite"
echo "=============================="
echo ""
echo "Base URL: $BASE_URL"
echo "Token:    ${TOKEN:0:20}..."
echo ""

# Navigate to the evaluation directory
cd "$(dirname "$0")/src/lib/benchmark/hallucination-qa"

# Run the evaluation
npx ts-node evaluate.ts --base-url "$BASE_URL" --token "$TOKEN"
