#!/bin/bash
# Telegram plugin resilience patch — verzió-agnosztikus, idempotens
# Használat: patch-telegram-plugin.sh <agent-home> <agent-name>
# Meghívja: nova-channels.sh, zara-channels.sh, code-channels.sh induláskor
# Cél: fetchWithTimeout + retry + last-send.json írás minden sikeres API-hívás után

set -u
AGENT_HOME="${1:-}"
AGENT_NAME="${2:-unknown}"
MARKER="CLAUDE_CODE_RESILIENCE_PATCH_V1"

if [ -z "$AGENT_HOME" ]; then
  echo "[patch] usage: $0 <agent-home> <agent-name>" >&2
  exit 1
fi

# Keressük az aktuális plugin verziót
PLUGIN_DIR=$(find "$AGENT_HOME/.claude/plugins/cache/claude-plugins-official/telegram" -maxdepth 1 -type d -name '[0-9]*' 2>/dev/null | sort -V | tail -1)
if [ -z "$PLUGIN_DIR" ]; then
  echo "[patch:$AGENT_NAME] telegram plugin not found, skipping" >&2
  exit 0
fi

SERVER="$PLUGIN_DIR/server.ts"
[ -f "$SERVER" ] || { echo "[patch:$AGENT_NAME] $SERVER missing" >&2; exit 0; }

# Idempotens: ha már patched, kilépés
if grep -q "$MARKER" "$SERVER" 2>/dev/null; then
  echo "[patch:$AGENT_NAME] already patched ($MARKER found)"
  exit 0
fi

# Backup (egyszeri, első patch előtt)
[ -f "$SERVER.orig" ] || cp "$SERVER" "$SERVER.orig"

# A patch-et beszúrjuk a 'const bot = new Bot(TOKEN)' sor UTÁN
# Keresünk 'const bot = new Bot(TOKEN)' vagy hasonló pontos egyezést
TMP=$(mktemp)
awk -v marker="$MARKER" -v agent="$AGENT_NAME" '
/^const bot = new Bot\(TOKEN\)/ {
  # Cseréljük timeout-tal
  print "const bot = new Bot(TOKEN, { client: { timeoutSeconds: 15 } }) // " marker
  print ""
  print "// " marker " — retry + success-logging middleware"
  print "try {"
  print "  const _fs = require(\"node:fs\")"
  print "  const _AGENT = \"" agent "\""
  print "  const _LAST_DIR = \"/tmp/agent-channels\""
  print "  const _LAST_FILE = _LAST_DIR + \"/last-send-\" + _AGENT + \".json\""
  print "  try { _fs.mkdirSync(_LAST_DIR, { recursive: true }) } catch {}"
  print "  bot.api.config.use(async (prev, method, payload, signal) => {"
  print "    let lastErr"
  print "    for (let attempt = 0; attempt <= 3; attempt++) {"
  print "      try {"
  print "        const result = await prev(method, payload, signal)"
  print "        if (typeof method === \"string\" && (method.startsWith(\"send\") || method.startsWith(\"edit\")) && method !== \"sendChatAction\") {"
  print "          try { _fs.writeFileSync(_LAST_FILE, JSON.stringify({ ts: Date.now(), method, agent: _AGENT })) } catch {}"
  print "        }"
  print "        return result"
  print "      } catch (err) {"
  print "        lastErr = err"
  print "        const e = err"
  print "        console.error(\"[grammY-retry:\" + _AGENT + \"] \" + method + \" attempt \" + attempt + \"/3 failed: \" + (e?.message || e))"
  print "        if (e && e.error_code === 429) {"
  print "          const wait = (e.parameters?.retry_after || 1) * 1000"
  print "          await new Promise(r => setTimeout(r, wait))"
  print "        } else if (attempt < 3) {"
  print "          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))"
  print "        } else {"
  print "          throw err"
  print "        }"
  print "      }"
  print "    }"
  print "    throw lastErr"
  print "  })"
  print "  bot.catch((errCtx) => {"
  print "    console.error(\"[grammY-global:\" + _AGENT + \"]\", errCtx.error?.message || errCtx.error, \"update:\", errCtx.ctx?.update?.update_id)"
  print "  })"
  print "} catch (patchErr) { console.error(\"[\" + \"" marker "\" + \"] init failed:\", patchErr) }"
  print ""
  next
}
{ print }
' "$SERVER" > "$TMP"

# Csak akkor írjuk felül ha a marker beszúródott (safety check)
if grep -q "$MARKER" "$TMP"; then
  mv "$TMP" "$SERVER"
  chown "$(stat -c '%u:%g' "$PLUGIN_DIR")" "$SERVER" 2>/dev/null || true
  echo "[patch:$AGENT_NAME] patched $SERVER ($MARKER)"
else
  rm -f "$TMP"
  echo "[patch:$AGENT_NAME] WARNING: 'new Bot(TOKEN)' sor nem található, skip" >&2
  exit 0
fi
