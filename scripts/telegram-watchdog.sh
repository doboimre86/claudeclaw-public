#!/bin/bash
# Telegram message watchdog — dual tmux socket support
# Nova: /tmp/tmux-997/default, Zara: /tmp/tmux-1001/default

NOVA_TMUX="/usr/bin/tmux -S /tmp/tmux-997/default"
ZARA_TMUX="/usr/bin/tmux -S /tmp/tmux-1001/default"
LOGFILE=/var/log/claudeclaw-telegram-watchdog.log

is_busy() {
  echo "$1" | grep -qiE 'Thinking|Running|Waiting|processing|Simmering|Kneading|Churning|Germinating|Leavening|Brewing|Baking|Working|Waddling|Skedaddling|Pontificating|Razzle|Crunching|Deliberating|Meandering|Musing|Pondering|Composing|Crafting|Cogitat|Decipher|Forging|stop hook|still running|esc to interrupt'
}

check_session() {
  local TMUX_CMD=$1
  local session=$2

  $TMUX_CMD has-session -t "$session" 2>/dev/null || return

  PANE=$($TMUX_CMD capture-pane -t "$session" -p 2>/dev/null)
  TAIL=$(echo "$PANE" | tail -5)

  is_busy "$TAIL" && return

  if echo "$TAIL" | grep -q 'Pasted text'; then
    echo "$(date '+%H:%M:%S') -- $session: auto-submit [Pasted text]" >> "$LOGFILE"
    $TMUX_CMD send-keys -t "$session" Enter
    return
  fi

  if echo "$TAIL" | grep -q 'queued messages'; then
    echo "$(date '+%H:%M:%S') -- $session: process queued" >> "$LOGFILE"
    $TMUX_CMD send-keys -t "$session" Enter
    return
  fi
}

while true; do
  check_session "$NOVA_TMUX" nova-channels
  check_session "$ZARA_TMUX" agent-zara
  
  [ -f "$LOGFILE" ] && {
    lines=$(wc -l < "$LOGFILE" 2>/dev/null || echo 0)
    [ "$lines" -gt 10000 ] && tail -5000 "$LOGFILE" > "${LOGFILE}.tmp" && mv "${LOGFILE}.tmp" "$LOGFILE"
  }
  sleep 10
done
