#!/bin/bash
# Mentés-visszatöltés teszt — heti egyszer fut, ellenőrzi hogy a backup
# valóban visszaállítható és olvasható.
#
# "Backup ami nem tesztelt = nincs backup."
#
# Lépések:
# 1. Restic legutóbbi snapshot kiválasztása
# 2. Egy konkrét DB dump kibontása /tmp/-be
# 3. Throwaway docker container indítása a restored adattal
# 4. SELECT COUNT(*) tesztelés
# 5. Magyar Telegram riport
# 6. Cleanup

set -uo pipefail

# === Config ===
TEST_DIR="/tmp/restore-drill-$(date +%s)"
TG_TOKEN="${TELEGRAM_BOT_TOKEN:-8763682539:AAFiJ6zTNzXtgOJ8DUu34EbgQ6THJRR7ZDI}"
TG_CHAT="${TELEGRAM_CHAT_ID:-${ALLOWED_CHAT_ID:-REPLACE_ME}}"
PUSH_URL="${RESTORE_DRILL_PUSH_URL:-}"   # Uptime Kuma push monitor URL
LOG_PREFIX="[restore-drill $(date +%H:%M)]"

start_ts=$(date +%s)
status="OK"
err_msg=""

cleanup() {
    [ -n "${TEST_CONTAINER:-}" ] && docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$TEST_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$TEST_DIR"

echo "$LOG_PREFIX === START ==="

# === 1. Legutóbbi DB dump kiválasztása (lokális, nem restic, gyorsabb) ===
LATEST_DUMP_DIR=$(ls -dt /srv/backup/dbdumps_* 2>/dev/null | head -1)
if [ -z "$LATEST_DUMP_DIR" ]; then
    status="FAIL"
    err_msg="Nincs dbdumps mappa /srv/backup/ alatt"
    echo "$LOG_PREFIX HIBA: $err_msg"
fi

# Egy konkrét DB dumpot tesztelünk: aibooking-db
TEST_DB_NAME="aibooking-db"
DUMP_FILE=$(ls "$LATEST_DUMP_DIR"/${TEST_DB_NAME}_pg_*.sql.gz 2>/dev/null | head -1)
if [ -z "$DUMP_FILE" ] && [ "$status" = "OK" ]; then
    status="FAIL"
    err_msg="Nincs aibooking-db dump a $LATEST_DUMP_DIR alatt"
fi

if [ "$status" = "OK" ]; then
    echo "$LOG_PREFIX Tesztelendő dump: $DUMP_FILE"
    DUMP_DATE=$(basename "$DUMP_FILE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}')

    # === 2. Dump kibontása ===
    SQL_FILE="$TEST_DIR/aibooking.sql"
    gunzip -c "$DUMP_FILE" > "$SQL_FILE" || { status="FAIL"; err_msg="gunzip hiba"; }
    SQL_SIZE_MB=$(du -m "$SQL_FILE" | cut -f1)
    echo "$LOG_PREFIX Kibontva: ${SQL_SIZE_MB} MB"
fi

# === 3. Throwaway docker container indítás ===
if [ "$status" = "OK" ]; then
    TEST_CONTAINER="restore-drill-$(date +%s)"
    echo "$LOG_PREFIX Eldobható postgres container indítás: $TEST_CONTAINER"
    docker run -d --name "$TEST_CONTAINER" \
        -e POSTGRES_PASSWORD=test \
        -e POSTGRES_DB=aibooking \
        --rm \
        postgres:16-alpine >/dev/null 2>&1 || { status="FAIL"; err_msg="docker run hiba"; }

    # Várjunk hogy a postgres feléledjen
    if [ "$status" = "OK" ]; then
        for i in $(seq 1 30); do
            if docker exec "$TEST_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
                break
            fi
            sleep 1
        done
    fi
fi

# === 4. Dump betöltés + COUNT(*) ===
TABLE_COUNT=0
ROW_COUNT=0
if [ "$status" = "OK" ]; then
    echo "$LOG_PREFIX Dump betöltés..."
    docker exec -i "$TEST_CONTAINER" psql -U postgres aibooking < "$SQL_FILE" >/dev/null 2>&1 || \
        { status="WARN"; err_msg="dump betöltés warning (lehet nem critical)"; }

    # Tábla- és sorszám
    TABLE_COUNT=$(docker exec "$TEST_CONTAINER" psql -U postgres aibooking -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ')

    # Dinamikusan találjuk meg a legnagyobb (rekord-számosságú) táblát
    ROW_TABLE="nincs adat"
    while IFS= read -r tbl; do
        tbl=$(echo "$tbl" | tr -d ' ')
        [ -z "$tbl" ] && continue
        cnt=$(docker exec "$TEST_CONTAINER" psql -U postgres aibooking -tAc \
            "SELECT COUNT(*) FROM \"$tbl\"" 2>/dev/null | tr -d ' ')
        if [ -n "$cnt" ] && [ "$cnt" -gt "$ROW_COUNT" ] 2>/dev/null; then
            ROW_COUNT=$cnt
            ROW_TABLE=$tbl
        fi
    done < <(docker exec "$TEST_CONTAINER" psql -U postgres aibooking -tAc \
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' LIMIT 50" 2>/dev/null)

    echo "$LOG_PREFIX Eredmény: $TABLE_COUNT tábla, legtöbb rekord: $ROW_COUNT ($ROW_TABLE táblában)"
fi

elapsed=$(( $(date +%s) - start_ts ))

# === 5. Telegram riport — MAGYARUL EGYÉRTELMŰEN ===
if [ "$status" = "OK" ]; then
    icon="✅"
    title="Mentés-visszatöltés teszt SIKERES"
    body="📂 Forrás mentés: ${DUMP_DATE}
🗄️ Tesztelt adatbázis: ${TEST_DB_NAME} (${SQL_SIZE_MB} MB)
📊 Tábla: ${TABLE_COUNT} db
📋 Rekord: ${ROW_COUNT} (${ROW_TABLE:-N/A} táblában)
⏱️ Időtartam: ${elapsed} mp

A backup tényleg visszaállítható. Eldobható konténer törölve."
elif [ "$status" = "WARN" ]; then
    icon="⚠️"
    title="Mentés-visszatöltés teszt — figyelmeztetés"
    body="A teszt részben sikerült.
📂 Forrás mentés: ${DUMP_DATE:-?}
⚠️ Hiba: ${err_msg}
📊 Talált: ${TABLE_COUNT} tábla, ${ROW_COUNT} rekord
⏱️ ${elapsed} mp"
else
    icon="❌"
    title="Mentés-visszatöltés teszt SIKERTELEN"
    body="A backup NEM állítható vissza!
❌ Hiba: ${err_msg}
⏱️ ${elapsed} mp

Ellenőrizd a /var/log/restore-drill-*.log-ot és a backup script-et."
fi

tg_text="${icon} ${title}
${body}"

curl -fsS --max-time 10 \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=${tg_text}" \
    "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" >/dev/null 2>&1 \
    && echo "$LOG_PREFIX Telegram OK" \
    || echo "$LOG_PREFIX Telegram hiba"

# === 6. Uptime Kuma push (opcionális) ===
if [ -n "$PUSH_URL" ]; then
    push_status=$([ "$status" = "OK" ] && echo "up" || echo "down")
    msg=$(echo "${title}: ${TABLE_COUNT}+tabla+${ROW_COUNT}+rekord" | tr ' ' '+' | head -c 200)
    curl -fsS --max-time 10 "${PUSH_URL}?status=${push_status}&msg=${msg}&ping=${elapsed}" >/dev/null 2>&1
fi

echo "$LOG_PREFIX === END (${status}, ${elapsed}s) ==="
exit 0
