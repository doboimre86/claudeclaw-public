#!/bin/bash
# sync-workspace-footer.sh
# Egységesíti az összes agent CLAUDE.md WORKSPACE+RULES footer-jét a kanonikus
# verzióval. Ugyanaz a verzió mint a src/services/agent-manager.ts WORKSPACE_FOOTER.
#
# Használat:
#   bash sync-workspace-footer.sh        # alkalmazás
#   bash sync-workspace-footer.sh --dry  # csak nézd meg, ne módosíts

set -uo pipefail

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

PROJECT="/srv/claudeclaw"
FOOTER_MARKER="## 📜 SZABÁLYKÖNYV + WORKSPACE — kötelező olvasás"

# Kanonikus footer — UGYANEZ kell legyen mint az agent-manager.ts WORKSPACE_FOOTER
read -r -d '' FOOTER <<'FOOTER_EOF' || true

## 📜 SZABÁLYKÖNYV + WORKSPACE — kötelező olvasás

**A teljes szabálykönyv itt: `/srv/claudeclaw/RULES.md`**

**Workspace fájlok (Lexi-minta) itt: `/srv/claudeclaw/workspace/`**
- `BOOT.md` — session-start olvasási sorrend
- `USER.md` — Owner profil (név, preferenciák, kritikus szabályok, Petra-incidens)
- `WEBSITES.md` — domain-térkép (ár-lookup, szolgáltatás → skill kapcsolás)
- `TEMPLATES.md` — gyors email-sablon-referencia (Selfiebox, esküvő, ajánlat, számla, köszönő)

Olvasd be **minden session start-kor** ÉS amikor jelzést kapsz hogy a RULES.md mtime frissült (memoria-heartbeat 30 percenként ellenőrzi).

A RULES.md a kanonikus szabályrendszer. Ha eltérés van a CLAUDE.md és a RULES.md között, **a RULES.md győz**. Konkrétan:
- DRAFT-FIRST szabályok (email/számla/pénz/törlés)
- Nyelvi szabályok (magyar, ékezetes)
- Voice TTS szabályok
- Memória/napló kötelezettség
- Tiltott műveletek
- Agens hatáskör
FOOTER_EOF

# Összes CLAUDE.md cél
TARGETS=("$PROJECT/CLAUDE.md")
for d in "$PROJECT/agents/"*/; do
    [ -f "$d/CLAUDE.md" ] && TARGETS+=("$d/CLAUDE.md")
done

echo "=== sync-workspace-footer ($([ $DRY -eq 1 ] && echo dry-run || echo ALKALMAZÁS)) ==="
echo "Célok: ${#TARGETS[@]} db CLAUDE.md"
echo ""

CHANGED=0
for f in "${TARGETS[@]}"; do
    [ ! -f "$f" ] && { echo "  $f -> HIÁNYZIK, kihagyva"; continue; }

    # FIX: index() fixed-string keresést használunk regex helyett, mert a marker
    # tartalmaz '+' karaktert ami ERE-ben "1 vagy több" jelentésű — emiatt $0 ~ marker
    # nem matchelt és a body az egész fájl maradt -> footer duplázódott.
    body=$(awk -v marker="$FOOTER_MARKER" '
        index($0, marker) > 0 {found=1}
        !found {print}
    ' "$f")
    # Trailing üres sorok levágása
    body_trimmed=$(printf '%s' "$body" | sed -e :a -e '/^$/{$d;N;ba' -e '}')

    new_content="${body_trimmed}"$'\n'"${FOOTER}"$'\n'

    # Ellenőrzés: van-e már változás? (cmp -s = bytecorrekt)
    tmp_new=$(mktemp)
    printf '%s' "$new_content" > "$tmp_new"
    if cmp -s "$tmp_new" "$f"; then
        rm -f "$tmp_new"
        echo "  $f -> OK (szinkronban)"
        continue
    fi

    if [ $DRY -eq 1 ]; then
        rm -f "$tmp_new"
        echo "  $f -> FRISSÍTÉSRE VÁR"
    else
        # Atomic move (mtime csak akkor változik ha tényleg más)
        mv "$tmp_new" "$f"
        echo "  $f -> FRISSÍTVE"
        CHANGED=$((CHANGED+1))
    fi
done

echo ""
echo "Vége. Módosítva: $CHANGED / ${#TARGETS[@]}"
[ $DRY -eq 1 ] && echo "(dry-run, valódi módosítás nem történt)"
