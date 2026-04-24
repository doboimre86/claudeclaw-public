#!/bin/bash
# remote-login-submit.sh <agent> <code-or-url>
# Beadja az auth kódot/URL-t a login tmux session-be,
# ellenőrzi a sikert, és restartol ha kell.
#
# Usage: sudo bash /srv/claudeclaw/scripts/remote-login-submit.sh nova "https://..."
set -euo pipefail

AGENT="${1:?Usage: $0 <nova|zara|codeagent> <code-or-url>}"
CODE="${2:?Usage: $0 <nova|zara|codeagent> <code-or-url>}"

declare -A UIDS=( [nova]=997 [zara]=1001 [codeagent]=1002 )
declare -A SERVICES=( [nova]=claudeclaw-channels [zara]=claudeclaw-zara [codeagent]=claude-code-channels )

uid="${UIDS[$AGENT]:-}"
service="${SERVICES[$AGENT]:-}"
[ -z "$uid" ] && { echo "ERROR: ismeretlen agent: $AGENT"; exit 1; }

SESSION="login-${AGENT}"
SOCKET="/tmp/tmux-${uid}/default"

# Check session exists
if ! tmux -S "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  echo "ERROR: login session '$SESSION' nem fut. Futtasd előbb: remote-login-start.sh $AGENT"
  exit 1
fi

# Send the code/URL to the pane
tmux -S "$SOCKET" send-keys -t "$SESSION" "$CODE" Enter

echo "CODE_SENT agent=$AGENT"

# Wait for result (max 15 seconds)
SUCCESS=""
FAIL=""
for i in $(seq 1 15); do
  sleep 1
  pane_content=$(tmux -S "$SOCKET" capture-pane -t "$SESSION" -p -S -50 2>/dev/null || true)

  if echo "$pane_content" | grep -qi "Login successful\|logged in\|success"; then
    SUCCESS="yes"
    break
  fi
  if echo "$pane_content" | grep -qi "error\|failed\|invalid\|expired"; then
    FAIL="yes"
    break
  fi
done

if [ "$SUCCESS" = "yes" ]; then
  echo "LOGIN_SUCCESS agent=$AGENT"
  # Cleanup login session
  tmux -S "$SOCKET" kill-session -t "$SESSION" 2>/dev/null || true
  # Restart the agent service
  echo "RESTARTING service=$service"
  systemctl restart "$service"
  sleep 2
  state=$(systemctl is-active "$service" 2>&1)
  echo "SERVICE_STATE=$state"
elif [ "$FAIL" = "yes" ]; then
  echo "LOGIN_FAILED agent=$AGENT"
  echo "PANE_CONTENT:"
  tmux -S "$SOCKET" capture-pane -t "$SESSION" -p -S -30 2>/dev/null || echo "(cannot read)"
else
  echo "LOGIN_TIMEOUT agent=$AGENT (no success/fail detected in 15s)"
  echo "PANE_CONTENT:"
  tmux -S "$SOCKET" capture-pane -t "$SESSION" -p -S -30 2>/dev/null || echo "(cannot read)"
fi
