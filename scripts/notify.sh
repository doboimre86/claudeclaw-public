#!/bin/bash
# Legacy wrapper — uj kod hasznalja a lib-et direkt:
#   source /srv/claudeclaw/scripts/lib/telegram-notify.sh
#   tg_notify severity cim torzs tech
#
# Ez a szkript kompatibilis a korabbi "./notify.sh UZENET" hivasokkal —
# ilyenkor info severity-vel megy ki, cim "Rendszer üzenet".
source /srv/claudeclaw/scripts/lib/telegram-notify.sh

if [ $# -eq 1 ]; then
  # Legacy mode: 1 argumentum
  tg_notify info "Rendszer üzenet" "$1"
elif [ $# -ge 4 ]; then
  # Uj mode: severity / cim / torzs / tech
  tg_notify "$@"
elif [ $# -eq 2 ] || [ $# -eq 3 ]; then
  # Attmeneti mode: severity + cim (+ torzs)
  tg_notify "$@" ""
else
  echo "Hasznalat:" >&2
  echo "  notify.sh \"uzenet\"                          (legacy info)" >&2
  echo "  notify.sh severity \"cim\" \"torzs\" [\"tech\"]  (uj formatum)" >&2
  exit 1
fi
