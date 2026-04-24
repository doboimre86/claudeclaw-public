#!/bin/bash
# Napi osszefoglalo health report - Telegramra
# Cron: 0 8 * * *
set -u

source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null || true

REPORT=""

# SERVICES
REPORT="[SERVICE]"
for svc in claudeclaw-channels claudeclaw-zara claude-code-channels claudeclaw-dashboard; do
  state=$(systemctl is-active "$svc" 2>&1)
  since=$(systemctl show -p ActiveEnterTimestamp --value "$svc" 2>/dev/null | cut -d" " -f-2)
  [ "$state" = "active" ] && icon="OK" || icon="!!"
  REPORT="${REPORT}
${icon} ${svc}: ${state} (since ${since})"
done

# MEMORIA
REPORT="${REPORT}

[MEMORIA]"
for svc in claudeclaw-channels claudeclaw-zara claude-code-channels; do
  mem=$(systemctl show -p MemoryCurrent --value "$svc" 2>/dev/null)
  peak=$(systemctl show -p MemoryPeak --value "$svc" 2>/dev/null)
  if [ -n "$mem" ] && [ "$mem" != "[not set]" ] && [ "$mem" -gt 0 ] 2>/dev/null; then
    memMb=$((mem / 1024 / 1024))
    peakMb=$((peak / 1024 / 1024))
    REPORT="${REPORT}
${svc}: ${memMb} MB (peak ${peakMb})"
  fi
done

# OAUTH
REPORT="${REPORT}

[OAUTH LEJARAT]"
NOW_MS=$(date +%s%3N)
for u in nova zara codeagent; do
  f=/home/$u/.claude/.credentials.json
  [ ! -f $f ] && continue
  exp=$(jq -r ".claudeAiOauth.expiresAt // empty" $f 2>/dev/null)
  [ -z "$exp" ] && continue
  diff=$((exp - NOW_MS))
  hours=$((diff / 3600000))
  REPORT="${REPORT}
${u}: $(date -d @$((exp/1000)) +%H:%M) (~${hours}h)"
done

# GEMINI BOT
REPORT="${REPORT}

[GEMINI BOT]"
if docker exec gemini-terminal pgrep -f "bot.py" >/dev/null 2>&1; then
  REPORT="${REPORT}
OK bot.py: fut"
else
  REPORT="${REPORT}
!! bot.py: NEM FUT"
fi

# SESSION JSONL (csak >5 MB)
REPORT="${REPORT}

[SESSION JSONL]"
for p in /home/nova/.claude/projects/*/*.jsonl /home/zara/.claude/projects/*/*.jsonl /home/codeagent/.claude/projects/*/*.jsonl; do
  [ ! -f "$p" ] && continue
  size=$(stat -c%s "$p" 2>/dev/null)
  sizeMb=$((size / 1024 / 1024))
  if [ $sizeMb -ge 5 ]; then
    dir=$(basename $(dirname $p))
    [ $sizeMb -ge 30 ] && icon="!!" || icon="OK"
    REPORT="${REPORT}
${icon} ${dir}: ${sizeMb} MB"
  fi
done

# CRON AKTIVITAS
REPORT="${REPORT}

[CRON LOGOK]"
for log in /var/log/claudeclaw-agent-health.log /var/log/claudeclaw-permission-guard.log /var/log/claudeclaw-plugin-watchdog.log /var/log/claudeclaw-oauth-watchdog.log; do
  if [ -f "$log" ]; then
    age=$((($(date +%s) - $(stat -c%Y "$log")) / 60))
    REPORT="${REPORT}
$(basename $log | sed s/claudeclaw-//): ${age} perce"
  fi
done

# DISK
REPORT="${REPORT}

[DISK]"
REPORT="${REPORT}
$(df -h / /var /srv 2>/dev/null | tail -n +2 | awk "{print \$6\": \"\$5\" \"\$3\"/\"\$2}")"

# Kuld
tg_notify info "Napi health report" "Rendszer allapot osszefoglalo" "$REPORT" > /dev/null 2>&1 && echo "Report elkuldve"

exit 0
