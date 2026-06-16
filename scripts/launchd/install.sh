#!/bin/bash
# Install the 51publisher backend as a macOS launchd LaunchAgent.
#
# Prerequisites:
#   1. Build the backend first:  pnpm build:backend (from repo root)
#   2. Create ~/.51publisher/.env with all required vars and chmod 600:
#        mkdir -p ~/.51publisher && cp packages/backend/.env.example ~/.51publisher/.env
#        # Edit the file, then:
#        chmod 600 ~/.51publisher/.env
#
# The plist is placed in ~/Library/LaunchAgents/ and loaded immediately.
# Running install.sh again is idempotent (unloads first if already loaded).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_MAIN="$REPO_ROOT/packages/backend/dist/index.js"
DEST_DIR="$HOME/.51publisher"
START_SCRIPT="$DEST_DIR/start-backend.sh"
PLIST_TEMPLATE="$SCRIPT_DIR/com.51publisher.backend.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.51publisher.backend.plist"
PLIST_LABEL="com.51publisher.backend"

echo "=== 51publisher backend install ==="
echo "Repo root : $REPO_ROOT"
echo "Node main : $NODE_MAIN"
echo "Dest dir  : $DEST_DIR"

# Require the backend to be built first.
if [[ ! -f "$NODE_MAIN" ]]; then
  echo ""
  echo "ERROR: $NODE_MAIN not found." >&2
  echo "       Run 'pnpm build:backend' (or 'pnpm build') from the repo root first." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# Generate start-backend.sh from template, substituting the real node entry point.
sed "s|__NODE_MAIN__|$(realpath "$NODE_MAIN")|g" \
  "$SCRIPT_DIR/start-backend.sh" > "$START_SCRIPT"
chmod 755 "$START_SCRIPT"
echo "✓ Written  $START_SCRIPT"

# Generate plist from template, substituting home dir and script path.
sed \
  -e "s|__HOME__|$HOME|g" \
  -e "s|__SCRIPT_PATH__|$START_SCRIPT|g" \
  "$PLIST_TEMPLATE" > "$PLIST_DEST"
echo "✓ Written  $PLIST_DEST"

# Idempotent load: unload silently if already loaded, then load.
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo "✓ Loaded   $PLIST_LABEL"

echo ""
echo "Backend daemon installed and running."
echo "Logs : $DEST_DIR/backend.log"
echo "Env  : ${PUBLISHER_ENV_PATH:-$DEST_DIR/.env}  (must be chmod 600)"
echo ""
echo "To uninstall: bash $SCRIPT_DIR/uninstall.sh"
