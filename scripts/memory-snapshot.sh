#!/bin/bash
# Minden 10 percben egy memoria-pillanatkepet ment a trendhez
# Cron: */10 * * * *
set -u
TREND_LOG=/var/log/claudeclaw-memory-trend.log

for svc in claudeclaw-channels claudeclaw-zara claude-code-channels; do
  mem=$(cat /sys/fs/cgroup/system.slice/${svc}.service/memory.current 2>/dev/null)
  if [ -n "$mem" ] && [ "$mem" != "0" ]; then
    memMb=$((mem / 1024 / 1024))
    echo "$(date +%s) $(date +%FT%T) $svc $memMb" >> "$TREND_LOG"
  fi
done

# Tartjuk a fajl meretet kordaban — max 7 nap (tizpercenkent 3 sor = 3024 sor / nap)
# 7 nap = ~21000 sor. Tail -30000 mindig tiszta.
if [ $(wc -l < "$TREND_LOG" 2>/dev/null) -gt 30000 ]; then
  tail -25000 "$TREND_LOG" > "$TREND_LOG.tmp" && mv "$TREND_LOG.tmp" "$TREND_LOG"
fi

exit 0
