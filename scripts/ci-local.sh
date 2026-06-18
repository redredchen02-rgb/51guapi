#!/usr/bin/env bash
set -e

echo "=== 51guapi Full CI Simulation ==="
echo ""

echo "=> [1/6] Installing dependencies..."
pnpm install --frozen-lockfile

echo "=> [2/6] Building shared package..."
pnpm --filter @51guapi/shared build

echo "=> [3/6] Type checking all packages..."
pnpm compile

echo "=> [4/6] Running lint..."
pnpm lint:ci

echo "=> [5/6] Running unit tests..."
pnpm -r test

echo "=> [6/6] Full build verification..."
bash scripts/check-all.sh

echo ""
echo "=== All CI checks passed ==="
