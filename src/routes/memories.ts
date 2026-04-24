import {
  searchMemories, getMemoriesForChat, getDb,
  saveAgentMemory, getAgentMemories, searchAgentMemories,
  getMemoryStats, updateMemory, hybridSearch, backfillEmbeddings,
  type Memory,
} from '../db.js'
import { ALLOWED_CHAT_ID, OLLAMA_URL } from '../config.js'
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import type { RouteContext } from './types.js'

export async function memoriesRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, url, req, res } = ctx

  if (path === '/api/memories' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { agent_id?: string; content: string; tier?: string; category?: string; keywords?: string }
    if (!data.content?.trim()) { json(res, { error: 'Content is required' }, 400); return true }
    const tier = data.tier || data.category || 'warm'
    const result = saveAgentMemory(data.agent_id || 'nova', data.content.trim(), tier, data.keywords || undefined, true)
    json(res, { ok: true, id: result.id })
    return true
  }

  if (path === '/api/memories' && method === 'GET') {
    const q = url.searchParams.get('q')?.trim() || ''
    // Security #15: LIKE escape — %_\\ karakterek escape-elése hogy
    // q='%' ne legyen "minden rekord" query. ESCAPE '\\' a LIKE mintában.
    const qEsc = q.replace(/[\\%_]/g, c => '\\' + c)
    const agentId = url.searchParams.get('agent') || ''
    const tier = url.searchParams.get('tier') || url.searchParams.get('category') || ''
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    const mode = url.searchParams.get('mode') || 'fts'
    let results: Memory[]
    if (q && mode === 'hybrid') {
      results = await hybridSearch(agentId || 'nova', q, limit)
    } else if (q && agentId) {
      results = searchAgentMemories(agentId, q, limit)
      if (results.length === 0) {
        const db2 = getDb()
        results = db2.prepare("SELECT * FROM memories WHERE (agent_id = ? OR category = 'shared') AND (content LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\') ORDER BY accessed_at DESC LIMIT ?").all(agentId, `%${qEsc}%`, `%${qEsc}%`, limit) as Memory[]
      }
    } else if (q) {
      results = searchMemories(q, ALLOWED_CHAT_ID, limit)
      if (results.length === 0) {
        const db2 = getDb()
        results = db2.prepare("SELECT * FROM memories WHERE content LIKE ? ESCAPE '\\' ORDER BY accessed_at DESC LIMIT ?").all(`%${qEsc}%`, limit) as Memory[]
      }
    } else if (agentId && !tier) {
      results = getAgentMemories(agentId, limit)
    } else if (tier) {
      // Tier-szűrés DB-szinten: ha csak tier alapján listázunk (nincs q),
      // közvetlen query — így a limit a szűrt eredményre vonatkozik,
      // nem a limit 50-ből szűrünk 5-öt.
      const db2 = getDb()
      if (agentId) {
        results = db2.prepare(
          "SELECT * FROM memories WHERE (agent_id = ? OR category = 'shared') AND category = ? ORDER BY accessed_at DESC LIMIT ?"
        ).all(agentId, tier, limit) as Memory[]
      } else {
        results = db2.prepare(
          "SELECT * FROM memories WHERE category = ? ORDER BY accessed_at DESC LIMIT ?"
        ).all(tier, limit) as Memory[]
      }
    } else {
      results = getMemoriesForChat(ALLOWED_CHAT_ID, limit)
    }
    const formatted = results.map(m => ({
      ...m, embedding: undefined,
      created_label: new Date(m.created_at * 1000).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' }),
      accessed_label: new Date(m.accessed_at * 1000).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' }),
    }))
    json(res, formatted)
    return true
  }

  if (path === '/api/memories/import' && method === 'POST') {
    const body = await readBody(req)
    const { agent_id, chunks } = JSON.parse(body.toString()) as { agent_id: string; chunks: string[] }
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) { json(res, { error: 'No chunks to import' }, 400); return true }
    const agentId = agent_id || 'nova'
    const stats = { hot: 0, warm: 0, cold: 0, shared: 0 }
    let imported = 0
    let categorizeModel: string | null = null
    try {
      const ollamaModels = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.json() as Promise<{ models?: { name: string }[] }>).then(d => (d.models || []).filter(m => !m.name.includes('embed')).map(m => m.name)).catch(() => [] as string[])
      categorizeModel = ollamaModels.find((m: string) => m.includes('gemma4')) || ollamaModels[0] || null
    } catch { categorizeModel = null }
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      if (!categorizeModel) { saveAgentMemory(agentId, chunk, 'warm', '', true); stats.warm++; imported++; continue }
      try {
        const catResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: categorizeModel, prompt: `Categorize this memory into exactly one tier and generate keywords.\n\nMemory: "${chunk.slice(0, 500)}"\n\nTiers:\n- hot: active tasks, pending decisions, things happening NOW\n- warm: preferences, config, project context, stable knowledge\n- cold: long-term lessons, historical decisions, archive\n- shared: information relevant to multiple agents\n\nRespond ONLY with JSON, nothing else:\n{"tier": "warm", "keywords": "keyword1, keyword2, keyword3"}`, stream: false }),
          signal: AbortSignal.timeout(90000),
        })
        const catData = await catResponse.json() as { response?: string }
        let tier = 'warm'; let keywords = ''
        try {
          const jsonMatch = (catData.response || '').match(/\{[\s\S]*\}/)
          if (jsonMatch) { const parsed = JSON.parse(jsonMatch[0]); tier = ['hot', 'warm', 'cold', 'shared'].includes(parsed.tier) ? parsed.tier : 'warm'; keywords = parsed.keywords || '' }
        } catch {}
        saveAgentMemory(agentId, chunk, tier, keywords, true); stats[tier as keyof typeof stats]++; imported++
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200))
      } catch { saveAgentMemory(agentId, chunk, 'warm', '', true); stats.warm++; imported++ }
    }
    logger.info({ agentId, imported, stats }, 'Migráció befejezve')
    json(res, { ok: true, imported, stats })
    return true
  }

  if (path === '/api/memories/backfill' && method === 'POST') {
    try { const count = await backfillEmbeddings(); json(res, { ok: true, count }); return true }
    catch (err) { logger.error({ err }, 'Backfill failed'); json(res, { error: 'Backfill failed' }, 500); return true }
  }

  if (path === '/api/memories/stats' && method === 'GET') {
    json(res, getMemoryStats())
    return true
  }

  const memUpdateMatch = path.match(/^\/api\/memories\/(\d+)$/)
  if (memUpdateMatch && method === 'PUT') {
    const id = parseInt(memUpdateMatch[1], 10)
    const body = await readBody(req)
    const { content, category, tier, agent_id, keywords } = JSON.parse(body.toString()) as { content: string; category?: string; tier?: string; agent_id?: string; keywords?: string }
    if (updateMemory(id, content, tier || category, agent_id, keywords)) { json(res, { ok: true }); return true }
    json(res, { error: 'Memory not found' }, 404)
    return true
  }
  if (memUpdateMatch && method === 'DELETE') {
    const id = parseInt(memUpdateMatch[1], 10)
    const db2 = getDb()
    const changes = db2.prepare('DELETE FROM memories WHERE id = ?').run(id).changes
    if (changes > 0) { json(res, { ok: true }); return true }
    json(res, { error: 'Memory not found' }, 404)
    return true
  }

  return false
}
