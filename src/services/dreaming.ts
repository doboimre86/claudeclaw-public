import { getDb, decayMemories } from '../db.js'
import { runAgent } from '../agent.js'
import { logger } from '../logger.js'

interface DreamReport {
  phase0: { decayed: number }
  phase1: { clustersFound: number; memoriesMerged: number; memoriesRemoved: number }
  phase2: { insightsGenerated: number }
  phase3: { hotPromoted: number; sharedPromoted: number; promoted: number; demoted: number; coldCleaned: number; touchLogCleaned: number }
  duration: number
  timestamp: string
}

let lastDreamReport: DreamReport | null = null

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/))
  const wordsB = new Set(b.toLowerCase().split(/\s+/))
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

async function lightSleep(agentId: string) {
  const db = getDb()
  const hotMemories = db.prepare(
    'SELECT id, content, keywords, salience FROM memories WHERE agent_id = ? AND category = ? ORDER BY created_at DESC'
  ).all(agentId, 'hot') as { id: number; content: string; salience: number; keywords: string }[]

  // Upstream code-review #7: Set<id> az O(n³) includes() helyett.
  const toDelete = new Set<number>()
  let merged = 0

  for (let i = 0; i < hotMemories.length; i++) {
    if (toDelete.has(hotMemories[i].id)) continue
    for (let j = i + 1; j < hotMemories.length; j++) {
      if (toDelete.has(hotMemories[j].id)) continue
      if (jaccardSimilarity(hotMemories[i].content, hotMemories[j].content) > 0.6) {
        const keep = hotMemories[i].salience >= hotMemories[j].salience ? i : j
        const drop = keep === i ? j : i
        toDelete.add(hotMemories[drop].id)
        merged++
      }
    }
  }

  if (toDelete.size > 0) {
    const ids = Array.from(toDelete)
    const ph = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM memories WHERE id IN (${ph})`).run(...ids)
  }

  return { clustersFound: Math.ceil(hotMemories.length / 3), memoriesMerged: merged, memoriesRemoved: toDelete.size }
}

async function remSleep(agentId: string) {
  const db = getDb()
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400
  const recentHot = db.prepare(
    'SELECT content FROM memories WHERE agent_id = ? AND category = ? AND created_at > ? ORDER BY created_at DESC LIMIT 30'
  ).all(agentId, 'hot', oneDayAgo) as { id: number; content: string; salience: number; keywords: string }[]
  const warmSample = db.prepare(
    'SELECT content FROM memories WHERE agent_id = ? AND category = ? ORDER BY salience DESC LIMIT 15'
  ).all(agentId, 'warm') as { id: number; content: string; salience: number; keywords: string }[]

  if (recentHot.length < 3) return { insightsGenerated: 0 }

  const hotText = recentHot.map((m) => '- ' + m.content).join('\n')
  const warmText = warmSample.map((m) => '- ' + m.content).join('\n')

  try {
    const { text } = await runAgent(
      'Analyze these recent memories and find patterns, connections, actionable insights.\n\n' +
      'Recent (last 24h):\n' + hotText + '\n\nLong-term:\n' + warmText +
      '\n\nGenerate 1-3 concrete insights. One sentence each, one per line, no prefixes.'
    )
    if (!text) return { insightsGenerated: 0 }

    const insights = text.split('\n').filter((l: string) => l.trim().length > 10).slice(0, 3)
    const today = new Date().toISOString().slice(0, 10)

    // chat_id required NOT NULL — dream-insight saját chat_id-re (nem kötődik user-hez)
    const dreamChatId = 'dream:' + agentId
    for (const insight of insights) {
      db.prepare(
        'INSERT INTO memories (chat_id, agent_id, content, sector, category, keywords, salience, created_at, accessed_at, auto_generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(dreamChatId, agentId, insight.trim(), 'semantic', 'warm', 'dream-insight, ' + today, 1.5, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), 1)
    }
    return { insightsGenerated: insights.length }
  } catch (err) {
    logger.error({ err }, 'REM sleep failed')
    return { insightsGenerated: 0 }
  }
}

async function deepSleep(agentId: string) {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  // Warm/Hot → shared PROMOTE: tartalom-alapú detekció.
  // Agent-isolation miatt a cross-agent touch-log nem praktikus (Zara
  // nem keres Nova privát rekordjaiban). Ezért a TARTALOM alapján
  // detektáljuk a közös értékű rekordokat:
  //  - Más agent nevét említi (pl. Nova rekord szövegében "Zara" vagy "Lexi")
  //  - "csapat", "közös", "mindenki", "team" kulcsszó
  //  - Explicit [Csapat ...] / [Team ...] / "közös memória" hivatkozás
  // Industry pattern (2026): "shared solution store" — ha egy tudás
  // több agent-nek releváns, ne duplikálja a munkát.
  const otherAgents = ['nova', 'zara', 'lexi', 'codeagent'].filter(a => a !== agentId)
  const agentNamePatterns = otherAgents.map(a => `%${a}%`)
  const sharedPromoted = db.prepare(`
    UPDATE memories SET category = 'shared'
    WHERE agent_id = ?
      AND category IN ('warm', 'hot')
      AND (
        LOWER(content) LIKE ? OR
        LOWER(content) LIKE ? OR
        LOWER(content) LIKE ? OR
        LOWER(content) LIKE '%csapat összefoglaló%' OR
        LOWER(content) LIKE '%csapat osszefoglalo%' OR
        LOWER(content) LIKE '%közös memória%' OR
        LOWER(content) LIKE '%kozos memoria%' OR
        LOWER(content) LIKE '%shared memory%' OR
        LOWER(content) LIKE '%minden agent%'
      )
  `).run(agentId, ...agentNamePatterns)

  // Warm → hot PROMOTE: aktív + magas salience-ű warm rekordok hot-ba.
  // A touchMemory minden olvasáskor +0.1 salience-t ad, tehát gyakran
  // hivatkozott rekordok 3.0 fölé mennek. accessed_at < 24h = most is aktív.
  const hotPromoted = db.prepare(
    'UPDATE memories SET category = ? WHERE agent_id = ? AND category = ? AND salience >= ? AND accessed_at > ?'
  ).run('hot', agentId, 'warm', 3.0, now - 24 * 3600)

  // Hot → warm: csak ha a rekord MÁR NEM AKTÍV
  //   - salience <2.0 (lebomlott) VAGY
  //   - accessed_at >3 napos (nem érinti senki)
  // A created_at NEM számít — egy régi rekord is maradhat hot-ban, ha még mindig
  // aktív. (Ez volt a bug: a frissen promote-olt rekordokat a régi created_at
  // condition azonnal visszadobta warm-ba.)
  const promoted = db.prepare(
    'UPDATE memories SET category = ? WHERE agent_id = ? AND category = ? AND (salience < ? OR accessed_at < ?)'
  ).run('warm', agentId, 'hot', 2.0, now - 3 * 86400)

  // Warm → cold: 14 napnál régebbi + alacsony salience (bomlás után)
  const demoted = db.prepare(
    'UPDATE memories SET category = ? WHERE agent_id = ? AND category = ? AND salience < ? AND accessed_at < ?'
  ).run('cold', agentId, 'warm', 1.5, now - 14 * 86400)

  // Cold tisztogatás: csak nagyon alacsony salience + régi
  const cleaned = db.prepare(
    'DELETE FROM memories WHERE agent_id = ? AND category = ? AND salience < ? AND accessed_at < ?'
  ).run(agentId, 'cold', 0.2, now - 90 * 86400)

  // Touch log tisztogatás: 30 napnál régebbi bejegyzések törlése
  // (a shared promote 7 napos window-ot néz, 30 nap bőven elég audit-hoz)
  const touchLogCleaned = db.prepare(
    'DELETE FROM memory_touches WHERE touched_at < ?'
  ).run(now - 30 * 86400)

  return {
    hotPromoted: (hotPromoted as { changes?: number }).changes || 0,
    sharedPromoted: (sharedPromoted as { changes?: number }).changes || 0,
    promoted: (promoted as { changes?: number }).changes || 0,
    demoted: (demoted as { changes?: number }).changes || 0,
    coldCleaned: (cleaned as { changes?: number }).changes || 0,
    touchLogCleaned: (touchLogCleaned as { changes?: number }).changes || 0
  }
}

export async function runDreamCycle(agentId: string = 'nova'): Promise<DreamReport> {
  const start = Date.now()
  logger.info({ agentId }, 'Dream cycle starting')
  // Phase 0: salience decay (minden agent cycle-nél, de globális DB műveletként)
  const decayed = decayMemories()
  const phase0 = { decayed }
  const phase1 = await lightSleep(agentId)
  const phase2 = await remSleep(agentId)
  const phase3 = await deepSleep(agentId)

  const report: DreamReport = { phase0, phase1, phase2, phase3, duration: Date.now() - start, timestamp: new Date().toISOString() }
  lastDreamReport = report
  logger.info({ report }, 'Dream cycle complete')
  return report
}

export function getLastDreamReport(): DreamReport | null { return lastDreamReport }

let dreamCycleInterval: ReturnType<typeof setInterval> | null = null

export function stopDreamCycle(): void {
  if (dreamCycleInterval) {
    clearInterval(dreamCycleInterval)
    dreamCycleInterval = null
  }
}

export function scheduleDreamCycle() {
  let lastRunDate = ''
  const tick = async () => {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    // 03:00 ± catch-up: ha ma még nem futott és már elmúlt 03:00, futtassuk most
    // (ez lefedi azt is, amikor a dashboard restart közben éppen 03:00 volt)
    const shouldRun = lastRunDate !== today && now.getHours() >= 3
    if (shouldRun) {
      lastRunDate = today
      try {
        await runDreamCycle('nova')
        try { await runDreamCycle('zara') } catch {}
      } catch (err) { logger.error({ err }, 'Scheduled dream cycle failed') }
    }
  }
  // Első tick azonnal (startup-katch-up), utána percenként
  tick().catch(() => {})
  // code-review #8: mentjük az intervalt, hogy shutdown-kor lezárható legyen.
  if (dreamCycleInterval) clearInterval(dreamCycleInterval)
  dreamCycleInterval = setInterval(tick, 60000)
  logger.info('Dream cycle scheduler started (daily at 03:00, with catch-up)')
}
