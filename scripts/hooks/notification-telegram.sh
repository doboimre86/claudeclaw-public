#!/bin/bash
# Notification hook: forward to Telegram, but filter idle notifications
INPUT=$(cat 2>/dev/null)
MESSAGE=$(echo "$INPUT" | jq -r '.message // empty' 2>/dev/null)
TYPE=$(echo "$INPUT" | jq -r '.notificationType // empty' 2>/dev/null)

# Skip idle notifications
[ "$TYPE" = "idle_prompt" ] && exit 0
[ -z "$MESSAGE" ] && exit 0

if [ -x /srv/claudeclaw/scripts/notify.sh ]; then
  /srv/claudeclaw/scripts/notify.sh "$MESSAGE" 2>/dev/null
fi
exit 0
