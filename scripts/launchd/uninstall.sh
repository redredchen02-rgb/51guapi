#!/bin/bash
# Uninstall the 51publisher backend launchd LaunchAgent.
set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.51publisher.backend.plist"

if [[ ! -f "$PLIST_DEST" ]]; then
  echo "plist not found at $PLIST_DEST — nothing to uninstall."
  exit 0
fi

launchctl unload "$PLIST_DEST" 2>/dev/null || true
rm -f "$PLIST_DEST"
echo "✓ Uninstalled com.51publisher.backend"
echo "  The plist was removed from ~/Library/LaunchAgents/."
echo "  ~/.51publisher/ and its contents were left in place."
