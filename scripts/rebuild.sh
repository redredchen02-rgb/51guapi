#!/usr/bin/env bash
set -e

echo "=== 51guapi Rebuild ==="

echo "=> Cleaning..."
rm -rf node_modules packages/extension/.wxt packages/extension/.output packages/extension/node_modules packages/backend/dist packages/backend/node_modules packages/shared/dist

echo "=> Installing..."
pnpm install

echo "=> Building shared..."
pnpm --filter @51guapi/shared build

echo "=> Type checking..."
pnpm compile

echo "=> Running tests..."
pnpm -r test

echo "=== Rebuild complete ==="
