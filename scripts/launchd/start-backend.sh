#!/bin/bash
# Template — install.sh substitutes __NODE_MAIN__ with the real absolute path.
set -euo pipefail

ENV_FILE="${PUBLISHER_ENV_PATH:-$HOME/.51publisher/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env file not found at $ENV_FILE" >&2
  exit 1
fi

# Require chmod 600 — readable only by owner.
chmod_result=$(stat -f "%OLp" "$ENV_FILE" 2>/dev/null || stat -c "%a" "$ENV_FILE" 2>/dev/null)
if [[ "$chmod_result" != "600" ]]; then
  echo "ERROR: $ENV_FILE must be chmod 600, got $chmod_result. Run: chmod 600 $ENV_FILE" >&2
  exit 1
fi

# macOS extended ACL check: chmod 600 is insufficient if an ACL grants other users read access.
if ls -le "$ENV_FILE" 2>/dev/null | grep -q "+"; then
  echo "ERROR: $ENV_FILE has a macOS extended ACL. Run: chmod -N $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

exec node __NODE_MAIN__
