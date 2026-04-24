#!/bin/bash
# Start Nova services

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Nova inditas..."
launchctl load "$HOME/Library/LaunchAgents/claudeclaw-dashboard.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/claudeclaw-channels.plist" 2>/dev/null || true

echo "✓ Dashboard: http://localhost:3420"
echo "✓ Telegram csatorna inditva"
