#!/bin/bash
# PostToolUse hook: auto-format after Write/Edit
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE_PATH" 2>/dev/null
    elif [ -f /srv/claudeclaw/node_modules/.bin/prettier ]; then
      /srv/claudeclaw/node_modules/.bin/prettier --write "$FILE_PATH" 2>/dev/null
    fi
    ;;
esac
exit 0
