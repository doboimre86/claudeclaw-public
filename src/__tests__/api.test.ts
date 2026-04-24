import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { initDatabase } from '../db.js'

// Teszt token beállítása MIELŐTT a web modul betöltődik
const TEST_TOKEN = 'test-secret-token-for-api-tests'
process.env.DASHBOARD_TOKEN = TEST_TOKEN
process.env.NODE_ENV = 'test'

let server: http.Server
let port: number

/**
 * HTTP kérés küldése a teszt szerverre.
 */
function request(
  method: string,
  path: string,
  options?: { body?: unknown; token?: string | null }
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    let bodyStr: string | undefined

    if (options?.body !== undefined) {
      bodyStr = JSON.stringify(options.body)
      headers['Content-Type'] = 'application/json'
    }

    // Ha a token nincs explicit null-ra állítva, használjuk a teszt tokent
    if (options?.token !== null) {
      headers['Authorization'] = `Bearer ${options?.token ?? TEST_TOKEN}`
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString()
          let data: unknown
          try {
            data = JSON.parse(raw)
          } catch {
            data = raw
          }
          resolve({ status: res.statusCode || 0, data })
        })
      }
    )
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

beforeAll(async () => {
  // DB inicializálás teszthez
  initDatabase()

  // Dinamikus import, hogy a DASHBOARD_TOKEN env var már be legyen állítva
  const { startWebServer } = await import('../server.js')

  // Port 0: az OS választ egy szabad portot.
  // A startWebServer belsőleg hívja a server.listen()-t.
  server = startWebServer(0)

  // Megvárjuk amíg a szerver ténylegesen listen-el
  await new Promise<void>((resolve) => {
    server.on('listening', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        port = addr.port
      }
      resolve()
    })
    // Ha már listening, azonnal resolve
    const addr = server.address()
    if (addr && typeof addr === 'object') {
      port = addr.port
      resolve()
    }
  })
})

afterAll(async () => {
  // Cleanup: teszt kartyak, memoriak, daily_logs torlese
  if (port) {
    // Kanban teszt kartyak torlese
    const { data: cards } = await request('GET', '/api/kanban')
    for (const card of cards as Array<Record<string, unknown>>) {
      const title = card.title as string
      if (title === 'Teszt kartya' || title === 'Frissitett cim' || title === 'Update teszt' || title === 'Torlendo kartya') {
        await request('DELETE', `/api/kanban/${card.id}`)
      }
    }
    // Teszt memoriak torlese
    const { data: mems } = await request('GET', '/api/memories?agent=nova')
    for (const mem of mems as Array<Record<string, unknown>>) {
      const content = mem.content as string
      if (content?.includes('teszt') || content?.includes('Teszt') || content?.includes('CRUD teszt')) {
        await request('DELETE', `/api/memories/${mem.id}`)
      }
    }
    // Teszt daily_logs torlese — minden vitest futas egy uj "Teszt naplo
    // bejegyzes" rekordot hoz letre a POST /api/daily-log teszt miatt.
    // Ezeket DB-szinten torolnunk kell, mert nincs DELETE /api/daily-log endpoint.
    try {
      const { getDb } = await import('../db.js')
      const db = getDb()
      db.prepare("DELETE FROM daily_logs WHERE content LIKE '%Teszt naplo bejegyzes%' OR content LIKE '%Ez egy teszt.%'").run()
    } catch { /* ha a DB-hez nem fer hozza, folytasd */ }
  }
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

// ─── 1. GET /api/health ───
describe('GET /api/health', () => {
  it('200 valaszt ad valid JSON-nel es status: ok', async () => {
    const { status, data } = await request('GET', '/api/health', { token: null })
    expect(status).toBe(200)
    expect(data).toBeTypeOf('object')
    expect((data as Record<string, unknown>).status).toBe('ok')
  })

  it('publikus: token nelkul is elerheto', async () => {
    const { status } = await request('GET', '/api/health', { token: null })
    expect(status).toBe(200)
  })
})

// ─── 2. GET /api/nova ───
describe('GET /api/nova', () => {
  it('200 valaszt ad es tartalmazza a name: Nova mezo', async () => {
    const { status, data } = await request('GET', '/api/nova')
    expect(status).toBe(200)
    expect(data).toBeTypeOf('object')
    expect((data as Record<string, unknown>).name).toBe('Nova')
  })
})

// ─── 3. GET /api/kanban ───
describe('GET /api/kanban', () => {
  it('200 valaszt ad es tombot ad vissza', async () => {
    const { status, data } = await request('GET', '/api/kanban')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── 4. GET /api/memories ───
describe('GET /api/memories', () => {
  it('200 valaszt ad es tombot ad vissza', async () => {
    const { status, data } = await request('GET', '/api/memories')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── 5. GET /api/memories/stats ───
describe('GET /api/memories/stats', () => {
  it('200 valaszt ad es tartalmazza a total mezot', async () => {
    const { status, data } = await request('GET', '/api/memories/stats')
    expect(status).toBe(200)
    expect(data).toBeTypeOf('object')
    expect((data as Record<string, unknown>).total).toBeTypeOf('number')
    expect((data as Record<string, unknown>).byAgent).toBeTypeOf('object')
    expect((data as Record<string, unknown>).byTier).toBeTypeOf('object')
  })
})

// ─── 6. POST /api/kanban ───
describe('POST /api/kanban', () => {
  it('200 valaszt ad es kartyat hoz letre', async () => {
    const { status, data } = await request('POST', '/api/kanban', {
      body: {
        title: 'Teszt kartya',
        column: 'todo',
        description: 'Ez egy teszt',
      },
    })
    expect(status).toBe(200)
    const obj = data as Record<string, unknown>
    expect(obj.ok).toBe(true)
    expect(obj.id).toBeDefined()
    expect(typeof obj.id).toBe('string')
  })

  it('a letrehozott kartya megjelenik a GET /api/kanban-ban', async () => {
    const { data } = await request('GET', '/api/kanban')
    const cards = data as Array<Record<string, unknown>>
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.some((c) => c.title === 'Teszt kartya')).toBe(true)
  })
})

// ─── 7. POST /api/memories ───
describe('POST /api/memories', () => {
  it('200 valaszt ad es memoriat ment', async () => {
    const { status, data } = await request('POST', '/api/memories', {
      body: {
        agent_id: 'nova',
        content: 'Ez egy teszt memoria',
        tier: 'warm',
        keywords: 'teszt, api',
      },
    })
    expect(status).toBe(200)
    const obj = data as Record<string, unknown>
    expect(obj.ok).toBe(true)
    expect(obj.id).toBeDefined()
  })

  it('a mentett memoria megjelenik a stats-ban', async () => {
    const { data } = await request('GET', '/api/memories/stats')
    const stats = data as Record<string, unknown>
    expect((stats.total as number)).toBeGreaterThan(0)
  })

  it('ures content eseten 400 hibat ad', async () => {
    const { status } = await request('POST', '/api/memories', {
      body: { content: '' },
    })
    expect(status).toBe(400)
  })
})

// ─── 8. Auth tesztek ───
describe('Auth: token nelkul 401', () => {
  it('GET /api/nova token nelkul 401', async () => {
    const { status } = await request('GET', '/api/nova', { token: null })
    expect(status).toBe(401)
  })

  it('GET /api/kanban token nelkul 401', async () => {
    const { status } = await request('GET', '/api/kanban', { token: null })
    expect(status).toBe(401)
  })

  it('GET /api/memories token nelkul 401', async () => {
    const { status } = await request('GET', '/api/memories', { token: null })
    expect(status).toBe(401)
  })

  it('POST /api/kanban token nelkul 401', async () => {
    const { status } = await request('POST', '/api/kanban', {
      token: null,
      body: { title: 'nope', column: 'todo' },
    })
    expect(status).toBe(401)
  })

  it('rossz token eseten 401', async () => {
    const { status } = await request('GET', '/api/nova', { token: 'wrong-token' })
    expect(status).toBe(401)
  })

  it('GET /api/health publikus marad', async () => {
    const { status } = await request('GET', '/api/health', { token: null })
    expect(status).toBe(200)
  })
})

// ─── 9. PUT /api/kanban/:id ───
describe('PUT /api/kanban/:id', () => {
  let cardId: string

  beforeAll(async () => {
    const { data } = await request('POST', '/api/kanban', {
      body: { title: 'Update teszt', description: 'Eredeti leiras' },
    })
    cardId = (data as Record<string, unknown>).id as string
  })

  it('kartya frissitese 200-at ad', async () => {
    const { status, data } = await request('PUT', `/api/kanban/${cardId}`, {
      body: { title: 'Frissitett cim', status: 'in_progress' },
    })
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })

  it('nem letezo kartya 404-et ad', async () => {
    const { status } = await request('PUT', '/api/kanban/nonexistent-id', {
      body: { title: 'Nope' },
    })
    expect(status).toBe(404)
  })
})

// ─── 10. DELETE /api/kanban/:id ───
describe('DELETE /api/kanban/:id', () => {
  let cardId: string

  beforeAll(async () => {
    const { data } = await request('POST', '/api/kanban', {
      body: { title: 'Torlendo kartya', description: 'Torolni fogom' },
    })
    cardId = (data as Record<string, unknown>).id as string
  })

  it('kartya torlese 200-at ad', async () => {
    const { status, data } = await request('DELETE', `/api/kanban/${cardId}`)
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })

  it('torolt kartya nem jelenik meg a listaban', async () => {
    const { data } = await request('GET', '/api/kanban')
    const cards = data as Array<Record<string, unknown>>
    expect(cards.some((c) => c.id === cardId)).toBe(false)
  })
})

// ─── 11. POST + GET /api/daily-log ───
describe('Daily log', () => {
  it('POST /api/daily-log memoriat ment', async () => {
    const { status, data } = await request('POST', '/api/daily-log', {
      body: {
        agent_id: 'nova',
        content: '## 12:00 -- Teszt naplo bejegyzes\nEz egy teszt.',
      },
    })
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })

  it('GET /api/daily-log visszaadja a mai bejegyzeseket', async () => {
    const today = new Date().toISOString().split('T')[0]
    const { status, data } = await request('GET', `/api/daily-log?agent=nova&date=${today}`)
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('GET /api/daily-log/dates tombot ad vissza', async () => {
    const { status, data } = await request('GET', '/api/daily-log/dates?agent=nova')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── 12. PUT + DELETE /api/memories/:id ───
describe('Memories CRUD', () => {
  let memId: number

  beforeAll(async () => {
    const { data } = await request('POST', '/api/memories', {
      body: {
        agent_id: 'nova',
        content: 'CRUD teszt memoria',
        tier: 'warm',
        keywords: 'crud, teszt',
      },
    })
    memId = (data as Record<string, unknown>).id as number
  })

  it('PUT /api/memories/:id frissiti a memoriat', async () => {
    const { status, data } = await request('PUT', `/api/memories/${memId}`, {
      body: { content: 'Frissitett memoria tartalom' },
    })
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })

  it('DELETE /api/memories/:id torli a memoriat', async () => {
    const { status, data } = await request('DELETE', `/api/memories/${memId}`)
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })
})

// ─── 13. Messages ───
describe('Messages', () => {
  let msgId: number

  it('POST /api/messages uzenetet kuld', async () => {
    const { status, data } = await request('POST', '/api/messages', {
      body: {
        from: 'nova',
        to: 'lexi',
        content: 'Teszt uzenet',
      },
    })
    expect(status).toBe(200)
    const obj = data as Record<string, unknown>
    expect(obj.id).toBeDefined()
    expect(obj.from_agent).toBe('nova')
    expect(obj.to_agent).toBe('lexi')
    msgId = obj.id as number
  })

  it('GET /api/messages listazza az uzeneteket', async () => {
    const { status, data } = await request('GET', '/api/messages?agent=lexi')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('PUT /api/messages/:id frissiti az uzenetet', async () => {
    if (!msgId) return
    const { status, data } = await request('PUT', `/api/messages/${msgId}`, {
      body: { status: 'done', result: 'Teszt befejezve' },
    })
    expect(status).toBe(200)
    expect((data as Record<string, unknown>).ok).toBe(true)
  })
})

// ─── 14. GET /api/status ───
describe('GET /api/status', () => {
  it('200 valaszt ad', async () => {
    const { status, data } = await request('GET', '/api/status')
    expect(status).toBe(200)
    expect(data).toBeTypeOf('object')
  })
})

// ─── 15. GET /api/agents ───
describe('GET /api/agents', () => {
  it('200 valaszt ad es tombot ad vissza', async () => {
    const { status, data } = await request('GET', '/api/agents')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── 16. GET /api/kanban/assignees ───
describe('GET /api/kanban/assignees', () => {
  it('200 valaszt ad es tombot ad vissza', async () => {
    const { status, data } = await request('GET', '/api/kanban/assignees')
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })
})

// ─── 17. Auth: vedett endpointok token nelkul ───
describe('Auth: uj route-ok token nelkul 401', () => {
  it('POST /api/daily-log token nelkul 401', async () => {
    const { status } = await request('POST', '/api/daily-log', {
      token: null,
      body: { agent_id: 'nova', content: 'nope' },
    })
    expect(status).toBe(401)
  })

  it('GET /api/daily-log token nelkul 401', async () => {
    const { status } = await request('GET', '/api/daily-log?agent=nova&date=2026-01-01', { token: null })
    expect(status).toBe(401)
  })

  it('GET /api/agents token nelkul 401', async () => {
    const { status } = await request('GET', '/api/agents', { token: null })
    expect(status).toBe(401)
  })

  it('POST /api/messages token nelkul 401', async () => {
    const { status } = await request('POST', '/api/messages', {
      token: null,
      body: { from: 'x', to: 'y', content: 'z' },
    })
    expect(status).toBe(401)
  })

  it('GET /api/status token nelkul 401', async () => {
    const { status } = await request('GET', '/api/status', { token: null })
    expect(status).toBe(401)
  })
})
