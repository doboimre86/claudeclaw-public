import { resolve, sep } from 'node:path'

export function sanitizeAgentName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Magyar és egyéb ékezetes karakterek transliterálása (á→a, é→e, ő→o, ű→u, stb.)
    // NFD bontja szét a diakritikusokat (pl. ő = o + combining double acute), a
    // /[\u0300-\u036f]/ tartomány kiszedi őket. Így az ékezetes nevek nem
    // amputálódnak (pl. "étrendíró" → "etrendiro", nem "trendr").
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// Same rules as sanitizeAgentName -- used for skill names to prevent path traversal
export function sanitizeSkillName(raw: string): string {
  return sanitizeAgentName(raw)
}

// Joins segments and verifies the resolved path stays inside `base`. Throws on escape.
export function safeJoin(base: string, ...parts: string[]): string {
  const resolvedBase = resolve(base)
  const target = resolve(base, ...parts)
  if (target !== resolvedBase && !target.startsWith(resolvedBase + sep)) {
    throw new Error(`Path traversal rejected: ${parts.join('/')}`)
  }
  return target
}
