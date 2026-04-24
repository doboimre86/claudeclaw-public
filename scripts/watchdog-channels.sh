#!/bin/bash
# Watchdog: ellenőrzi hogy a claude process fut-e a nova-channels tmux sessionben.
# Ha nem fut, újraindítja a channels.sh-t.
# Ha 401 auth error van, Telegram értesítést küld.

SESSION="nova-channels"
TMUX="/usr/bin/tmux"
LOGFILE="/var/log/claudeclaw-watchdog.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTH_ERROR_FLAG="/tmp/claudeclaw-auth-error-notified"

# Van-e élő tmux session?
if ! $TMUX has-session -t "$SESSION" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') -- nova-channels session not found, restarting..." >> "$LOGFILE"
  /srv/claudeclaw/scripts/channels.sh &
  exit 0
fi

# Fut-e claude process a sessionben?
PANE_PID=$($TMUX list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null | head -1)
if [ -z "$PANE_PID" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') -- no pane pid found, restarting..." >> "$LOGFILE"
  $TMUX kill-session -t "$SESSION" 2>/dev/null
  /srv/claudeclaw/scripts/channels.sh &
  exit 0
fi

# Ellenőrizzük hogy a claude process él-e (a pane child process-ként)
if ! pgrep -P "$PANE_PID" -f "claude" >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') -- claude not running in session, restarting..." >> "$LOGFILE"
  $TMUX kill-session -t "$SESSION" 2>/dev/null
  /srv/claudeclaw/scripts/channels.sh &
  exit 0
fi

# === 401 Auth Error Detection ===
check_auth_error() {
  local sess="$1"
  if $TMUX has-session -t "$sess" 2>/dev/null; then
    if $TMUX capture-pane -t "$sess" -p 2>/dev/null | tail -20 | grep -q "API Error: 401\|authentication_error\|Please run /login"; then
      return 0
    fi
  fi
  return 1
}

AUTH_ERRORS=""
if check_auth_error "nova-channels"; then
  AUTH_ERRORS="Nova"
fi
if check_auth_error "agent-zara"; then
  AUTH_ERRORS="${AUTH_ERRORS:+$AUTH_ERRORS, }Zara"
fi

if [ -n "$AUTH_ERRORS" ]; then
  # Only notify once per hour (avoid spam)
  if [ ! -f "$AUTH_ERROR_FLAG" ] || [ $(($(date +%s) - $(stat -c %Y "$AUTH_ERROR_FLAG" 2>/dev/null || echo 0))) -gt 3600 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') -- 401 auth error detected: $AUTH_ERRORS" >> "$LOGFILE"
    source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null
    _auth_body="Egy vagy több agent OAuth tokenje lejárt. Kézi relogin kell, a botok addig nem válaszolnak."
    _auth_tech="Érintett: $AUTH_ERRORS
Parancs: claude login az érintett userrel
Időpont: $(date +%H:%M)"
    tg_notify error "OAuth token lejárt" "$_auth_body" "$_auth_tech" > /dev/null 2>&1
    touch "$AUTH_ERROR_FLAG"
  fi
else
  rm -f "$AUTH_ERROR_FLAG" 2>/dev/null
fi
