#!/bin/bash
# OAuth token lejárat figyelés + proaktív force-refresh
# Cron: */15 * * * *
#
# Logika (2026-04-24 racefix):
# - <30p lejáratig VAGY már lejárt → force-refresh próba (claude --print "ok")
#   - Polling max 90s-ig a credentials.json mtime változására
#   - Ha az mtime új ÉS expiresAt nőtt → SIKER, csendes
#   - Ha 90s alatt nem változott VAGY változott de csökkent → FAIL
# - Riadó (Telegram) CSAK akkor küldődik, ha:
#   a) a token MÁR LEJÁRT (diff < 0) ÉS force-refresh sikertelen
#   b) >60 perc - nincs riadó (még bőven van idő)
#   c) pre-warning riadókat (15-60p) TÖRÖLTÜK, mert csak zajt okoznak
set -u
STATE_DIR=/var/lib/claudeclaw/oauth-watchdog
LOG=/var/log/claudeclaw-oauth-watchdog.log
COOLDOWN=1800
CLAUDE=/root/.nova-claude/.local/bin/claude
REFRESH_WAIT_SEC=90     # max várakozás force-refresh után

mkdir -p "$STATE_DIR" 2>/dev/null
log() { echo "$(date "+%F %T") $*" >> "$LOG"; }

alert_allowed() {
  local key="$1"
  local stampfile="$STATE_DIR/alert-${key}.stamp"
  if [ -f "$stampfile" ]; then
    local last=$(cat "$stampfile")
    local now=$(date +%s)
    [ $((now - last)) -lt $COOLDOWN ] && return 1
  fi
  date +%s > "$stampfile"
  return 0
}

# Force-refresh: indít egy claude --print "ok"-ot háttérben, majd polling-olja
# a credentials.json-t, hogy mikor íródott ki új (nagyobb expiresAt) token.
# Return: 0 ha sikerült, 1 ha nem
force_refresh() {
  local user="$1"
  local file="$2"
  local old_expires="$3"
  local home="/home/${user}"

  # mtime a force-refresh ELŐTT
  local old_mtime
  old_mtime=$(sudo stat -c %Y "$file" 2>/dev/null)

  # Háttérben indítjuk (nem várunk rá blokkolóan), hadd refresh-eljen
  sudo -u "$user" HOME="$home" PATH=/root/.nova-claude/.local/bin:/usr/bin:/bin \
    timeout $REFRESH_WAIT_SEC \
    "$CLAUDE" --print --dangerously-skip-permissions "ok" \
    >/dev/null 2>&1 &
  local pid=$!

  # Polling: max REFRESH_WAIT_SEC-ig várunk, 2 másodpercenként check
  local elapsed=0
  while [ $elapsed -lt $REFRESH_WAIT_SEC ]; do
    sleep 2
    elapsed=$((elapsed + 2))
    local new_mtime
    new_mtime=$(sudo stat -c %Y "$file" 2>/dev/null)
    if [ -n "$new_mtime" ] && [ "$new_mtime" != "$old_mtime" ]; then
      # A fájl megváltozott — ellenőrizzük hogy tényleg újabb token-e
      local new_expires
      new_expires=$(sudo jq -r ".claudeAiOauth.expiresAt // empty" "$file" 2>/dev/null)
      if [ -n "$new_expires" ] && [ "$new_expires" -gt "$old_expires" ]; then
        # Sikerült — takarítsuk a háttér-processzt, siker
        kill $pid 2>/dev/null
        wait $pid 2>/dev/null
        return 0
      fi
    fi
  done

  # 90s lejárt, nem változott értelmesen
  kill $pid 2>/dev/null
  wait $pid 2>/dev/null
  return 1
}

source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null || true

AGENTS=(
  "nova|/home/nova/.claude/.credentials.json"
  "zara|/home/zara/.claude/.credentials.json"
  "codeagent|/home/codeagent/.claude/.credentials.json"
)

NOW_MS=$(date +%s%3N)
REFRESH_THRESHOLD_MS=$((30 * 60 * 1000))

for row in "${AGENTS[@]}"; do
  IFS="|" read -r key file <<< "$row"
  [ ! -f "$file" ] && continue

  expires=$(sudo jq -r ".claudeAiOauth.expiresAt // empty" "$file" 2>/dev/null)
  [ -z "$expires" ] && continue

  diff=$((expires - NOW_MS))
  mins=$((diff / 60000))
  lejarat_str=$(date -d @$((expires / 1000)) "+%F %T" 2>/dev/null)

  if [ $diff -lt $REFRESH_THRESHOLD_MS ]; then
    # <30 perc hátra VAGY már lejárt → force-refresh
    if [ $diff -lt 0 ]; then
      log "$key: LEJART (${mins}p) - force-refresh probaja"
    else
      log "$key: ${mins}p hatra - preemptiv force-refresh probaja"
    fi

    if force_refresh "$key" "$file" "$expires"; then
      # Sikerült — új lejárat logolás
      new_expires=$(sudo jq -r ".claudeAiOauth.expiresAt // empty" "$file" 2>/dev/null)
      new_str=$(date -d @$((new_expires / 1000)) "+%F %T" 2>/dev/null)
      log "$key: force-refresh SIKERES: $lejarat_str -> $new_str"
    else
      # Nem sikerült. Riadó CSAK ha már tényleg lejárt.
      if [ $diff -lt 0 ]; then
        if alert_allowed "expired-$key"; then
          tg_notify error "OAuth LEJART (force-refresh sikertelen): $key" "A $key credentials.json expiresAt elmult es a force-refresh sem sikerult ${REFRESH_WAIT_SEC}s alatt. Manualis /login kell." "Lejarat: $lejarat_str" > /dev/null 2>&1
          log "$key: FORCE-REFRESH FAILED, alert elkuldve"
        fi
      else
        # <30p volt, de a refresh nem fejezodott be 90s alatt — lehet meg megy
        # NEM riadunk (pre-warning zaj elkerulese), csak logolunk
        log "$key: ${mins}p force-refresh nem fejezte be 90s alatt - nincs riado (lehet meg fut)"
      fi
    fi
  fi
  # >=30p eseten semmi nem kell - Claude CLI maga refresh-el 401-re
done

find "$STATE_DIR" -name "alert-*.stamp" -mmin +120 -delete 2>/dev/null

exit 0
