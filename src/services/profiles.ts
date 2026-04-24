import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from '../config.js'
import { logger } from '../logger.js'

// Szerepkör-alapú biztonsági profilok (templates/profiles/*.json).
// Upstream-inspired (2026-04). Minden profil meghatározza a Claude Code
// settings.json `permissions.allow` és `permissions.deny` listáit. Az
// értékekben `${AGENT_DIR}` és `${HOME}` placeholderek runtime-ban bontódnak.

const PROFILES_DIR = join(PROJECT_ROOT, 'templates', 'profiles')

export interface SecurityProfile {
  id: string
  label: string
  description?: string
  permissionMode?: 'permissive' | 'strict' | string
  filesystem: {
    allow: string[]
    deny: string[]
  }
}

export interface ProfileContext {
  /** Agent projekt-mappája, a `${AGENT_DIR}` placeholder értéke. */
  agentDir: string
  /** User HOME dir, a `${HOME}` placeholder értéke. */
  homeDir: string
}

function expandPlaceholders(s: string, ctx: ProfileContext): string {
  return s
    .replace(/\$\{AGENT_DIR\}/g, ctx.agentDir)
    .replace(/\$\{HOME\}/g, ctx.homeDir)
}

/**
 * Betölti a megadott ID-jú biztonsági profilt a templates/profiles/ alól és
 * kibontja a placeholder-eket. Null-t ad ha nem létezik vagy parse-hiba van.
 */
export function loadProfile(profileId: string | undefined | null, ctx: ProfileContext): SecurityProfile | null {
  if (!profileId) return null
  // Path-traversal védelem: csak sima fájlnevek (a-z, 0-9, -, _) engedélyezettek
  if (!/^[a-z0-9_-]+$/i.test(profileId)) {
    logger.warn({ profileId }, 'Security profile ID invalid (illegal chars)')
    return null
  }
  const path = join(PROFILES_DIR, `${profileId}.json`)
  if (!existsSync(path)) {
    logger.warn({ profileId, path }, 'Security profile not found')
    return null
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as Partial<SecurityProfile>
    if (!data || typeof data !== 'object') return null
    return {
      id: data.id ?? profileId,
      label: data.label ?? profileId,
      description: data.description,
      permissionMode: data.permissionMode,
      filesystem: {
        allow: (data.filesystem?.allow ?? []).map((s) => expandPlaceholders(s, ctx)),
        deny: (data.filesystem?.deny ?? []).map((s) => expandPlaceholders(s, ctx)),
      },
    }
  } catch (err) {
    logger.warn({ err, profileId }, 'Security profile load failed')
    return null
  }
}

/** Listázza az elérhető profilokat (UI dropdown-hoz). */
export function listProfiles(): Array<{ id: string; label: string; description?: string }> {
  if (!existsSync(PROFILES_DIR)) return []
  try {
    return readdirSync(PROFILES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const id = f.slice(0, -5)
        try {
          const raw = readFileSync(join(PROFILES_DIR, f), 'utf-8')
          const data = JSON.parse(raw) as Partial<SecurityProfile>
          return { id: data.id ?? id, label: data.label ?? id, description: data.description }
        } catch {
          return { id, label: id }
        }
      })
  } catch {
    return []
  }
}
