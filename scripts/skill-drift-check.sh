#!/bin/bash
# Detect when shared skills drift between Nova and the per-agent copies.
#
# Background: agent skills are file copies (not symlinks), so updating
# Nova/copywriting/SKILL.md does NOT propagate to agents/zara/.../copywriting.
# This check warns when those copies fall out of sync.
#
# Output: "OK" or a list of drifted skills. Exit 0 always (informational).
# Wired into Uptime Kuma push monitor — pings status=up if no drift,
# status=down (with msg) if any drift detected.
set -uo pipefail

ROOT="${CLAUDECLAW_ROOT:-/srv/claudeclaw}"
NOVA_SKILLS="$ROOT/.claude/skills"
AGENTS_DIR="$ROOT/agents"
PUSH_URL="${SKILL_DRIFT_PUSH_URL:-}"

drift_count=0
drift_list=""

# Resolve a skill name to its SKILL.md path (or top-level .md file)
skill_path() {
  local base="$1" name="$2"
  if [ -f "$base/$name/SKILL.md" ]; then
    echo "$base/$name/SKILL.md"
  elif [ -f "$base/${name}.md" ]; then
    echo "$base/${name}.md"
  fi
}

# Iterate every agent dir under agents/
for agent_dir in "$AGENTS_DIR"/*/; do
  [ -d "$agent_dir" ] || continue
  agent_name=$(basename "$agent_dir")
  agent_skills="$agent_dir.claude/skills"
  [ -d "$agent_skills" ] || continue

  # For each skill present in BOTH Nova and the agent dir, compare md5
  for skill in "$agent_skills"/*; do
    base=$(basename "$skill" .md)
    nova_path=$(skill_path "$NOVA_SKILLS" "$base")
    agent_path=$(skill_path "$agent_skills" "$base")
    [ -z "$nova_path" ] && continue   # not shared
    [ -z "$agent_path" ] && continue
    nova_md5=$(md5sum "$nova_path" 2>/dev/null | cut -d" " -f1)
    agent_md5=$(md5sum "$agent_path" 2>/dev/null | cut -d" " -f1)
    if [ "$nova_md5" != "$agent_md5" ]; then
      drift_count=$((drift_count + 1))
      drift_list="${drift_list}${agent_name}/${base} "
    fi
  done
done

if [ "$drift_count" -eq 0 ]; then
  echo "OK — no skill drift between Nova and per-agent copies"
  if [ -n "$PUSH_URL" ]; then
    curl -fsS --max-time 8 "${PUSH_URL}?status=up&msg=no+drift&ping=0" >/dev/null 2>&1 || true
  fi
  exit 0
fi

echo "DRIFT detected ($drift_count skills out of sync):"
echo "  $drift_list" | tr " " "\n" | sed "/^$/d" | sed "s/^/    - /"
echo
echo "Fix: pick the canonical version (usually Nova) and copy it back to the agent dir:"
echo "  cp $NOVA_SKILLS/<skill>/SKILL.md $AGENTS_DIR/<agent>/.claude/skills/<skill>/SKILL.md"
if [ -n "$PUSH_URL" ]; then
  msg=$(echo "drift+$drift_count+skills+$drift_list" | tr " " "+" | head -c 250)
  curl -fsS --max-time 8 "${PUSH_URL}?status=down&msg=${msg}&ping=0" >/dev/null 2>&1 || true
fi
exit 0  # informational only — do not break cron
