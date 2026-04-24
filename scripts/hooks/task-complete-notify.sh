#!/bin/bash
# Stop hook: notify on Telegram when long task completes
STATEFILE="/tmp/claude-task-start-$(whoami).txt"

# If no start time recorded, record it and exit
if [ ! -f "$STATEFILE" ]; then
  date +%s > "$STATEFILE"
  exit 0
fi

START=$(cat "$STATEFILE" 2>/dev/null)
NOW=$(date +%s)
ELAPSED=$((NOW - START))

# Reset timer
date +%s > "$STATEFILE"

# Only notify if task took >3 minutes
if [ "$ELAPSED" -gt 180 ]; then
  MINUTES=$((ELAPSED / 60))
  MSG="Feladat kesz! (${MINUTES} perc)"
  if [ -x /srv/claudeclaw/scripts/notify.sh ]; then
    /srv/claudeclaw/scripts/notify.sh "$MSG" 2>/dev/null
  fi
fi
exit 0
