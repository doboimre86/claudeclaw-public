#!/bin/bash
# Apply tight permissions to secret-bearing files.
# Idempotent: safe to re-run after install / config edits.
#
# What this does:
#   - .env, .mcp.json, .dashboard-token: 640 root:claudeclaw (no world read)
#   - Requires the "claudeclaw" group to exist (created by install)
set -euo pipefail

ROOT="${CLAUDECLAW_ROOT:-/srv/claudeclaw}"
GROUP="${CLAUDECLAW_GROUP:-claudeclaw}"

if ! getent group "$GROUP" > /dev/null; then
  echo "Group $GROUP does not exist — create it first (groupadd $GROUP)" >&2
  exit 1
fi

tighten() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "skip (missing): $path"
    return
  fi
  chown root:"$GROUP" "$path"
  chmod 640 "$path"
  echo "tightened: $path"
}

tighten "$ROOT/.env"
tighten "$ROOT/.mcp.json"
tighten "$ROOT/store/.dashboard-token"

echo "Done. Add agent users to the $GROUP group so they can read these files:"
echo "  usermod -aG $GROUP nova"
echo "  usermod -aG $GROUP zara"
