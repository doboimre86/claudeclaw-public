import { randomUUID } from 'node:crypto'
import {
  listKanbanCards, createKanbanCard, updateKanbanCard,
  moveKanbanCard, archiveKanbanCard, deleteKanbanCard,
  getKanbanComments, addKanbanComment, getAgentTasks,
} from '../db.js'
import { OWNER_NAME } from '../config.js'
import { readBody, json } from '../utils/http.js'
import { listAgentNames } from '../services/agent-manager.js'
import type { RouteContext } from './types.js'

// Mass-assignment védelem: csak az explicit whitelisten szereplő mezőket
// fogadjuk el user input-ból. A created_at, updated_at, archived_at, id
// csak a szerver oldalon állítódnak.
const KANBAN_CARD_FIELDS = ['title', 'description', 'status', 'assignee', 'priority', 'due_date', 'sort_order', 'blocked_by', 'labels'] as const
function pickKanbanFields(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {}
  const obj = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of KANBAN_CARD_FIELDS) {
    if (k in obj) out[k] = obj[k]
  }
  return out
}

// Security #25: kanban card ID formátum szigorítás.
// UUID-slice(0,8) hex, de user-input is kerülhet ide — korlátozzuk
// [a-zA-Z0-9_-]{1,64}-ra. Üres vagy illegális → null.
function sanitizeKanbanId(raw: string): string | null {
  if (!raw || raw.length > 64) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) return null
  return raw
}

export async function kanbanRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res } = ctx

  if (path === '/api/kanban' && method === 'GET') {
    json(res, listKanbanCards())
    return true
  }

  // Agent-specific tasks: assigned, blocked, actionable
  const agentTasksMatch = path.match(/^\/api\/kanban\/agent\/([^/]+)$/)
  if (agentTasksMatch && method === 'GET') {
    const agentName = decodeURIComponent(agentTasksMatch[1])
    json(res, getAgentTasks(agentName))
    return true
  }

  // Labels: list all unique labels
  if (path === '/api/kanban/labels' && method === 'GET') {
    const cards = listKanbanCards()
    const labelSet = new Set<string>()
    for (const card of cards) {
      if (card.labels) {
        for (const l of card.labels.split(',')) {
          const trimmed = l.trim()
          if (trimmed) labelSet.add(trimmed)
        }
      }
    }
    json(res, [...labelSet].sort())
    return true
  }

  if (path === '/api/kanban/assignees' && method === 'GET') {
    const agents = listAgentNames().map((name) => ({ name, type: 'agent' }))
    json(res, [{ name: OWNER_NAME, type: 'owner' }, { name: 'Nova', type: 'bot' }, ...agents])
    return true
  }

  if (path === '/api/kanban' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    // Upstream code-review #13: mass-assignment védelem — explicit whitelist,
    // nem `...data` spread. Így pl. `created_at`, `archived_at`, `id` injektálás
    // nem jut át (a szerver kezeli őket saját jogán).
    const id = randomUUID().slice(0, 8)
    const safe = pickKanbanFields(data)
    if (typeof safe.title !== 'string' || !safe.title.trim()) {
      json(res, { error: 'Title is required' }, 400)
      return true
    }
    createKanbanCard({ id, ...safe } as Parameters<typeof createKanbanCard>[0])
    json(res, { ok: true, id })
    return true
  }

  const kanbanCardMatch = path.match(/^\/api\/kanban\/([^/]+)$/)
  if (kanbanCardMatch && method === 'PUT') {
    const id = sanitizeKanbanId(decodeURIComponent(kanbanCardMatch[1]))
    if (!id) { json(res, { error: 'Invalid card ID' }, 400); return true }
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    const safe = pickKanbanFields(data)
    if (updateKanbanCard(id, safe as Parameters<typeof updateKanbanCard>[1])) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }
  if (kanbanCardMatch && method === 'DELETE') {
    const id = sanitizeKanbanId(decodeURIComponent(kanbanCardMatch[1]))
    if (!id) { json(res, { error: 'Invalid card ID' }, 400); return true }
    if (deleteKanbanCard(id)) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  const kanbanMoveMatch = path.match(/^\/api\/kanban\/([^/]+)\/move$/)
  if (kanbanMoveMatch && method === 'POST') {
    const id = sanitizeKanbanId(decodeURIComponent(kanbanMoveMatch[1]))
    if (!id) { json(res, { error: 'Invalid card ID' }, 400); return true }
    const body = await readBody(req)
    const { status, sort_order } = JSON.parse(body.toString())
    if (moveKanbanCard(id, status, sort_order ?? 0)) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  const kanbanArchiveMatch = path.match(/^\/api\/kanban\/([^/]+)\/archive$/)
  if (kanbanArchiveMatch && method === 'POST') {
    const id = sanitizeKanbanId(decodeURIComponent(kanbanArchiveMatch[1]))
    if (!id) { json(res, { error: 'Invalid card ID' }, 400); return true }
    if (archiveKanbanCard(id)) { json(res, { ok: true }); return true }
    json(res, { error: 'Kártya nem található' }, 404)
    return true
  }

  const kanbanCommentsMatch = path.match(/^\/api\/kanban\/([^/]+)\/comments$/)
  if (kanbanCommentsMatch && method === 'GET') {
    const cardId = sanitizeKanbanId(decodeURIComponent(kanbanCommentsMatch[1]))
    if (!cardId) { json(res, { error: 'Invalid card ID' }, 400); return true }
    json(res, getKanbanComments(cardId))
    return true
  }
  if (kanbanCommentsMatch && method === 'POST') {
    const cardId = sanitizeKanbanId(decodeURIComponent(kanbanCommentsMatch[1]))
    if (!cardId) { json(res, { error: 'Invalid card ID' }, 400); return true }
    const body = await readBody(req)
    const { author, content } = JSON.parse(body.toString())
    if (!author || !content) { json(res, { error: 'Szerző és tartalom kötelező' }, 400); return true }
    json(res, addKanbanComment(cardId, author, content))
    return true
  }

  return false
}
