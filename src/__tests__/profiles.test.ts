import { describe, it, expect } from 'vitest'
import { loadProfile, listProfiles } from '../services/profiles.js'

const ctx = { agentDir: '/srv/claudeclaw/agents/test', homeDir: '/root' }

describe('loadProfile', () => {
  it('null-t ad ha a profileId üres vagy undefined', () => {
    expect(loadProfile(undefined, ctx)).toBeNull()
    expect(loadProfile(null, ctx)).toBeNull()
    expect(loadProfile('', ctx)).toBeNull()
  })

  it('null-t ad path-traversal kísérletre', () => {
    expect(loadProfile('../../../etc/passwd', ctx)).toBeNull()
    expect(loadProfile('..', ctx)).toBeNull()
    expect(loadProfile('a/b', ctx)).toBeNull()
  })

  it('null-t ad nem létező profilra', () => {
    expect(loadProfile('nonexistent-profile-xyz', ctx)).toBeNull()
  })

  it('betölti a default profilt', () => {
    const p = loadProfile('default', ctx)
    expect(p).not.toBeNull()
    expect(p!.id).toBe('default')
    expect(p!.permissionMode).toBe('permissive')
    expect(p!.filesystem.allow).toEqual([])
    expect(p!.filesystem.deny).toEqual([])
  })

  it('betölti a developer-senior profilt és kibont ${HOME}-ot', () => {
    const p = loadProfile('developer-senior', ctx)
    expect(p).not.toBeNull()
    expect(p!.filesystem.deny).toContain('Read(/root/.ssh/**)')
    expect(p!.filesystem.deny).toContain('Bash(sudo:*)')
    // Semmiféle ${HOME} placeholder nem maradt
    const asStr = JSON.stringify(p!.filesystem.deny)
    expect(asStr).not.toContain('${HOME}')
  })

  it('betölti a developer-junior profilt és kibont ${AGENT_DIR}-t', () => {
    const p = loadProfile('developer-junior', ctx)
    expect(p).not.toBeNull()
    expect(p!.filesystem.allow).toContain('Read(/srv/claudeclaw/agents/test/**)')
    expect(p!.filesystem.allow).toContain('Write(/srv/claudeclaw/agents/test/**)')
    // Placeholder nem maradt
    const asStr = JSON.stringify(p!.filesystem.allow)
    expect(asStr).not.toContain('${AGENT_DIR}')
  })

  it('betölti a marketer profilt', () => {
    const p = loadProfile('marketer', ctx)
    expect(p).not.toBeNull()
    expect(p!.id).toBe('marketer')
    expect(p!.filesystem.deny).toContain('Read(/root/.env)')
    expect(p!.filesystem.deny).toContain('Bash(curl -X POST:*)')
  })

  it('betölti a researcher profilt (draft-only)', () => {
    const p = loadProfile('researcher', ctx)
    expect(p).not.toBeNull()
    expect(p!.filesystem.deny).toContain('Bash(git push:*)')
  })
})

describe('listProfiles', () => {
  it('legalább 5 profilt listáz', () => {
    const list = listProfiles()
    expect(list.length).toBeGreaterThanOrEqual(5)
  })

  it('minden listaelem tartalmaz id + label mezőt', () => {
    const list = listProfiles()
    for (const p of list) {
      expect(typeof p.id).toBe('string')
      expect(typeof p.label).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
    }
  })

  it('tartalmazza a default, developer-senior, marketer ID-kat', () => {
    const ids = listProfiles().map((p) => p.id)
    expect(ids).toContain('default')
    expect(ids).toContain('developer-senior')
    expect(ids).toContain('marketer')
  })
})
