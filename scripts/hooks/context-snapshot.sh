#!/bin/bash
# PreCompact hook: Save context snapshot before context compression
CONTEXT_FILE="/srv/claudeclaw/store/CONTEXT.md"
API="http://localhost:3420/api"
TOKEN="${DASHBOARD_TOKEN:-cfb71091a2102aca1ada2c0f7b5bc24b82459cc030b7439463aaec1e750d2628}"
AUTH="Authorization: Bearer $TOKEN"

HOT=$(curl -s -H "$AUTH" "$API/memories?agent=nova&tier=hot&limit=20" 2>/dev/null | python3 -c "
import json,sys
try:
  for m in json.load(sys.stdin)[:15]: print('- '+m.get('content','')[:200])
except: pass
" 2>/dev/null)

DAILY=$(curl -s -H "$AUTH" "$API/daily-log?agent=nova&date=$(date +%Y-%m-%d)" 2>/dev/null | python3 -c "
import json,sys
try:
  for d in json.load(sys.stdin)[-5:]: print(d.get('content','')[:300])
except: pass
" 2>/dev/null)

KANBAN=$(curl -s -H "$AUTH" "$API/kanban?status=in_progress,waiting,planned&limit=10" 2>/dev/null | python3 -c "
import json,sys
try:
  for k in json.load(sys.stdin)[:10]: print('- ['+k.get('status','')+'] '+k.get('title',''))
except: pass
" 2>/dev/null)

cat > "$CONTEXT_FILE" << CTXEOF
# Nova Aktiv Kontextus
Frissitve: $(date '+%Y-%m-%d %H:%M')

## Hot memoria
$HOT

## Mai naplo
$DAILY

## Kanban
$KANBAN
CTXEOF
