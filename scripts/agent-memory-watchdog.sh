#!/bin/bash
# Memoria-aware soft watchdog — ha a cgroup memory > 2.5 GB, preventiv restart
# Cron: */3 * * * *
# A ma reggeli incidens (memory 2.2 GB → throttling hang) alap: ha memoria kozelit a MemoryHigh-hoz, restart mielott teljesen megall.
set -u
LOG=/var/log/claudeclaw-memory-watchdog.log
STATE_DIR=/var/lib/claudeclaw/memory-watchdog
THRESHOLD_MB=2500  # 2.5 GB — MemoryHigh alatt maradunk

mkdir -p "$STATE_DIR" 2>/dev/null
log() { echo "$(date "+%F %T") $*" >> "$LOG"; }

source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null || true

AGENTS=(
  "nova|claudeclaw-channels"
  "zara|claudeclaw-zara"
  "codeagent|claude-code-channels"
)

for row in "${AGENTS[@]}"; do
  IFS="|" read -r key service <<< "$row"

  memfile="/sys/fs/cgroup/system.slice/${service}.service/memory.current"
  [ ! -r "$memfile" ] && continue

  mem=$(cat "$memfile" 2>/dev/null)
  [ -z "$mem" ] || [ "$mem" = "0" ] && continue

  memMb=$((mem / 1024 / 1024))

  if [ "$memMb" -gt "$THRESHOLD_MB" ]; then
    # Cooldown: max 1 auto-restart / 30 perc / agent
    stampfile="$STATE_DIR/restart-${key}.stamp"
    if [ -f "$stampfile" ]; then
      last=$(cat "$stampfile")
      now=$(date +%s)
      if [ $((now - last)) -lt 1800 ]; then
        log "$key: memoria ${memMb}MB > threshold, DE cooldown-ban (30p)"
        continue
      fi
    fi
    date +%s > "$stampfile"

    log "$key: PREVENTIV RESTART — memoria ${memMb}MB > ${THRESHOLD_MB}MB"
    tg_notify warning "Auto-restart (memory): $key" "$key memoriaja ${memMb}MB, prevenciokent restart. A --continue folytatja a session-t." "Service: $service" > /dev/null 2>&1

    systemctl restart "$service" && log "$key: restart OK" || log "$key: RESTART FAILED"
  fi
done

exit 0
