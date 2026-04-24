#!/bin/bash
# ClaudeClaw Daily Reflexió — este 22:00
#
# Célja: minden agent (nova, zara) megnézi a nap tevékenységét, és ha talál
# skill-érett mintát, azt feldolgozza a skill-factory skill-lel.
#
# Cron: 0 22 * * * /srv/claudeclaw/scripts/daily-reflexio.sh
#
# NEM fut háttérben ha a service/agent maga le van állítva — graceful skip.

set -u

LOG=/var/log/claudeclaw-daily-reflexio.log
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

REFLEXIO_PROMPT='Nezd at a mai napod tevekenyseget (agent_messages tabla, memoriak). Vegig mentunk valami olyan uj mintan ami erdemes lenne skillbe onteni? Pl:
- 5+ tool hivas egy folyamatban
- Uj javitas / hibarecovery amit meg nem ismertel
- Felhasznaloi feedback ami altalanosithato

Ha igen, hasznald a skill-factory skill-t hogy csinalj belole SKILL.md-t.
Ha nem: csak irj egy 1 soros log bejegyzest hogy "ma nincs uj skill-erett minta".

Ne csinalj skillt rutinmunkabol. Csak akkor, ha tenyleg erdemes ujra hasznalni.'

AGENTS=(nova zara)

DASH_TOKEN=$(grep -E "^DASHBOARD_TOKEN|^BEARER" /srv/claudeclaw/.env 2>/dev/null | head -1 | cut -d= -f2-)
[ -z "$DASH_TOKEN" ] && { log "HIBA: DASHBOARD_TOKEN nem talalt .env-ben"; exit 1; }

for agent in "${AGENTS[@]}"; do
    svc="claudeclaw-channels"
    [ "$agent" = "zara" ] && svc="claudeclaw-zara"

    if ! systemctl is-active "$svc" >/dev/null 2>&1; then
        log "$agent: service ($svc) nem aktiv, kihagyva"
        continue
    fi

    response=$(curl -s -X POST "http://localhost:3420/api/messages" \
        -H "Authorization: Bearer $DASH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c "import json; print(json.dumps({'from':'cron:daily-reflexio','to':'$agent','content':'''$REFLEXIO_PROMPT'''}))")" \
        2>&1)

    if echo "$response" | grep -qE '"id":[0-9]+|"ok":true'; then
        log "$agent: reflexios prompt elkuldve"
    else
        log "$agent: HIBA: $response"
    fi
done

exit 0
