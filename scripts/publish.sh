#!/bin/bash
# Publish Cortex SDK packages to npm
#
# Usage:
#   ./scripts/publish.sh          # Build and publish both packages
#   ./scripts/publish.sh --dry-run # Build only, don't publish

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 Dry run mode - will build but not publish"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📦 Building and publishing Cortex packages..."
echo ""

# Build @cortex/memory
echo "═══════════════════════════════════════════════════"
echo "📚 Building @cortex/memory..."
echo "═══════════════════════════════════════════════════"
cd "$ROOT_DIR/packages/core"
npm install
npm run build

if [[ "$DRY_RUN" == false ]]; then
  echo "🚀 Publishing @cortex/memory..."
  npm publish --access public
else
  echo "✅ @cortex/memory built successfully (dry run - not publishing)"
fi

cd "$ROOT_DIR"
echo ""

# Build @cortex/mcp
echo "═══════════════════════════════════════════════════"
echo "🔌 Building @cortex/mcp..."
echo "═══════════════════════════════════════════════════"
cd "$ROOT_DIR/packages/mcp-server"
npm install
npm run build

if [[ "$DRY_RUN" == false ]]; then
  echo "🚀 Publishing @cortex/mcp..."
  npm publish --access public
else
  echo "✅ @cortex/mcp built successfully (dry run - not publishing)"
fi

cd "$ROOT_DIR"
echo ""

echo "═══════════════════════════════════════════════════"
if [[ "$DRY_RUN" == false ]]; then
  echo "✅ Done! Published @cortex/memory and @cortex/mcp"
  echo ""
  echo "Install with:"
  echo "  npm install @cortex/memory"
  echo "  npx @cortex/mcp"
else
  echo "✅ Dry run complete! Both packages built successfully."
  echo ""
  echo "To publish for real, run:"
  echo "  ./scripts/publish.sh"
fi
echo "═══════════════════════════════════════════════════"
