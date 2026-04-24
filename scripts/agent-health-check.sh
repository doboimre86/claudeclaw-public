#!/bin/bash
# Agent health check + idegen chat_id monitor
# Cron: */10 * * * *
set -u
LOG=/var/log/claudeclaw-agent-health.log
STATE_DIR=/var/lib/claudeclaw/agent-health
ALERT_COOLDOWN=1800
NOTIFY=/srv/claudeclaw/scripts/notify.sh
IMI_CHAT_ID="${ALLOWED_CHAT_ID:-REPLACE_ME}"

mkdir -p "$STATE_DIR" 2>/dev/null

log() { echo "$(date "+%F %T") $*" >> "$LOG"; }

alert_allowed() {
  local key="$1"
  local stampfile="$STATE_DIR/alert-$(echo "$key" | tr "/" "_" | tr -d " ").stamp"
  if [ -f "$stampfile" ]; then
    local last=$(cat "$stampfile")
    local now=$(date +%s)
    [ $((now - last)) -lt $ALERT_COOLDOWN ] && return 1
  fi
  date +%s > "$stampfile"
  return 0
}

# Format: agent_key|user|service|tmux_uid|tmux_session|env_token_file
AGENTS=(
  "nova|nova|claudeclaw-channels|997|nova-channels|/home/nova/.claude/channels/telegram/.env"
  "zara|zara|claudeclaw-zara|1001|agent-zara|/home/zara/.claude/channels/telegram/.env"
  "code|codeagent|claude-code-channels|1002|code-channels|/home/codeagent/.claude/channels/telegram/.env"
)

PROBLEMS=()

for row in "${AGENTS[@]}"; do
  IFS="|" read -r key user service uid session envfile <<< "$row"

  # 1. service aktiv?
  state=$(systemctl is-active "$service" 2>&1)
  if [ "$state" != "active" ]; then
    PROBLEMS+=("${key}: systemd service $service = $state")
    continue
  fi

  # 2. tmux session el?
  if ! timeout 10 tmux -S "/tmp/tmux-$uid/default" has-session -t "$session" 2>/dev/null; then
    PROBLEMS+=("${key}: tmux session \"$session\" (uid $uid) nem fut")
    continue
  fi

  # 3. bot token 401-e?
  if [ -f "$envfile" ]; then
    token=$(grep "^TELEGRAM_BOT_TOKEN=" "$envfile" | cut -d= -f2-)
    if [ -n "$token" ]; then
      resp=$(curl -s -m 5 "https://api.telegram.org/bot${token}/getMe" 2>/dev/null)
      ok=$(echo "$resp" | grep -o "\"ok\":true")
      if [ -z "$ok" ]; then
        errcode=$(echo "$resp" | grep -o "\"error_code\":[0-9]*" | head -1)
        PROBLEMS+=("${key}: Telegram getMe bukott ($errcode)")
      fi
    fi
  fi

  # 4. cgroup memory hasznalat >90%
  memfile="/sys/fs/cgroup/system.slice/${service}.service/memory.current"
  maxfile="/sys/fs/cgroup/system.slice/${service}.service/memory.max"
  if [ -r "$memfile" ] && [ -r "$maxfile" ]; then
    cur=$(cat "$memfile")
    max=$(cat "$maxfile")
    if [ "$max" != "max" ] && [ "$max" -gt 0 ]; then
      pct=$((cur * 100 / max))
      if [ "$pct" -gt 80 ]; then
        PROBLEMS+=("${key}: memory ${pct}% (${cur}/${max} byte)")
      fi
    fi
  fi

  # 5. Idegen chat_id a tmux pane-ben
  # A telegram plugin ki­irja minden inbound uzenetet: "← telegram · CHAT_ID: szoveg"
  # Mi csak az ID-ket huzzuk ki, es ami nem Owner-e, az gyanus.
  seenfile="$STATE_DIR/seen-chatids-$key"
  touch "$seenfile"
  pane=$(sudo -u "$user" tmux -S "/tmp/tmux-$uid/default" capture-pane -t "$session" -p -S -500 2>/dev/null)
  if [ -n "$pane" ]; then
    ids=$(echo "$pane" | grep -oE "telegram[^0-9]+[0-9]{6,}:" | grep -oE "[0-9]{6,}" | sort -u)
    for id in $ids; do
      if [ "$id" != "$IMI_CHAT_ID" ]; then
        if ! grep -q "^$id$" "$seenfile" 2>/dev/null; then
          PROBLEMS+=("${key}: 🚨 IDEGEN chat_id üzent: $id — allowlist elutasít, de valaki próbálkozott. Ha ez te voltál másik accountról, hozzáadás: echo $id >> /home/${user}/.claude/channels/telegram/seen-whitelist (manualisan) vagy allowFrom-ba")
          echo "$id" >> "$seenfile"
        fi
      fi
    done
  fi
done

# 6. Session jsonl méret >50 MB = warning (auto-compact indokolt)
for f in /home/nova/.claude/projects/*/*.jsonl /home/zara/.claude/projects/*/*.jsonl /home/codeagent/.claude/projects/*/*.jsonl; do
  [ ! -f "$f" ] && continue
  size=$(stat -c%s "$f" 2>/dev/null)
  if [ -n "$size" ] && [ "$size" -gt 52428800 ]; then
    sizeMb=$((size / 1024 / 1024))
    owner=$(stat -c%U "$f" 2>/dev/null)
    PROBLEMS+=("${owner}: session jsonl $(basename $(dirname $f))/$(basename $f) = ${sizeMb} MB (>50 MB, auto-compact ajanlott)")
  fi
done

# --- Alert ---
source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null || true

if [ ${#PROBLEMS[@]} -gt 0 ]; then
  joinkey=$(printf "%s\n" "${PROBLEMS[@]}" | sort | md5sum | awk "{print \$1}")

  # Escalation számláló: ha ugyanaz a joinkey 3x egymás után (30 perc), emergency
  escfile="$STATE_DIR/escalation-${joinkey}.count"
  esccount=0
  [ -f "$escfile" ] && esccount=$(cat "$escfile" 2>/dev/null)
  esccount=$((esccount + 1))
  echo "$esccount" > "$escfile"

  # Régi escalation file-ok (más problémáról) törlése, hogy ne gyűljön
  find "$STATE_DIR" -name "escalation-*.count" ! -name "escalation-${joinkey}.count" -mmin +30 -delete 2>/dev/null

  if [ "$esccount" -ge 3 ]; then
    # EMERGENCY — 3+ ciklus (30+ perc) óta ugyanaz, cooldown override
    body="⚠️ EMERGENCY: A probléma ${esccount} egymást követő ellenőrzés óta (≥30 perce) fennáll és nem javul. Azonnali beavatkozás kell!"
    tech=""
    for prob in "${PROBLEMS[@]}"; do
      tech="$tech${tech:+\n}• $prob"
    done
    tech="$tech${tech:+\n}Escalation: ${esccount}. ciklus\nHost: $(hostname)"
    tg_notify error "🚨 EMERGENCY health alert" "$body" "$tech" > /dev/null 2>&1 && log "EMERGENCY elkuldve: esc=$esccount key=$joinkey" || log "EMERGENCY NOTIFY FAILED"
    # Reset, hogy ne spam-eljen minden ciklusban, hanem újabb 3 ciklus után lőjön
    echo 0 > "$escfile"
  elif alert_allowed "$joinkey"; then
    body="A rendszeres agent health ellenőrzés talált valamit ami figyelmet érdemel. Részletek lent."
    tech=""
    for prob in "${PROBLEMS[@]}"; do
      tech="$tech${tech:+\n}• $prob"
    done
    tech="$tech${tech:+\n}Host: $(hostname)"
    tg_notify error "Agent health riasztás" "$body" "$tech" > /dev/null 2>&1 && log "ALERT elkuldve: ${#PROBLEMS[@]} problema" || log "NOTIFY FAILED"
  else
    log "ALERT SKIPPED cooldown key=$joinkey esc=$esccount problemak=${#PROBLEMS[@]}"
  fi
  for prob in "${PROBLEMS[@]}"; do log "PROBLEM $prob"; done
else
  # Tiszta futás — reseteljük az escalation és alert számlálókat
  find "$STATE_DIR" -name "alert-*.stamp" -mmin +60 -delete 2>/dev/null
  find "$STATE_DIR" -name "escalation-*.count" -delete 2>/dev/null
fi

exit 0
