#!/bin/bash
# Plugin outbound watchdog — 2 percenként ellenőrzi hogy a 3 agent telegram plugin-je
# tud-e outbound-ot küldeni. Ha NEM (plugin akadt), restart.
#
# Kritérium agent-enként:
#   1. last-send-<agent>.json fiatal? (<5 perc) → OK
#   2. Ha >5 perc régi, de a tmux pane tartalmazza 'Called plugin:telegram' az elmúlt 5 percben → PLUGIN AKADT → restart
#   3. Ha a patch-marker hiányzik a plugin-server.ts-ben → reapply + restart
#
# Plus ellenőrzi a patch idempotens jelenlétét (újra-patchel ha frissült a plugin).

set -u
LOG=/var/log/claudeclaw-plugin-watchdog.log
STATE_DIR=/var/lib/claudeclaw/plugin-watchdog
ALERT_COOLDOWN=7200  # 2 ora (V3 2026-04-19 stabilitas)
NOTIFY=/srv/claudeclaw/scripts/notify.sh
IMI_CHAT="${ALLOWED_CHAT_ID:-REPLACE_ME}"
STALE_SECONDS=1800  # 30 perc (V3 2026-04-19 stabilitas)
PATCH_MARKER="CLAUDE_CODE_RESILIENCE_PATCH_V1"

mkdir -p "$STATE_DIR" 2>/dev/null

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
alert() {
  local key="$1" msg="$2"
  local mark="$STATE_DIR/alert-$key"
  local now=$(date +%s)
  if [ -f "$mark" ]; then
    local last=$(cat "$mark" 2>/dev/null || echo 0)
    [ $((now - last)) -lt $ALERT_COOLDOWN ] && return
  fi
  echo "$now" > "$mark"
  log "ALERT: $msg"
  [ -x "$NOTIFY" ] && "$NOTIFY" "$IMI_CHAT" "⚠️ Plugin watchdog: $msg" 2>/dev/null || true
}

# Specialis OAuth 401 alert — szepen formazott, lepesrol lepesre
alert_oauth() {
  local agent="$1" service="$2"
  local key="oauth-401-$agent"
  local mark="$STATE_DIR/alert-$key"
  local now=$(date +%s)
  if [ -f "$mark" ]; then
    local last=$(cat "$mark" 2>/dev/null || echo 0)
    [ $((now - last)) -lt $ALERT_COOLDOWN ] && return
  fi
  echo "$now" > "$mark"
  log "ALERT: [$agent] OAuth 401 — szep notify kikuldve"

  local title="$agent Claude OAuth token lejart"
  local body="A $agent agent Claude session 401 Unauthorized hibat kap minden keresre. Restart NEM javitja, bongeszo-auth szukseges Claude Max fiokkal. Kovesd a lepeseket sorban, figyelj a promptra melyik shellben vagy."
  local tech="1 lepes (root shell root@ai:~#): sudo -u $agent -i
2 lepes ($agent shell $agent@ai:~$): claude /login
3 lepes bongeszo: Claude Max fiokkal auth, varj Login successful uzenetre
4 lepes kilepes Claude CLI-bol: Ctrl-D vagy /exit parancs
5 lepes kilepes $agent shellbol: exit  (visszakerulsz root shellbe)
6 lepes (root shell root@ai:~#): systemctl restart $service
Fontos: $agent user nem sudoer, restart CSAK root alol megy
Ellenorzes: kuldj $agent-nak Telegram uzenetet, kell valaszolnia"

  if [ -x /srv/claudeclaw/scripts/notify.sh ]; then
    /srv/claudeclaw/scripts/notify.sh error "$title" "$body" "$tech" 2>/dev/null || true
  fi
}

# 3 agent
declare -A AGENTS=(
  [nova]="/home/nova|claudeclaw-channels"
  [zara]="/home/zara|claudeclaw-zara"
  [codeagent]="/home/codeagent|claude-code-channels"
)

for agent in "${!AGENTS[@]}"; do
  IFS='|' read -r home service <<< "${AGENTS[$agent]}"
  
  # 1) Patch-marker ellenőrzés — ha hiányzik, applikálja újra
  SERVER=$(find "$home/.claude/plugins/cache/claude-plugins-official/telegram" -maxdepth 2 -name 'server.ts' 2>/dev/null | sort -V | tail -1)
  if [ -n "$SERVER" ] && ! grep -q "$PATCH_MARKER" "$SERVER" 2>/dev/null; then
    log "[$agent] patch marker hiányzik — újra-patchelés"
    /srv/claudeclaw/scripts/patch-telegram-plugin.sh "$home" "$agent" >> "$LOG" 2>&1
    systemctl restart "$service" 2>/dev/null
    alert "patch-reapplied-$agent" "$agent plugin patch újra-applikálva (frissítés után) és service restart"
    continue
  fi
  
  # 2) Outbound-akadás ellenőrzés
  LAST_FILE="/tmp/agent-channels/last-send-$agent.json"
  
  # Service uptime ellenorzes — ha most indult, nem ertekelunk (V2 fix 2026-04-19)
  svc_start=$(systemctl show -p ActiveEnterTimestamp "$service" --value 2>/dev/null | xargs -I{} date -d "{}" +%s 2>/dev/null)
  if [ -n "$svc_start" ] && [ "$svc_start" -gt 0 ]; then
    svc_uptime=$(( $(date +%s) - svc_start ))
    if [ "$svc_uptime" -lt "$STALE_SECONDS" ]; then
      # Service friss indulas, meg nincs ertelme ertekelni
      continue
    fi
  fi

  # OAuth 401 detekcio — pane-based, independent from last-send (V4 fix 2026-04-20)
  # Ha a Claude CLI 401-gyel elhasal, restart nem segit, manualis login kell
  TMUX_SOCKET_EARLY="/tmp/tmux-$(id -u "$agent" 2>/dev/null)/default"
  if [ -S "$TMUX_SOCKET_EARLY" ]; then
    case $agent in
      nova)      PANE_EARLY="nova-channels" ;;
      zara)      PANE_EARLY="agent-zara" ;;
      codeagent) PANE_EARLY="code-channels" ;;
    esac
    # Csak a lathato pane-t nezzuk (nincs -S history), es csak Claude CLI-specifikus mintat
    # (nem az altalanos "401" szo, mert WP REST API is dob 401-et ami NEM OAuth kerdese)
    PANE_401=$(tmux -S "$TMUX_SOCKET_EARLY" capture-pane -t "$PANE_EARLY" -p 2>/dev/null)
    if echo "$PANE_401" | grep -qE "Please run /login|authentication_error.*Invalid authentication credentials"; then
      log "[$agent] OAuth 401 detektalt pane-ben — NINCS restart, manualis claude /login szukseges"
      alert_oauth "$agent" "$service"
      continue
    fi
  fi

  
  if [ ! -f "$LAST_FILE" ]; then
    # Ha a fájl nincs, lehet hogy az agent soha nem küldött — ez NEM hiba
    continue
  fi
  
  # Utolsó send timestamp ezredmásodpercben
  last_ms=$(grep -oE '"ts":[0-9]+' "$LAST_FILE" 2>/dev/null | cut -d: -f2)
  [ -z "$last_ms" ] && continue
  last_s=$((last_ms / 1000))
  now_s=$(date +%s)
  age_s=$((now_s - last_s))
  
  # method ellenorzes — sendChatAction (typing indikator) nem szamit eletjelnek (V2 fix 2026-04-19)
  last_method=$(grep -oE '"method":"[^"]*"' "$LAST_FILE" 2>/dev/null | head -1 | cut -d'"' -f4)
  
  if [ "$age_s" -lt "$STALE_SECONDS" ] && [ "$last_method" != "sendChatAction" ]; then
    # Friss valos send — OK
    continue
  fi
  
  # Régi send — nézzük van-e ÚJ 'Called plugin:telegram' a pane-ben az elmúlt 5 percben
  # Ez azt jelzi, hogy a Claude próbál küldeni DE a plugin nem hajtja végre
  
  TMUX_SOCKET="/tmp/tmux-$(id -u $(stat -c '%U' $home))/default"
  [ -S "$TMUX_SOCKET" ] || continue
  
  case $agent in
    nova)      PANE="nova-channels" ;;
    zara)      PANE="agent-zara" ;;
    codeagent) PANE="code-channels" ;;
  esac
  
  # CSAK a LÁTHATÓ pane-t (nincs -S scrollback) — régi 'Called plugin:telegram' sorok
  # scrollback-ben fals pozitívat okoztak éjszakai idle után.
  PANE_CONTENT=$(tmux -S "$TMUX_SOCKET" capture-pane -t "$PANE" -p 2>/dev/null)
  if echo "$PANE_CONTENT" | grep -vE '\(ctrl\+o to expand\)' | grep -q 'Called plugin:telegram'; then
    log "[$agent] outbound stale (${age_s}s) ÉS 'Called plugin:telegram' látható — PLUGIN AKADT, restart"
    systemctl restart "$service" 2>/dev/null
    alert "plugin-stuck-$agent" "$agent telegram plugin outbound akadt (${age_s}s csend), service restart"
  fi
done
