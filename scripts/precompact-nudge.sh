#!/bin/bash
# ClaudeClaw PreCompact Nudge Hook
# Upstream scripts/hooks/memory-save.sh ihletésre, adaptálva ClaudeClaw-ra.
#
# A Claude Code ezt a hook-ot kontextus-tömörítés ELŐTT hívja meg.
# Stdin-en JSON-t kap: {hook_event_name, transcript_path, cwd, trigger}
# Mi itt NEM tudjuk a teljes kontextust kinyerni (az az agent feladata
# a tömörítéskor), de tudunk egy "nudge" üzenetet visszaadni, amit a
# Claude látni fog a compaction prompt-ban.
#
# A nudge arra emlékezteti az agentet:
#   - Gondolja át, volt-e újrafelhasználható minta a session-ben
#   - Ha igen, hívja elő a skill-factory skillt (5+ tool call után)
#   - Mentse a fontos tudást közös memóriába
#
# Install: settings.json hooks.PreCompact[].command = /path/to/this/script
#
# Return: stdout az ami megy a Claude kontextusába (additionalContext)

set -u

AGENT_ID="${CC_AGENT_ID:-$(whoami)}"
TS=$(date "+%Y-%m-%d %H:%M")

# PreCompact hook stdin JSON (nem használjuk most, de itt lenne)
# STDIN_JSON=$(cat)

# Nudge üzenet — ez kerül a compaction kontextusba
cat <<EOF
[PreCompact Nudge — $TS]

Mielőtt a kontextus tömörítésre kerül, gondold át röviden:

1. **Skill-érett minta**: Volt-e ebben a session-ben olyan többlépéses
   workflow (5+ tool hívás), amit érdemes lenne skill-factory-val skillé
   alakítani?

2. **Közös tudás**: Olyan tény / javítás / döntés, ami más agenteknek
   (Nova, Zara, Lexi, codeagent) is hasznos? Ha igen, mentsd el:
   \`memory_store\` az MCP memóriába, tag-ekkel.

3. **Feedback megőrzése**: Javított rajtad a felhasználó? Ha a javítás
   általánosítható, a saját memóriádba mentsd \`feedback_*.md\` fájlként
   a \`~/.claude/projects/*/memory/\` mappába.

Ezek NEM kötelezők — csak akkor csináld, ha tényleg van értékes minta.
Ne csináld a rutinmunkához (chit-chat, sima válaszok).

Agent: $AGENT_ID
EOF

exit 0
