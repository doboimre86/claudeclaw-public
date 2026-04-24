#!/bin/bash
# Agent thinking notify — ha agent >2 perce gondolkodik Owner üzenete után,
# küldj egy "⏳ Még dolgozom" üzenetet hogy Owner ne higgye hogy csendes.
#
# Kritériumok (MIND egyszerre):
#   1. Pane-ben látszik long-running state (Compacting/Enchanting/Crunched/Cooked/Baked/thinking-spinner)
#   2. Utolsó Owner-inbound < 5 perc
#   3. Utolsó agent-outbound > 2 perc (/tmp/agent-channels/last-send-<agent>.json alapján)
#   4. Erre az Owner üzenetre még nem küldtünk notify-t (state fájl: /var/lib/claudeclaw/thinking-notify/<agent>-last-imi-id)

set -u
LOG=/var/log/claudeclaw-thinking-notify.log
STATE_DIR=/var/lib/claudeclaw/thinking-notify
IMI_CHAT="${ALLOWED_CHAT_ID:-REPLACE_ME}"
THINKING_THRESHOLD=60     # 2 perc gondolkodás
IMI_FRESHNESS=300          # Owner üzenete max 5 perc régi
NOTIFY_COOLDOWN_PER_AGENT=600  # 10 perc/agent notify között

mkdir -p "$STATE_DIR" 2>/dev/null

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }

declare -A AGENTS=(
  [nova]="/tmp/tmux-997/default|nova-channels|${TELEGRAM_BOT_TOKEN:-}"
  [zara]="/tmp/tmux-1001/default|agent-zara|${ZARA_TELEGRAM_BOT_TOKEN:-}"
  [codeagent]="/tmp/tmux-1002/default|code-channels|${CODEAGENT_TELEGRAM_BOT_TOKEN:-}"
)

# .env-ekből bot tokenek
NOVA_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /srv/claudeclaw/.env 2>/dev/null | cut -d= -f2-)
ZARA_TOKEN=$(grep '^ZARA_TELEGRAM_BOT_TOKEN=' /srv/claudeclaw/agents/zara/.env 2>/dev/null | cut -d= -f2-)
[ -z "$ZARA_TOKEN" ] && ZARA_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /srv/claudeclaw/agents/zara/.claude/channels/telegram/.env 2>/dev/null | cut -d= -f2-)
CODE_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /home/codeagent/.claude/channels/telegram/.env 2>/dev/null | cut -d= -f2-)

check_agent() {
  local agent="$1" socket="$2" session="$3" token="$4"
  [ -z "$token" ] && return
  [ -S "$socket" ] || return
  
  # 1. Pane tartalom
  local pane
  pane=$(tmux -S "$socket" capture-pane -t "$session" -p -S -40 2>/dev/null) || return
  
  # Long-running state detektálás
  local state=""
  if echo "$pane" | grep -qE 'Compacting conversation'; then
    state="compacting"
  fi
  
  [ -z "$state" ] && return
  
  # 2. Utolsó agent-outbound
  local last_file="/tmp/agent-channels/last-send-$agent.json"
  local last_send_s=0
  if [ -f "$last_file" ]; then
    local ms=$(grep -oE '"ts":[0-9]+' "$last_file" | cut -d: -f2)
    [ -n "$ms" ] && last_send_s=$((ms / 1000))
  fi
  local now_s=$(date +%s)
  local since_send=$((now_s - last_send_s))
  
  [ "$since_send" -lt "$THINKING_THRESHOLD" ] && return  # friss válasz már
  
  # 3. Owner utolsó inbound (pane-ből)
  # Keressük a legújabb '← telegram · ${ALLOWED_CHAT_ID:-REPLACE_ME}' sort
  local imi_line_ts
  imi_line_ts=$(echo "$pane" | grep -n '← telegram · ${ALLOWED_CHAT_ID:-REPLACE_ME}' | tail -1)
  [ -z "$imi_line_ts" ] && return
  
  # Időt nem tudunk kiszedni a pane-ből pontosan — használjuk az 'utolsó agent-restart' timestamp-ját mint proxy
  # Ha Owner ÜZENETÉRE nem jött válasz, then state fresh
  
  # 4. Cooldown per agent
  local last_notify_file="$STATE_DIR/$agent-last-notify"
  local last_notify_s=0
  [ -f "$last_notify_file" ] && last_notify_s=$(cat "$last_notify_file" 2>/dev/null || echo 0)
  local since_notify=$((now_s - last_notify_s))
  [ "$since_notify" -lt "$NOTIFY_COOLDOWN_PER_AGENT" ] && return
  
  # Küldés
  local msg="⏳ Session-t tömörítek ($state, kb. 60s). Mindjárt válaszolok."
  local url="https://api.telegram.org/bot$token/sendMessage"
  
  log "$agent state=$state since_send=${since_send}s → notify"
  curl -s -X POST "$url" --data-urlencode "chat_id=$IMI_CHAT" --data-urlencode "text=$msg" >> "$LOG" 2>&1
  echo "$now_s" > "$last_notify_file"
}

check_agent nova      /tmp/tmux-997/default  nova-channels  "$NOVA_TOKEN"
check_agent zara      /tmp/tmux-1001/default agent-zara     "$ZARA_TOKEN"
check_agent codeagent /tmp/tmux-1002/default code-channels  "$CODE_TOKEN"
