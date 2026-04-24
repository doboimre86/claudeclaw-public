#!/bin/bash
# ClaudeClaw Zara (Sonnet)

# Plugin resilience auto-patch (idempotens, minden indulásnál)
[ -x /srv/claudeclaw/scripts/patch-telegram-plugin.sh ] && /srv/claudeclaw/scripts/patch-telegram-plugin.sh /home/zara zara >&2 || true

SESSION="agent-zara"
TMUX=/usr/bin/tmux
CLAUDE=/root/.nova-claude/.local/bin/claude

export HOME=/home/zara
export PATH=/root/.nova-claude/.local/bin:/home/zara/.bun/bin:/usr/local/bin:/usr/bin:/bin

if [ -f /srv/claudeclaw/.env ]; then
  set -a
  source /srv/claudeclaw/.env
  set +a
fi

if [ -f /srv/claudeclaw/agents/zara/.claude/channels/telegram/.env ]; then
  set -a
  source /srv/claudeclaw/agents/zara/.claude/channels/telegram/.env
  set +a
fi

export TELEGRAM_STATE_DIR=/srv/claudeclaw/agents/zara/.claude/channels/telegram

# Orphan claude-ok megölése (ne maradjon duplikált instance restart után)
pkill -u zara -f "claude.*--channels plugin:telegram" 2>/dev/null || true
sleep 1

$TMUX kill-session -t "$SESSION" 2>/dev/null

$TMUX new-session -d -s "$SESSION" -c /srv/claudeclaw/agents/zara \
  "set -a && source /srv/claudeclaw/.env 2>/dev/null && set +a && \
   set -a && source /srv/claudeclaw/agents/zara/.claude/channels/telegram/.env 2>/dev/null && set +a && \
   export HOME=/home/zara && \
   export PATH=/root/.nova-claude/.local/bin:/home/zara/.bun/bin:/usr/local/bin:/usr/bin:/bin && \
   export TELEGRAM_STATE_DIR=/srv/claudeclaw/agents/zara/.claude/channels/telegram && export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999 && \
   export CLAUDE_CODE_IDLE_THRESHOLD_MINUTES=9999 && \
   $CLAUDE --continue --model claude-sonnet-4-6 --dangerously-skip-permissions --mcp-config /srv/claudeclaw/agents/zara/.mcp.json --channels plugin:telegram@claude-plugins-official"

while $TMUX has-session -t "$SESSION" 2>/dev/null; do
  sleep 30
done
exit 1
