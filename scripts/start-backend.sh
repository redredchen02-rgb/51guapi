#!/usr/bin/env bash
# One-click backend startup with build-freshness check and healthz smoke test.
# Usage: bash scripts/start-backend.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_JS="$REPO_ROOT/packages/backend/dist/index.js"
SRC_GLOB="$REPO_ROOT/packages/backend/src"
HEALTHZ_URL="http://localhost:3001/api/v1/healthz"

# Rebuild if dist is missing or any src file is newer than the dist entry point.
needs_build() {
  [[ ! -f "$DIST_JS" ]] && return 0
  # find returns output only when a newer source file exists
  [[ -n "$(find "$SRC_GLOB" -name "*.ts" -newer "$DIST_JS" 2>/dev/null)" ]]
}

if needs_build; then
  echo "[start-backend] dist is stale or missing — building…"
  (cd "$REPO_ROOT" && pnpm --filter publisher-backend build)
fi

# Check if backend is already running.
if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
  echo "[start-backend] Backend is already running. $HEALTHZ_URL → ok"
  exit 0
fi

# Locate .env: custom path > ~/.51publisher/.env > packages/backend/.env (new user default).
if [[ -n "${PUBLISHER_ENV_PATH:-}" && -f "$PUBLISHER_ENV_PATH" ]]; then
  ENV_FILE="$PUBLISHER_ENV_PATH"
elif [[ -f "$HOME/.51publisher/.env" ]]; then
  ENV_FILE="$HOME/.51publisher/.env"
elif [[ -f "$REPO_ROOT/packages/backend/.env" ]]; then
  ENV_FILE="$REPO_ROOT/packages/backend/.env"
else
  echo "[start-backend] ERROR: .env not found. Run: bash scripts/setup.sh" >&2
  exit 1
fi
echo "[start-backend] Loading env from $ENV_FILE"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

LOG_FILE="/tmp/51publisher-backend.log"
PID_FILE="/tmp/51publisher-backend.pid"

echo "[start-backend] Starting backend (background, log: $LOG_FILE)…"
nohup node "$DIST_JS" >> "$LOG_FILE" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"

# Poll healthz up to 10 times (1 s apart) to confirm the server is up.
for i in $(seq 1 10); do
  sleep 1
  if curl -sf "$HEALTHZ_URL" >/dev/null 2>&1; then
    echo "[start-backend] Backend is up (pid $BACKEND_PID). $HEALTHZ_URL → ok"
    echo "[start-backend] Stop: kill \$(cat $PID_FILE)"
    exit 0
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[start-backend] ERROR: process exited unexpectedly. Log:" >&2
    tail -20 "$LOG_FILE" >&2
    exit 1
  fi
  echo "[start-backend] Waiting for healthz… ($i/10)"
done

echo "[start-backend] ERROR: healthz did not return 200 after 10 s." >&2
echo "[start-backend] Check log: cat $LOG_FILE" >&2
kill "$BACKEND_PID" 2>/dev/null || true
exit 1
