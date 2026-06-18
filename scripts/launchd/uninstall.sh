#!/bin/bash
# Uninstall the 51guapi backend launchd LaunchAgent.
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.51guapi.backend.plist"

if [[ ! -f "$PLIST_DEST" ]]; then
  echo "plist not found at $PLIST_DEST — nothing to uninstall."
  exit 0
fi

launchctl unload "$PLIST_DEST" 2>/dev/null || true
rm -f "$PLIST_DEST"
echo "✓ Uninstalled com.51guapi.backend"
echo "  The plist was removed from ~/Library/LaunchAgents/."
echo "  ~/.51guapi/ and its contents were left in place."
