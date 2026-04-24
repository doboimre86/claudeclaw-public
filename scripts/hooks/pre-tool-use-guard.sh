#!/bin/bash
# PreToolUse hook: block dangerous commands
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Block dangerous patterns
for pattern in "rm -rf /" "DROP TABLE" "DROP DATABASE" "mkfs." "> /dev/sda" "chmod -R 777 /" "dd if=/dev/zero" ":(){ :|:&" "docker rm -f" "docker system prune -a"; do
  if echo "$TOOL_INPUT" | grep -qi "$pattern"; then
    echo "{\"decision\":\"block\",\"reason\":\"Veszelyes parancs blokkolva: $pattern\"}"
    exit 0
  fi
done
exit 0
