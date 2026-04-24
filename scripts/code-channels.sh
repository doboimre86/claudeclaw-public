#!/bin/bash
# Claude Code Telegram Channels — @imi_claudecode_bot
# codeagent user (uid 1002), docker + claudeclaw groups
# Alapja: zara-channels.sh, de saját bot token, saját state dir, NEM tölt claudeclaw .env-et

# Plugin resilience auto-patch (idempotens, minden indulásnál)
[ -x /srv/claudeclaw/scripts/patch-telegram-plugin.sh ] && /srv/claudeclaw/scripts/patch-telegram-plugin.sh /home/codeagent codeagent >&2 || true

# Startup-kor touch-oljuk a last-send fájlt — enélkül a plugin-outbound-watchdog
# hosszú idle után (pl. éjszaka) azt hiszi a plugin akadt és restart-ol.
mkdir -p /tmp/agent-channels 2>/dev/null
chmod 1777 /tmp/agent-channels 2>/dev/null || true
printf '{"ts":%s,"method":"startup","agent":"codeagent"}' "$(date +%s%3N)" > /tmp/agent-channels/last-send-codeagent.json 2>/dev/null || true

SESSION="code-channels"
TMUX=/usr/bin/tmux
CLAUDE=/root/.nova-claude/.local/bin/claude

export HOME=/home/codeagent
export PATH=/root/.nova-claude/.local/bin:/home/codeagent/.bun/bin:/usr/local/bin:/usr/bin:/bin

# CSAK a saját token env, NEM a /srv/claudeclaw/.env (az Nova-é)
if [ -f /home/codeagent/.claude/channels/telegram/.env ]; then
  set -a
  source /home/codeagent/.claude/channels/telegram/.env
  set +a
fi

export TELEGRAM_STATE_DIR=/home/codeagent/.claude/channels/telegram
export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999

# --- Okos --continue eldöntése (stale session elleni védelem) ---
SESSION_DIR="/home/codeagent/.claude/projects/-home-codeagent"
CONTINUE_FLAG=""
MAX_AGE=$((24 * 3600))
if [ -d "$SESSION_DIR" ]; then
  LATEST=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$LATEST") ))
    if [ "$AGE" -lt "$MAX_AGE" ]; then
      CONTINUE_FLAG="--continue"
    fi
  fi
fi

# Orphan claude-ok megölése (ne maradjon duplikált instance restart után)
pkill -u codeagent -f "claude.*--channels plugin:telegram" 2>/dev/null || true
sleep 1

$TMUX kill-session -t "$SESSION" 2>/dev/null

$TMUX new-session -d -s "$SESSION" -c /home/codeagent \
  "export HOME=/home/codeagent && \
   export PATH=/root/.nova-claude/.local/bin:/home/codeagent/.bun/bin:/usr/local/bin:/usr/bin:/bin && \
   set -a && source /home/codeagent/.claude/channels/telegram/.env && set +a && \
   export TELEGRAM_STATE_DIR=/home/codeagent/.claude/channels/telegram && \
   export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999 && \
   $CLAUDE $CONTINUE_FLAG --dangerously-skip-permissions --mcp-config /home/codeagent/.mcp.json --channels plugin:telegram@claude-plugins-official"

while $TMUX has-session -t "$SESSION" 2>/dev/null; do
  sleep 30
done
exit 1
