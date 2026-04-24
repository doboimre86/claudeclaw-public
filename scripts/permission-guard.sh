#!/bin/bash
# Permission guard — kritikus fajlok tulajdon + mode + access.json integritas drift detekcio + javitas.
# Cron: */5 * * * * /srv/claudeclaw/scripts/permission-guard.sh
#
# Idempotens. Rate-limit Telegram alert: 30 perc ugyanarra a hibakeszletre.
# Logol: /var/log/claudeclaw-permission-guard.log

set -u
LOG=/var/log/claudeclaw-permission-guard.log
STATE_DIR=/var/lib/claudeclaw/permission-guard
ALERT_COOLDOWN=1800
NOTIFY=/srv/claudeclaw/scripts/notify.sh
IMI_CHAT_ID="${ALLOWED_CHAT_ID:-REPLACE_ME}"

mkdir -p "$STATE_DIR" 2>/dev/null

RULES=(
  "/srv/claudeclaw/.mcp.json|zara|claudeclaw|640"
  "/srv/claudeclaw/.env|zara|zara|600"
  "/srv/claudeclaw/agents/zara/.mcp.json|zara|zara|600"
  "/home/codeagent/.mcp.json|codeagent|codeagent|600"
  "/home/nova/.claude/channels/telegram/access.json|nova|nova|600"
  "/srv/claudeclaw/agents/zara/.claude/channels/telegram/access.json|zara|zara|600"
  "/home/codeagent/.claude/channels/telegram/access.json|codeagent|codeagent|600"
  "/etc/sudoers.d/codeagent|root|root|440"
  "/etc/sudoers.d/nova|root|root|440"
  "/root/.claude/scheduled-tasks|root|claudeclaw|2775"
  "/srv/crm-migration/dumps|root|root|750"
  "/srv/claudeclaw/scripts/patch-telegram-plugin.sh|root|root|755"
  "/srv/claudeclaw/scripts/plugin-outbound-watchdog.sh|root|root|755"
  "/srv/claudeclaw/scripts/agent-thinking-notify.sh|root|root|755"
  "/var/lib/claudeclaw/tg-buttons|root|claudeclaw|775"
  "/srv/claudeclaw/.playwright-mcp|nova|claudeclaw|775"
)

ACCESS_JSONS=(
  "/home/nova/.claude/channels/telegram/access.json|nova|nova"
  "/srv/claudeclaw/agents/zara/.claude/channels/telegram/access.json|zara|zara"
  "/home/codeagent/.claude/channels/telegram/access.json|codeagent|codeagent"
)

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

FIXES=()

# --- 1. Tulajdon + mode drift ---
for rule in "${RULES[@]}"; do
  IFS="|" read -r path wanted_user wanted_group wanted_mode <<< "$rule"
  [ -e "$path" ] || continue

  cur_user=$(stat -c "%U" "$path" 2>/dev/null)
  cur_group=$(stat -c "%G" "$path" 2>/dev/null)
  cur_mode=$(stat -c "%a" "$path" 2>/dev/null)

  changed=""
  if [ "$cur_user" != "$wanted_user" ] || [ "$cur_group" != "$wanted_group" ]; then
    chown "$wanted_user:$wanted_group" "$path" 2>/dev/null && \
      changed="$changed owner:$cur_user:$cur_group→$wanted_user:$wanted_group"
  fi
  if [ "$cur_mode" != "$wanted_mode" ]; then
    chmod "$wanted_mode" "$path" 2>/dev/null && \
      changed="$changed mode:$cur_mode→$wanted_mode"
  fi
  if [ -n "$changed" ]; then
    log "FIX $path$changed"
    FIXES+=("$path$changed")
  fi
done

# --- 1.5 Nova skills directory: root:claudeclaw 775/664 ---
for path in /srv/claudeclaw/.claude/skills/; do
  find "$path" -type d -not -perm 775 2>/dev/null | while read d; do
    chmod 775 "$d" && log "FIX $d mode:→775" && FIXES+=("$d dir:→775")
  done
  find "$path" -type f -not -perm 664 2>/dev/null | while read f; do
    chmod 664 "$f" && log "FIX $f mode:→664" && FIXES+=("$f file:→664")
  done
  find "$path" \( -not -user root -o -not -group claudeclaw \) 2>/dev/null | while read x; do
    chown root:claudeclaw "$x" && log "FIX $x owner:→root:claudeclaw" && FIXES+=("$x owner:→root:claudeclaw")
  done
done

# --- 1.6 Chrome symlink (Playwright MCP elvarja /opt/google/chrome/chrome-t) ---
CHROME_TARGET=/home/nova/.cache/ms-playwright/mcp-chrome-d83fc9f/chrome-linux64/chrome
CHROME_LINK=/opt/google/chrome/chrome
if [ ! -e "$CHROME_LINK" ] && [ -e "$CHROME_TARGET" ]; then
  mkdir -p /opt/google/chrome
  ln -sf "$CHROME_TARGET" "$CHROME_LINK" 2>/dev/null && \
    log "FIX Chrome symlink létrehozva: $CHROME_LINK → $CHROME_TARGET" && \
    FIXES+=("Chrome symlink helyreállítva: /opt/google/chrome/chrome")
fi

# --- 2. Scripts executable bit ---
for script in /srv/claudeclaw/scripts/*.sh; do
  [ -e "$script" ] || continue
  if [ ! -x "$script" ]; then
    chmod +x "$script" 2>/dev/null && \
      log "FIX $script mode:+x (elveszett executable bit)" && \
      FIXES+=("$script mode:+x")
  fi
done

# --- 3. access.json integritas (Telegram allowlist) ---
# Elvart canonical szerkezet (kanonikus JSON):
# {"dmPolicy":"allowlist","allowFrom":["${ALLOWED_CHAT_ID:-REPLACE_ME}"],"groups":{},"pending":{}}
CANONICAL_ACCESS="{\"dmPolicy\":\"allowlist\",\"allowFrom\":[\"${IMI_CHAT_ID}\"],\"groups\":{},\"pending\":{}}"

for row in "${ACCESS_JSONS[@]}"; do
  IFS="|" read -r path owner group <<< "$row"
  [ -e "$path" ] || continue

  # JSON ervenyes?
  if ! jq empty "$path" >/dev/null 2>&1; then
    log "ACCESS-CORRUPT $path — JSON invalid, restore canonical"
    cp "$path" "$path.bak.$(date +%s)" 2>/dev/null
    echo "$CANONICAL_ACCESS" | jq "." > "$path" 2>/dev/null
    chown "$owner:$group" "$path"
    chmod 600 "$path"
    FIXES+=("$path access.json JSON INVALID → visszaallitva canonical-ra (backup mentve)")
    continue
  fi

  # Mezok ellenorzese
  dm=$(jq -r ".dmPolicy // empty" "$path" 2>/dev/null)
  allow=$(jq -r ".allowFrom | tostring" "$path" 2>/dev/null)
  groups_empty=$(jq -r "if (.groups | length == 0) then \"ok\" else \"not_empty\" end" "$path" 2>/dev/null)
  pending_susp=$(jq -r "if (.pending | length == 0) then \"ok\" else (.pending | keys | join(\",\")) end" "$path" 2>/dev/null)

  drift=""
  if [ "$dm" != "allowlist" ]; then
    drift="$drift dmPolicy=$dm"
  fi
  if [ "$allow" != "[\"${IMI_CHAT_ID}\"]" ]; then
    drift="$drift allowFrom=$allow"
  fi
  if [ "$groups_empty" != "ok" ]; then
    drift="$drift groups_not_empty"
  fi

  # Pending: csak szolunk, nem javitjuk automatikusan (lehet hogy user szeretne paritni)
  if [ "$pending_susp" != "ok" ]; then
    log "ACCESS-PENDING $path — gyanus pending pairing: $pending_susp"
    FIXES+=("$path access.json PENDING PAIRING: $pending_susp (NEM automata javitas)")
  fi

  if [ -n "$drift" ]; then
    log "ACCESS-DRIFT $path —$drift → restore canonical"
    cp "$path" "$path.bak.$(date +%s)" 2>/dev/null
    echo "$CANONICAL_ACCESS" | jq "." > "$path"
    chown "$owner:$group" "$path"
    chmod 600 "$path"
    FIXES+=("$path access.json DRIFT:$drift → canonical (backup mentve)")
  fi
done

# --- Telegram alert ---
source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null || true

if [ ${#FIXES[@]} -gt 0 ]; then
  joinkey=$(printf "%s\n" "${FIXES[@]}" | sort | md5sum | awk "{print \$1}")
  if alert_allowed "$joinkey"; then
    body="Valami módosulást észleltem a kritikus fájlokon, helyreállítottam canonical állapotra."
    tech=""
    for f in "${FIXES[@]}"; do
      tech="$tech${tech:+\n}• $f"
    done
    tech="$tech${tech:+\n}Host: $(hostname)"
    tg_notify warning "Permission drift javítva" "$body" "$tech" > /dev/null 2>&1 || log "NOTIFY FAILED"
  else
    log "ALERT SKIPPED cooldown key=$joinkey fixek=${#FIXES[@]}"
  fi
fi

exit 0
