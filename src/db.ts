import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, existsSync, chmodSync, openSync, closeSync } from 'node:fs'
import { STORE_DIR, ALLOWED_CHAT_ID, OLLAMA_URL } from './config.js'
import { logger } from './logger.js'
import { extractEntities, entitiesToKeywords } from './utils/entity-extract.js'

let db: Database.Database

// DB fájl és sidecar-ok (WAL, SHM, journal) owner-only (0600) módra állítása.
// Védekezés TOCTOU ellen: default umask (0644) miatt más lokális process
// (malicious npm postinstall, rogue script) elolvashatná.
// Upstream #38 ihletésre — biztonsági hardening.
function tightenDbPermissions(dbPath: string): void {
  const sidecars = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]
  for (const path of sidecars) {
    if (!existsSync(path)) continue
    try { chmodSync(path, 0o600) } catch (err) {
      logger.warn({ err, path }, 'DB file permission tightening failed')
    }
  }
}

export function initDatabase(): void {
  mkdirSync(STORE_DIR, { recursive: true })
  const dbPath = join(STORE_DIR, 'claudeclaw.db')
  // TOCTOU-race zárás: frissen telepített DB fájl atomic 0600 módú létrehozása
  // mielőtt a better-sqlite3 megnyitná (default umask helyett).
  if (!existsSync(dbPath)) {
    try { closeSync(openSync(dbPath, 'wx', 0o600)) } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EEXIST') {
        logger.warn({ err, dbPath }, 'DB pre-create failed, continuing; mode will be tightened post-open')
      }
    }
  }
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  tightenDbPermissions(dbPath)
  db.pragma('synchronous = NORMAL')
  db.pragma('wal_autocheckpoint = 1000')
  db.pragma('cache_size = -32000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Migráció: message_count oszlop hozzáadása meglévő DB-hez
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0')
  } catch {
    // már létezik, rendben
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='id'
    )
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)

  // Drop the legacy scheduled_tasks table — replaced by file-based scheduler.
  // Idempotent: IF EXISTS so re-runs are no-ops once dropped.
  db.exec(`DROP INDEX IF EXISTS idx_tasks_status_next`)
  db.exec(`DROP TABLE IF EXISTS scheduled_tasks`)

  // --- Agent state (mood + energy + last activity) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_state (
      agent_id TEXT PRIMARY KEY,
      mood TEXT NOT NULL DEFAULT 'neutral' CHECK(mood IN ('happy','alert','curious','calm','tired','cautious','sad','focused','neutral')),
      energy INTEGER NOT NULL DEFAULT 50 CHECK(energy >= 0 AND energy <= 100),
      last_feedback TEXT,
      last_feedback_at INTEGER,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_state_updated ON agent_state(updated_at DESC)`)

  // --- Kanban ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','waiting','done')),
      assignee TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      due_date INTEGER,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    )
  `)
  // Migration: add blocked_by and labels columns to kanban_cards
  try {
    db.exec("ALTER TABLE kanban_cards ADD COLUMN blocked_by TEXT DEFAULT NULL")
  } catch { /* column exists */ }
  try {
    db.exec("ALTER TABLE kanban_cards ADD COLUMN labels TEXT DEFAULT NULL")
  } catch { /* column exists */ }

  // Migration: add agent_id, category, auto_generated columns to memories
  try {
    db.exec("ALTER TABLE memories ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'nova'")
  } catch {
    // column already exists
  }
  try {
    db.exec("ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('user_pref','project','feedback','learning','shared','general'))")
  } catch {
    // column already exists
  }
  try {
    db.exec('ALTER TABLE memories ADD COLUMN auto_generated INTEGER NOT NULL DEFAULT 0')
  } catch {
    // column already exists
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, category)`)

  // Migration: hot/warm/cold tier system + keywords column
  // Recreate memories table without restrictive CHECK constraint on category
  try {
    const hasOldCheck = db.prepare("SELECT sql FROM sqlite_master WHERE name='memories'").get() as { sql: string } | undefined
    if (hasOldCheck?.sql?.includes("'user_pref'")) {
      db.exec(`
        CREATE TABLE memories_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          topic_key TEXT,
          content TEXT NOT NULL,
          sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
          salience REAL NOT NULL DEFAULT 1.0,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          agent_id TEXT NOT NULL DEFAULT 'nova',
          category TEXT NOT NULL DEFAULT 'warm',
          auto_generated INTEGER NOT NULL DEFAULT 0,
          keywords TEXT
        );
        INSERT INTO memories_new SELECT id, chat_id, topic_key, content, sector, salience, created_at, accessed_at, agent_id,
          CASE category
            WHEN 'user_pref' THEN 'warm'
            WHEN 'project' THEN 'warm'
            WHEN 'general' THEN 'warm'
            WHEN 'feedback' THEN 'cold'
            WHEN 'learning' THEN 'cold'
            WHEN 'shared' THEN 'shared'
            ELSE 'warm'
          END,
          auto_generated, NULL FROM memories;
        DROP TABLE memories;
        ALTER TABLE memories_new RENAME TO memories;
      `)
      // Recreate FTS and triggers for new schema (now includes keywords)
      db.exec(`DROP TABLE IF EXISTS memories_fts`)
      db.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(content, keywords, content='memories', content_rowid='id')`)
      db.exec(`DROP TRIGGER IF EXISTS memories_ai`)
      db.exec(`DROP TRIGGER IF EXISTS memories_ad`)
      db.exec(`DROP TRIGGER IF EXISTS memories_au`)
      db.exec(`CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords); END`)
      db.exec(`CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES('delete', old.id, old.content, old.keywords); END`)
      db.exec(`CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES('delete', old.id, old.content, old.keywords); INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords); END`)
      db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, category)`)
    }
  } catch {
    // Migration already done or not needed
  }

  // If the table already has the new schema but no keywords column (edge case)
  try {
    db.exec('ALTER TABLE memories ADD COLUMN keywords TEXT')
  } catch {
    // column already exists
  }

  // Migration: embedding column for vector search
  try {
    db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT')
  } catch {
    // column already exists
  }

  // Memory touch log — trackeli melyik agent mikor érintett egy rekordot.
  // Használat: dream cycle shared auto-promote (ha több agent érintette
  // az utolsó 7 napban → shared tier). Append-only tábla, napi cron
  // törölheti a régi (>30 napos) bejegyzéseket.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_touches (
      memory_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      touched_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_touches_memory ON memory_touches(memory_id, touched_at DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_touches_recent ON memory_touches(touched_at DESC)`)

  // Daily logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(agent_id, date)`)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_status ON kanban_cards(status, archived_at)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_comments_card ON kanban_comments(card_id)`)

  // --- Agent Messages ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','done','failed')),
      result TEXT,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      completed_at INTEGER
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_messages_status ON agent_messages(status, to_agent)`)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_chat_accessed ON memories(chat_id, accessed_at DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_priority_status ON kanban_cards(priority, status, archived_at)`)

  // --- Hot-path indexes (avoid temp b-tree sort on common queries) ---
  // Message router: SELECT ... WHERE status=? AND to_agent=? ORDER BY created_at ASC
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_messages_pending_created ON agent_messages(status, to_agent, created_at)`)
  // Kanban board load: SELECT ... WHERE archived_at IS NULL ORDER BY sort_order ASC
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kanban_archived_sort ON kanban_cards(archived_at, sort_order)`)

  // --- Chat messages (dashboard chat history) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL DEFAULT 'nova',
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_agent ON chat_messages(agent, created_at DESC)`)

  // --- Usage tracking ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL DEFAULT 'nova',
      source TEXT NOT NULL DEFAULT 'chat',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      model TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_log_agent_date ON usage_log(agent, created_at DESC)`)

  // Periodic WAL checkpoint — keeps WAL file size bounded (runs every 30 min)
  setInterval(() => {
    try { db.pragma('wal_checkpoint(PASSIVE)') } catch (err) { logger.warn({ err }, 'WAL checkpoint failed') }
  }, 30 * 60 * 1000).unref()
}
export function getDb(): Database.Database {
  return db
}

// --- Munkamenetek ---

export function getSession(chatId: string): { sessionId: string; messageCount: number } | undefined {
  const row = db
    .prepare('SELECT session_id, message_count FROM sessions WHERE chat_id = ?')
    .get(chatId) as { session_id: string; message_count: number } | undefined
  if (!row) return undefined
  return { sessionId: row.session_id, messageCount: row.message_count }
}

export function setSession(chatId: string, sessionId: string, messageCount = 0): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (chat_id, session_id, updated_at, message_count) VALUES (?, ?, ?, ?)'
  ).run(chatId, sessionId, Math.floor(Date.now() / 1000), messageCount)
}

export function incrementSessionCount(chatId: string): number {
  db.prepare('UPDATE sessions SET message_count = message_count + 1 WHERE chat_id = ?').run(chatId)
  const row = db.prepare('SELECT message_count FROM sessions WHERE chat_id = ?').get(chatId) as { message_count: number } | undefined
  return row?.message_count ?? 0
}

export function clearSession(chatId: string): void {
  db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId)
}

// --- Memória ---

export interface Memory {
  id: number
  chat_id: string
  topic_key: string | null
  content: string
  sector: 'semantic' | 'episodic'
  salience: number
  created_at: number
  accessed_at: number
  agent_id: string
  category: string  // 'hot' | 'warm' | 'cold' | 'shared'
  auto_generated: number
  keywords: string | null
  embedding: string | null
}

export function saveMemory(
  chatId: string,
  content: string,
  sector: 'semantic' | 'episodic',
  topicKey?: string
): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at) VALUES (?, ?, ?, ?, 1.0, ?, ?)'
  ).run(chatId, topicKey ?? null, content, sector, now, now)
}

export function searchMemories(query: string, chatId: string, limit = 3): Memory[] {
  const sanitized = query.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
  if (!sanitized) return []
  const terms = sanitized
    .split(/\s+/)
    .map((t) => t + '*')
    .join(' ')
  try {
    // Kombinált ranking: FTS5 bm25 rank (kisebb = jobb egyezés) + salience boost.
    // A rank általában negatív float, a salience 0.01..5.0 közt mozog.
    // effective_score = rank / (1 + salience)  — magasabb salience → kisebb (jobb) score
    return db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN memories_fts f ON m.id = f.rowid
         WHERE f.content MATCH ? AND m.chat_id = ?
         ORDER BY (f.rank / (1.0 + COALESCE(m.salience, 1.0))) ASC
         LIMIT ?`
      )
      .all(terms, chatId, limit) as Memory[]
  } catch {
    return []
  }
}

export function recentMemories(chatId: string, limit = 5): Memory[] {
  return db
    .prepare('SELECT * FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?')
    .all(chatId, limit) as Memory[]
}

export function touchMemory(id: number, agentId?: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0) WHERE id = ?'
  ).run(now, id)
  // Shared auto-promote bemenet: ha tudjuk ki érintette, logoljuk
  if (agentId) {
    db.prepare('INSERT INTO memory_touches (memory_id, agent_id, touched_at) VALUES (?, ?, ?)').run(id, agentId, now)
  }
}

export function decayMemories(): number {
  const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 86400
  // Szeliden bomlik: 0.5% naponként, csak a 1 hétnél régebben ÉRINTETT emlékekre
  // (accessed_at alapján, így ha valaki ránéz egy régi emlékre, az a touchMemory révén újraindul).
  // SOHA nem törlünk — a salience csak csökken, minimum 0.01-ig.
  const result = db
    .prepare('UPDATE memories SET salience = MAX(salience * 0.995, 0.01) WHERE accessed_at < ?')
    .run(oneWeekAgo)
  return (result as { changes?: number }).changes || 0
}

export function getMemoriesForChat(chatId: string, limit = 10): Memory[] {
  return db
    .prepare('SELECT * FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?')
    .all(chatId, limit) as Memory[]
}

// Deduplikáció: ellenőrzi, hogy van-e nagyon hasonló tartalmú emlék
function findDuplicate(agentId: string, content: string): Memory | null {
  // Pontos egyezés
  const exact = db.prepare(
    "SELECT * FROM memories WHERE agent_id = ? AND content = ? LIMIT 1"
  ).get(agentId, content) as Memory | undefined
  if (exact) return exact

  // Hasonlóság: az első 100 karakter egyezése (gyors szűrő)
  const prefix = content.slice(0, 100)
  const similar = db.prepare(
    "SELECT * FROM memories WHERE agent_id = ? AND content LIKE ? ORDER BY accessed_at DESC LIMIT 5"
  ).all(agentId, prefix + '%') as Memory[]
  for (const m of similar) {
    // Jaccard-szerű hasonlóság: szavak átfedése
    const words1 = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    const words2 = new Set(m.content.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    if (words1.size === 0 || words2.size === 0) continue
    const intersection = [...words1].filter(w => words2.has(w)).length
    const union = new Set([...words1, ...words2]).size
    if (union > 0 && intersection / union > 0.7) return m
  }
  return null
}

export function saveAgentMemory(
  agentId: string,
  content: string,
  tier: string,  // hot, warm, cold, shared
  keywords?: string,
  autoGenerated: boolean = false
): { id: number } {
  // Deduplikáció: ha nagyon hasonló emlék már létezik, frissítjük
  const dup = findDuplicate(agentId, content)
  if (dup) {
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE memories SET content = ?, accessed_at = ?, salience = MIN(salience + 0.1, 5.0), category = ?, keywords = COALESCE(?, keywords) WHERE id = ?')
      .run(content, now, tier, keywords ?? null, dup.id)
    logger.info({ id: dup.id, agentId }, 'Memória deduplikálva — meglévő frissítve')
    return { id: dup.id }
  }

  const now = Math.floor(Date.now() / 1000)
  // Auto-enrich keywords with extracted entities (MyCompany Ltd, Jane Doe, example.com, etc.)
  const enrichedKeywords = entitiesToKeywords(extractEntities(content), keywords)
  const info = db.prepare(
    'INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at, agent_id, category, auto_generated, keywords) VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, ?, ?, ?)'
  ).run(ALLOWED_CHAT_ID, null, content, 'semantic', now, now, agentId, tier, autoGenerated ? 1 : 0, enrichedKeywords || null)
  const id = Number(info.lastInsertRowid)

  // Fire-and-forget: generate embedding asynchronously
  generateEmbedding(content + (keywords ? ' ' + keywords : '')).then(emb => {
    if (emb) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(emb), id)
    }
  }).catch((err) => { logger.warn({ err }, 'Embedding generation failed') })

  return { id }
}

// Refresh-on-Read: frissíti az accessed_at-ot és növeli a salience-t.
// Ha `touchingAgentId` meg van adva, logoljuk a memory_touches táblába is —
// ez vezérli a shared auto-promote-ot (ha több agent érint egy rekordot).
function touchResults(results: Memory[], touchingAgentId?: string): Memory[] {
  if (results.length === 0) return results
  const now = Math.floor(Date.now() / 1000)
  const ids = results.map(m => m.id)
  // Perf: egy IN query N UPDATE helyett.
  const ph = ids.map(() => '?').join(',')
  db.prepare(
    `UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.05, 5.0) WHERE id IN (${ph})`
  ).run(now, ...ids)
  // Touch log — csak ha tudjuk melyik agent hívta a keresést
  if (touchingAgentId) {
    const insertTouch = db.prepare('INSERT INTO memory_touches (memory_id, agent_id, touched_at) VALUES (?, ?, ?)')
    const tx = db.transaction((memoryIds: number[]) => {
      for (const id of memoryIds) insertTouch.run(id, touchingAgentId, now)
    })
    tx(ids)
  }
  return results
}

export function getAgentMemories(agentId: string, limit: number = 20): Memory[] {
  return touchResults(db.prepare(
    "SELECT * FROM memories WHERE (agent_id = ? OR category = 'shared') ORDER BY accessed_at DESC LIMIT ?"
  ).all(agentId, limit) as Memory[], agentId)
}

export function searchAgentMemories(agentId: string, query: string, limit: number = 10): Memory[] {
  const sanitized = query.replace(/[^\p{L}\p{N}\s]/gu, '').trim()
  if (!sanitized) return []
  const terms = sanitized.split(/\s+/).map(t => t + '*').join(' ')
  try {
    return touchResults(db.prepare(
      `SELECT m.* FROM memories m
       JOIN memories_fts f ON m.id = f.rowid
       WHERE f.memories_fts MATCH ? AND (m.agent_id = ? OR m.category = 'shared')
       ORDER BY rank LIMIT ?`
    ).all(terms, agentId, limit) as Memory[], agentId)
  } catch {
    return touchResults(db.prepare(
      "SELECT * FROM memories WHERE (agent_id = ? OR category = 'shared') AND (content LIKE ? OR keywords LIKE ?) ORDER BY accessed_at DESC LIMIT ?"
    ).all(agentId, `%${query}%`, `%${query}%`, limit) as Memory[], agentId)
  }
}

export function getMemoryStats(): { total: number; byAgent: Record<string, number>; byTier: Record<string, number>; withEmbedding: number } {
  const total = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as {c:number}).c
  const withEmbedding = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL').get() as {c:number}).c
  const agentRows = db.prepare('SELECT agent_id, COUNT(*) as c FROM memories GROUP BY agent_id').all() as {agent_id:string, c:number}[]
  const tierRows = db.prepare('SELECT category, COUNT(*) as c FROM memories GROUP BY category').all() as {category:string, c:number}[]
  const byAgent: Record<string, number> = {}
  const byTier: Record<string, number> = {}
  for (const r of agentRows) byAgent[r.agent_id] = r.c
  for (const r of tierRows) byTier[r.category] = r.c
  return { total, byAgent, byTier, withEmbedding }
}

export function updateMemory(id: number, content: string, category?: string, agentId?: string, keywords?: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  const sets: string[] = ['content = ?', 'accessed_at = ?']
  const params: unknown[] = [content, now]
  if (category) { sets.push('category = ?'); params.push(category) }
  if (agentId) { sets.push('agent_id = ?'); params.push(agentId) }
  if (keywords !== undefined) { sets.push('keywords = ?'); params.push(keywords) }
  params.push(id)
  return db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params).changes > 0
}

// --- Daily logs ---

export function appendDailyLog(agentId: string, content: string): void {
  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().split('T')[0]
  db.prepare('INSERT INTO daily_logs (agent_id, date, content, created_at) VALUES (?, ?, ?, ?)').run(agentId, today, content, now)
}

export function getDailyLog(agentId: string, date: string): { id: number; content: string; created_at: number }[] {
  return db.prepare('SELECT id, content, created_at FROM daily_logs WHERE agent_id = ? AND date = ? ORDER BY created_at ASC').all(agentId, date) as { id: number; content: string; created_at: number }[]
}

export function getDailyLogDates(agentId: string, limit: number = 14): string[] {
  return (db.prepare('SELECT DISTINCT date FROM daily_logs WHERE agent_id = ? ORDER BY date DESC LIMIT ?').all(agentId, limit) as { date: string }[]).map(r => r.date)
}

// Legacy scheduled_tasks functions removed -- replaced by file-based scheduler (services/scheduler.ts)

// --- Kanban ---

export interface KanbanCard {
  id: string
  title: string
  description: string | null
  status: 'planned' | 'in_progress' | 'waiting' | 'done'
  assignee: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_date: number | null
  sort_order: number
  created_at: number
  updated_at: number
  archived_at: number | null
  blocked_by: string | null   // comma-separated card IDs
  labels: string | null       // comma-separated labels
}

export interface KanbanComment {
  id: number
  card_id: string
  author: string
  content: string
  created_at: number
}

export function listKanbanCards(): KanbanCard[] {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400
  // Auto-archive done cards older than 30 days
  db.prepare(
    "UPDATE kanban_cards SET archived_at = ? WHERE status = 'done' AND archived_at IS NULL AND updated_at < ?"
  ).run(Math.floor(Date.now() / 1000), thirtyDaysAgo)
  return db
    .prepare('SELECT * FROM kanban_cards WHERE archived_at IS NULL ORDER BY sort_order ASC')
    .all() as KanbanCard[]
}

export function listKanbanCardsSummary(): { status: string; title: string; assignee: string | null; priority: string; id: string }[] {
  return db
    .prepare("SELECT id, title, status, assignee, priority FROM kanban_cards WHERE archived_at IS NULL ORDER BY status, sort_order ASC")
    .all() as any[]
}

export function getKanbanCard(id: string): KanbanCard | undefined {
  return db.prepare('SELECT * FROM kanban_cards WHERE id = ?').get(id) as KanbanCard | undefined
}

export function createKanbanCard(card: {
  id: string
  title: string
  description?: string
  status?: KanbanCard['status']
  assignee?: string
  priority?: KanbanCard['priority']
  due_date?: number
  blocked_by?: string
  labels?: string
}): void {
  const now = Math.floor(Date.now() / 1000)
  const status = card.status ?? 'planned'
  // Get max sort_order for that status column
  const maxRow = db.prepare(
    'SELECT MAX(sort_order) as m FROM kanban_cards WHERE status = ? AND archived_at IS NULL'
  ).get(status) as { m: number | null }
  const sortOrder = (maxRow?.m ?? -1) + 1

  db.prepare(
    `INSERT INTO kanban_cards (id, title, description, status, assignee, priority, due_date, sort_order, created_at, updated_at, blocked_by, labels)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    card.id, card.title, card.description ?? null, status,
    card.assignee ?? null, card.priority ?? 'normal',
    card.due_date ?? null, sortOrder, now, now,
    card.blocked_by ?? null, card.labels ?? null
  )
}

export function updateKanbanCard(id: string, fields: Partial<Omit<KanbanCard, 'id' | 'created_at'>>): boolean {
  const card = getKanbanCard(id)
  if (!card) return false
  const now = Math.floor(Date.now() / 1000)
  const f = { ...card, ...fields, updated_at: now }
  return db.prepare(
    `UPDATE kanban_cards SET title=?, description=?, status=?, assignee=?, priority=?, due_date=?, sort_order=?, updated_at=?, archived_at=?, blocked_by=?, labels=?
     WHERE id=?`
  ).run(f.title, f.description, f.status, f.assignee, f.priority, f.due_date, f.sort_order, f.updated_at, f.archived_at, f.blocked_by, f.labels, id).changes > 0
}

export function getAgentTasks(agentName: string): { assigned: KanbanCard[]; blocked: KanbanCard[]; actionable: KanbanCard[] } {
  const allCards = listKanbanCards()
  const doneIds = new Set(allCards.filter(c => c.status === 'done').map(c => c.id))

  const assigned = allCards.filter(c =>
    c.assignee?.toLowerCase() === agentName.toLowerCase() && c.status !== 'done'
  )

  const blocked: KanbanCard[] = []
  const actionable: KanbanCard[] = []

  for (const card of assigned) {
    if (card.blocked_by) {
      const blockerIds = card.blocked_by.split(',').map(s => s.trim()).filter(Boolean)
      const unresolvedBlockers = blockerIds.filter(bid => !doneIds.has(bid))
      if (unresolvedBlockers.length > 0) {
        blocked.push(card)
        continue
      }
    }
    actionable.push(card)
  }

  return { assigned, blocked, actionable }
}

export function moveKanbanCard(id: string, status: KanbanCard['status'], sortOrder: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return db.prepare(
    'UPDATE kanban_cards SET status=?, sort_order=?, updated_at=? WHERE id=?'
  ).run(status, sortOrder, now, id).changes > 0
}

export function archiveKanbanCard(id: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  return db.prepare('UPDATE kanban_cards SET archived_at=?, updated_at=? WHERE id=?').run(now, now, id).changes > 0
}

export function deleteKanbanCard(id: string): boolean {
  // Tranzakció — ha a második DELETE meghal, a commentek törlése is rollback-elődik.
  const tx = db.transaction((cardId: string): boolean => {
    db.prepare('DELETE FROM kanban_comments WHERE card_id = ?').run(cardId)
    return db.prepare('DELETE FROM kanban_cards WHERE id = ?').run(cardId).changes > 0
  })
  return tx(id)
}

export function getKanbanComments(cardId: string): KanbanComment[] {
  return db.prepare('SELECT * FROM kanban_comments WHERE card_id = ? ORDER BY created_at ASC').all(cardId) as KanbanComment[]
}

export function addKanbanComment(cardId: string, author: string, content: string): KanbanComment {
  const now = Math.floor(Date.now() / 1000)
  const info = db.prepare(
    'INSERT INTO kanban_comments (card_id, author, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(cardId, author, content, now)
  db.prepare('UPDATE kanban_cards SET updated_at = ? WHERE id = ?').run(now, cardId)
  return { id: Number(info.lastInsertRowid), card_id: cardId, author, content, created_at: now }
}

// --- Heartbeat helpers ---

export interface HeartbeatKanbanSummary {
  urgent: KanbanCard[]
  in_progress: KanbanCard[]
  waiting: KanbanCard[]
}

export function getHeartbeatKanbanSummary(): HeartbeatKanbanSummary {
  const urgent = db
    .prepare("SELECT * FROM kanban_cards WHERE archived_at IS NULL AND priority = 'urgent' AND status != 'done'")
    .all() as KanbanCard[]
  const in_progress = db
    .prepare("SELECT * FROM kanban_cards WHERE archived_at IS NULL AND status = 'in_progress'")
    .all() as KanbanCard[]
  const waiting = db
    .prepare("SELECT * FROM kanban_cards WHERE archived_at IS NULL AND status = 'waiting'")
    .all() as KanbanCard[]
  return { urgent, in_progress, waiting }
}

// --- Agent Messages ---

export interface AgentMessage {
  id: number
  from_agent: string
  to_agent: string
  content: string
  status: 'pending' | 'delivered' | 'done' | 'failed'
  result: string | null
  created_at: number
  delivered_at: number | null
  completed_at: number | null
}

export function createAgentMessage(from: string, to: string, content: string): AgentMessage {
  const now = Math.floor(Date.now() / 1000)
  const info = db.prepare(
    'INSERT INTO agent_messages (from_agent, to_agent, content, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(from, to, content, 'pending', now)
  return {
    id: Number(info.lastInsertRowid),
    from_agent: from, to_agent: to, content, status: 'pending',
    result: null, created_at: now, delivered_at: null, completed_at: null,
  }
}

export function getPendingMessages(toAgent?: string): AgentMessage[] {
  if (toAgent) {
    return db.prepare("SELECT * FROM agent_messages WHERE status = 'pending' AND to_agent = ? ORDER BY created_at ASC")
      .all(toAgent) as AgentMessage[]
  }
  return db.prepare("SELECT * FROM agent_messages WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as AgentMessage[]
}

export function markMessageDelivered(id: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return db.prepare("UPDATE agent_messages SET status = 'delivered', delivered_at = ? WHERE id = ?").run(now, id).changes > 0
}

export function markMessageDone(id: number, result?: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  // Ha delivered_at még NULL (pl. egyből done-ra ugrott), állítsuk be most,
  // hogy analitika / SLA mérés tudjon vele számolni.
  return db.prepare("UPDATE agent_messages SET status = 'done', result = ?, completed_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?").run(result ?? null, now, now, id).changes > 0
}

export function markMessageFailed(id: number, error?: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  return db.prepare("UPDATE agent_messages SET status = 'failed', result = ?, completed_at = ? WHERE id = ?").run(error ?? null, now, id).changes > 0
}

export function listAgentMessages(limit = 50): AgentMessage[] {
  return db.prepare('SELECT * FROM agent_messages ORDER BY created_at DESC LIMIT ?').all(limit) as AgentMessage[]
}

export function getAgentMessage(id: number): AgentMessage | undefined {
  return db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as AgentMessage | undefined
}

// Legacy getActiveScheduledTaskCount removed -- use listScheduledTasks() from services/scheduler.ts

// --- Chat Messages (dashboard chat history) ---

export interface ChatMessage {
  id: number
  agent: string
  role: 'user' | 'assistant' | 'system'
  content: string
  session_id: string | null
  created_at: number
}

export function saveChatMessage(agent: string, role: 'user' | 'assistant' | 'system', content: string, sessionId?: string): ChatMessage {
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(
    'INSERT INTO chat_messages (agent, role, content, session_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(agent, role, content, sessionId || null, now)
  return { id: Number(result.lastInsertRowid), agent, role, content, session_id: sessionId || null, created_at: now }
}

export function getChatHistory(agent: string, limit = 50): ChatMessage[] {
  return db.prepare('SELECT * FROM chat_messages WHERE agent = ? ORDER BY created_at DESC LIMIT ?')
    .all(agent, limit) as ChatMessage[]
}

export function clearChatHistory(agent: string): number {
  return db.prepare('DELETE FROM chat_messages WHERE agent = ?').run(agent).changes
}

// --- Usage Tracking ---

export interface UsageEntry {
  id: number
  agent: string
  source: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  model: string | null
  session_id: string | null
  created_at: number
}

export function logUsage(data: { agent?: string; source?: string; inputTokens: number; outputTokens: number; costUsd: number; model?: string; sessionId?: string }): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO usage_log (agent, source, input_tokens, output_tokens, cost_usd, model, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(data.agent || 'nova', data.source || 'chat', data.inputTokens, data.outputTokens, data.costUsd, data.model || null, data.sessionId || null, now)
}

export function getUsageStats(agent?: string, days = 30): { totalCost: number; totalInput: number; totalOutput: number; entries: number; daily: { date: string; cost: number; tokens: number }[] } {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const whereClause = agent ? 'WHERE agent = ? AND created_at >= ?' : 'WHERE created_at >= ?'
  const params = agent ? [agent, since] : [since]

  const totals = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost, COALESCE(SUM(input_tokens),0) as input, COALESCE(SUM(output_tokens),0) as output, COUNT(*) as entries FROM usage_log ${whereClause}`).get(...params) as { cost: number; input: number; output: number; entries: number }

  const daily = db.prepare(`SELECT date(created_at, 'unixepoch', 'localtime') as date, SUM(cost_usd) as cost, SUM(input_tokens + output_tokens) as tokens FROM usage_log ${whereClause} GROUP BY date ORDER BY date DESC LIMIT 30`).all(...params) as { date: string; cost: number; tokens: number }[]

  return { totalCost: totals.cost, totalInput: totals.input, totalOutput: totals.output, entries: totals.entries, daily }
}

// --- Vector Search (Ollama + nomic-embed-text) ---

const EMBED_MODEL = 'nomic-embed-text'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 2000) }),
    })
    const data = await resp.json() as { embedding?: number[] }
    return data.embedding || null
  } catch {
    return null
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  // Védelem division-by-zero ellen (nulla-vektor esetén NaN-t adna, ami sort-ban
  // véletlenszerű helyre kerül). 0-ra esést jelzünk ami a ranking végére kerül.
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function vectorSearch(agentId: string, queryEmbedding: number[], limit: number = 10): Memory[] {
  const rows = db.prepare(
    "SELECT * FROM memories WHERE embedding IS NOT NULL AND (agent_id = ? OR category = 'shared')"
  ).all(agentId) as Memory[]

  const scored = rows.map(m => {
    try {
      const emb = JSON.parse(m.embedding!) as number[]
      return { memory: m, score: cosineSimilarity(queryEmbedding, emb) }
    } catch {
      return { memory: m, score: 0 }
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.memory)
}

export async function hybridSearch(agentId: string, query: string, limit: number = 10): Promise<Memory[]> {
  const k = 60 // RRF constant

  // FTS5 results
  const ftsResults = searchAgentMemories(agentId, query, limit * 2)

  // Vector results
  const queryEmbedding = await generateEmbedding(query)
  const vecResults = queryEmbedding ? vectorSearch(agentId, queryEmbedding, limit * 2) : []

  // Reciprocal Rank Fusion
  const scores: Map<number, number> = new Map()
  const byId: Map<number, Memory> = new Map()

  ftsResults.forEach((m, rank) => {
    scores.set(m.id, (scores.get(m.id) || 0) + 1 / (k + rank + 1))
    byId.set(m.id, m)
  })

  vecResults.forEach((m, rank) => {
    scores.set(m.id, (scores.get(m.id) || 0) + 1 / (k + rank + 1))
    byId.set(m.id, m)
  })

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  return ranked.slice(0, limit).map(([id]) => byId.get(id)!)
}

export async function backfillEmbeddings(): Promise<number> {
  const rows = db.prepare('SELECT id, content, keywords FROM memories WHERE embedding IS NULL').all() as { id: number; content: string; keywords: string | null }[]
  let count = 0
  for (const row of rows) {
    const text = row.content + (row.keywords ? ' ' + row.keywords : '')
    const emb = await generateEmbedding(text)
    if (emb) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(emb), row.id)
      count++
    }
    // Small delay to not overwhelm Ollama
    await new Promise(r => setTimeout(r, 100))
  }
  return count
}
