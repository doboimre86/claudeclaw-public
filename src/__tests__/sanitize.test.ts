import { describe, it, expect } from 'vitest'
import { sanitizeAgentName, sanitizeSkillName, safeJoin } from '../utils/sanitize.js'

describe('sanitizeAgentName', () => {
  it('kisbetűsíti és trim-eli', () => {
    expect(sanitizeAgentName('  Zara  ')).toBe('zara')
  })

  it('megőrzi az ASCII neveket', () => {
    expect(sanitizeAgentName('nova')).toBe('nova')
    expect(sanitizeAgentName('code-agent')).toBe('code-agent')
    expect(sanitizeAgentName('agent-123')).toBe('agent-123')
  })

  it('magyar ékezetes karaktereket transliterál, nem vág le', () => {
    expect(sanitizeAgentName('étrendíró')).toBe('etrendiro')
    expect(sanitizeAgentName('Őrző')).toBe('orzo')
    expect(sanitizeAgentName('zöldség')).toBe('zoldseg')
    expect(sanitizeAgentName('ÁÉÍÓÖŐÚÜŰ')).toBe('aeiooouuu')
  })

  it('egyéb diakritikusokat is kezel (NFD)', () => {
    expect(sanitizeAgentName('naïve')).toBe('naive')
    expect(sanitizeAgentName('café')).toBe('cafe')
    expect(sanitizeAgentName('Zürich')).toBe('zurich')
  })

  it('szóközt és speciális karaktert kiszűr', () => {
    expect(sanitizeAgentName('ag ent')).toBe('agent')
    expect(sanitizeAgentName('agent!')).toBe('agent')
    expect(sanitizeAgentName('../escape')).toBe('escape')
  })

  it('egymás utáni kötőjeleket összevon', () => {
    expect(sanitizeAgentName('a--b---c')).toBe('a-b-c')
  })

  it('elöl/hátul levő kötőjeleket eltávolítja', () => {
    expect(sanitizeAgentName('-abc-')).toBe('abc')
    expect(sanitizeAgentName('---xyz---')).toBe('xyz')
  })

  it('50 karakterre vág', () => {
    const long = 'a'.repeat(100)
    expect(sanitizeAgentName(long).length).toBe(50)
  })

  it('üres eredményt ad vissza path traversal kísérletre', () => {
    expect(sanitizeAgentName('../../')).toBe('')
    expect(sanitizeAgentName('///')).toBe('')
  })
})

describe('sanitizeSkillName', () => {
  it('ugyanazokat a szabályokat alkalmazza mint az agent név', () => {
    expect(sanitizeSkillName('Email-figyelő')).toBe('email-figyelo')
  })
})

describe('safeJoin', () => {
  it('érvényes path-t ad vissza', () => {
    const result = safeJoin('/tmp', 'sub', 'file.txt')
    expect(result).toBe('/tmp/sub/file.txt')
  })

  it('path traversal kísérletet dob', () => {
    expect(() => safeJoin('/tmp', '..', 'etc', 'passwd')).toThrow(/Path traversal rejected/)
    expect(() => safeJoin('/tmp', '../../root')).toThrow(/Path traversal rejected/)
  })

  it('üres resztet engedi (maga a base)', () => {
    expect(safeJoin('/tmp')).toBe('/tmp')
  })
})
