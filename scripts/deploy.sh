#!/usr/bin/env bash
set -e

echo "=== 51guapi Deploy ==="

# Detect environment
if [ -f /app/package.json ]; then
  echo "=> Detected Docker/container environment"
  echo "=> Starting backend..."
  exec node dist/index.js
fi

echo "=> Detected local environment"

# Build if needed
if [ ! -d "packages/backend/dist" ]; then
  echo "=> Building..."
  pnpm --filter @51guapi/shared build
  pnpm --filter 51guapi-backend build
fi

# Verify health
echo "=> Starting backend..."
bash scripts/start-backend.sh &

echo "=> Waiting for health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3002/api/v1/healthz > /dev/null 2>&1; then
    echo "=> Backend healthy on port 3002"
    exit 0
  fi
  sleep 1
done

echo "=> Health check failed after 30s"
exit 1
