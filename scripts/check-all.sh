#!/usr/bin/env bash
set -e

echo "=> Running lint..."
pnpm lint:ci

echo "=> Running tests..."
pnpm -r test

echo "=> Building backend..."
pnpm --filter publisher-backend build

echo "=> Building extension..."
pnpm --filter publisher-fill-assistant build

echo "=> Verifying build artifacts..."
if [ ! -d "packages/extension/.output" ]; then
  echo "Error: Extension build artifact directory .output not found!"
  exit 1
fi

if [ ! -d "packages/backend/dist" ]; then
  echo "Error: Backend build artifact directory dist not found!"
  exit 1
fi

echo "=> Build artifacts OK."
echo "=> All checks passed!"
