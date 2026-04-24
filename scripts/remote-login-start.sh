#!/bin/bash
# remote-login-start.sh <agent>
# Dedikált tmux session-ben indítja a claude /login flow-t
# és kiolvassa az auth URL-t a pane-ből.
#
# Agents: nova (uid=997), zara (uid=1001), codeagent (uid=1002)
# Usage: sudo bash /srv/claudeclaw/scripts/remote-login-start.sh nova
set -euo pipefail

AGENT="${1:?Usage: $0 <nova|zara|codeagent>}"
CLAUDE_BIN="/root/.nova-claude/.local/bin/claude"

declare -A UIDS=( [nova]=997 [zara]=1001 [codeagent]=1002 )
declare -A HOMES=( [nova]=/home/nova [zara]=/home/zara [codeagent]=/home/codeagent )

uid="${UIDS[$AGENT]:-}"
home="${HOMES[$AGENT]:-}"
[ -z "$uid" ] && { echo "ERROR: ismeretlen agent: $AGENT"; exit 1; }

SESSION="login-${AGENT}"
SOCKET="/tmp/tmux-${uid}/default"

# Kill previous login session if exists
tmux -S "$SOCKET" kill-session -t "$SESSION" 2>/dev/null || true
sleep 0.5

# Start dedicated login session as the agent user
sudo -u "$AGENT" tmux -S "$SOCKET" new-session -d -s "$SESSION" -c "$home" \
  "HOME=$home $CLAUDE_BIN /login"

echo "LOGIN_SESSION_STARTED agent=$AGENT session=$SESSION socket=$SOCKET"

# Helper: extract multiline URL from pane
extract_url() {
  tmux -S "$SOCKET" capture-pane -t "$SESSION" -p 2>/dev/null \
    | awk '/^https:\/\/claude\.com/{found=1} found{if(/^$/){exit}; gsub(/[[:space:]]+$/,""); printf "%s",$0}'
}

# Phase 1: Wait for menu or "Opening browser" (max 15s)
MENU_SENT=0
for i in $(seq 1 15); do
  sleep 1
  raw=$(tmux -S "$SOCKET" capture-pane -t "$SESSION" -p 2>/dev/null || true)

  # Trust prompt — auto-answer
  if echo "$raw" | grep -qi "trust.*folder\|trust this\|Yes.*trust\|Do you trust"; then
    tmux -S "$SOCKET" send-keys -t "$SESSION" "y" Enter 2>/dev/null || true
    sleep 2
    continue
  fi

  # Menu appeared — select option 1
  if [ "$MENU_SENT" = "0" ] && echo "$raw" | grep -q "Select login method"; then
    tmux -S "$SOCKET" send-keys -t "$SESSION" "1" 2>/dev/null
    MENU_SENT=1
    sleep 1
    continue
  fi

  # Already past menu
  if [ "$MENU_SENT" = "0" ] && echo "$raw" | grep -qi "Opening browser\|Browser didn't"; then
    MENU_SENT=1
    break
  fi
done

# Phase 2: Wait for auth URL (max 30s)
URL=""
for i in $(seq 1 30); do
  sleep 1
  URL=$(extract_url)
  [ -n "$URL" ] && break
done

if [ -n "$URL" ]; then
  echo "AUTH_URL=$URL"
else
  echo "ERROR: No URL found after 45s. Pane content:"
  tmux -S "$SOCKET" capture-pane -t "$SESSION" -p -S -50 2>/dev/null || echo "(cannot read pane)"
  exit 1
fi
