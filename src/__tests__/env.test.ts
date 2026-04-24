import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readEnvFile } from '../env.js'

// FONTOS: ez a teszt KORÁBBAN a valódi /srv/claudeclaw/.env-et írta felül
// afterEach-ben → root-ként futva permission drift-et okozott (owner
// root:root, mode 644), amit a permission-guard 5 percenként visszaállított,
// Telegram notifikációkkal. Most a teszt TEMP dir-be ír, a prod .env
// érintetlen marad.

let tmpDir: string
let testEnvPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claudeclaw-env-test-'))
  testEnvPath = join(tmpDir, '.env')
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('readEnvFile', () => {
  it('ures objektumot ad vissza ha nincs .env', () => {
    expect(existsSync(testEnvPath)).toBe(false)
    const result = readEnvFile(undefined, testEnvPath)
    expect(result).toEqual({})
  })

  it('kulcs-ertek parokat parszol', () => {
    writeFileSync(testEnvPath, 'FOO=bar\nBAZ=qux\n')
    const result = readEnvFile(undefined, testEnvPath)
    expect(result['FOO']).toBe('bar')
    expect(result['BAZ']).toBe('qux')
  })

  it('idezojeleket kezel', () => {
    writeFileSync(testEnvPath, 'KEY="value with spaces"\nKEY2=\'single\'\n')
    const result = readEnvFile(undefined, testEnvPath)
    expect(result['KEY']).toBe('value with spaces')
    expect(result['KEY2']).toBe('single')
  })

  it('kommenteket atugorja', () => {
    writeFileSync(testEnvPath, '# komment\nKEY=val\n')
    const result = readEnvFile(undefined, testEnvPath)
    expect(result['KEY']).toBe('val')
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('szurt kulcsokat ad vissza ha megadva', () => {
    writeFileSync(testEnvPath, 'A=1\nB=2\nC=3\n')
    const result = readEnvFile(['A', 'C'], testEnvPath)
    expect(result['A']).toBe('1')
    expect(result['C']).toBe('3')
    expect(result['B']).toBeUndefined()
  })
})
