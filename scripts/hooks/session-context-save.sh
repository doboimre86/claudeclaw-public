#!/bin/bash
# Stop hook: Save active conversation context to hot memory
# This ensures context survives session restarts

# Get the last conversation summary from Claude output
INPUT=$(cat 2>/dev/null)
STOP_REASON=$(echo "$INPUT" | jq -r ".stop_reason // empty" 2>/dev/null)

# Only save on meaningful stops (not on every tiny turn)
# The hook receives the assistant message content
CONTENT=$(echo "$INPUT" | jq -r ".assistant_message // empty" 2>/dev/null)
[ -z "$CONTENT" ] && exit 0

# Skip if content is too short (probably just an acknowledgment)
[ ${#CONTENT} -lt 100 ] && exit 0

# Extract key context: who we were talking about, what we were doing
SUMMARY=$(echo "$CONTENT" | head -c 500)

# Save to hot memory with session-context tag
curl -s -X POST "http://localhost:3420/api/memories" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"nova\",\"content\":\"[SESSION KONTEXTUS] $SUMMARY\",\"tier\":\"hot\",\"keywords\":\"session-context, aktiv-beszelgetes\"}" \
  >/dev/null 2>&1

exit 0
