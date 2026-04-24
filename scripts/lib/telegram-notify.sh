#!/bin/bash
# /srv/claudeclaw/scripts/lib/telegram-notify.sh
#
# Egyseges Telegram ertesito lib ClaudeClaw rendszer-uzenetekhez.
# Minden infra/rendszer uzenet a Claude Code bot-ra (@imi_claudecode_bot) megy.
# Nova es Zara botok a saját agent uzeneteiket kuldik (plugin reply-val) — azokat NEM hivjuk.
#
# Hasznalat:
#   source /srv/claudeclaw/scripts/lib/telegram-notify.sh
#   tg_notify <success|warning|error|info> "Cim" "Torzs" "kulcs1: ertek1
#   kulcs2: ertek2"
#
# Bot token: /home/codeagent/.claude/channels/telegram/.env
# Chat ID:   hardcoded Owner (${ALLOWED_CHAT_ID:-REPLACE_ME}) — egyetlen fogado

set -u

TG_BOT_ENV="${TG_BOT_ENV:-/home/codeagent/.claude/channels/telegram/.env}"
TG_CHAT_ID="${TG_CHAT_ID:-${ALLOWED_CHAT_ID:-REPLACE_ME}}"

tg_md2_escape() {
  python3 /srv/claudeclaw/scripts/lib/md2-escape.py "$1"
}

tg_format_header() {
  local severity="$1"
  local title="$2"
  local emoji
  case "$severity" in
    success) emoji="✅" ;;
    warning) emoji="⚠️" ;;
    error)   emoji="🔴" ;;
    info|*)  emoji="ℹ️" ;;
  esac
  local title_esc
  title_esc=$(tg_md2_escape "$title")
  printf "%s *%s*" "$emoji" "$title_esc"
}

# Tech reszlet formaz: "kulcs: ertek" sort *kulcs:* ertek-re alakit
# Bemenet: multiline string (valodi newline-ok)
tg_format_tech() {
  local tech="$1"
  [ -z "$tech" ] && return
  local line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [[ "$line" == *:* ]]; then
      local key="${line%%:*}"
      local val="${line#*:}"
      val="${val# }"
      local key_esc val_esc
      key_esc=$(tg_md2_escape "$key")
      val_esc=$(tg_md2_escape "$val")
      printf "*%s:* %s\n" "$key_esc" "$val_esc"
    else
      tg_md2_escape "$line"
      printf "\n"
    fi
  done <<< "$tech"
}

tg_notify() {
  local severity="${1:-info}"
  local title="${2:-Ertesites}"
  local body="${3:-}"
  local tech="${4:-}"

  if [ ! -f "$TG_BOT_ENV" ]; then
    echo "tg_notify: nincs env fajl: $TG_BOT_ENV" >&2
    return 2
  fi
  local token
  token=$(grep "^TELEGRAM_BOT_TOKEN=" "$TG_BOT_ENV" | cut -d= -f2-)
  if [ -z "$token" ]; then
    echo "tg_notify: hianyzo TELEGRAM_BOT_TOKEN az env-ben: $TG_BOT_ENV" >&2
    return 2
  fi

  local header body_esc tech_block
  header=$(tg_format_header "$severity" "$title")
  body_esc=$(tg_md2_escape "$body")
  tech_block=$(tg_format_tech "$tech")

  # Uzenet osszeallitas printf-fel (valodi newline-ok)
  local message
  if [ -n "$tech_block" ]; then
    message=$(printf "%s\n\n%s\n\n%s" "$header" "$body_esc" "$tech_block")
  else
    message=$(printf "%s\n\n%s" "$header" "$body_esc")
  fi

  curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" \
    --data-urlencode "text=${message}" \
    --data-urlencode "parse_mode=MarkdownV2" \
    --data-urlencode "disable_web_page_preview=true" \
    -o /tmp/tg_notify_last.json 2>/dev/null

  if grep -q "\"ok\":true" /tmp/tg_notify_last.json 2>/dev/null; then
    return 0
  else
    echo "tg_notify: sikertelen kuldes. Response:" >&2
    cat /tmp/tg_notify_last.json >&2 2>/dev/null
    return 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  tg_notify "$@"
  exit $?
fi


# tg_notify_with_buttons — inline keyboard gombos uzenet a felhasznalonak.
# Hasznalat:
#   tg_notify_with_buttons "Cim" "Torzs/kontextus" \
#     "Igen|OK|\u2705|contract_ok" \
#     "Modositsd|edit|\u270F\uFE0F|contract_edit" \
#     "Megse|cancel|\u274C|contract_cancel"
#
# Minden gomb-argumentum format: "label|value|emoji|callback_ref"
#   label    = mit mutat a gomb (pl. "Igen")
#   value    = mit kapjon a modell mint "Owner valasztotta: <value>"
#   emoji    = opcionalis emoji elottre ("" ha nincs)
#   callback_ref = referencia kod (loggolashoz, nem krit)
#
# A patchelt plugin utan Nova egy [Gomb: <label>] <value> synthetic
# message-et kap az MCP channel-en.
#
# Kimenet stdout-ra: a state-id (8 hex char) — ha a hivonak kell tudni.

tg_notify_with_buttons() {
  local title="${1:-}"
  local body="${2:-}"
  shift 2 || return 1

  local env_file="${TG_BOT_ENV:-/home/codeagent/.claude/channels/telegram/.env}"
  local chat_id="${TG_CHAT_ID:-${ALLOWED_CHAT_ID:-REPLACE_ME}}"
  local state_dir="/var/lib/claudeclaw/tg-buttons"

  local token
  token=$(grep "^TELEGRAM_BOT_TOKEN=" "$env_file" | cut -d= -f2-)
  [ -z "$token" ] && { echo "tg_notify_with_buttons: no token" >&2; return 2; }

  # Nova tokent hasznaljuk — az a default a lib-ben? Ellenorzes
  # Override-olhato: TG_BOT_ENV=/srv/claudeclaw/.env (nova token)
  # Default most Claude Code — jol van, mert a Nova plugin ezt a bot-ot kezeli
  # (a reply-tool token-e)
  # DE: a cc: callback patch CSAK a nova plugin-en van! Tehat Nova bot kell.
  # Kenyelmetlen: a lib default Claude Code. Ezert:
  if [ -z "${TG_BOT_ENV_OVERRIDE:-}" ]; then
    # Automatic fallback: ha Nova env letezik es a cc: patch-hez kell, azt hasznaljuk
    if [ -f "/srv/claudeclaw/.env" ]; then
      env_file="/srv/claudeclaw/.env"
      token=$(grep "^TELEGRAM_BOT_TOKEN=" "$env_file" | cut -d= -f2-)
    fi
  fi

  [ -z "$token" ] && { echo "tg_notify_with_buttons: no token" >&2; return 2; }

  mkdir -p "$state_dir" 2>/dev/null
  local state_id
  state_id=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
  local state_file="$state_dir/$state_id.json"

  # JSON build — jq-val biztonsagos
  local choices_json="[]"
  local keyboard_rows="[]"
  local idx=0
  local header_md2
  header_md2=$(python3 /srv/claudeclaw/scripts/lib/md2-escape.py "$title")

  local text_body
  text_body=$(python3 /srv/claudeclaw/scripts/lib/md2-escape.py "$body")
  local full_text="*${header_md2}*

${text_body}"

  # Gombok iteracio
  for btn in "$@"; do
    local label value emoji ref
    IFS="|" read -r label value emoji ref <<< "$btn"
    local display="${emoji:+${emoji} }${label}"
    choices_json=$(echo "$choices_json" | jq --arg l "$display" --arg v "$value" --arg r "$ref" ". + [{label:\$l, value:\$v, ref:\$r}]")
    keyboard_rows=$(echo "$keyboard_rows" | jq --arg t "$display" --arg cb "cc:$state_id:$idx" ". + [[{text:\$t, callback_data:\$cb}]]")
    idx=$((idx + 1))
  done

  # Final state JSON
  jq -n --arg ctx "$body" --argjson c "$choices_json" --arg created "$(date +%s)" "{context: \$ctx, choices: \$c, created: \$created | tonumber}" > "$state_file"
  chmod 664 "$state_file"

  local keyboard_json
  keyboard_json=$(jq -n --argjson ik "$keyboard_rows" "{inline_keyboard: \$ik}")

  # Send
  curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${full_text}" \
    --data-urlencode "parse_mode=MarkdownV2" \
    --data-urlencode "disable_web_page_preview=true" \
    --data-urlencode "reply_markup=${keyboard_json}" \
    -o /tmp/tg_notify_last.json 2>/dev/null

  if grep -q '"ok":true' /tmp/tg_notify_last.json 2>/dev/null; then
    echo "$state_id"
    return 0
  else
    echo "tg_notify_with_buttons: failed" >&2
    cat /tmp/tg_notify_last.json >&2 2>/dev/null
    return 1
  fi
}

