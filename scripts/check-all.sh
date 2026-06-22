#!/usr/bin/env bash
set -e

echo "=> Running lint..."
pnpm lint:ci

echo "=> Running tests..."
pnpm -r test

echo "=> Building backend..."
pnpm --filter 51guapi-backend build

echo "=> Building extension..."
pnpm --filter 51guapi-extension build

echo "=> Verifying build artifacts..."
if [ ! -f "packages/extension/.output/chrome-mv3/manifest.json" ]; then
  echo "Error: Extension artifact missing chrome-mv3/manifest.json (build empty/broken)!"
  exit 1
fi

if ! ls packages/backend/dist/*.js >/dev/null 2>&1; then
  echo "Error: Backend artifact dist has no .js (build empty/broken)!"
  exit 1
fi

echo "=> Build artifacts OK."
echo "=> All checks passed!"
