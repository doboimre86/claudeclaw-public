#!/bin/bash
# ClaudeClaw Nova — okos --continue logikaval
# Ha van friss (<24h) session jsonl a Nova projects-ben, folytatjuk.
# Ha nincs vagy regebbi, friss session (ne bukjon stale-re).

# Plugin resilience auto-patch (idempotens, minden indulásnál)
[ -x /srv/claudeclaw/scripts/patch-telegram-plugin.sh ] && /srv/claudeclaw/scripts/patch-telegram-plugin.sh /home/nova nova >&2 || true

SESSION="nova-channels"
TMUX=/usr/bin/tmux
CLAUDE=/root/.nova-claude/.local/bin/claude

export HOME=/home/nova
export PATH=/root/.nova-claude/.local/bin:/home/nova/.bun/bin:/usr/local/bin:/usr/bin:/bin

if [ -f /srv/claudeclaw/.env ]; then
  set -a
  source /srv/claudeclaw/.env
  set +a
fi

export TELEGRAM_STATE_DIR=/home/nova/.claude/channels/telegram
export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999

# --- --continue eldontese ---
SESSION_DIR="/home/nova/.claude/projects/-srv-claudeclaw"
CONTINUE_FLAG=""
MAX_AGE=$((24 * 3600))   # 24 ora
if [ -d "$SESSION_DIR" ]; then
  LATEST=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$LATEST") ))
    if [ "$AGE" -lt "$MAX_AGE" ]; then
      CONTINUE_FLAG="--continue"
      echo "[nova-channels.sh] $(date +%T) --continue: $(basename "$LATEST") kora $((AGE/60)) perc" >&2
    else
      echo "[nova-channels.sh] $(date +%T) friss session: $(basename "$LATEST") kora $((AGE/3600)) ora (>24h)" >&2
    fi
  else
    echo "[nova-channels.sh] $(date +%T) friss session: nincs jsonl" >&2
  fi
else
  echo "[nova-channels.sh] $(date +%T) friss session: projects dir hianyzik" >&2
fi

# Orphan claude-ok megölése (ne maradjon duplikált instance restart után)
pkill -u nova -f "claude.*--channels plugin:telegram" 2>/dev/null || true
sleep 1

$TMUX kill-session -t "$SESSION" 2>/dev/null

$TMUX new-session -d -s "$SESSION" -c /srv/claudeclaw \
  "set -a && source /srv/claudeclaw/.env && set +a && \
   export HOME=/home/nova && \
   export PATH=/root/.nova-claude/.local/bin:/home/nova/.bun/bin:/usr/local/bin:/usr/bin:/bin && \
   export TELEGRAM_STATE_DIR=/home/nova/.claude/channels/telegram && \
   export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999 && \
   $CLAUDE $CONTINUE_FLAG --dangerously-skip-permissions --mcp-config /srv/claudeclaw/.mcp.json --channels plugin:telegram@claude-plugins-official"

while timeout 30 $TMUX has-session -t "$SESSION" 2>/dev/null; do
  sleep 30
done
exit 1
